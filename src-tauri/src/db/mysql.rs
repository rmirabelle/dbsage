use crate::error::AppResult;
use base64::Engine;
use serde_json::{json, Value};
use sqlx::mysql::{MySqlConnectOptions, MySqlPoolOptions, MySqlRow, MySqlSslMode};
use sqlx::{Column, MySqlPool, Row, TypeInfo};
use std::time::Duration;

/// Builds a MySQL connection pool. Keeps connection count low — this is a desktop
/// client, not a service. Two connections is enough for table-list + paged grid.
pub async fn build_pool(
    host: &str,
    port: u16,
    username: &str,
    password: &str,
    database: Option<&str>,
    use_ssl: bool,
) -> AppResult<MySqlPool> {
    let mut opts = MySqlConnectOptions::new()
        .host(host)
        .port(port)
        .username(username)
        .password(password);
    if !use_ssl {
        opts = opts.ssl_mode(MySqlSslMode::Disabled);
    }
    if let Some(db) = database {
        if !db.is_empty() {
            opts = opts.database(db);
        }
    }

    let pool = MySqlPoolOptions::new()
        .max_connections(2)
        .acquire_timeout(Duration::from_secs(8))
        .connect_with(opts)
        .await?;
    Ok(pool)
}

/// Backtick-quote a MySQL identifier, escaping any embedded backticks.
pub fn quote_ident(ident: &str) -> String {
    format!("`{}`", ident.replace('`', "``"))
}

/// Read a column as a string regardless of whether MySQL returns it with a text
/// or binary collation. INFORMATION_SCHEMA columns sometimes arrive as bytes.
pub fn get_string(row: &MySqlRow, i: usize) -> String {
    if let Ok(s) = row.try_get::<String, _>(i) {
        return s;
    }
    if let Ok(b) = row.try_get::<Vec<u8>, _>(i) {
        return String::from_utf8_lossy(&b).into_owned();
    }
    String::new()
}

/// Like `get_string`, but preserves SQL NULL as `None`. Needed for columns where
/// NULL is semantically distinct from an empty/zero value (e.g. COLUMN_DEFAULT,
/// where NULL means "no default" but a present default of `0` arrives as bytes
/// and would be lost by a plain `try_get::<Option<String>>`).
pub fn get_opt_string(row: &MySqlRow, i: usize) -> Option<String> {
    if let Ok(s) = row.try_get::<Option<String>, _>(i) {
        return s;
    }
    if let Ok(b) = row.try_get::<Option<Vec<u8>>, _>(i) {
        return b.map(|b| String::from_utf8_lossy(&b).into_owned());
    }
    None
}

/// Decode a MySQL row into a JSON object, mapping column types to portable JSON values.
/// Duplicate column names (e.g. `SELECT *` over a JOIN where both tables have `id`)
/// are disambiguated the same way `result_columns` does, so no value is silently
/// overwritten and every column header finds its value in the row object.
pub fn row_to_json(row: &MySqlRow) -> Value {
    let mut obj = serde_json::Map::with_capacity(row.columns().len());
    for (i, col) in row.columns().iter().enumerate() {
        let name = disambiguate(col.name(), |n| obj.contains_key(n));
        let value = decode_column(row, i, col.type_info().name());
        obj.insert(name, value);
    }
    Value::Object(obj)
}

/// Decode a MySQL row into a JSON object keyed by the given display names
/// (one per column, in column order). Used when the caller has resolved
/// duplicate column names itself (e.g. "table.name" labels for a JOIN).
pub fn row_to_json_named(row: &MySqlRow, names: &[String]) -> Value {
    let mut obj = serde_json::Map::with_capacity(names.len());
    for (i, col) in row.columns().iter().enumerate() {
        let value = decode_column(row, i, col.type_info().name());
        obj.insert(names[i].clone(), value);
    }
    Value::Object(obj)
}

/// Derive display columns (name, SQL type name) from an arbitrary result row.
/// Used by the ad-hoc query runner, which has no INFORMATION_SCHEMA metadata to
/// describe the columns of a free-form result set. Duplicate names become
/// "name (2)", "name (3)", ... — matching `row_to_json`, which walks the same
/// columns in the same order.
pub fn result_columns(row: &MySqlRow) -> Vec<(String, String)> {
    let mut out: Vec<(String, String)> = Vec::with_capacity(row.columns().len());
    for c in row.columns() {
        let name = disambiguate(c.name(), |n| out.iter().any(|(taken, _)| taken == n));
        out.push((name, c.type_info().name().to_string()));
    }
    out
}

/// Return `name` unchanged when free, otherwise the first free "name (2)",
/// "name (3)", ... per the caller's `taken` predicate.
pub fn disambiguate(name: &str, taken: impl Fn(&str) -> bool) -> String {
    if !taken(name) {
        return name.to_string();
    }
    let mut n = 2;
    loop {
        let candidate = format!("{name} ({n})");
        if !taken(&candidate) {
            return candidate;
        }
        n += 1;
    }
}

fn decode_column(row: &MySqlRow, i: usize, ty: &str) -> Value {
    match ty {
        // MySQL BOOLEAN is an alias for TINYINT(1) — keep the integer shape.
        "BOOLEAN" | "TINYINT" | "SMALLINT" | "MEDIUMINT" | "INT" | "BIGINT" => {
            try_get::<i64>(row, i).map(|n| json!(n)).unwrap_or(Value::Null)
        }

        "TINYINT UNSIGNED" | "SMALLINT UNSIGNED" | "MEDIUMINT UNSIGNED" | "INT UNSIGNED"
        | "BIGINT UNSIGNED" => try_get::<u64>(row, i).map(|n| json!(n)).unwrap_or(Value::Null),

        "FLOAT" | "DOUBLE" => try_get::<f64>(row, i).map(|n| json!(n)).unwrap_or(Value::Null),

        "DECIMAL" => try_get::<bigdecimal::BigDecimal>(row, i)
            .map(|d| Value::String(d.to_string()))
            .unwrap_or(Value::Null),

        "VARCHAR" | "CHAR" | "TEXT" | "TINYTEXT" | "MEDIUMTEXT" | "LONGTEXT" | "ENUM" | "SET" => {
            try_get::<String>(row, i)
                .map(Value::String)
                .unwrap_or(Value::Null)
        }

        "JSON" => try_get::<Value>(row, i).unwrap_or(Value::Null),

        "DATE" => try_get::<chrono::NaiveDate>(row, i)
            .map(|d| Value::String(d.to_string()))
            .unwrap_or(Value::Null),

        "TIME" => try_get::<chrono::NaiveTime>(row, i)
            .map(|t| Value::String(t.to_string()))
            .unwrap_or(Value::Null),

        "DATETIME" | "TIMESTAMP" => try_get::<chrono::NaiveDateTime>(row, i)
            .map(|d| Value::String(d.format("%Y-%m-%d %H:%M:%S").to_string()))
            .unwrap_or(Value::Null),

        "YEAR" => try_get::<u16>(row, i).map(|y| json!(y)).unwrap_or(Value::Null),

        "BLOB" | "TINYBLOB" | "MEDIUMBLOB" | "LONGBLOB" | "VARBINARY" | "BINARY" => {
            try_get::<Vec<u8>>(row, i)
                .map(|b| Value::String(base64::engine::general_purpose::STANDARD.encode(&b)))
                .unwrap_or(Value::Null)
        }

        _ => try_get::<String>(row, i)
            .map(Value::String)
            .unwrap_or(Value::Null),
    }
}

fn try_get<'r, T>(row: &'r MySqlRow, i: usize) -> Option<T>
where
    T: sqlx::Decode<'r, sqlx::MySql> + sqlx::Type<sqlx::MySql>,
{
    row.try_get::<Option<T>, _>(i).ok().flatten()
}
