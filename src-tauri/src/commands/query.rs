use crate::db::mysql::{get_string, quote_ident, result_columns, row_to_json};
use crate::error::{AppError, AppResult};
use crate::state::AppState;
use futures_util::TryStreamExt;
use serde::{Deserialize, Serialize};
use serde_json::Value;
use sqlx::mysql::MySqlRow;
use sqlx::{Either, Executor, MySqlPool, Row};
use std::collections::HashSet;
use tauri::{AppHandle, State};

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

/// Result of an ad-hoc query. For result-set statements (SELECT/SHOW/etc.)
/// `columns`/`rows` carry the data and `rows_affected` is None. For statements
/// with no result set (INSERT/UPDATE/DELETE/DDL) `rows_affected` is set and
/// `rows` is empty.
#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct QueryResult {
    pub columns: Vec<ColumnInfo>,
    pub rows: Vec<Value>,
    pub rows_affected: Option<u64>,
    /// Server-side execution time (statement run only, excludes row decoding), ms.
    pub elapsed_ms: u64,
    /// True when the result set was capped at `max_rows` and more rows existed.
    pub truncated: bool,
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
    Like,
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
            match (json_path, &f.op) {
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
         WHERE SCHEMA_NAME NOT IN ('information_schema','performance_schema','mysql','sys') \
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
        "SELECT COLUMN_NAME, COLUMN_TYPE, IS_NULLABLE, COLUMN_KEY \
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
        "SELECT COLUMN_NAME, COLUMN_TYPE, IS_NULLABLE, COLUMN_KEY, COLUMN_DEFAULT, EXTRA, COLUMN_COMMENT \
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
            default_value: r.try_get::<Option<String>, _>(4).ok().flatten(),
            extra: get_string(r, 5),
            comment: get_string(r, 6),
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
    let row = sqlx::query(
        "SELECT AUTO_INCREMENT FROM INFORMATION_SCHEMA.TABLES \
         WHERE TABLE_SCHEMA = ? AND TABLE_NAME = ?",
    )
    .bind(&database)
    .bind(&table)
    .fetch_optional(&pool)
    .await?;
    Ok(row.and_then(|r| r.try_get::<Option<u64>, _>(0).ok().flatten()))
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
        let name = get_string(r, 0);
        /* NON_UNIQUE is an integer column; its exact width varies by server, so
           try the likely sqlx mappings before giving up (default: non-unique). */
        let non_unique = r
            .try_get::<i64, _>(1)
            .or_else(|_| r.try_get::<i32, _>(1).map(i64::from))
            .or_else(|_| r.try_get::<u64, _>(1).map(|v| v as i64))
            .or_else(|_| r.try_get::<u32, _>(1).map(i64::from))
            .unwrap_or(1);
        let column = get_string(r, 2);
        let collation = r.try_get::<Option<String>, _>(3).ok().flatten();
        let raw_type = get_string(r, 4).to_uppercase();
        let comment = get_string(r, 5);

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
    Ok(out)
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

    let outcome: AppResult<QueryResult> = async {
        let started = std::time::Instant::now();
        if !database.trim().is_empty() {
            (&mut *conn)
                .execute(format!("USE {}", quote_ident(&database)).as_str())
                .await?;
        }

        let mut rows: Vec<MySqlRow> = Vec::new();
        let mut affected: u64 = 0;
        let mut had_result_set = false;
        let mut truncated = false;
        {
            let mut stream = (&mut *conn).fetch_many(sql.as_str());
            while let Some(item) = stream.try_next().await? {
                match item {
                    Either::Left(res) => affected += res.rows_affected(),
                    Either::Right(row) => {
                        had_result_set = true;
                        /* Stop once we've collected the cap. Seeing one more row
                           past the cap means the result had more — flag it and
                           bail without buffering the rest. */
                        if let Some(cap) = max_rows {
                            if rows.len() as u32 >= cap {
                                truncated = true;
                                break;
                            }
                        }
                        rows.push(row);
                    }
                }
            }
        }
        let elapsed_ms = started.elapsed().as_millis() as u64;

        let columns: Vec<ColumnInfo> = rows
            .first()
            .map(|r| {
                result_columns(r)
                    .into_iter()
                    .map(|(name, data_type)| ColumnInfo {
                        name,
                        data_type,
                        nullable: true,
                        key: String::new(),
                    })
                    .collect()
            })
            .unwrap_or_default();
        let json_rows: Vec<Value> = rows.iter().map(row_to_json).collect();

        Ok(QueryResult {
            columns,
            rows: json_rows,
            rows_affected: if had_result_set { None } else { Some(affected) },
            elapsed_ms,
            truncated,
        })
    }
    .await;

    state.running_queries.write().await.remove(&token);

    /* When truncated, we stopped reading mid-result, so the connection still has
       unsent rows queued. Detach it from the pool (dropping it closes the socket,
       which tells the server to stop) so a dirty connection isn't reused. */
    if matches!(&outcome, Ok(r) if r.truncated) {
        let _ = conn.detach();
    }
    outcome
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
    (&mut *conn)
        .execute(format!("TRUNCATE TABLE {qualified}").as_str())
        .await?;
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
    /* Keep folder membership pointing at the new name. */
    crate::store::folders::rename_table(&app, &profile_id, &database, &old_name, &new_name)?;
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
