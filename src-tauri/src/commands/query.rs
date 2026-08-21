use crate::db::mysql::{
    disambiguate, get_opt_string, get_string, quote_ident, result_columns, row_to_json,
    row_to_json_named,
};
use crate::error::{AppError, AppResult};
use crate::state::AppState;
use futures_util::TryStreamExt;
use mysql_async::prelude::Queryable;
use serde::{Deserialize, Serialize};
use serde_json::Value;
use sqlx::mysql::MySqlRow;
use sqlx::{Column, Either, Executor, MySqlPool, Row};
use std::collections::HashSet;
use std::sync::atomic::Ordering;
use std::time::Duration;
use tauri::{AppHandle, Emitter, State};

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct TableInfo {
    pub name: String,
    pub kind: String,
    pub estimated_rows: Option<u64>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ColumnInfo {
    pub name: String,
    pub data_type: String,
    pub nullable: bool,
    pub key: String,
    /// The column's COMMENT, if any (empty string when none). Surfaced as a
    /// styled tooltip on the table-view column header.
    #[serde(default)]
    pub comment: String,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RowsResult {
    pub columns: Vec<ColumnInfo>,
    pub rows: Vec<Value>,
    pub total: Option<u64>,
    pub limit: u32,
    pub offset: u32,
}

/// One statement's outcome within an ad-hoc query run. For result-set
/// statements (SELECT/SHOW/etc.) `columns`/`rows` carry the data and
/// `rows_affected` is None. For statements with no result set
/// (INSERT/UPDATE/DELETE/DDL) `rows_affected` is set and `rows` is empty.
#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct StatementResult {
    pub columns: Vec<ColumnInfo>,
    pub rows: Vec<Value>,
    pub rows_affected: Option<u64>,
    /// True when this result set was capped at `max_rows` and more rows existed.
    pub truncated: bool,
}

/// Result of an ad-hoc query run: one entry per statement (a compound script
/// separated by `;` produces several).
#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct QueryResult {
    pub results: Vec<StatementResult>,
    /// Server-side execution time for the whole run (excludes row decoding), ms.
    pub elapsed_ms: u64,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum SortDirection {
    Asc,
    Desc,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SortSpec {
    pub column: String,
    pub direction: SortDirection,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum FilterOp {
    Equals,
    /// `col <> ?`
    Ne,
    Like,
    /// `col NOT LIKE ?`
    NotLike,
    /// `col IS NULL` — takes no value.
    IsNull,
    /// `col IS NOT NULL` — takes no value.
    NotNull,
    /// `col > ?`
    Gt,
    /// `col >= ?`
    Gte,
    /// `col < ?`
    Lt,
    /// `col <= ?`
    Lte,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ColumnFilter {
    pub column: String,
    pub op: FilterOp,
    pub value: String,
    /// JSON columns only: dotted property path (e.g. "address.city"). When set,
    /// the filter targets that JSON property instead of the whole column.
    #[serde(default)]
    pub json_path: Option<String>,
}

/// Auto-wrap `value` with `%` for "contains" semantics, unless the user has
/// already supplied wildcards (`%` or `_`) — then pass through verbatim.
fn prepare_like_value(value: &str) -> String {
    if value.contains('%') || value.contains('_') {
        value.to_string()
    } else {
        format!("%{value}%")
    }
}

/// Infer a JSON value from raw filter text: a bare integer/float becomes a JSON
/// number, `true`/`false`/`null` become those literals, and everything else is
/// a string. Wrapping in double quotes (e.g. `"33"`) forces a string.
fn infer_json_value(raw: &str) -> Value {
    let v = raw.trim();
    if v.len() >= 2 && v.starts_with('"') && v.ends_with('"') {
        return Value::String(v[1..v.len() - 1].to_string());
    }
    if v.eq_ignore_ascii_case("true") {
        return Value::Bool(true);
    }
    if v.eq_ignore_ascii_case("false") {
        return Value::Bool(false);
    }
    if v.eq_ignore_ascii_case("null") {
        return Value::Null;
    }
    if let Ok(n) = v.parse::<i64>() {
        return Value::Number(n.into());
    }
    if let Ok(f) = v.parse::<f64>() {
        if let Some(num) = serde_json::Number::from_f64(f) {
            return Value::Number(num);
        }
    }
    Value::String(v.to_string())
}

/// One path segment with an optional `[key=value]` array selector.
struct PathSeg {
    key: String,
    pred: Option<(String, String)>,
}

/// Parse a property path into segments. Splits on `.` but not inside `[…]` (so
/// selector values may contain dots), and parses a trailing `[key=value]`
/// selector. e.g. `answers[q=eArrest.02].v`.
fn parse_json_path(path: &str) -> Vec<PathSeg> {
    let mut tokens: Vec<String> = Vec::new();
    let mut buf = String::new();
    let mut depth: i32 = 0;
    for ch in path.chars() {
        match ch {
            '[' => {
                depth += 1;
                buf.push(ch);
            }
            ']' => {
                depth = (depth - 1).max(0);
                buf.push(ch);
            }
            '.' if depth == 0 => {
                if !buf.trim().is_empty() {
                    tokens.push(buf.trim().to_string());
                }
                buf.clear();
            }
            _ => buf.push(ch),
        }
    }
    if !buf.trim().is_empty() {
        tokens.push(buf.trim().to_string());
    }
    tokens
        .iter()
        .map(|tok| {
            if let Some(open) = tok.find('[') {
                if tok.ends_with(']') {
                    let key = tok[..open].trim().to_string();
                    let inner = &tok[open + 1..tok.len() - 1];
                    if let Some(eq) = inner.find('=') {
                        return PathSeg {
                            key,
                            pred: Some((
                                inner[..eq].trim().to_string(),
                                inner[eq + 1..].trim().to_string(),
                            )),
                        };
                    }
                    return PathSeg { key, pred: None };
                }
            }
            PathSeg {
                key: tok.to_string(),
                pred: None,
            }
        })
        .collect()
}

/// Recursively build the nested candidate value. A selector merges its key/value
/// into the same element object as the continuing path, so a correlated filter
/// like `answers[q=eArrest.02].v = 3001001` becomes
/// `{"answers":{"q":"eArrest.02","v":3001001}}` — matching an element that has
/// *both*.
fn build_candidate(segs: &[PathSeg], leaf: Value) -> Value {
    let Some(seg) = segs.first() else {
        return leaf;
    };
    let rest_val = build_candidate(&segs[1..], leaf);
    let mapped = if let Some((pk, pv)) = &seg.pred {
        let mut obj = serde_json::Map::new();
        obj.insert(pk.clone(), infer_json_value(pv));
        if let Value::Object(rest_obj) = rest_val {
            for (k, v) in rest_obj {
                obj.insert(k, v);
            }
        }
        Value::Object(obj)
    } else {
        rest_val
    };
    if seg.key.is_empty() {
        return mapped;
    }
    let mut o = serde_json::Map::new();
    o.insert(seg.key.clone(), mapped);
    Value::Object(o)
}

/// Build a candidate JSON object for `JSON_CONTAINS` from a property path and a
/// value — e.g. ("address.city", "NYC") → `{"address":{"city":"NYC"}}`.
fn json_candidate(path: &str, value: &str) -> String {
    let segs = parse_json_path(path);
    if segs.is_empty() {
        return infer_json_value(value).to_string();
    }
    build_candidate(&segs, infer_json_value(value)).to_string()
}

/// Build a recursive `JSON_SEARCH` path for a property — e.g. "address.city" →
/// `$**."address"."city"`, matching the key at any depth. `[k=v]` selectors are
/// dropped here (JSON_SEARCH is a fuzzy text match and can't correlate).
fn json_search_path(path: &str) -> String {
    let mut p = String::from("$**");
    for seg in parse_json_path(path) {
        if seg.key.is_empty() {
            continue;
        }
        let escaped = seg.key.replace('\\', "\\\\").replace('"', "\\\"");
        p.push_str(&format!(".\"{escaped}\""));
    }
    p
}

/// Build the `WHERE …` clause and ordered bind values for the given filters.
/// Returns an empty string when there are no filters.
fn build_where(
    filters: Option<&Vec<ColumnFilter>>,
    column_set: &HashSet<&str>,
) -> AppResult<(String, Vec<String>)> {
    let mut where_clauses: Vec<String> = Vec::new();
    let mut bindings: Vec<String> = Vec::new();
    if let Some(fs) = filters {
        for f in fs {
            if !column_set.contains(f.column.as_str()) {
                return Err(AppError::Other(format!(
                    "unknown filter column: {}",
                    f.column
                )));
            }
            let ident = quote_ident(&f.column);
            let json_path = f
                .json_path
                .as_deref()
                .map(str::trim)
                .filter(|s| !s.is_empty());
            match &f.op {
                /* Comparison operators apply to the column directly (no JSON
                   path); IS [NOT] NULL take no bound value. */
                FilterOp::IsNull => {
                    where_clauses.push(format!("{ident} IS NULL"));
                }
                FilterOp::NotNull => {
                    where_clauses.push(format!("{ident} IS NOT NULL"));
                }
                FilterOp::Ne => {
                    where_clauses.push(format!("{ident} <> ?"));
                    bindings.push(f.value.clone());
                }
                FilterOp::NotLike => {
                    where_clauses.push(format!("{ident} NOT LIKE ?"));
                    bindings.push(prepare_like_value(&f.value));
                }
                FilterOp::Gt => {
                    where_clauses.push(format!("{ident} > ?"));
                    bindings.push(f.value.clone());
                }
                FilterOp::Gte => {
                    where_clauses.push(format!("{ident} >= ?"));
                    bindings.push(f.value.clone());
                }
                FilterOp::Lt => {
                    where_clauses.push(format!("{ident} < ?"));
                    bindings.push(f.value.clone());
                }
                FilterOp::Lte => {
                    where_clauses.push(format!("{ident} <= ?"));
                    bindings.push(f.value.clone());
                }
                FilterOp::Equals | FilterOp::Like => match (json_path, &f.op) {
                    (Some(path), FilterOp::Equals) => {
                        where_clauses.push(format!("JSON_CONTAINS({ident}, CAST(? AS JSON))"));
                        bindings.push(json_candidate(path, &f.value));
                    }
                    (Some(path), FilterOp::Like) => {
                        where_clauses
                            .push(format!("JSON_SEARCH({ident}, 'one', ?, NULL, ?) IS NOT NULL"));
                        bindings.push(prepare_like_value(&f.value));
                        bindings.push(json_search_path(path));
                    }
                    (None, FilterOp::Equals) => {
                        where_clauses.push(format!("{ident} = ?"));
                        bindings.push(f.value.clone());
                    }
                    (None, FilterOp::Like) => {
                        where_clauses.push(format!("{ident} LIKE ?"));
                        bindings.push(prepare_like_value(&f.value));
                    }
                    _ => unreachable!(),
                },
            }
        }
    }
    let where_clause = if where_clauses.is_empty() {
        String::new()
    } else {
        format!(" WHERE {}", where_clauses.join(" AND "))
    };
    Ok((where_clause, bindings))
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PkValue {
    pub column: String,
    pub value: Option<String>,
}

async fn pool_for<'a>(
    state: &'a State<'_, AppState>,
    profile_id: &str,
) -> AppResult<MySqlPool> {
    let pools = state.pools.read().await;
    pools
        .get(profile_id)
        .cloned()
        .ok_or_else(|| AppError::NotConnected(profile_id.to_string()))
}

#[tauri::command]
pub async fn list_databases(
    state: State<'_, AppState>,
    profile_id: String,
) -> AppResult<Vec<String>> {
    let pool = pool_for(&state, &profile_id).await?;
    let rows = sqlx::query(
        "SELECT SCHEMA_NAME FROM INFORMATION_SCHEMA.SCHEMATA \
         ORDER BY SCHEMA_NAME",
    )
    .fetch_all(&pool)
    .await?;
    Ok(rows.iter().map(|r| get_string(r, 0)).collect())
}

#[tauri::command]
pub async fn list_tables(
    state: State<'_, AppState>,
    profile_id: String,
    database: String,
) -> AppResult<Vec<TableInfo>> {
    let pool = pool_for(&state, &profile_id).await?;
    let rows = sqlx::query(
        "SELECT TABLE_NAME, TABLE_TYPE, TABLE_ROWS \
         FROM INFORMATION_SCHEMA.TABLES \
         WHERE TABLE_SCHEMA = ? \
         ORDER BY TABLE_NAME",
    )
    .bind(&database)
    .fetch_all(&pool)
    .await?;

    Ok(rows
        .iter()
        .map(|r| TableInfo {
            name: get_string(r, 0),
            kind: {
                let s = get_string(r, 1);
                if s.is_empty() { "BASE TABLE".to_string() } else { s }
            },
            estimated_rows: r.try_get::<Option<i64>, _>(2).ok().flatten().map(|n| n as u64),
        })
        .collect())
}

async fn fetch_columns(
    pool: &MySqlPool,
    database: &str,
    table: &str,
) -> AppResult<Vec<ColumnInfo>> {
    let rows = sqlx::query(
        "SELECT COLUMN_NAME, COLUMN_TYPE, IS_NULLABLE, COLUMN_KEY, COLUMN_COMMENT \
         FROM INFORMATION_SCHEMA.COLUMNS \
         WHERE TABLE_SCHEMA = ? AND TABLE_NAME = ? \
         ORDER BY ORDINAL_POSITION",
    )
    .bind(database)
    .bind(table)
    .fetch_all(pool)
    .await?;
    Ok(rows
        .iter()
        .map(|r| ColumnInfo {
            name: get_string(r, 0),
            data_type: get_string(r, 1),
            nullable: get_string(r, 2) == "YES",
            key: get_string(r, 3),
            comment: get_string(r, 4),
        })
        .collect())
}

#[tauri::command]
pub async fn fetch_rows(
    state: State<'_, AppState>,
    profile_id: String,
    database: String,
    table: String,
    limit: u32,
    offset: u32,
    sort: Option<SortSpec>,
    filters: Option<Vec<ColumnFilter>>,
) -> AppResult<RowsResult> {
    let pool = pool_for(&state, &profile_id).await?;
    let columns = fetch_columns(&pool, &database, &table).await?;
    let column_set: HashSet<&str> = columns.iter().map(|c| c.name.as_str()).collect();

    let safe_limit = limit.clamp(1, 5000);
    let qualified = format!("{}.{}", quote_ident(&database), quote_ident(&table));

    let (where_clause, bindings) = build_where(filters.as_ref(), &column_set)?;

    let order_clause = if let Some(s) = sort.as_ref() {
        if !column_set.contains(s.column.as_str()) {
            return Err(AppError::Other(format!(
                "unknown sort column: {}",
                s.column
            )));
        }
        let dir = match s.direction {
            SortDirection::Asc => "ASC",
            SortDirection::Desc => "DESC",
        };
        format!(" ORDER BY {} {dir}", quote_ident(&s.column))
    } else {
        String::new()
    };

    let sql = format!(
        "SELECT * FROM {qualified}{where_clause}{order_clause} LIMIT {safe_limit} OFFSET {offset}"
    );
    let mut q = sqlx::query(&sql);
    for v in &bindings {
        q = q.bind(v);
    }
    let rows = q.fetch_all(&pool).await?;
    let json_rows: Vec<Value> = rows.iter().map(row_to_json).collect();

    /* Cheap row-count estimate from table statistics. Only meaningful for the
       whole table — with an active filter we can't estimate, so return None and
       let the UI offer an on-demand exact count. */
    let total: Option<u64> = if where_clause.is_empty() {
        let est = sqlx::query(
            "SELECT TABLE_ROWS FROM INFORMATION_SCHEMA.TABLES \
             WHERE TABLE_SCHEMA = ? AND TABLE_NAME = ?",
        )
        .bind(&database)
        .bind(&table)
        .fetch_optional(&pool)
        .await?;
        est.and_then(|r| r.try_get::<Option<i64>, _>(0).ok().flatten())
            .map(|n| n.max(0) as u64)
    } else {
        None
    };

    Ok(RowsResult {
        columns,
        rows: json_rows,
        total,
        limit: safe_limit,
        offset,
    })
}

#[tauri::command]
pub async fn list_columns(
    state: State<'_, AppState>,
    profile_id: String,
    database: String,
    table: String,
) -> AppResult<Vec<ColumnInfo>> {
    let pool = pool_for(&state, &profile_id).await?;
    fetch_columns(&pool, &database, &table).await
}

#[tauri::command]
pub async fn count_rows(
    state: State<'_, AppState>,
    profile_id: String,
    database: String,
    table: String,
    filters: Option<Vec<ColumnFilter>>,
) -> AppResult<u64> {
    let pool = pool_for(&state, &profile_id).await?;
    let columns = fetch_columns(&pool, &database, &table).await?;
    let column_set: HashSet<&str> = columns.iter().map(|c| c.name.as_str()).collect();
    let qualified = format!("{}.{}", quote_ident(&database), quote_ident(&table));
    let (where_clause, bindings) = build_where(filters.as_ref(), &column_set)?;

    let sql = format!("SELECT COUNT(*) FROM {qualified}{where_clause}");
    let mut q = sqlx::query(&sql);
    for v in &bindings {
        q = q.bind(v);
    }
    let row = q.fetch_one(&pool).await?;
    let n: i64 = row.try_get(0).unwrap_or(0);
    Ok(n.max(0) as u64)
}

#[tauri::command]
pub async fn table_exists(
    state: State<'_, AppState>,
    profile_id: String,
    database: String,
    table: String,
) -> AppResult<bool> {
    let pool = pool_for(&state, &profile_id).await?;
    let row = sqlx::query(
        "SELECT COUNT(*) FROM INFORMATION_SCHEMA.TABLES \
         WHERE TABLE_SCHEMA = ? AND TABLE_NAME = ?",
    )
    .bind(&database)
    .bind(&table)
    .fetch_one(&pool)
    .await?;
    let n: i64 = row.try_get(0).unwrap_or(0);
    Ok(n > 0)
}

/// Run a CREATE TABLE statement built by the designer. All statements run on a
/// single pooled connection so `USE` sticks. When `overwrite` is set the table
/// is dropped first (destructive — the caller must have confirmed).
#[tauri::command]
pub async fn create_table(
    state: State<'_, AppState>,
    profile_id: String,
    database: String,
    table_name: String,
    sql: String,
    overwrite: bool,
) -> AppResult<()> {
    let pool = pool_for(&state, &profile_id).await?;
    let mut conn = pool.acquire().await?;
    /* Run as raw (simple-protocol) statements: `USE` and most DDL aren't allowed
       through MySQL's prepared-statement protocol (error 1295), which is what
       `sqlx::query(...)` uses. Passing a &str to `execute` uses COM_QUERY. */
    (&mut *conn)
        .execute(format!("USE {}", quote_ident(&database)).as_str())
        .await?;
    if overwrite {
        (&mut *conn)
            .execute(format!("DROP TABLE IF EXISTS {}", quote_ident(&table_name)).as_str())
            .await?;
    }
    (&mut *conn).execute(sql.as_str()).await?;
    Ok(())
}

/// Copy a table to another database. When the target is on the same connection,
/// `CREATE TABLE ... LIKE` (+ `INSERT ... SELECT`) reproduces the full structure
/// (columns, indexes, primary key) and rows entirely server-side. When the
/// target is a different connection (possibly a different server), the structure
/// is reproduced from `SHOW CREATE TABLE` and the rows are streamed across.
/// The copy is named `target_table` when given (used by same-database "duplicate
/// as `{name}_copy`"), otherwise it keeps the source table's name (used when
/// copying into a different database). It is aborted (with a clear error) if that
/// name is already taken in the target database, so nothing existing is ever
/// overwritten. Returns `false` when the user cancels mid-copy (the
/// partially-written target table is dropped so nothing is left behind).
/**
 * The copy's destination uses a dedicated mysql_async connection instead of
 * the app's sqlx pool: mysql_async implements MySQL protocol compression
 * (CLIENT_COMPRESS), which sqlx lacks, and bulk INSERT text compresses ~10:1
 * — the difference between a WAN copy taking seconds and taking minutes. It
 * also cuts exposure to wire corruption by the same factor. SSL mirrors the
 * profile's Use SSL setting with sqlx-Preferred semantics (no cert checks).
 */
fn copy_dest_opts(
    profile: &crate::store::profiles::ConnectionProfile,
    password: &str,
    database: &str,
) -> mysql_async::Opts {
    let mut builder = mysql_async::OptsBuilder::default()
        .ip_or_hostname(profile.host.clone())
        .tcp_port(profile.port)
        .user(Some(profile.username.clone()))
        .pass(Some(password.to_string()))
        .db_name(Some(database.to_string()))
        .compression(mysql_async::Compression::fast());
    if profile.use_ssl {
        builder = builder.ssl_opts(
            mysql_async::SslOpts::default()
                .with_danger_accept_invalid_certs(true)
                .with_danger_skip_domain_validation(true),
        );
    }
    builder.into()
}

fn dst_err(e: mysql_async::Error) -> AppError {
    AppError::Other(format!("target database error: {e}"))
}

/**
 * Execute one multi-row INSERT batch on the destination, surviving transient
 * network/TLS failures (this network path has been observed corrupting
 * sustained TLS uploads at roughly one record per few hundred MB). On an I/O
 * error the dead connection is replaced with a fresh one, and COUNT(*) on the
 * target table (which only this copy writes to) decides whether the failed
 * statement actually applied before the link died — so a retry never
 * duplicates rows.
 */
async fn execute_batch_with_reconnect(
    opts: &mysql_async::Opts,
    dst_conn: &mut mysql_async::Conn,
    dest_table: &str,
    stmt: &str,
    rows_before: u64,
    batch_len: u64,
) -> AppResult<()> {
    let mut attempts: u32 = 0;
    loop {
        let err = match dst_conn.query_drop(stmt).await {
            Ok(()) => return Ok(()),
            Err(e) => e,
        };
        attempts += 1;
        let transient = matches!(err, mysql_async::Error::Io(_));
        if !transient || attempts >= 5 {
            return Err(dst_err(err));
        }
        tokio::time::sleep(Duration::from_millis(500 * attempts as u64)).await;
        *dst_conn = mysql_async::Conn::new(opts.clone()).await.map_err(dst_err)?;
        let count: i64 = dst_conn
            .query_first(format!("SELECT COUNT(*) FROM {}", quote_ident(dest_table)))
            .await
            .map_err(dst_err)?
            .unwrap_or(0);
        if count as u64 >= rows_before + batch_len {
            return Ok(());
        }
    }
}

#[tauri::command]
pub async fn copy_table(
    app: AppHandle,
    state: State<'_, AppState>,
    profile_id: String,
    source_database: String,
    source_table: String,
    target_profile_id: Option<String>,
    target_database: String,
    target_table: Option<String>,
    include_data: bool,
) -> AppResult<bool> {
    state.cancel_copy.store(false, Ordering::Relaxed);

    let dest_table = target_table.unwrap_or_else(|| source_table.clone());

    let cross_connection = target_profile_id
        .as_deref()
        .is_some_and(|t| t != profile_id);

    if !cross_connection {
        return copy_table_same_connection(
            &state,
            &profile_id,
            &source_database,
            &source_table,
            &target_database,
            &dest_table,
            include_data,
        )
        .await;
    }

    let target_profile = target_profile_id.unwrap();
    let src_pool = pool_for(&state, &profile_id).await?;

    let dest_profile = crate::store::profiles::get(&app, &target_profile)?;
    let dest_password = crate::store::secrets::get_password(&target_profile)?.ok_or_else(|| {
        AppError::Other(format!("no password stored for profile {target_profile}"))
    })?;
    let dest_opts = copy_dest_opts(&dest_profile, &dest_password, &target_database);
    let mut dst_conn = mysql_async::Conn::new(dest_opts.clone())
        .await
        .map_err(|e| AppError::Other(format!("could not connect to target: {e}")))?;

    let exists: i64 = dst_conn
        .exec_first(
            "SELECT COUNT(*) FROM INFORMATION_SCHEMA.TABLES \
             WHERE TABLE_SCHEMA = ? AND TABLE_NAME = ?",
            (&target_database, &source_table),
        )
        .await
        .map_err(dst_err)?
        .unwrap_or(0);
    if exists > 0 {
        return Err(AppError::Other(format!(
            "a table named \"{source_table}\" already exists in \"{target_database}\""
        )));
    }

    let qualified_src = format!(
        "{}.{}",
        quote_ident(&source_database),
        quote_ident(&source_table)
    );

    /* Reproduce the structure from the source's own DDL (SHOW CREATE TABLE
       returns (Table, "Create Table") — the unqualified CREATE is column 1).
       The destination connection's db_name puts it in the right schema. */
    let create_row = sqlx::query(&format!("SHOW CREATE TABLE {qualified_src}"))
        .fetch_one(&src_pool)
        .await?;
    let create_sql = get_string(&create_row, 1);
    dst_conn.query_drop(&create_sql).await.map_err(dst_err)?;

    if include_data {
        let total: u64 = sqlx::query_scalar::<_, i64>(&format!(
            "SELECT COUNT(*) FROM {qualified_src}"
        ))
        .fetch_one(&src_pool)
        .await
        .unwrap_or(0)
        .max(0) as u64;
        let _ = app.emit("table-copy-progress", serde_json::json!({ "done": 0, "total": total }));

        let mut src_conn = src_pool.acquire().await?;
        let select_sql = format!("SELECT * FROM {qualified_src}");
        let mut stream = sqlx::query(&select_sql).fetch(&mut *src_conn);
        let mut columns: Vec<(String, String)> = Vec::new();
        let mut insert_prefix = String::new();
        /* Batch rows into multi-row INSERTs, flushing on row count or byte size
           to stay comfortably under the target's max_allowed_packet (64MB
           default on MySQL 8). Batches are large because each flush pays a
           full WAN round-trip serialized behind the previous one — with
           protocol compression, wire size is not the constraint. */
        let mut batch: Vec<String> = Vec::new();
        let mut batch_bytes: usize = 0;
        let mut done: u64 = 0;
        let mut cancelled = false;
        while let Some(row) = stream.try_next().await? {
            if state.cancel_copy.load(Ordering::Relaxed) {
                cancelled = true;
                break;
            }
            if columns.is_empty() {
                columns = result_columns(&row);
                let col_list = columns
                    .iter()
                    .map(|(name, _)| quote_ident(name))
                    .collect::<Vec<_>>()
                    .join(", ");
                insert_prefix =
                    format!("INSERT INTO {} ({}) VALUES", quote_ident(&source_table), col_list);
            }
            let values = columns
                .iter()
                .enumerate()
                .map(|(i, (_, ty))| sql_literal(&row, i, ty))
                .collect::<Vec<_>>()
                .join(", ");
            batch_bytes += values.len() + 4;
            batch.push(format!("({values})"));
            if batch.len() >= 10_000 || batch_bytes >= 8_000_000 {
                let stmt = format!("{insert_prefix} {}", batch.join(", "));
                execute_batch_with_reconnect(
                    &dest_opts,
                    &mut dst_conn,
                    &source_table,
                    &stmt,
                    done,
                    batch.len() as u64,
                )
                .await?;
                done += batch.len() as u64;
                let _ = app
                    .emit("table-copy-progress", serde_json::json!({ "done": done, "total": total }));
                batch.clear();
                batch_bytes = 0;
            }
        }
        drop(stream);
        if cancelled {
            /* Tear down the partially-written table so a cancelled copy leaves
               nothing behind. */
            let qualified_dst = format!(
                "{}.{}",
                quote_ident(&target_database),
                quote_ident(&source_table)
            );
            let _ = dst_conn
                .query_drop(format!("DROP TABLE IF EXISTS {qualified_dst}"))
                .await;
            return Ok(false);
        }
        if !batch.is_empty() {
            let stmt = format!("{insert_prefix} {}", batch.join(", "));
            execute_batch_with_reconnect(
                &dest_opts,
                &mut dst_conn,
                &source_table,
                &stmt,
                done,
                batch.len() as u64,
            )
            .await?;
            done += batch.len() as u64;
        }
        let _ = app.emit(
            "table-copy-progress",
            serde_json::json!({ "done": done, "total": done.max(total) }),
        );
    }
    let _ = dst_conn.disconnect().await;
    Ok(true)
}

/// Same-connection copy: structure and rows stay server-side via
/// `CREATE TABLE ... LIKE` and `INSERT ... SELECT`. The `INSERT ... SELECT` runs
/// as a single statement, so a cancel interrupts it with `KILL QUERY` (the copy
/// connection's id is registered in `copy_kill` for that purpose). Returns
/// `false` when cancelled, after dropping the (rolled-back) target table.
async fn copy_table_same_connection(
    state: &State<'_, AppState>,
    profile_id: &str,
    source_database: &str,
    source_table: &str,
    target_database: &str,
    dest_table: &str,
    include_data: bool,
) -> AppResult<bool> {
    let pool = pool_for(state, profile_id).await?;

    let exists = sqlx::query(
        "SELECT COUNT(*) FROM INFORMATION_SCHEMA.TABLES \
         WHERE TABLE_SCHEMA = ? AND TABLE_NAME = ?",
    )
    .bind(target_database)
    .bind(dest_table)
    .fetch_one(&pool)
    .await?;
    if exists.try_get::<i64, _>(0).unwrap_or(0) > 0 {
        return Err(AppError::Other(format!(
            "a table named \"{dest_table}\" already exists in \"{target_database}\""
        )));
    }

    let src = format!("{}.{}", quote_ident(source_database), quote_ident(source_table));
    let dst = format!("{}.{}", quote_ident(target_database), quote_ident(dest_table));

    let mut conn = pool.acquire().await?;

    /* Capture this connection's thread id so a cancel can target the
       INSERT ... SELECT with KILL QUERY. */
    let conn_id: u32 = {
        let row = (&mut *conn).fetch_one("SELECT CONNECTION_ID()").await?;
        row.try_get::<u64, _>(0).unwrap_or(0) as u32
    };
    *state.copy_kill.write().await = Some((profile_id.to_string(), conn_id));

    (&mut *conn)
        .execute(format!("CREATE TABLE {dst} LIKE {src}").as_str())
        .await?;

    if !include_data {
        state.copy_kill.write().await.take();
        return Ok(true);
    }

    let result = (&mut *conn)
        .execute(format!("INSERT INTO {dst} SELECT * FROM {src}").as_str())
        .await;
    state.copy_kill.write().await.take();

    match result {
        Ok(_) => Ok(true),
        Err(e) => {
            if state.cancel_copy.load(Ordering::Relaxed) {
                /* KILL QUERY left the connection mid-protocol; discard it and use
                   a fresh one to drop the now-empty target table. */
                let _ = conn.detach();
                if let Ok(mut cleanup) = pool.acquire().await {
                    let _ = (&mut *cleanup)
                        .execute(format!("DROP TABLE IF EXISTS {dst}").as_str())
                        .await;
                }
                Ok(false)
            } else {
                Err(e.into())
            }
        }
    }
}

/// Create a new (empty) database/schema on the server.
#[tauri::command]
pub async fn create_database(
    state: State<'_, AppState>,
    profile_id: String,
    name: String,
) -> AppResult<()> {
    let pool = pool_for(&state, &profile_id).await?;
    let mut conn = pool.acquire().await?;
    (&mut *conn)
        .execute(format!("CREATE DATABASE {}", quote_ident(&name)).as_str())
        .await?;
    Ok(())
}

/// Permanently drop a database/schema and everything it contains.
#[tauri::command]
pub async fn drop_database(
    state: State<'_, AppState>,
    profile_id: String,
    name: String,
) -> AppResult<()> {
    let pool = pool_for(&state, &profile_id).await?;
    let mut conn = pool.acquire().await?;
    (&mut *conn)
        .execute(format!("DROP DATABASE {}", quote_ident(&name)).as_str())
        .await?;
    Ok(())
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ColumnDef {
    pub name: String,
    /// Full SQL type as stored, e.g. "int(11) unsigned" or "varchar(255)".
    pub column_type: String,
    pub nullable: bool,
    pub key: String,
    pub default_value: Option<String>,
    pub extra: String,
    pub comment: String,
    /// Collation for text columns, None for numeric/binary types.
    pub collation: Option<String>,
}

/// Full column metadata for editing an existing table (richer than `list_columns`).
#[tauri::command]
pub async fn column_definitions(
    state: State<'_, AppState>,
    profile_id: String,
    database: String,
    table: String,
) -> AppResult<Vec<ColumnDef>> {
    let pool = pool_for(&state, &profile_id).await?;
    let rows = sqlx::query(
        "SELECT COLUMN_NAME, COLUMN_TYPE, IS_NULLABLE, COLUMN_KEY, COLUMN_DEFAULT, EXTRA, COLUMN_COMMENT, COLLATION_NAME \
         FROM INFORMATION_SCHEMA.COLUMNS \
         WHERE TABLE_SCHEMA = ? AND TABLE_NAME = ? \
         ORDER BY ORDINAL_POSITION",
    )
    .bind(&database)
    .bind(&table)
    .fetch_all(&pool)
    .await?;
    Ok(rows
        .iter()
        .map(|r| ColumnDef {
            name: get_string(r, 0),
            column_type: get_string(r, 1),
            nullable: get_string(r, 2) == "YES",
            key: get_string(r, 3),
            default_value: get_opt_string(r, 4),
            extra: get_string(r, 5),
            comment: get_string(r, 6),
            collation: get_opt_string(r, 7),
        })
        .collect())
}

/// The table's current AUTO_INCREMENT counter (None when it has no such column).
#[tauri::command]
pub async fn table_auto_increment(
    state: State<'_, AppState>,
    profile_id: String,
    database: String,
    table: String,
) -> AppResult<Option<u64>> {
    let pool = pool_for(&state, &profile_id).await?;
    let mut conn = pool.acquire().await?;
    /* MySQL 8.0 caches the dynamic INFORMATION_SCHEMA.TABLES columns (AUTO_INCREMENT,
       DATA_LENGTH, ...) for `information_schema_stats_expiry` seconds (default 24h), so a
       read right after an ALTER returns the stale pre-change value. Force a live read for
       this session; the variable is absent on MariaDB / MySQL 5.7 (which don't cache it),
       so a failure there is benign and ignored. */
    let _ = sqlx::query("SET SESSION information_schema_stats_expiry = 0")
        .execute(&mut *conn)
        .await;
    let row = sqlx::query(
        "SELECT AUTO_INCREMENT FROM INFORMATION_SCHEMA.TABLES \
         WHERE TABLE_SCHEMA = ? AND TABLE_NAME = ?",
    )
    .bind(&database)
    .bind(&table)
    .fetch_optional(&mut *conn)
    .await?;
    Ok(row.and_then(|r| {
        if let Ok(v) = r.try_get::<Option<u64>, _>(0) {
            return v;
        }
        if let Ok(v) = r.try_get::<Option<i64>, _>(0) {
            return v.map(|n| n as u64);
        }
        /* INFORMATION_SCHEMA sometimes hands numeric columns back as a string or
           bytes (e.g. NEWDECIMAL collation), which the typed decodes above reject. */
        get_opt_string(&r, 0).and_then(|s| s.trim().parse::<u64>().ok())
    }))
}

/// The table's COMMENT (empty string when none), used to seed the designer.
#[tauri::command]
pub async fn table_comment(
    state: State<'_, AppState>,
    profile_id: String,
    database: String,
    table: String,
) -> AppResult<String> {
    let pool = pool_for(&state, &profile_id).await?;
    let row = sqlx::query(
        "SELECT TABLE_COMMENT FROM INFORMATION_SCHEMA.TABLES \
         WHERE TABLE_SCHEMA = ? AND TABLE_NAME = ?",
    )
    .bind(&database)
    .bind(&table)
    .fetch_optional(&pool)
    .await?;
    Ok(row.map(|r| get_string(&r, 0)).unwrap_or_default())
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct TableSchemaMeta {
    pub engine: Option<String>,
    pub collation: Option<String>,
    pub comment: String,
}

/// Table-level schema metadata (engine, default collation, comment) for the
/// schema diff view.
#[tauri::command]
pub async fn table_schema_meta(
    state: State<'_, AppState>,
    profile_id: String,
    database: String,
    table: String,
) -> AppResult<TableSchemaMeta> {
    let pool = pool_for(&state, &profile_id).await?;
    let row = sqlx::query(
        "SELECT ENGINE, TABLE_COLLATION, TABLE_COMMENT FROM INFORMATION_SCHEMA.TABLES \
         WHERE TABLE_SCHEMA = ? AND TABLE_NAME = ?",
    )
    .bind(&database)
    .bind(&table)
    .fetch_optional(&pool)
    .await?;
    match row {
        Some(r) => Ok(TableSchemaMeta {
            engine: get_opt_string(&r, 0),
            collation: get_opt_string(&r, 1),
            comment: get_string(&r, 2),
        }),
        None => Err(AppError::Other(format!(
            "Table `{}`.`{}` was not found",
            database, table
        ))),
    }
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct IndexColumn {
    pub column: String,
    /// "ASC" or "DESC".
    pub direction: String,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct IndexDef {
    pub name: String,
    pub columns: Vec<IndexColumn>,
    /// "NORMAL" | "UNIQUE" | "FULLTEXT" | "SPATIAL".
    pub index_type: String,
    /// "BTREE" | "HASH".
    pub method: String,
    pub comment: String,
}

/// Secondary indexes for an existing table, used to seed the designer in edit
/// mode. PRIMARY is excluded — it's driven by the per-column key flag.
#[tauri::command]
pub async fn index_definitions(
    state: State<'_, AppState>,
    profile_id: String,
    database: String,
    table: String,
) -> AppResult<Vec<IndexDef>> {
    let pool = pool_for(&state, &profile_id).await?;
    let rows = sqlx::query(
        "SELECT INDEX_NAME, NON_UNIQUE, COLUMN_NAME, COLLATION, INDEX_TYPE, INDEX_COMMENT \
         FROM INFORMATION_SCHEMA.STATISTICS \
         WHERE TABLE_SCHEMA = ? AND TABLE_NAME = ? AND INDEX_NAME <> 'PRIMARY' \
         ORDER BY INDEX_NAME, SEQ_IN_INDEX",
    )
    .bind(&database)
    .bind(&table)
    .fetch_all(&pool)
    .await?;

    let mut out: Vec<IndexDef> = Vec::new();
    for r in &rows {
        push_statistics_row(&mut out, r, 0);
    }
    Ok(out)
}

/// Fold one INFORMATION_SCHEMA.STATISTICS row (columns starting at offset
/// `base`: INDEX_NAME, NON_UNIQUE, COLUMN_NAME, COLLATION, INDEX_TYPE,
/// INDEX_COMMENT) into an accumulating index list — rows arrive ordered by
/// index name + SEQ_IN_INDEX, so repeats of a name extend its column list.
fn push_statistics_row(out: &mut Vec<IndexDef>, r: &MySqlRow, base: usize) {
    let name = get_string(r, base);
    /* NON_UNIQUE is an integer column; its exact width varies by server, so
       try the likely sqlx mappings before giving up (default: non-unique). */
    let non_unique = r
        .try_get::<i64, _>(base + 1)
        .or_else(|_| r.try_get::<i32, _>(base + 1).map(i64::from))
        .or_else(|_| r.try_get::<u64, _>(base + 1).map(|v| v as i64))
        .or_else(|_| r.try_get::<u32, _>(base + 1).map(i64::from))
        .unwrap_or(1);
    let column = get_string(r, base + 2);
    let collation = r.try_get::<Option<String>, _>(base + 3).ok().flatten();
    let raw_type = get_string(r, base + 4).to_uppercase();
    let comment = get_string(r, base + 5);

    let direction = if collation.as_deref() == Some("D") {
        "DESC"
    } else {
        "ASC"
    }
    .to_string();

    let index_type = if raw_type == "FULLTEXT" {
        "FULLTEXT"
    } else if raw_type == "SPATIAL" {
        "SPATIAL"
    } else if non_unique == 0 {
        "UNIQUE"
    } else {
        "NORMAL"
    }
    .to_string();

    let method = if raw_type == "HASH" { "HASH" } else { "BTREE" }.to_string();

    match out.iter_mut().find(|i| i.name == name) {
        Some(existing) => existing.columns.push(IndexColumn { column, direction }),
        None => out.push(IndexDef {
            name,
            columns: vec![IndexColumn { column, direction }],
            index_type,
            method,
            comment,
        }),
    }
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ForeignKeyDef {
    pub name: String,
    pub columns: Vec<String>,
    pub ref_schema: String,
    pub ref_table: String,
    pub ref_columns: Vec<String>,
    /// "RESTRICT" | "CASCADE" | "SET NULL" | "NO ACTION" | "SET DEFAULT".
    pub on_update: String,
    pub on_delete: String,
}

/// Foreign-key constraints declared on `table`, used to seed the designer's
/// Foreign Keys editor. Multi-column keys arrive as one row per column
/// (ordered by ORDINAL_POSITION) and are folded into a single entry.
#[tauri::command]
pub async fn foreign_key_definitions(
    state: State<'_, AppState>,
    profile_id: String,
    database: String,
    table: String,
) -> AppResult<Vec<ForeignKeyDef>> {
    let pool = pool_for(&state, &profile_id).await?;
    let rows = sqlx::query(
        "SELECT k.CONSTRAINT_NAME, k.COLUMN_NAME, k.REFERENCED_TABLE_SCHEMA, \
                k.REFERENCED_TABLE_NAME, k.REFERENCED_COLUMN_NAME, \
                r.UPDATE_RULE, r.DELETE_RULE \
         FROM INFORMATION_SCHEMA.KEY_COLUMN_USAGE k \
         JOIN INFORMATION_SCHEMA.REFERENTIAL_CONSTRAINTS r \
           ON r.CONSTRAINT_SCHEMA = k.CONSTRAINT_SCHEMA \
          AND r.CONSTRAINT_NAME = k.CONSTRAINT_NAME \
          AND r.TABLE_NAME = k.TABLE_NAME \
         WHERE k.TABLE_SCHEMA = ? AND k.TABLE_NAME = ? \
           AND k.REFERENCED_TABLE_NAME IS NOT NULL \
         ORDER BY k.CONSTRAINT_NAME, k.ORDINAL_POSITION",
    )
    .bind(&database)
    .bind(&table)
    .fetch_all(&pool)
    .await?;

    let mut out: Vec<ForeignKeyDef> = Vec::new();
    for r in &rows {
        let name = get_string(r, 0);
        let column = get_string(r, 1);
        let ref_column = get_string(r, 4);
        match out.iter_mut().find(|f| f.name == name) {
            Some(existing) => {
                existing.columns.push(column);
                existing.ref_columns.push(ref_column);
            }
            None => out.push(ForeignKeyDef {
                name,
                columns: vec![column],
                ref_schema: get_string(r, 2),
                ref_table: get_string(r, 3),
                ref_columns: vec![ref_column],
                on_update: get_string(r, 5).to_uppercase(),
                on_delete: get_string(r, 6).to_uppercase(),
            }),
        }
    }
    Ok(out)
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct TruncateBlocker {
    /// The table being truncated that this child references.
    pub table: String,
    pub child_schema: String,
    pub child_table: String,
    pub constraint: String,
    /// Rows in the child whose FK columns are all non-null — the rows that
    /// would be orphaned by the truncate.
    pub rows: u64,
}

/// For each table in `tables`, find the tables that hold a foreign key pointing
/// at it (self-references and tables that are themselves in `tables` are
/// skipped — truncating them too orphans nothing) and count the child rows
/// that currently reference something. A blocker with `rows > 0` means the
/// truncate would leave orphans.
#[tauri::command]
pub async fn truncate_blockers(
    state: State<'_, AppState>,
    profile_id: String,
    database: String,
    tables: Vec<String>,
) -> AppResult<Vec<TruncateBlocker>> {
    let pool = pool_for(&state, &profile_id).await?;
    let mut out: Vec<TruncateBlocker> = Vec::new();
    for table in &tables {
        let rows = sqlx::query(
            "SELECT TABLE_SCHEMA, TABLE_NAME, CONSTRAINT_NAME, COLUMN_NAME \
             FROM INFORMATION_SCHEMA.KEY_COLUMN_USAGE \
             WHERE REFERENCED_TABLE_SCHEMA = ? AND REFERENCED_TABLE_NAME = ? \
             ORDER BY TABLE_SCHEMA, TABLE_NAME, CONSTRAINT_NAME, ORDINAL_POSITION",
        )
        .bind(&database)
        .bind(table)
        .fetch_all(&pool)
        .await?;

        /* Fold per-column rows into (schema, table, constraint) → columns. */
        let mut fks: Vec<(String, String, String, Vec<String>)> = Vec::new();
        for r in &rows {
            let schema = get_string(r, 0);
            let child = get_string(r, 1);
            let constraint = get_string(r, 2);
            let column = get_string(r, 3);
            let same_table = schema == database && &child == table;
            let also_truncating = schema == database && tables.contains(&child);
            if same_table || also_truncating {
                continue;
            }
            match fks
                .iter_mut()
                .find(|f| f.0 == schema && f.1 == child && f.2 == constraint)
            {
                Some(f) => f.3.push(column),
                None => fks.push((schema, child, constraint, vec![column])),
            }
        }

        for (schema, child, constraint, columns) in fks {
            let cond = columns
                .iter()
                .map(|c| format!("{} IS NOT NULL", quote_ident(c)))
                .collect::<Vec<_>>()
                .join(" AND ");
            let sql = format!(
                "SELECT COUNT(*) FROM {}.{} WHERE {cond}",
                quote_ident(&schema),
                quote_ident(&child)
            );
            let row = sqlx::query(&sql).fetch_one(&pool).await?;
            let count = row
                .try_get::<i64, _>(0)
                .map(|v| v.max(0) as u64)
                .or_else(|_| row.try_get::<u64, _>(0))
                .unwrap_or(0);
            out.push(TruncateBlocker {
                table: table.clone(),
                child_schema: schema,
                child_table: child,
                constraint,
                rows: count,
            });
        }
    }
    Ok(out)
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct TableSchemaEntry {
    pub name: String,
    pub columns: Vec<ColumnDef>,
    pub indexes: Vec<IndexDef>,
    pub meta: TableSchemaMeta,
}

/// Full schema for every base table in a database, fetched with three bulk
/// INFORMATION_SCHEMA queries (the database diff would otherwise need six
/// round-trips per table). Views are excluded; PRIMARY is excluded from the
/// index lists just like `index_definitions` (it's carried by the per-column
/// key flag).
#[tauri::command]
pub async fn database_schema(
    state: State<'_, AppState>,
    profile_id: String,
    database: String,
) -> AppResult<Vec<TableSchemaEntry>> {
    let pool = pool_for(&state, &profile_id).await?;

    let trows = sqlx::query(
        "SELECT TABLE_NAME, ENGINE, TABLE_COLLATION, TABLE_COMMENT \
         FROM INFORMATION_SCHEMA.TABLES \
         WHERE TABLE_SCHEMA = ? AND TABLE_TYPE = 'BASE TABLE' \
         ORDER BY TABLE_NAME",
    )
    .bind(&database)
    .fetch_all(&pool)
    .await?;

    let mut entries: Vec<TableSchemaEntry> = trows
        .iter()
        .map(|r| TableSchemaEntry {
            name: get_string(r, 0),
            columns: Vec::new(),
            indexes: Vec::new(),
            meta: TableSchemaMeta {
                engine: get_opt_string(r, 1),
                collation: get_opt_string(r, 2),
                comment: get_string(r, 3),
            },
        })
        .collect();
    let by_name: std::collections::HashMap<String, usize> = entries
        .iter()
        .enumerate()
        .map(|(i, e)| (e.name.clone(), i))
        .collect();

    let crows = sqlx::query(
        "SELECT TABLE_NAME, COLUMN_NAME, COLUMN_TYPE, IS_NULLABLE, COLUMN_KEY, COLUMN_DEFAULT, EXTRA, COLUMN_COMMENT, COLLATION_NAME \
         FROM INFORMATION_SCHEMA.COLUMNS \
         WHERE TABLE_SCHEMA = ? \
         ORDER BY TABLE_NAME, ORDINAL_POSITION",
    )
    .bind(&database)
    .fetch_all(&pool)
    .await?;
    for r in &crows {
        /* Rows for views aren't in the map and are skipped. */
        let Some(&i) = by_name.get(&get_string(r, 0)) else {
            continue;
        };
        entries[i].columns.push(ColumnDef {
            name: get_string(r, 1),
            column_type: get_string(r, 2),
            nullable: get_string(r, 3) == "YES",
            key: get_string(r, 4),
            default_value: get_opt_string(r, 5),
            extra: get_string(r, 6),
            comment: get_string(r, 7),
            collation: get_opt_string(r, 8),
        });
    }

    let irows = sqlx::query(
        "SELECT TABLE_NAME, INDEX_NAME, NON_UNIQUE, COLUMN_NAME, COLLATION, INDEX_TYPE, INDEX_COMMENT \
         FROM INFORMATION_SCHEMA.STATISTICS \
         WHERE TABLE_SCHEMA = ? AND INDEX_NAME <> 'PRIMARY' \
         ORDER BY TABLE_NAME, INDEX_NAME, SEQ_IN_INDEX",
    )
    .bind(&database)
    .fetch_all(&pool)
    .await?;
    for r in &irows {
        let Some(&i) = by_name.get(&get_string(r, 0)) else {
            continue;
        };
        push_statistics_row(&mut entries[i].indexes, r, 1);
    }

    Ok(entries)
}

/// Run a single DDL statement (e.g. ALTER TABLE) in the context of `database`.
/// Uses the simple query protocol so `USE`/DDL aren't rejected (error 1295).
#[tauri::command]
pub async fn run_ddl(
    state: State<'_, AppState>,
    profile_id: String,
    database: String,
    sql: String,
) -> AppResult<()> {
    let pool = pool_for(&state, &profile_id).await?;
    let mut conn = pool.acquire().await?;
    (&mut *conn)
        .execute(format!("USE {}", quote_ident(&database)).as_str())
        .await?;
    (&mut *conn).execute(sql.as_str()).await?;
    Ok(())
}

/// Run an arbitrary, user-typed SQL statement in the context of `database` and
/// return its result set (or affected-row count). Uses the simple query protocol
/// so `USE`/DDL and statements unsupported by the prepared protocol all work.
///
/// `token` (the query tab's id) registers the underlying connection id while the
/// query runs, so `cancel_query` can interrupt it with `KILL QUERY`.
#[tauri::command]
pub async fn execute_query(
    app: AppHandle,
    state: State<'_, AppState>,
    profile_id: String,
    database: String,
    sql: String,
    token: String,
    // Cap on rows to collect; None means fetch everything (the user opted out).
    max_rows: Option<u32>,
) -> AppResult<QueryResult> {
    let pool = pool_for(&state, &profile_id).await?;
    let mut conn = pool.acquire().await?;

    /* Capture the connection's thread id up front so a Stop request can target
       exactly this query with KILL QUERY. */
    let conn_id: u32 = {
        let row = (&mut *conn)
            .fetch_one("SELECT CONNECTION_ID()")
            .await?;
        row.try_get::<u64, _>(0).unwrap_or(0) as u32
    };
    state
        .running_queries
        .write()
        .await
        .insert(token.clone(), conn_id);

    let started = std::time::Instant::now();

    /* Emit the server-side elapsed every 100ms so the UI can tick a live timer
       while the statement runs. Aborted as soon as the query settles. */
    let ticker = {
        let app = app.clone();
        let token = token.clone();
        tokio::spawn(async move {
            loop {
                tokio::time::sleep(Duration::from_millis(100)).await;
                let _ = app.emit(
                    "query-progress",
                    serde_json::json!({
                        "token": token,
                        "serverMs": started.elapsed().as_millis() as u64,
                    }),
                );
            }
        })
    };

    let outcome: AppResult<QueryResult> = async {
        if !database.trim().is_empty() {
            (&mut *conn)
                .execute(format!("USE {}", quote_ident(&database)).as_str())
                .await?;
        }

        /* A compound script yields an interleaved stream: rows (Right) for each
           result set, then one completion marker (Left) per statement. Split on
           the markers so every statement becomes its own StatementResult —
           flattening them under the first statement's columns renders every
           later set as nulls. Raw rows are kept until the stream ends so
           duplicate column names can be resolved first (see below). */
        let mut raw: Vec<(Vec<MySqlRow>, u64, bool)> = Vec::new();
        let mut pending: Vec<MySqlRow> = Vec::new();
        {
            let mut stream = (&mut *conn).fetch_many(sql.as_str());
            while let Some(item) = stream.try_next().await? {
                match item {
                    Either::Left(res) => {
                        let rows = std::mem::take(&mut pending);
                        raw.push((rows, res.rows_affected(), false));
                    }
                    Either::Right(row) => {
                        /* Stop once this set has collected the cap. Seeing one
                           more row past the cap means the result had more —
                           flag it and bail without buffering the rest (any
                           statements after this one don't run). */
                        if let Some(cap) = max_rows {
                            if pending.len() as u32 >= cap {
                                raw.push((std::mem::take(&mut pending), 0, true));
                                break;
                            }
                        }
                        pending.push(row);
                    }
                }
            }
        }
        if !pending.is_empty() {
            raw.push((pending, 0, false));
        }
        let elapsed_ms = started.elapsed().as_millis() as u64;

        /* A single-statement run whose result repeats a column name (SELECT *
           over a JOIN where several tables have `id`) gets its repeats labeled
           "table.name" via a metadata lookup; anything else (multi-statement
           scripts, lookup failure) falls back to "name (2)" suffixes. */
        let mut names: Option<Vec<String>> = None;
        if raw.len() == 1 {
            if let Some(first) = raw[0].0.first() {
                if has_duplicate_names(first) {
                    names =
                        table_prefixed_names(&app, &profile_id, &database, &sql, first).await;
                }
            }
        }
        let results: Vec<StatementResult> = raw
            .into_iter()
            .map(|(rows, affected, truncated)| {
                statement_result(rows, affected, truncated, names.take())
            })
            .collect();

        Ok(QueryResult {
            results,
            elapsed_ms,
        })
    }
    .await;

    ticker.abort();
    state.running_queries.write().await.remove(&token);

    /* When truncated, we stopped reading mid-result, so the connection still has
       unsent rows queued. Detach it from the pool (dropping it closes the socket,
       which tells the server to stop) so a dirty connection isn't reused. */
    if matches!(&outcome, Ok(r) if r.results.iter().any(|s| s.truncated)) {
        let _ = conn.detach();
    }
    outcome
}

/// Package one statement's collected rows as a StatementResult. A statement
/// that produced no rows is reported via its affected-row count (an empty
/// SELECT is indistinguishable from DDL at this layer and shows as 0 affected).
/// `names`, when given (and matching the column count), overrides the display
/// names for both the column list and the row-object keys.
fn statement_result(
    rows: Vec<MySqlRow>,
    affected: u64,
    truncated: bool,
    names: Option<Vec<String>>,
) -> StatementResult {
    let base = rows.first().map(result_columns).unwrap_or_default();
    let names = names.filter(|n| n.len() == base.len());
    let columns: Vec<ColumnInfo> = base
        .into_iter()
        .enumerate()
        .map(|(i, (name, data_type))| ColumnInfo {
            name: names.as_ref().map(|n| n[i].clone()).unwrap_or(name),
            data_type,
            nullable: true,
            key: String::new(),
            comment: String::new(),
        })
        .collect();
    let json_rows: Vec<Value> = rows
        .iter()
        .map(|r| match &names {
            Some(n) => row_to_json_named(r, n),
            None => row_to_json(r),
        })
        .collect();
    let had_rows = !json_rows.is_empty();
    StatementResult {
        columns,
        rows: json_rows,
        rows_affected: if had_rows { None } else { Some(affected) },
        truncated,
    }
}

/// True when the result row repeats a column name (e.g. `SELECT *` over a JOIN
/// where several tables have an `id`).
fn has_duplicate_names(row: &MySqlRow) -> bool {
    let mut seen = HashSet::new();
    row.columns().iter().any(|c| !seen.insert(c.name()))
}

/**
 * Resolve display names for a duplicate-named result set by preparing the
 * statement on a dedicated metadata connection: the prepare response reports
 * each column's source table (the alias, when the query aliases one), which
 * sqlx result rows do not expose. Only repeated names get the "table.name"
 * prefix; unique columns keep their bare name. Returns None — callers fall
 * back to "name (2)" suffixes — when the password lookup, connect, or prepare
 * fails (e.g. statements the prepared protocol rejects), or when the prepared
 * metadata doesn't line up with the executed result.
 */
async fn table_prefixed_names(
    app: &AppHandle,
    profile_id: &str,
    database: &str,
    sql: &str,
    first_row: &MySqlRow,
) -> Option<Vec<String>> {
    if database.trim().is_empty() {
        return None;
    }
    let profile = crate::store::profiles::get(app, profile_id).ok()?;
    let password = crate::store::secrets::get_password(profile_id).ok()??;
    let opts = copy_dest_opts(&profile, &password, database);
    let mut conn = mysql_async::Conn::new(opts).await.ok()?;
    let meta_columns = match conn.prep(sql).await {
        Ok(stmt) => stmt.columns().to_vec(),
        Err(_) => {
            let _ = conn.disconnect().await;
            return None;
        }
    };
    let _ = conn.disconnect().await;

    let cols = first_row.columns();
    if meta_columns.len() != cols.len() {
        return None;
    }
    let mut counts: std::collections::HashMap<&str, u32> = std::collections::HashMap::new();
    for c in cols {
        *counts.entry(c.name()).or_insert(0) += 1;
    }
    let mut out: Vec<String> = Vec::with_capacity(cols.len());
    for (i, c) in cols.iter().enumerate() {
        let base = c.name();
        if meta_columns[i].name_str() != base {
            return None;
        }
        let table = meta_columns[i].table_str();
        let name = if counts[base] > 1 && !table.is_empty() {
            format!("{table}.{base}")
        } else {
            base.to_string()
        };
        /* Prefixing can still collide (e.g. `SELECT id, id FROM t` — same
           table twice); suffix those the usual way. */
        let name = disambiguate(&name, |n| out.iter().any(|o| o == n));
        out.push(name);
    }
    Some(out)
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AnalyzeIndexInfo {
    pub name: String,
    pub non_unique: bool,
    /// Columns in key order (SEQ_IN_INDEX).
    pub columns: Vec<String>,
    /// Estimated distinct values (selectivity proxy); None when unknown.
    pub cardinality: Option<i64>,
    /// "BTREE" | "FULLTEXT" | "HASH" | "SPATIAL".
    pub index_type: String,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AnalyzeTableInfo {
    /// The name the plan uses (the alias when the query aliases the table).
    pub name: String,
    /// The real base-table name (for generating DDL).
    pub real_name: String,
    pub schema: String,
    /// INFORMATION_SCHEMA.TABLES.TABLE_ROWS — an estimate for InnoDB.
    pub table_rows: Option<u64>,
    pub engine: Option<String>,
    pub columns: Vec<ColumnDef>,
    pub indexes: Vec<AnalyzeIndexInfo>,
}

/// Everything the frontend analysis engine needs to grade a query: the raw
/// plan (rich JSON + traditional grid), the optimizer's rewrite warnings,
/// optional measured timings, and schema facts for the referenced tables.
#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct QueryAnalysisInput {
    pub server_version: String,
    pub read_only: bool,
    /// `EXPLAIN FORMAT=JSON` output (the engine's primary input); None if unsupported.
    pub explain_json: Option<String>,
    /// Traditional `EXPLAIN` grid for display.
    pub explain_columns: Vec<String>,
    pub explain_rows: Vec<Value>,
    /// `SHOW WARNINGS` messages after the JSON EXPLAIN (reveals the rewritten query).
    pub warnings: Vec<String>,
    /// `EXPLAIN ANALYZE` tree text when opted in for a read-only query (8.0.18+).
    pub analyze_tree: Option<String>,
    pub tables: Vec<AnalyzeTableInfo>,
}

/// Returns true when `s` begins a word boundary (whitespace or end of input).
fn at_word_boundary(s: &str) -> bool {
    s.chars().next().map(|c| c.is_whitespace()).unwrap_or(true)
}

/// Strip a leading `EXPLAIN [ANALYZE] [FORMAT[=]xxx]` so we can re-wrap the inner
/// statement ourselves. Conservative — only removes recognized leading keywords.
fn strip_leading_explain(sql: &str) -> String {
    let s = sql.trim_start();
    if !s.to_ascii_lowercase().starts_with("explain") || !at_word_boundary(&s[7..]) {
        return s.to_string();
    }
    let mut rest = s[7..].trim_start();
    if rest.to_ascii_lowercase().starts_with("analyze") && at_word_boundary(&rest[7..]) {
        rest = rest[7..].trim_start();
    }
    if rest.to_ascii_lowercase().starts_with("format") {
        let after = rest[6..].trim_start();
        let after = after.strip_prefix('=').unwrap_or(after).trim_start();
        let tok_end = after.find(char::is_whitespace).unwrap_or(after.len());
        rest = after[tok_end..].trim_start();
    }
    rest.to_string()
}

/// Whether a statement is safe to EXPLAIN ANALYZE (it actually runs the query).
fn is_read_only(sql: &str) -> bool {
    let s = sql.trim_start().to_ascii_lowercase();
    s.starts_with("select")
        || s.starts_with("with")
        || s.starts_with("table ")
        || s.starts_with("values")
        || s.starts_with("(select")
}

/// Recursively collect every `table_name` string in the EXPLAIN JSON tree.
fn collect_table_names(v: &Value, out: &mut Vec<String>) {
    match v {
        Value::Object(map) => {
            if let Some(Value::String(name)) = map.get("table_name") {
                if !out.contains(name) {
                    out.push(name.clone());
                }
            }
            for val in map.values() {
                collect_table_names(val, out);
            }
        }
        Value::Array(arr) => {
            for val in arr {
                collect_table_names(val, out);
            }
        }
        _ => {}
    }
}

/// Remove comments and string literals (→ spaces) and pad `, ( )` so the result
/// tokenizes cleanly for alias parsing. Backtick identifiers pass through.
fn scrub_sql(sql: &str) -> String {
    let b = sql.as_bytes();
    let mut out = String::with_capacity(sql.len());
    let mut i = 0;
    while i < b.len() {
        let c = b[i];
        if c == b'-' && i + 1 < b.len() && b[i + 1] == b'-' {
            while i < b.len() && b[i] != b'\n' {
                i += 1;
            }
            out.push(' ');
        } else if c == b'#' {
            while i < b.len() && b[i] != b'\n' {
                i += 1;
            }
            out.push(' ');
        } else if c == b'/' && i + 1 < b.len() && b[i + 1] == b'*' {
            i += 2;
            while i + 1 < b.len() && !(b[i] == b'*' && b[i + 1] == b'/') {
                i += 1;
            }
            i += 2;
            out.push(' ');
        } else if c == b'\'' || c == b'"' {
            let q = c;
            i += 1;
            while i < b.len() {
                if b[i] == b'\\' {
                    i += 2;
                    continue;
                }
                if b[i] == q {
                    if i + 1 < b.len() && b[i + 1] == q {
                        i += 2;
                        continue;
                    }
                    i += 1;
                    break;
                }
                i += 1;
            }
            out.push(' ');
        } else if c == b',' || c == b'(' || c == b')' {
            out.push(' ');
            out.push(c as char);
            out.push(' ');
            i += 1;
        } else {
            out.push(c as char);
            i += 1;
        }
    }
    out
}

fn normalize_ident(tok: &str) -> String {
    tok.trim().trim_matches('`').to_string()
}

/// Strip backticks and any schema qualifier: `db`.`tbl` → tbl.
fn normalize_table(tok: &str) -> String {
    let last = tok.rsplit('.').next().unwrap_or(tok);
    normalize_ident(last)
}

fn is_plain_ident(tok: &str) -> bool {
    let t = tok.trim_matches('`');
    !t.is_empty() && t.chars().all(|c| c.is_alphanumeric() || c == '_')
}

fn is_clause_keyword(s: &str) -> bool {
    matches!(
        s.to_ascii_lowercase().as_str(),
        "on" | "where"
            | "group" | "order" | "limit" | "join" | "left" | "right" | "inner"
            | "outer" | "cross" | "natural" | "using" | "set" | "having" | "union"
            | "straight_join" | "force" | "use" | "ignore" | "for" | "as" | "and"
            | "or" | "select" | "window" | "into" | "(" | ")" | "," | ";"
    )
}

/// Best-effort map of base tables and their aliases from a query's FROM/JOIN
/// clauses, e.g. `FROM pcrs p LEFT JOIN epatient04` → [(pcrs, Some(p)),
/// (epatient04, None)]. Heuristic (not a full parser); derived-table subqueries
/// (a `(` after FROM/JOIN) are skipped.
fn parse_table_aliases(sql: &str) -> Vec<(String, Option<String>)> {
    let scrubbed = scrub_sql(sql);
    let tokens: Vec<&str> = scrubbed.split_whitespace().collect();
    let mut out: Vec<(String, Option<String>)> = Vec::new();
    let mut i = 0;
    while i < tokens.len() {
        let kw = tokens[i].to_ascii_lowercase();
        if kw == "from" || kw == "join" {
            let comma_list = kw == "from";
            i += 1;
            loop {
                if i >= tokens.len() || tokens[i] == "(" {
                    break;
                }
                let real = normalize_table(tokens[i]);
                i += 1;
                if real.is_empty() {
                    break;
                }
                let mut alias: Option<String> = None;
                if i < tokens.len() {
                    let nx = tokens[i].to_ascii_lowercase();
                    if nx == "as" {
                        i += 1;
                        if i < tokens.len() {
                            alias = Some(normalize_ident(tokens[i]));
                            i += 1;
                        }
                    } else if !is_clause_keyword(&nx) && is_plain_ident(tokens[i]) {
                        alias = Some(normalize_ident(tokens[i]));
                        i += 1;
                    }
                }
                out.push((real, alias));
                if comma_list && i < tokens.len() && tokens[i] == "," {
                    i += 1;
                    continue;
                }
                break;
            }
            continue;
        }
        i += 1;
    }
    out
}

/// Schema facts (row estimate, columns, indexes + cardinality) for one base
/// table. Returns None for derived/aliased/materialized tables not in I_S.
async fn gather_table_info(
    pool: &MySqlPool,
    database: &str,
    table: &str,
) -> Option<AnalyzeTableInfo> {
    let trow = sqlx::query(
        "SELECT TABLE_ROWS, ENGINE FROM INFORMATION_SCHEMA.TABLES \
         WHERE TABLE_SCHEMA = ? AND TABLE_NAME = ?",
    )
    .bind(database)
    .bind(table)
    .fetch_optional(pool)
    .await
    .ok()??;
    let table_rows = trow
        .try_get::<Option<u64>, _>(0)
        .ok()
        .flatten()
        .or_else(|| trow.try_get::<Option<i64>, _>(0).ok().flatten().map(|n| n as u64));
    let engine = get_opt_string(&trow, 1);

    let crows = sqlx::query(
        "SELECT COLUMN_NAME, COLUMN_TYPE, IS_NULLABLE, COLUMN_KEY, COLUMN_DEFAULT, EXTRA, COLUMN_COMMENT, COLLATION_NAME \
         FROM INFORMATION_SCHEMA.COLUMNS \
         WHERE TABLE_SCHEMA = ? AND TABLE_NAME = ? ORDER BY ORDINAL_POSITION",
    )
    .bind(database)
    .bind(table)
    .fetch_all(pool)
    .await
    .ok()?;
    let columns: Vec<ColumnDef> = crows
        .iter()
        .map(|r| ColumnDef {
            name: get_string(r, 0),
            column_type: get_string(r, 1),
            nullable: get_string(r, 2) == "YES",
            key: get_string(r, 3),
            default_value: get_opt_string(r, 4),
            extra: get_string(r, 5),
            comment: get_string(r, 6),
            collation: get_opt_string(r, 7),
        })
        .collect();

    let irows = sqlx::query(
        "SELECT INDEX_NAME, NON_UNIQUE, COLUMN_NAME, CARDINALITY, INDEX_TYPE \
         FROM INFORMATION_SCHEMA.STATISTICS \
         WHERE TABLE_SCHEMA = ? AND TABLE_NAME = ? ORDER BY INDEX_NAME, SEQ_IN_INDEX",
    )
    .bind(database)
    .bind(table)
    .fetch_all(pool)
    .await
    .ok()?;
    let mut indexes: Vec<AnalyzeIndexInfo> = Vec::new();
    for r in &irows {
        let name = get_string(r, 0);
        let non_unique = r
            .try_get::<i64, _>(1)
            .or_else(|_| r.try_get::<i32, _>(1).map(i64::from))
            .or_else(|_| r.try_get::<u64, _>(1).map(|v| v as i64))
            .unwrap_or(1)
            != 0;
        let column = get_string(r, 2);
        let cardinality = r
            .try_get::<Option<i64>, _>(3)
            .ok()
            .flatten()
            .or_else(|| r.try_get::<Option<u64>, _>(3).ok().flatten().map(|v| v as i64));
        let index_type = get_string(r, 4).to_uppercase();
        match indexes.iter_mut().find(|i| i.name == name) {
            Some(existing) => existing.columns.push(column),
            None => indexes.push(AnalyzeIndexInfo {
                name,
                non_unique,
                columns: vec![column],
                cardinality,
                index_type,
            }),
        }
    }

    Some(AnalyzeTableInfo {
        name: table.to_string(),
        real_name: table.to_string(),
        schema: database.to_string(),
        table_rows,
        engine,
        columns,
        indexes,
    })
}

/// Build the analysis bundle for a query: run EXPLAIN (rich JSON + grid), capture
/// the optimizer's rewrite warnings, optionally EXPLAIN ANALYZE a read-only query
/// for measured timings, and gather schema facts for every referenced base table.
/// The grading/suggestions are computed frontend-side from this bundle.
#[tauri::command]
pub async fn analyze_query(
    state: State<'_, AppState>,
    profile_id: String,
    database: String,
    sql: String,
    run_analyze: bool,
) -> AppResult<QueryAnalysisInput> {
    let pool = pool_for(&state, &profile_id).await?;
    let mut conn = pool.acquire().await?;

    if !database.trim().is_empty() {
        (&mut *conn)
            .execute(format!("USE {}", quote_ident(&database)).as_str())
            .await?;
    }

    let server_version = {
        let row = (&mut *conn).fetch_one("SELECT VERSION()").await?;
        get_string(&row, 0)
    };

    let core_sql = strip_leading_explain(&sql);
    let read_only = is_read_only(&core_sql);

    /* Rich JSON plan — the engine's primary input. Tolerate failure (older/odd
       servers) and fall back to the traditional grid. */
    let explain_json = match (&mut *conn)
        .fetch_one(format!("EXPLAIN FORMAT=JSON {core_sql}").as_str())
        .await
    {
        Ok(row) => Some(get_string(&row, 0)),
        Err(_) => None,
    };

    /* Capture the optimizer's rewrite/notes right after the JSON EXPLAIN (the
       next statement resets the warning list). */
    let warnings = match (&mut *conn).fetch_all("SHOW WARNINGS").await {
        Ok(rows) => rows.iter().map(|r| get_string(r, 2)).collect(),
        Err(_) => Vec::new(),
    };

    /* Traditional grid. A failure here is the real syntax/permission error, so
       surface it. */
    let trad = (&mut *conn)
        .fetch_all(format!("EXPLAIN {core_sql}").as_str())
        .await?;
    let explain_columns = trad
        .first()
        .map(|r| result_columns(r).into_iter().map(|(n, _)| n).collect::<Vec<_>>())
        .unwrap_or_default();
    let explain_rows: Vec<Value> = trad.iter().map(row_to_json).collect();

    let analyze_tree = if run_analyze && read_only {
        match (&mut *conn)
            .fetch_all(format!("EXPLAIN ANALYZE {core_sql}").as_str())
            .await
        {
            Ok(rows) => {
                let text = rows
                    .iter()
                    .map(|r| get_string(r, 0))
                    .collect::<Vec<_>>()
                    .join("\n");
                (!text.is_empty()).then_some(text)
            }
            Err(_) => None,
        }
    } else {
        None
    };

    /* Resolve the plan's table names (which are ALIASES when the query aliases
       a table) to real base tables so we can read their schema. Start from the
       SQL's FROM/JOIN list, then cover any plan tables the parser missed. */
    let alias_pairs = parse_table_aliases(&core_sql);
    let mut plan_names = Vec::new();
    if let Some(js) = explain_json.as_deref() {
        if let Ok(v) = serde_json::from_str::<Value>(js) {
            collect_table_names(&v, &mut plan_names);
        }
    }
    let mut tables = Vec::new();
    let mut covered: std::collections::HashSet<String> = std::collections::HashSet::new();
    for (real, alias) in &alias_pairs {
        let plan_name = alias.clone().unwrap_or_else(|| real.clone());
        if covered.contains(&plan_name) {
            continue;
        }
        if let Some(mut info) = gather_table_info(&pool, &database, real).await {
            info.name = plan_name.clone();
            tables.push(info);
            covered.insert(plan_name);
        }
    }
    for tn in plan_names {
        if covered.contains(&tn) {
            continue;
        }
        if let Some(info) = gather_table_info(&pool, &database, &tn).await {
            covered.insert(tn);
            tables.push(info);
        }
    }

    Ok(QueryAnalysisInput {
        server_version,
        read_only,
        explain_json,
        explain_columns,
        explain_rows,
        warnings,
        analyze_tree,
        tables,
    })
}

/// Interrupt the query running under `token` (if any) by issuing `KILL QUERY`
/// on a separate pooled connection. No-op when nothing is registered.
#[tauri::command]
pub async fn cancel_query(
    state: State<'_, AppState>,
    profile_id: String,
    token: String,
) -> AppResult<()> {
    let conn_id = state.running_queries.read().await.get(&token).copied();
    let Some(conn_id) = conn_id else {
        return Ok(());
    };
    let pool = pool_for(&state, &profile_id).await?;
    let mut conn = pool.acquire().await?;
    (&mut *conn)
        .execute(format!("KILL QUERY {conn_id}").as_str())
        .await?;
    Ok(())
}

#[tauri::command]
pub async fn truncate_table(
    state: State<'_, AppState>,
    profile_id: String,
    database: String,
    table: String,
) -> AppResult<()> {
    let pool = pool_for(&state, &profile_id).await?;
    let mut conn = pool.acquire().await?;
    let qualified = format!("{}.{}", quote_ident(&database), quote_ident(&table));
    /* MySQL refuses to TRUNCATE any table another table's foreign key points
       at, even when both tables are empty. The caller (TableActionDialog) has
       already checked, via `truncate_blockers`, that no referencing rows exist,
       so the constraint check is turned off for this session-scoped connection
       only and restored afterwards. */
    (&mut *conn).execute("SET FOREIGN_KEY_CHECKS = 0").await?;
    let result = (&mut *conn)
        .execute(format!("TRUNCATE TABLE {qualified}").as_str())
        .await;
    (&mut *conn).execute("SET FOREIGN_KEY_CHECKS = 1").await?;
    result?;
    Ok(())
}

#[tauri::command]
pub async fn rename_table(
    app: AppHandle,
    state: State<'_, AppState>,
    profile_id: String,
    database: String,
    old_name: String,
    new_name: String,
) -> AppResult<()> {
    let pool = pool_for(&state, &profile_id).await?;
    let mut conn = pool.acquire().await?;
    let from = format!("{}.{}", quote_ident(&database), quote_ident(&old_name));
    let to = format!("{}.{}", quote_ident(&database), quote_ident(&new_name));
    (&mut *conn)
        .execute(format!("RENAME TABLE {from} TO {to}").as_str())
        .await?;
    /* Keep folder membership pointing at the new name. Folders are keyed by host. */
    let host = crate::store::profiles::get(&app, &profile_id)?.host;
    crate::store::folders::rename_table(&app, &host, &database, &old_name, &new_name)?;
    Ok(())
}

#[tauri::command]
pub async fn drop_table(
    state: State<'_, AppState>,
    profile_id: String,
    database: String,
    table: String,
) -> AppResult<()> {
    let pool = pool_for(&state, &profile_id).await?;
    let mut conn = pool.acquire().await?;
    let qualified = format!("{}.{}", quote_ident(&database), quote_ident(&table));
    (&mut *conn)
        .execute(format!("DROP TABLE {qualified}").as_str())
        .await?;
    Ok(())
}

/// Quote a value as a MySQL single-quoted string literal (backslash-escaped, to
/// match the app's "Copy as INSERT" output).
fn sql_quote(s: &str) -> String {
    format!("'{}'", s.replace('\\', "\\\\").replace('\'', "\\'"))
}

fn opt<'r, T>(row: &'r MySqlRow, i: usize) -> Option<T>
where
    T: sqlx::Decode<'r, sqlx::MySql> + sqlx::Type<sqlx::MySql>,
{
    row.try_get::<Option<T>, _>(i).ok().flatten()
}

/// Render one cell as a MySQL literal for an INSERT, by column type. NULL stays
/// NULL; numerics are unquoted; binary becomes a `0x…` hex literal; everything
/// else is a quoted string.
fn sql_literal(row: &MySqlRow, i: usize, ty: &str) -> String {
    let null = || "NULL".to_string();
    match ty {
        "BOOLEAN" | "TINYINT" | "SMALLINT" | "MEDIUMINT" | "INT" | "BIGINT" => {
            opt::<i64>(row, i).map(|n| n.to_string()).unwrap_or_else(null)
        }
        "TINYINT UNSIGNED" | "SMALLINT UNSIGNED" | "MEDIUMINT UNSIGNED" | "INT UNSIGNED"
        | "BIGINT UNSIGNED" => opt::<u64>(row, i).map(|n| n.to_string()).unwrap_or_else(null),
        "FLOAT" | "DOUBLE" => opt::<f64>(row, i).map(|n| n.to_string()).unwrap_or_else(null),
        "DECIMAL" => opt::<bigdecimal::BigDecimal>(row, i)
            .map(|d| d.to_string())
            .unwrap_or_else(null),
        "YEAR" => opt::<u16>(row, i).map(|y| y.to_string()).unwrap_or_else(null),
        "DATE" => opt::<chrono::NaiveDate>(row, i)
            .map(|d| sql_quote(&d.to_string()))
            .unwrap_or_else(null),
        "TIME" => opt::<chrono::NaiveTime>(row, i)
            .map(|t| sql_quote(&t.to_string()))
            .unwrap_or_else(null),
        "DATETIME" | "TIMESTAMP" => opt::<chrono::NaiveDateTime>(row, i)
            .map(|d| sql_quote(&d.format("%Y-%m-%d %H:%M:%S").to_string()))
            .unwrap_or_else(null),
        "JSON" => opt::<Value>(row, i)
            .map(|v| sql_quote(&v.to_string()))
            .unwrap_or_else(null),
        "BLOB" | "TINYBLOB" | "MEDIUMBLOB" | "LONGBLOB" | "VARBINARY" | "BINARY" => {
            opt::<Vec<u8>>(row, i)
                .map(|b| {
                    if b.is_empty() {
                        "''".to_string()
                    } else {
                        let mut hex = String::with_capacity(2 + b.len() * 2);
                        hex.push_str("0x");
                        for byte in &b {
                            hex.push_str(&format!("{byte:02x}"));
                        }
                        hex
                    }
                })
                .unwrap_or_else(null)
        }
        _ => opt::<String>(row, i)
            .map(|s| sql_quote(&s))
            .unwrap_or_else(null),
    }
}

/// Remove the table-level `AUTO_INCREMENT=<n>` option from a `SHOW CREATE TABLE`
/// DDL string. The next inserted row should pick its own counter, so the script
/// shouldn't pin it to the source table's current value. Only the table option
/// (`AUTO_INCREMENT=`, with `=`) is touched; the column-level `AUTO_INCREMENT`
/// flag has no `=` and is left intact.
fn strip_auto_increment_option(ddl: &str) -> String {
    let needle = "AUTO_INCREMENT=";
    let Some(start) = ddl.find(needle) else {
        return ddl.to_string();
    };
    /* Skip past the digits that follow the `=`. */
    let after = start + needle.len();
    let digits_end = ddl[after..]
        .find(|c: char| !c.is_ascii_digit())
        .map(|i| after + i)
        .unwrap_or(ddl.len());
    /* Also drop one trailing space so we don't leave a double space. */
    let mut end = digits_end;
    if ddl[end..].starts_with(' ') {
        end += 1;
    }
    let mut result = String::with_capacity(ddl.len());
    result.push_str(&ddl[..start]);
    result.push_str(&ddl[end..]);
    result
}

/// Write a `.sql` script for one or more tables: each table's `CREATE TABLE`
/// statement and, optionally, `INSERT` statements that restore every row. With
/// several tables the statements are concatenated into the single file (in the
/// given order). When data is included, emits `table-sql-progress`
/// ({ done, total }) — cumulative across all tables — so the UI can show a
/// progress bar. Returns `false` (and writes nothing) when the user cancels
/// mid-stream.
#[tauri::command]
pub async fn export_table_sql(
    app: AppHandle,
    state: State<'_, AppState>,
    profile_id: String,
    database: String,
    tables: Vec<String>,
    path: String,
    include_data: bool,
) -> AppResult<bool> {
    state.cancel_sql_export.store(false, Ordering::Relaxed);
    let pool = pool_for(&state, &profile_id).await?;

    /* Grand total across every table so the progress bar tracks the whole job,
       not each table in isolation. */
    let mut total: u64 = 0;
    if include_data {
        for table in &tables {
            let qualified = format!("{}.{}", quote_ident(&database), quote_ident(table));
            total += sqlx::query_scalar::<_, i64>(&format!("SELECT COUNT(*) FROM {qualified}"))
                .fetch_one(&pool)
                .await
                .unwrap_or(0)
                .max(0) as u64;
        }
        let _ = app.emit("table-sql-progress", serde_json::json!({ "done": 0, "total": total }));
    }

    let mut out = String::new();
    let mut done: u64 = 0;
    let mut last_emit: u64 = 0;

    for table in &tables {
        let qualified = format!("{}.{}", quote_ident(&database), quote_ident(table));

        let create_row = sqlx::query(&format!("SHOW CREATE TABLE {qualified}"))
            .fetch_one(&pool)
            .await?;
        /* SHOW CREATE TABLE returns (Table, "Create Table"); the DDL is column 1. */
        let create_sql = strip_auto_increment_option(&get_string(&create_row, 1));

        if !out.is_empty() {
            out.push('\n');
        }
        out.push_str(&format!("-- DB Sage export of `{database}`.`{table}`\n\n"));
        out.push_str(&create_sql);
        out.push_str(";\n");

        if !include_data {
            continue;
        }

        /* Stream on a dedicated connection so a cancel can detach it (it still
           has unsent rows queued) instead of returning a dirty conn to the pool. */
        let mut conn = pool.acquire().await?;
        let select_sql = format!("SELECT * FROM {qualified}");
        let mut stream = sqlx::query(&select_sql).fetch(&mut *conn);
        let mut columns: Vec<(String, String)> = Vec::new();
        let mut insert_prefix = String::new();
        let mut cancelled = false;
        while let Some(row) = stream.try_next().await? {
            if state.cancel_sql_export.load(Ordering::Relaxed) {
                cancelled = true;
                break;
            }
            if columns.is_empty() {
                columns = result_columns(&row);
                let col_list = columns
                    .iter()
                    .map(|(name, _)| quote_ident(name))
                    .collect::<Vec<_>>()
                    .join(", ");
                insert_prefix =
                    format!("INSERT INTO {} ({}) VALUES", quote_ident(table), col_list);
                out.push('\n');
            }
            let values = columns
                .iter()
                .enumerate()
                .map(|(i, (_, ty))| sql_literal(&row, i, ty))
                .collect::<Vec<_>>()
                .join(", ");
            out.push_str(&format!("{insert_prefix} ({values});\n"));
            done += 1;
            if done - last_emit >= 500 {
                last_emit = done;
                let _ = app
                    .emit("table-sql-progress", serde_json::json!({ "done": done, "total": total }));
            }
        }
        drop(stream);
        if cancelled {
            let _ = conn.detach();
            return Ok(false);
        }
    }

    if include_data {
        let _ = app.emit(
            "table-sql-progress",
            serde_json::json!({ "done": done, "total": done.max(total) }),
        );
    }

    let target = std::path::PathBuf::from(&path);
    let tmp = target.with_extension("sql-tmp");
    std::fs::write(&tmp, out.as_bytes())?;
    std::fs::rename(&tmp, &target)?;
    Ok(true)
}

/// Ask the in-progress SQL-script export to stop (best-effort, checked per row).
#[tauri::command]
pub async fn cancel_table_sql_export(state: State<'_, AppState>) -> AppResult<()> {
    state.cancel_sql_export.store(true, Ordering::Relaxed);
    Ok(())
}

/// Ask the in-progress table copy to stop. Sets the cancel flag (which the
/// cross-connection streaming loop checks) and, if a same-connection
/// `INSERT ... SELECT` is in flight, interrupts it with `KILL QUERY`.
#[tauri::command]
pub async fn cancel_table_copy(state: State<'_, AppState>) -> AppResult<()> {
    state.cancel_copy.store(true, Ordering::Relaxed);
    let target = state.copy_kill.read().await.clone();
    if let Some((profile_id, conn_id)) = target {
        let pool = pool_for(&state, &profile_id).await?;
        let mut conn = pool.acquire().await?;
        let _ = (&mut *conn)
            .execute(format!("KILL QUERY {conn_id}").as_str())
            .await;
    }
    Ok(())
}

#[tauri::command]
pub async fn update_cell(
    state: State<'_, AppState>,
    profile_id: String,
    database: String,
    table: String,
    pk: Vec<PkValue>,
    column: String,
    value: Option<String>,
) -> AppResult<u64> {
    if pk.is_empty() {
        return Err(AppError::Other(
            "cannot update: table has no primary key columns provided".into(),
        ));
    }

    let pool = pool_for(&state, &profile_id).await?;
    let columns = fetch_columns(&pool, &database, &table).await?;
    let column_set: HashSet<&str> = columns.iter().map(|c| c.name.as_str()).collect();

    if !column_set.contains(column.as_str()) {
        return Err(AppError::Other(format!("unknown column: {column}")));
    }
    for p in &pk {
        if !column_set.contains(p.column.as_str()) {
            return Err(AppError::Other(format!(
                "unknown pk column: {}",
                p.column
            )));
        }
    }

    let qualified = format!("{}.{}", quote_ident(&database), quote_ident(&table));
    let set_clause = format!("{} = ?", quote_ident(&column));

    let where_clauses: Vec<String> = pk
        .iter()
        .map(|p| {
            if p.value.is_none() {
                format!("{} IS NULL", quote_ident(&p.column))
            } else {
                format!("{} = ?", quote_ident(&p.column))
            }
        })
        .collect();
    let where_clause = where_clauses.join(" AND ");

    let sql = format!("UPDATE {qualified} SET {set_clause} WHERE {where_clause}");
    let mut q = sqlx::query(&sql);
    /* Bind the SET value (None → NULL). */
    q = match &value {
        Some(v) => q.bind(v.clone()),
        None => q.bind(Option::<String>::None),
    };
    /* Bind PK values (skip None — those use IS NULL in WHERE). */
    for p in &pk {
        if let Some(v) = &p.value {
            q = q.bind(v.clone());
        }
    }

    let result = q.execute(&pool).await?;
    let affected = result.rows_affected();
    if affected == 0 {
        return Err(AppError::Other(
            "no rows matched — row may have been deleted or modified concurrently".into(),
        ));
    }
    if affected > 1 {
        return Err(AppError::Other(format!(
            "update affected {affected} rows — refusing silently. Check the table for duplicate primary keys."
        )));
    }
    Ok(affected)
}

#[tauri::command]
pub async fn delete_row(
    state: State<'_, AppState>,
    profile_id: String,
    database: String,
    table: String,
    pk: Vec<PkValue>,
) -> AppResult<u64> {
    if pk.is_empty() {
        return Err(AppError::Other(
            "cannot delete: table has no primary key columns provided".into(),
        ));
    }

    let pool = pool_for(&state, &profile_id).await?;
    let columns = fetch_columns(&pool, &database, &table).await?;
    let column_set: HashSet<&str> = columns.iter().map(|c| c.name.as_str()).collect();
    for p in &pk {
        if !column_set.contains(p.column.as_str()) {
            return Err(AppError::Other(format!(
                "unknown pk column: {}",
                p.column
            )));
        }
    }

    let qualified = format!("{}.{}", quote_ident(&database), quote_ident(&table));
    let where_clauses: Vec<String> = pk
        .iter()
        .map(|p| {
            if p.value.is_none() {
                format!("{} IS NULL", quote_ident(&p.column))
            } else {
                format!("{} = ?", quote_ident(&p.column))
            }
        })
        .collect();
    let where_clause = where_clauses.join(" AND ");

    let sql = format!("DELETE FROM {qualified} WHERE {where_clause}");
    let mut q = sqlx::query(&sql);
    for p in &pk {
        if let Some(v) = &p.value {
            q = q.bind(v.clone());
        }
    }

    let result = q.execute(&pool).await?;
    let affected = result.rows_affected();
    if affected == 0 {
        return Err(AppError::Other(
            "no rows matched - row may have been deleted or modified concurrently".into(),
        ));
    }
    if affected > 1 {
        return Err(AppError::Other(format!(
            "delete affected {affected} rows - refusing silently. Check the table for duplicate primary keys."
        )));
    }
    Ok(affected)
}

/// DELETE every row of `table` whose `column` matches one of `values` — the
/// cascade half of a row delete (related rows in a has-many / has-one target).
/// Returns the number of rows removed; 0 is fine (related rows may already be
/// gone), unlike `delete_row`'s strict single-row contract.
#[tauri::command]
pub async fn delete_rows_by_values(
    state: State<'_, AppState>,
    profile_id: String,
    database: String,
    table: String,
    column: String,
    values: Vec<String>,
) -> AppResult<u64> {
    if values.is_empty() {
        return Ok(0);
    }

    let pool = pool_for(&state, &profile_id).await?;
    let columns = fetch_columns(&pool, &database, &table).await?;
    if !columns.iter().any(|c| c.name == column) {
        return Err(AppError::Other(format!("unknown column: {column}")));
    }

    let qualified = format!("{}.{}", quote_ident(&database), quote_ident(&table));
    let placeholders = vec!["?"; values.len()].join(", ");
    let sql = format!(
        "DELETE FROM {qualified} WHERE {} IN ({placeholders})",
        quote_ident(&column)
    );
    let mut q = sqlx::query(&sql);
    for v in &values {
        q = q.bind(v.clone());
    }
    Ok(q.execute(&pool).await?.rows_affected())
}

/// INSERT a new row. `values` carries only the columns the caller supplied
/// (omitted columns fall back to their DB default / auto-increment). A value of
/// `None` inserts SQL NULL.
#[tauri::command]
pub async fn insert_row(
    state: State<'_, AppState>,
    profile_id: String,
    database: String,
    table: String,
    values: Vec<PkValue>,
) -> AppResult<u64> {
    if values.is_empty() {
        return Err(AppError::Other(
            "no values provided to insert".into(),
        ));
    }

    let pool = pool_for(&state, &profile_id).await?;
    let columns = fetch_columns(&pool, &database, &table).await?;
    let column_set: HashSet<&str> = columns.iter().map(|c| c.name.as_str()).collect();
    for v in &values {
        if !column_set.contains(v.column.as_str()) {
            return Err(AppError::Other(format!("unknown column: {}", v.column)));
        }
    }

    let qualified = format!("{}.{}", quote_ident(&database), quote_ident(&table));
    let cols = values
        .iter()
        .map(|v| quote_ident(&v.column))
        .collect::<Vec<_>>()
        .join(", ");
    let placeholders = values.iter().map(|_| "?").collect::<Vec<_>>().join(", ");
    let sql = format!("INSERT INTO {qualified} ({cols}) VALUES ({placeholders})");

    let mut q = sqlx::query(&sql);
    for v in &values {
        q = match &v.value {
            Some(val) => q.bind(val.clone()),
            None => q.bind(Option::<String>::None),
        };
    }

    let result = q.execute(&pool).await?;
    Ok(result.rows_affected())
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct JsonImportPreview {
    pub row_count: u64,
    /// Union of property names across the first rows, in first-seen order.
    pub keys: Vec<String>,
    /// The first few records verbatim, for the wizard's preview.
    pub sample_rows: Vec<Value>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct JsonColumnMapping {
    /// Target table column.
    pub column: String,
    /// Source JSON property feeding it.
    pub json_key: String,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct JsonImportResult {
    pub inserted: u64,
    /// Rows that failed to insert and were skipped (continue-on-error mode only).
    pub skipped: u64,
    pub cancelled: bool,
}

/// Read a JSON file and require a top-level array (of objects). The whole file is
/// read into memory — fine for Rust even at large sizes, and it keeps the payload
/// out of the webview (the frontend only ever passes the path).
fn read_json_array(path: &str) -> AppResult<Vec<Value>> {
    let text = std::fs::read_to_string(path)
        .map_err(|e| AppError::Other(format!("Could not read file: {e}")))?;
    let parsed: Value = serde_json::from_str(&text)
        .map_err(|e| AppError::Other(format!("Invalid JSON: {e}")))?;
    match parsed {
        Value::Array(a) => Ok(a),
        _ => Err(AppError::Other(
            "Expected a JSON array of objects at the top level.".into(),
        )),
    }
}

/// Coerce a JSON value to the string DBSage binds for one column. SQL NULL covers
/// both an explicit `null` and a missing key (the caller passes `Null` then);
/// booleans become `1`/`0`; numbers and strings pass through; nested arrays and
/// objects are stored as JSON text. For datetime/timestamp targets the JSON `T`
/// separator is normalized to the space MySQL expects.
fn json_value_to_bind(value: &Value, target_type: &str) -> Option<String> {
    match value {
        Value::Null => None,
        Value::Bool(b) => Some(if *b { "1".into() } else { "0".into() }),
        Value::Number(n) => Some(n.to_string()),
        Value::String(s) => {
            let base = target_type
                .split(|c| c == '(' || c == ' ')
                .next()
                .unwrap_or("")
                .to_lowercase();
            if base == "datetime" || base == "timestamp" {
                Some(s.replacen('T', " ", 1))
            } else {
                Some(s.clone())
            }
        }
        other => serde_json::to_string(other).ok(),
    }
}

fn db_message(e: &sqlx::Error) -> String {
    match e.as_database_error() {
        Some(db) => db.message().to_string(),
        None => e.to_string(),
    }
}

/// Insert one batch of rows as a single multi-row INSERT, returning how many
/// rows were inserted. On failure the batch is replayed row-by-row: with
/// `continue_on_error` the failing rows are simply skipped (their successful
/// neighbors persist); without it, the first offending record is returned as its
/// 0-based global index + the DB message, and the surrounding transaction is
/// rolled back by the caller so the probe inserts never persist.
async fn flush_import_batch(
    conn: &mut sqlx::pool::PoolConnection<sqlx::MySql>,
    insert_prefix: &str,
    single_sql: &str,
    row_placeholder: &str,
    batch: &[(usize, Vec<Option<String>>)],
    continue_on_error: bool,
) -> Result<u64, (usize, String)> {
    let rows_sql = std::iter::repeat(row_placeholder)
        .take(batch.len())
        .collect::<Vec<_>>()
        .join(", ");
    let sql = format!("{insert_prefix} {rows_sql}");
    let mut q = sqlx::query(&sql);
    for (_, vals) in batch {
        for v in vals {
            q = q.bind(v.clone());
        }
    }
    if q.execute(&mut **conn).await.is_ok() {
        return Ok(batch.len() as u64);
    }
    let mut inserted: u64 = 0;
    for (idx, vals) in batch {
        let mut sq = sqlx::query(single_sql);
        for v in vals {
            sq = sq.bind(v.clone());
        }
        match sq.execute(&mut **conn).await {
            Ok(_) => inserted += 1,
            Err(e) => {
                if !continue_on_error {
                    return Err((*idx, db_message(&e)));
                }
            }
        }
    }
    if !continue_on_error && inserted == batch.len() as u64 {
        return Err((batch[0].0, "insert failed".to_string()));
    }
    Ok(inserted)
}

/// Inspect a JSON file for the import wizard: total record count, the union of
/// property names (first-seen order), and a few sample records.
#[tauri::command]
pub async fn json_import_preview(path: String) -> AppResult<JsonImportPreview> {
    let rows = read_json_array(&path)?;
    let mut keys: Vec<String> = Vec::new();
    let mut seen: HashSet<String> = HashSet::new();
    for v in rows.iter().take(200) {
        if let Value::Object(map) = v {
            for k in map.keys() {
                if seen.insert(k.clone()) {
                    keys.push(k.clone());
                }
            }
        }
    }
    let sample_rows = rows.iter().take(3).cloned().collect();
    Ok(JsonImportPreview {
        row_count: rows.len() as u64,
        keys,
        sample_rows,
    })
}

/// Import rows from a JSON file into a table using a property→column mapping.
/// Only mapped columns are written, so unmapped columns fall back to their DB
/// default / auto-increment. The whole import runs in one transaction: any error
/// (e.g. a duplicate primary key when the id column is mapped) rolls everything
/// back and reports the offending row — unless `continue_on_error` is set, in
/// which case failing rows are skipped and everything else commits (the result
/// carries the skipped count). Returns `cancelled: true` (nothing written) when
/// the user stops it mid-run.
#[tauri::command]
pub async fn import_json_rows(
    app: AppHandle,
    state: State<'_, AppState>,
    profile_id: String,
    database: String,
    table: String,
    path: String,
    mappings: Vec<JsonColumnMapping>,
    continue_on_error: bool,
) -> AppResult<JsonImportResult> {
    state.cancel_import.store(false, Ordering::Relaxed);
    if mappings.is_empty() {
        return Err(AppError::Other("No columns mapped to import.".into()));
    }

    let rows = read_json_array(&path)?;
    let total = rows.len() as u64;

    let pool = pool_for(&state, &profile_id).await?;
    let columns = fetch_columns(&pool, &database, &table).await?;
    let type_of: std::collections::HashMap<&str, &str> = columns
        .iter()
        .map(|c| (c.name.as_str(), c.data_type.as_str()))
        .collect();
    for m in &mappings {
        if !type_of.contains_key(m.column.as_str()) {
            return Err(AppError::Other(format!("Unknown column: {}", m.column)));
        }
    }

    let qualified = format!("{}.{}", quote_ident(&database), quote_ident(&table));
    let col_list = mappings
        .iter()
        .map(|m| quote_ident(&m.column))
        .collect::<Vec<_>>()
        .join(", ");
    let row_placeholder = format!(
        "({})",
        mappings.iter().map(|_| "?").collect::<Vec<_>>().join(", ")
    );
    let insert_prefix = format!("INSERT INTO {qualified} ({col_list}) VALUES");
    let single_sql = format!("{insert_prefix} {row_placeholder}");

    let mut conn = pool.acquire().await?;
    (&mut *conn).execute("START TRANSACTION").await?;
    let _ = app.emit(
        "json-import-progress",
        serde_json::json!({ "done": 0, "total": total }),
    );

    let mut batch: Vec<(usize, Vec<Option<String>>)> = Vec::new();
    let mut batch_bytes: usize = 0;
    let mut inserted: u64 = 0;
    let mut skipped: u64 = 0;

    for (idx, row) in rows.iter().enumerate() {
        if state.cancel_import.load(Ordering::Relaxed) {
            let _ = (&mut *conn).execute("ROLLBACK").await;
            return Ok(JsonImportResult {
                inserted: 0,
                skipped: 0,
                cancelled: true,
            });
        }
        let obj = row.as_object();
        let mut vals: Vec<Option<String>> = Vec::with_capacity(mappings.len());
        for m in &mappings {
            let ty = type_of.get(m.column.as_str()).copied().unwrap_or("");
            let bound = match obj.and_then(|o| o.get(&m.json_key)) {
                Some(val) => json_value_to_bind(val, ty),
                None => None,
            };
            batch_bytes += bound.as_ref().map(|s| s.len()).unwrap_or(4) + 4;
            vals.push(bound);
        }
        batch.push((idx, vals));

        if batch.len() >= 500 || batch_bytes >= 800_000 {
            match flush_import_batch(
                &mut conn,
                &insert_prefix,
                &single_sql,
                &row_placeholder,
                &batch,
                continue_on_error,
            )
            .await
            {
                Ok(got) => {
                    inserted += got;
                    skipped += batch.len() as u64 - got;
                }
                Err((row_index, msg)) => {
                    let _ = (&mut *conn).execute("ROLLBACK").await;
                    return Err(AppError::Other(format!("Row {}: {}", row_index + 1, msg)));
                }
            }
            let _ = app.emit(
                "json-import-progress",
                serde_json::json!({ "done": inserted + skipped, "total": total }),
            );
            batch.clear();
            batch_bytes = 0;
        }
    }

    if !batch.is_empty() {
        match flush_import_batch(
            &mut conn,
            &insert_prefix,
            &single_sql,
            &row_placeholder,
            &batch,
            continue_on_error,
        )
        .await
        {
            Ok(got) => {
                inserted += got;
                skipped += batch.len() as u64 - got;
            }
            Err((row_index, msg)) => {
                let _ = (&mut *conn).execute("ROLLBACK").await;
                return Err(AppError::Other(format!("Row {}: {}", row_index + 1, msg)));
            }
        }
    }

    (&mut *conn).execute("COMMIT").await?;
    let _ = app.emit(
        "json-import-progress",
        serde_json::json!({ "done": inserted + skipped, "total": total.max(inserted + skipped) }),
    );
    Ok(JsonImportResult {
        inserted,
        skipped,
        cancelled: false,
    })
}

/// Ask the in-progress JSON import to stop (checked per batch; rolls back).
#[tauri::command]
pub async fn cancel_json_import(state: State<'_, AppState>) -> AppResult<()> {
    state.cancel_import.store(true, Ordering::Relaxed);
    Ok(())
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DuplicateOutcome {
    /// "ok" | "conflict" | "error"
    pub status: String,
    /// Database message for the "conflict"/"error" cases (None when "ok").
    pub message: Option<String>,
}

/// Duplicate one existing row (identified by its primary key) via
/// `INSERT INTO t (cols…) SELECT cols… FROM t WHERE pk… LIMIT 1`, omitting
/// auto-increment and generated columns so the server assigns fresh values.
/// The copy is performed entirely server-side, so every value is byte-exact —
/// BLOBs, decimals, JSON, etc. are never round-tripped (and possibly mangled)
/// through the client.
///
/// Rather than erroring on a constraint violation, this returns a structured
/// outcome: a duplicate-key / integrity conflict (SQLSTATE 23000) comes back as
/// `status: "conflict"` so the caller can offer an edit-and-retry, while other
/// statement failures surface as `status: "error"`. Only connection-level
/// problems are returned as `Err`.
#[tauri::command]
pub async fn duplicate_row(
    state: State<'_, AppState>,
    profile_id: String,
    database: String,
    table: String,
    pk: Vec<PkValue>,
) -> AppResult<DuplicateOutcome> {
    if pk.is_empty() {
        return Err(AppError::Other(
            "cannot duplicate: table has no primary key columns provided".into(),
        ));
    }

    let pool = pool_for(&state, &profile_id).await?;

    /* Column metadata including EXTRA, so auto-increment and generated columns
       can be dropped from the INSERT — the server fills those itself. */
    let meta = sqlx::query(
        "SELECT COLUMN_NAME, EXTRA \
         FROM INFORMATION_SCHEMA.COLUMNS \
         WHERE TABLE_SCHEMA = ? AND TABLE_NAME = ? \
         ORDER BY ORDINAL_POSITION",
    )
    .bind(&database)
    .bind(&table)
    .fetch_all(&pool)
    .await?;

    let mut column_names: HashSet<String> = HashSet::new();
    let mut insertable: Vec<String> = Vec::new();
    for r in &meta {
        let name = get_string(r, 0);
        let extra = get_string(r, 1).to_lowercase();
        column_names.insert(name.clone());
        if extra.contains("auto_increment") || extra.contains("generated") {
            continue;
        }
        insertable.push(name);
    }

    for p in &pk {
        if !column_names.contains(&p.column) {
            return Err(AppError::Other(format!("unknown pk column: {}", p.column)));
        }
    }

    let qualified = format!("{}.{}", quote_ident(&database), quote_ident(&table));
    let where_clause = pk
        .iter()
        .map(|p| {
            if p.value.is_none() {
                format!("{} IS NULL", quote_ident(&p.column))
            } else {
                format!("{} = ?", quote_ident(&p.column))
            }
        })
        .collect::<Vec<_>>()
        .join(" AND ");

    let sql = if insertable.is_empty() {
        /* Every column is auto-increment/generated — there's nothing to copy, so
           just materialise a fresh all-defaults row. */
        format!("INSERT INTO {qualified} () VALUES ()")
    } else {
        let cols = insertable
            .iter()
            .map(|c| quote_ident(c))
            .collect::<Vec<_>>()
            .join(", ");
        format!(
            "INSERT INTO {qualified} ({cols}) SELECT {cols} FROM {qualified} WHERE {where_clause} LIMIT 1"
        )
    };

    let mut q = sqlx::query(&sql);
    if !insertable.is_empty() {
        for p in &pk {
            if let Some(v) = &p.value {
                q = q.bind(v.clone());
            }
        }
    }

    match q.execute(&pool).await {
        Ok(res) if res.rows_affected() == 0 => Ok(DuplicateOutcome {
            status: "error".into(),
            message: Some("source row not found - it may have been deleted or changed".into()),
        }),
        Ok(_) => Ok(DuplicateOutcome {
            status: "ok".into(),
            message: None,
        }),
        Err(e) => match e.as_database_error() {
            Some(db) => {
                let conflict = db.code().as_deref() == Some("23000");
                Ok(DuplicateOutcome {
                    status: if conflict { "conflict" } else { "error" }.into(),
                    message: Some(db.message().to_string()),
                })
            }
            None => Err(e.into()),
        },
    }
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct UniqueConflict {
    /// Name of the violated unique index (e.g. "PRIMARY", "uq_email").
    pub index_name: String,
    /// The columns making up that index — all should be highlighted.
    pub columns: Vec<String>,
}

/// Check a candidate row's values against every UNIQUE index on the table and
/// report which ones already have a matching row. Used by the duplicate-row
/// edit dialog to surface *all* colliding columns at once (a real INSERT only
/// raises the first duplicate-key error), so the user can fix them in one pass.
///
/// An index is skipped when any of its columns is absent from `values` or NULL
/// (NULLs never collide in a MySQL unique index).
#[tauri::command]
pub async fn check_row_conflicts(
    state: State<'_, AppState>,
    profile_id: String,
    database: String,
    table: String,
    values: Vec<PkValue>,
) -> AppResult<Vec<UniqueConflict>> {
    let pool = pool_for(&state, &profile_id).await?;

    let provided: std::collections::HashMap<String, Option<String>> =
        values.into_iter().map(|v| (v.column, v.value)).collect();

    /* Unique indexes and their ordered columns (NON_UNIQUE = 0). */
    let rows = sqlx::query(
        "SELECT INDEX_NAME, COLUMN_NAME \
         FROM INFORMATION_SCHEMA.STATISTICS \
         WHERE TABLE_SCHEMA = ? AND TABLE_NAME = ? AND NON_UNIQUE = 0 \
         ORDER BY INDEX_NAME, SEQ_IN_INDEX",
    )
    .bind(&database)
    .bind(&table)
    .fetch_all(&pool)
    .await?;

    let mut indexes: Vec<(String, Vec<String>)> = Vec::new();
    for r in &rows {
        let idx = get_string(r, 0);
        let col = get_string(r, 1);
        match indexes.last_mut() {
            Some(last) if last.0 == idx => last.1.push(col),
            _ => indexes.push((idx, vec![col])),
        }
    }

    let qualified = format!("{}.{}", quote_ident(&database), quote_ident(&table));
    let mut conflicts: Vec<UniqueConflict> = Vec::new();

    for (index_name, cols) in indexes {
        let mut binds: Vec<String> = Vec::new();
        let mut checkable = true;
        for c in &cols {
            match provided.get(c) {
                Some(Some(val)) => binds.push(val.clone()),
                _ => {
                    checkable = false;
                    break;
                }
            }
        }
        if !checkable {
            continue;
        }

        let where_clause = cols
            .iter()
            .map(|c| format!("{} = ?", quote_ident(c)))
            .collect::<Vec<_>>()
            .join(" AND ");
        let sql = format!("SELECT EXISTS(SELECT 1 FROM {qualified} WHERE {where_clause})");
        let mut q = sqlx::query(&sql);
        for b in &binds {
            q = q.bind(b);
        }
        let row = q.fetch_one(&pool).await?;
        let exists: i64 = row.try_get(0).unwrap_or(0);
        if exists != 0 {
            conflicts.push(UniqueConflict {
                index_name,
                columns: cols,
            });
        }
    }

    Ok(conflicts)
}
