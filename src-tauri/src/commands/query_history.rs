use crate::error::AppResult;
use crate::store::profiles;
use crate::store::query_history::{self, HistoryItem};
use tauri::AppHandle;

/// History is keyed by connection HOST + database, mirroring saved_queries.
fn key(app: &AppHandle, profile_id: &str, database: &str) -> AppResult<String> {
    let host = profiles::get(app, profile_id)?.host;
    Ok(format!("{host}::{database}"))
}

#[tauri::command]
pub async fn list_query_history(
    app: AppHandle,
    profile_id: String,
    database: String,
) -> AppResult<Vec<HistoryItem>> {
    query_history::list(&app, &key(&app, &profile_id, &database)?)
}

#[tauri::command]
pub async fn add_query_history(
    app: AppHandle,
    profile_id: String,
    database: String,
    sql: String,
) -> AppResult<Vec<HistoryItem>> {
    query_history::add(&app, &key(&app, &profile_id, &database)?, &sql)
}

#[tauri::command]
pub async fn delete_query_history(
    app: AppHandle,
    profile_id: String,
    database: String,
    sql: String,
) -> AppResult<()> {
    query_history::delete(&app, &key(&app, &profile_id, &database)?, &sql)
}

#[tauri::command]
pub async fn clear_query_history(
    app: AppHandle,
    profile_id: String,
    database: String,
) -> AppResult<()> {
    query_history::clear(&app, &key(&app, &profile_id, &database)?)
}
