use crate::error::AppResult;
use crate::store::column_setups;
use serde_json::Value;
use tauri::AppHandle;

fn key(profile_id: &str, database: &str, table: &str) -> String {
    format!("{profile_id}::{database}::{table}")
}

#[tauri::command]
pub async fn get_column_setup(
    app: AppHandle,
    profile_id: String,
    database: String,
    table: String,
) -> AppResult<Option<Value>> {
    column_setups::get(&app, &key(&profile_id, &database, &table))
}

#[tauri::command]
pub async fn save_column_setup(
    app: AppHandle,
    profile_id: String,
    database: String,
    table: String,
    setup: Value,
) -> AppResult<()> {
    column_setups::set(&app, &key(&profile_id, &database, &table), setup)
}
