use crate::error::AppResult;
use crate::store::profiles;
use crate::store::saved_queries;
use serde_json::Value;
use tauri::AppHandle;

/// Saved queries are keyed by connection HOST + database so they follow the
/// server and import across installations; resolve the host from the profile.
fn key(app: &AppHandle, profile_id: &str, database: &str) -> AppResult<String> {
    let host = profiles::get(app, profile_id)?.host;
    Ok(format!("{host}::{database}"))
}

#[tauri::command]
pub async fn list_saved_queries(
    app: AppHandle,
    profile_id: String,
    database: String,
) -> AppResult<Vec<Value>> {
    saved_queries::list(&app, &key(&app, &profile_id, &database)?)
}

#[tauri::command]
pub async fn save_saved_query(
    app: AppHandle,
    profile_id: String,
    database: String,
    query: Value,
) -> AppResult<()> {
    saved_queries::save(&app, &key(&app, &profile_id, &database)?, query)
}

#[tauri::command]
pub async fn delete_saved_query(
    app: AppHandle,
    profile_id: String,
    database: String,
    name: String,
) -> AppResult<()> {
    saved_queries::delete(&app, &key(&app, &profile_id, &database)?, &name)
}
