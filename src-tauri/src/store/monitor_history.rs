use crate::error::AppResult;
use crate::state::AppState;
use serde::Serialize;
use sqlx::sqlite::{SqliteConnectOptions, SqlitePoolOptions};
use sqlx::SqlitePool;
use std::collections::BTreeMap;
use tauri::{AppHandle, Manager};

/// How long sampled history is kept before pruning.
const RETENTION_SECS: i64 = 7 * 24 * 3600;

/**
 * Time-series of selected `SHOW GLOBAL STATUS` counters, sampled by the
 * background monitor sampler into a local SQLite file (the app data dir). We
 * store the raw cumulative counters plus a unix timestamp; rates (QPS, etc.) are
 * derived on read by diffing consecutive samples, so the stored data stays exact
 * regardless of sampling interval. One row per (profile, timestamp).
 */
#[derive(Debug, Serialize, sqlx::FromRow)]
#[serde(rename_all = "camelCase")]
pub struct Sample {
    pub ts: i64,
    pub queries: Option<i64>,
    pub slow_queries: Option<i64>,
    pub bytes_sent: Option<i64>,
    pub bytes_received: Option<i64>,
    pub threads_running: Option<i64>,
    pub threads_connected: Option<i64>,
    pub bp_read_requests: Option<i64>,
    pub bp_reads: Option<i64>,
    pub uptime: Option<i64>,
}

/// Lazily open (and remember) the SQLite pool, creating the file + schema once.
pub async fn pool(app: &AppHandle) -> AppResult<SqlitePool> {
    let state = app.state::<AppState>();
    let pool = state
        .monitor_history
        .get_or_try_init(|| async { open(app).await })
        .await?;
    Ok(pool.clone())
}

async fn open(app: &AppHandle) -> AppResult<SqlitePool> {
    let dir = app.path().app_config_dir()?;
    std::fs::create_dir_all(&dir)?;
    let path = dir.join("monitor_history.db");
    let opts = SqliteConnectOptions::new()
        .filename(&path)
        .create_if_missing(true);
    let pool = SqlitePoolOptions::new()
        .max_connections(2)
        .connect_with(opts)
        .await?;
    sqlx::query(
        "CREATE TABLE IF NOT EXISTS samples (\
            profile_id TEXT NOT NULL, \
            ts INTEGER NOT NULL, \
            queries INTEGER, slow_queries INTEGER, \
            bytes_sent INTEGER, bytes_received INTEGER, \
            threads_running INTEGER, threads_connected INTEGER, \
            bp_read_requests INTEGER, bp_reads INTEGER, \
            uptime INTEGER, \
            PRIMARY KEY (profile_id, ts))",
    )
    .execute(&pool)
    .await?;
    Ok(pool)
}

/// Record one sample of the tracked counters for a connection, then prune
/// anything past the retention window.
pub async fn insert(
    app: &AppHandle,
    profile_id: &str,
    status: &BTreeMap<String, String>,
) -> AppResult<()> {
    let pool = pool(app).await?;
    let ts = chrono::Utc::now().timestamp();
    let n = |k: &str| status.get(k).and_then(|v| v.parse::<i64>().ok());
    sqlx::query(
        "INSERT OR REPLACE INTO samples \
            (profile_id, ts, queries, slow_queries, bytes_sent, bytes_received, \
             threads_running, threads_connected, bp_read_requests, bp_reads, uptime) \
         VALUES (?,?,?,?,?,?,?,?,?,?,?)",
    )
    .bind(profile_id)
    .bind(ts)
    .bind(n("Queries"))
    .bind(n("Slow_queries"))
    .bind(n("Bytes_sent"))
    .bind(n("Bytes_received"))
    .bind(n("Threads_running"))
    .bind(n("Threads_connected"))
    .bind(n("Innodb_buffer_pool_read_requests"))
    .bind(n("Innodb_buffer_pool_reads"))
    .bind(n("Uptime"))
    .execute(&pool)
    .await?;
    sqlx::query("DELETE FROM samples WHERE ts < ?")
        .bind(ts - RETENTION_SECS)
        .execute(&pool)
        .await?;
    Ok(())
}

/// All samples for a connection at or after `since_ts` (unix seconds), oldest first.
pub async fn query(
    app: &AppHandle,
    profile_id: &str,
    since_ts: i64,
) -> AppResult<Vec<Sample>> {
    let pool = pool(app).await?;
    let rows = sqlx::query_as::<_, Sample>(
        "SELECT ts, queries, slow_queries, bytes_sent, bytes_received, \
            threads_running, threads_connected, bp_read_requests, bp_reads, uptime \
         FROM samples WHERE profile_id = ? AND ts >= ? ORDER BY ts",
    )
    .bind(profile_id)
    .bind(since_ts)
    .fetch_all(&pool)
    .await?;
    Ok(rows)
}
