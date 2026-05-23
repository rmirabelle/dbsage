mod commands;
mod crypto;
mod db;
mod error;
mod state;
mod store;
mod updater;

use commands::{connect, folders, profiles, query, relations, state_io};
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
            query::list_columns,
            query::fetch_rows,
            query::count_rows,
            query::update_cell,
            query::table_exists,
            query::create_table,
            query::truncate_table,
            query::drop_table,
            query::rename_table,
            query::column_definitions,
            query::table_auto_increment,
            query::run_ddl,
            folders::list_folders,
            folders::create_folder,
            folders::rename_folder,
            folders::delete_folder,
            folders::set_table_folder,
            relations::list_relations,
            relations::save_relation,
            relations::delete_relation,
            state_io::export_state,
            state_io::import_state,
            updater::check_for_update,
            updater::download_and_run_installer,
            updater::get_app_version,
        ])
        .run(tauri::generate_context!())
        .expect("error while running DBSage");
}
