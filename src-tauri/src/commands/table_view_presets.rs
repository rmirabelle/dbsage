use crate::error::AppResult;
use crate::store::profiles;
use crate::store::table_view_presets;
use serde_json::Value;
use tauri::AppHandle;

/// Presets are keyed by connection HOST so they follow the server and import
/// across installations; resolve the host from the profile.
fn key(app: &AppHandle, profile_id: &str, database: &str, table: &str) -> AppResult<String> {
    let host = profiles::get(app, profile_id)?.host;
    Ok(format!("{host}::{database}::{table}"))
}

#[tauri::command]
pub async fn list_table_presets(
    app: AppHandle,
    profile_id: String,
    database: String,
    table: String,
) -> AppResult<Vec<Value>> {
    table_view_presets::list(&app, &key(&app, &profile_id, &database, &table)?)
}

#[tauri::command]
pub async fn tables_with_presets(
    app: AppHandle,
    profile_id: String,
    database: String,
) -> AppResult<Vec<String>> {
    let host = profiles::get(&app, &profile_id)?.host;
    table_view_presets::tables_with_presets(&app, &host, &database)
}

#[tauri::command]
pub async fn save_table_preset(
    app: AppHandle,
    profile_id: String,
    database: String,
    table: String,
    preset: Value,
) -> AppResult<()> {
    table_view_presets::save(&app, &key(&app, &profile_id, &database, &table)?, preset)
}

#[tauri::command]
pub async fn delete_table_preset(
    app: AppHandle,
    profile_id: String,
    database: String,
    table: String,
    name: String,
) -> AppResult<()> {
    table_view_presets::delete(&app, &key(&app, &profile_id, &database, &table)?, &name)
}
