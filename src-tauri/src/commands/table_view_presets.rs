use crate::error::AppResult;
use crate::store::table_view_presets;
use serde_json::Value;
use tauri::AppHandle;

fn key(profile_id: &str, database: &str, table: &str) -> String {
    format!("{profile_id}::{database}::{table}")
}

#[tauri::command]
pub async fn list_table_presets(
    app: AppHandle,
    profile_id: String,
    database: String,
    table: String,
) -> AppResult<Vec<Value>> {
    table_view_presets::list(&app, &key(&profile_id, &database, &table))
}

#[tauri::command]
pub async fn save_table_preset(
    app: AppHandle,
    profile_id: String,
    database: String,
    table: String,
    preset: Value,
) -> AppResult<()> {
    table_view_presets::save(&app, &key(&profile_id, &database, &table), preset)
}

#[tauri::command]
pub async fn delete_table_preset(
    app: AppHandle,
    profile_id: String,
    database: String,
    table: String,
    name: String,
) -> AppResult<()> {
    table_view_presets::delete(&app, &key(&profile_id, &database, &table), &name)
}
