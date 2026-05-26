use crate::error::AppResult;
use crate::store::folders::{self, Folder};
use crate::store::profiles;
use tauri::AppHandle;

/// Connection identity for the per-connection stores is the host, resolved from
/// the profile so folders follow the server (and import across installations).
fn host_of(app: &AppHandle, profile_id: &str) -> AppResult<String> {
    Ok(profiles::get(app, profile_id)?.host)
}

#[tauri::command]
pub async fn list_folders(
    app: AppHandle,
    profile_id: String,
    database: String,
) -> AppResult<Vec<Folder>> {
    folders::list(&app, &host_of(&app, &profile_id)?, &database)
}

#[tauri::command]
pub async fn create_folder(
    app: AppHandle,
    profile_id: String,
    database: String,
    name: String,
) -> AppResult<Folder> {
    folders::create(&app, &host_of(&app, &profile_id)?, &database, &name)
}

#[tauri::command]
pub async fn rename_folder(
    app: AppHandle,
    profile_id: String,
    database: String,
    folder_id: String,
    name: String,
) -> AppResult<Folder> {
    folders::rename(&app, &host_of(&app, &profile_id)?, &database, &folder_id, &name)
}

#[tauri::command]
pub async fn delete_folder(
    app: AppHandle,
    profile_id: String,
    database: String,
    folder_id: String,
) -> AppResult<()> {
    folders::delete(&app, &host_of(&app, &profile_id)?, &database, &folder_id)
}

#[tauri::command]
pub async fn set_table_folder(
    app: AppHandle,
    profile_id: String,
    database: String,
    table: String,
    folder_id: Option<String>,
) -> AppResult<()> {
    folders::set_table_folder(
        &app,
        &host_of(&app, &profile_id)?,
        &database,
        &table,
        folder_id.as_deref(),
    )
}
