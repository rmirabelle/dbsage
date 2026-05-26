use crate::error::AppResult;
use crate::store::column_setups;
use crate::store::profiles;
use serde_json::Value;
use tauri::AppHandle;

/// Per-table setups are keyed by connection HOST so they follow the server and
/// import across installations; resolve the host from the profile.
fn key(app: &AppHandle, profile_id: &str, database: &str, table: &str) -> AppResult<String> {
    let host = profiles::get(app, profile_id)?.host;
    Ok(format!("{host}::{database}::{table}"))
}

#[tauri::command]
pub async fn get_column_setup(
    app: AppHandle,
    profile_id: String,
    database: String,
    table: String,
) -> AppResult<Option<Value>> {
    column_setups::get(&app, &key(&app, &profile_id, &database, &table)?)
}

#[tauri::command]
pub async fn save_column_setup(
    app: AppHandle,
    profile_id: String,
    database: String,
    table: String,
    setup: Value,
) -> AppResult<()> {
    column_setups::set(&app, &key(&app, &profile_id, &database, &table)?, setup)
}
