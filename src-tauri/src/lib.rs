mod commands;
mod db;
mod error;
mod state;
mod store;
mod updater;

use commands::{connect, folders, profiles, query};
use state::AppState;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_window_state::Builder::default().build())
        .manage(AppState::default())
        .invoke_handler(tauri::generate_handler![
            profiles::list_profiles,
            profiles::save_profile,
            profiles::delete_profile,
            connect::test_connection,
            connect::open_connection,
            connect::close_connection,
            connect::is_connected,
            query::list_databases,
            query::list_tables,
            query::fetch_rows,
            query::update_cell,
            folders::list_folders,
            folders::create_folder,
            folders::rename_folder,
            folders::delete_folder,
            folders::set_table_folder,
            updater::check_for_update,
            updater::download_and_run_installer,
            updater::get_app_version,
        ])
        .run(tauri::generate_context!())
        .expect("error while running DBSage");
}
