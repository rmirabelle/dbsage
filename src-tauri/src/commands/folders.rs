use crate::error::AppResult;
use crate::store::folders::{self, Folder};
use tauri::AppHandle;

#[tauri::command]
pub async fn list_folders(
    app: AppHandle,
    profile_id: String,
    database: String,
) -> AppResult<Vec<Folder>> {
    folders::list(&app, &profile_id, &database)
}

#[tauri::command]
pub async fn create_folder(
    app: AppHandle,
    profile_id: String,
    database: String,
    name: String,
) -> AppResult<Folder> {
    folders::create(&app, &profile_id, &database, &name)
}

#[tauri::command]
pub async fn rename_folder(
    app: AppHandle,
    profile_id: String,
    database: String,
    folder_id: String,
    name: String,
) -> AppResult<Folder> {
    folders::rename(&app, &profile_id, &database, &folder_id, &name)
}

#[tauri::command]
pub async fn delete_folder(
    app: AppHandle,
    profile_id: String,
    database: String,
    folder_id: String,
) -> AppResult<()> {
    folders::delete(&app, &profile_id, &database, &folder_id)
}

#[tauri::command]
pub async fn set_table_folder(
    app: AppHandle,
    profile_id: String,
    database: String,
    table: String,
    folder_id: Option<String>,
) -> AppResult<()> {
    folders::set_table_folder(&app, &profile_id, &database, &table, folder_id.as_deref())
}
