mod commands;
mod crypto;
mod db;
mod error;
mod state;
mod store;
mod updater;

use commands::{
    admin, column_setups, connect, export, folders, monitoring, profiles, query, query_history,
    relations, saved_queries, state_io, table_view_presets,
};
use state::AppState;
use tauri::menu::{Menu, MenuItem};
use tauri::tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent};
use tauri::{AppHandle, Manager, WindowEvent};

/// Show every app window (main + any monitor windows) and surface them. Used by
/// the tray to bring the app back after a hide-to-tray. Monitor windows are
/// focused last so they aren't left buried behind the (larger) main window.
fn show_all_windows(app: &AppHandle) {
    let mut monitors = Vec::new();
    for (label, win) in app.webview_windows() {
        let _ = win.show();
        let _ = win.unminimize();
        if label != "main" {
            monitors.push(win);
        }
    }
    if let Some(main) = app.get_webview_window("main") {
        let _ = main.set_focus();
    }
    for win in monitors {
        let _ = win.set_focus();
    }
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_window_state::Builder::default().build())
        .manage(AppState::default())
        .setup(|app| {
            /* Re-key per-connection stores from profile id to host (idempotent).
             * Best-effort: a migration hiccup must never block app launch. */
            let _ = store::migrate::host_rekey(app.handle());

            /* Tray icon: lets the app keep running (and background sampling) after
             * the main window is hidden. Left-click or "Show" restores all
             * windows; "Quit" exits for real. */
            let show = MenuItem::with_id(app, "show", "Show DB Sage", true, None::<&str>)?;
            let quit = MenuItem::with_id(app, "quit", "Quit", true, None::<&str>)?;
            let menu = Menu::with_items(app, &[&show, &quit])?;
            TrayIconBuilder::new()
                .icon(app.default_window_icon().unwrap().clone())
                .tooltip("DB Sage")
                .menu(&menu)
                .show_menu_on_left_click(false)
                .on_menu_event(|app, event| match event.id.as_ref() {
                    "show" => show_all_windows(app),
                    "quit" => app.exit(0),
                    _ => {}
                })
                .on_tray_icon_event(|tray, event| {
                    if let TrayIconEvent::Click {
                        button: MouseButton::Left,
                        button_state: MouseButtonState::Up,
                        ..
                    } = event
                    {
                        show_all_windows(tray.app_handle());
                    }
                })
                .build(app)?;

            /* Closing the MAIN window hides the whole app to the tray (main + any
             * monitor windows) instead of quitting, so background sampling keeps
             * running. Monitor windows keep their default close (they're torn down
             * individually — that's the "stop monitoring this connection" gesture). */
            if let Some(main) = app.get_webview_window("main") {
                let handle = app.handle().clone();
                main.on_window_event(move |event| {
                    if let WindowEvent::CloseRequested { api, .. } = event {
                        api.prevent_close();
                        for (label, win) in handle.webview_windows() {
                            if label == "main"
                                || label.starts_with("monitor-")
                                || label.starts_with("admin-")
                            {
                                let _ = win.hide();
                            }
                        }
                    }
                });
            }
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            profiles::list_profiles,
            profiles::save_profile,
            profiles::delete_profile,
            connect::test_connection,
            connect::open_connection,
            connect::close_connection,
            connect::is_connected,
            query::list_databases,
            query::create_database,
            query::drop_database,
            query::list_tables,
            query::list_columns,
            query::fetch_rows,
            query::count_rows,
            query::execute_query,
            query::cancel_query,
            query::update_cell,
            query::insert_row,
            query::delete_row,
            query::table_exists,
            query::create_table,
            query::copy_table,
            query::cancel_table_copy,
            query::truncate_table,
            query::drop_table,
            query::rename_table,
            query::column_definitions,
            query::index_definitions,
            query::table_auto_increment,
            query::table_comment,
            query::export_table_sql,
            query::cancel_table_sql_export,
            query::run_ddl,
            folders::list_folders,
            folders::create_folder,
            folders::rename_folder,
            folders::delete_folder,
            folders::set_table_folder,
            column_setups::get_column_setup,
            column_setups::save_column_setup,
            table_view_presets::list_table_presets,
            table_view_presets::tables_with_presets,
            table_view_presets::save_table_preset,
            table_view_presets::delete_table_preset,
            saved_queries::list_saved_queries,
            saved_queries::save_saved_query,
            saved_queries::delete_saved_query,
            query_history::list_query_history,
            query_history::add_query_history,
            query_history::delete_query_history,
            query_history::clear_query_history,
            monitoring::list_processes,
            monitoring::global_status,
            monitoring::global_variables,
            monitoring::kill_process,
            monitoring::open_monitor_window,
            monitoring::monitor_history,
            relations::list_relations,
            relations::save_relation,
            relations::delete_relation,
            state_io::export_state,
            state_io::import_state,
            state_io::preview_state,
            export::export_query,
            updater::check_for_update,
            updater::download_and_run_installer,
            updater::get_app_version,
            admin::mysql_service_status,
            admin::service_control,
            admin::set_service_start_mode,
            admin::open_admin_window,
            admin::log_config,
            admin::read_log_tail,
            admin::resolve_my_ini,
            admin::read_my_ini,
            admin::save_my_ini,
        ])
        .run(tauri::generate_context!())
        .expect("error while running DBSage");
}
