use crate::error::AppResult;
use serde::{Deserialize, Serialize};
use std::collections::BTreeMap;
use std::path::PathBuf;
use std::time::{SystemTime, UNIX_EPOCH};
use tauri::{AppHandle, Manager};

/**
 * Per-database query history. Keyed by connection HOST + database (like
 * saved_queries) so the history follows the server across installations.
 * query_history.json layout:
 *   { "<host>::<database>": [ { "sql": ..., "executedAt": <unix-ms> }, ... ] }
 * Entries are stored most-recent-first. On re-execution of an identical SQL,
 * the existing entry's timestamp is bumped to "now" and it floats to the top.
 */
const MAX_PER_KEY: usize = 200;

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct HistoryItem {
    pub sql: String,
    #[serde(rename = "executedAt")]
    pub executed_at: u64,
}

pub type QueryHistoryFile = BTreeMap<String, Vec<HistoryItem>>;

fn path(app: &AppHandle) -> AppResult<PathBuf> {
    let dir = app.path().app_config_dir()?;
    std::fs::create_dir_all(&dir)?;
    Ok(dir.join("query_history.json"))
}

fn load_file(app: &AppHandle) -> AppResult<QueryHistoryFile> {
    let p = path(app)?;
    if !p.exists() {
        return Ok(QueryHistoryFile::default());
    }
    let bytes = std::fs::read(&p)?;
    if bytes.is_empty() {
        return Ok(QueryHistoryFile::default());
    }
    Ok(serde_json::from_slice(&bytes)?)
}

fn save_file(app: &AppHandle, file: &QueryHistoryFile) -> AppResult<()> {
    let p = path(app)?;
    let bytes = serde_json::to_vec_pretty(file)?;
    let tmp = p.with_extension("json.tmp");
    std::fs::write(&tmp, bytes)?;
    std::fs::rename(&tmp, &p)?;
    Ok(())
}

fn now_ms() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_millis() as u64)
        .unwrap_or(0)
}

pub fn list(app: &AppHandle, key: &str) -> AppResult<Vec<HistoryItem>> {
    Ok(load_file(app)?.remove(key).unwrap_or_default())
}

/// Add (or bump) a SQL string. If an identical SQL is already in history,
/// updates its timestamp to "now" and moves it to the top. Otherwise prepends
/// a new entry and trims the list to MAX_PER_KEY.
pub fn add(app: &AppHandle, key: &str, sql: &str) -> AppResult<Vec<HistoryItem>> {
    let mut file = load_file(app)?;
    let entry = file.entry(key.to_string()).or_default();
    let existing = entry.iter().position(|h| h.sql == sql);
    let item = HistoryItem {
        sql: sql.to_string(),
        executed_at: now_ms(),
    };
    if let Some(i) = existing {
        entry.remove(i);
    }
    entry.insert(0, item);
    if entry.len() > MAX_PER_KEY {
        entry.truncate(MAX_PER_KEY);
    }
    let result = entry.clone();
    save_file(app, &file)?;
    Ok(result)
}

pub fn delete(app: &AppHandle, key: &str, sql: &str) -> AppResult<()> {
    let mut file = load_file(app)?;
    if let Some(entry) = file.get_mut(key) {
        entry.retain(|h| h.sql != sql);
        if entry.is_empty() {
            file.remove(key);
        }
    }
    save_file(app, &file)
}

pub fn clear(app: &AppHandle, key: &str) -> AppResult<()> {
    let mut file = load_file(app)?;
    file.remove(key);
    save_file(app, &file)
}
