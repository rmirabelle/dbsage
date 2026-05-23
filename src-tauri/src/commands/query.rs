use crate::db::mysql::{get_string, quote_ident, row_to_json};
use crate::error::{AppError, AppResult};
use crate::state::AppState;
use serde::{Deserialize, Serialize};
use serde_json::Value;
use sqlx::{Executor, MySqlPool, Row};
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
            match f.op {
                FilterOp::Equals => {
                    where_clauses.push(format!("{ident} = ?"));
                    bindings.push(f.value.clone());
                }
                FilterOp::Like => {
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
