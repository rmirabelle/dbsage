mod commands;
mod crypto;
mod db;
mod error;
mod state;
mod store;
mod updater;

use commands::{
    admin, backup, column_setups, connect, export, folders, monitoring, profiles, query,
    query_history, relations, saved_queries, state_io, table_view_presets, windows,
};
use state::AppState;
use tauri::menu::{Menu, MenuItem};
use tauri::tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent};
use tauri::{AppHandle, Manager, WindowEvent};
use tauri_plugin_dialog::{DialogExt, MessageDialogButtons};

/// Stable id for the on-demand tray icon, so it can be created and removed.
const TRAY_ID: &str = "main-tray";

/// Create the tray icon if it isn't already present (idempotent). The tray only
/// exists while the app is hidden via "Minimize to Tray" — there's no permanent
/// tray presence during normal use (minimize goes to the taskbar, close quits),
/// so the app never shows in both the taskbar and the tray at once. Left-click or
/// "Show" restores all windows (and removes the tray); "Quit" exits for real.
fn ensure_tray(app: &AppHandle) -> tauri::Result<()> {
    if app.tray_by_id(TRAY_ID).is_some() {
        return Ok(());
    }
    let show = MenuItem::with_id(app, "show", "Show DB Sage", true, None::<&str>)?;
    let quit = MenuItem::with_id(app, "quit", "Quit", true, None::<&str>)?;
    let menu = Menu::with_items(app, &[&show, &quit])?;
    TrayIconBuilder::with_id(TRAY_ID)
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
    Ok(())
}

/// Hide every app window to the tray and create the tray icon so the app can be
/// restored. Used by the "Minimize to Tray" path; keeps background sampling alive.
fn hide_all_to_tray(app: &AppHandle) {
    let _ = ensure_tray(app);
    for (label, win) in app.webview_windows() {
        if label != "splash" {
            let _ = win.hide();
        }
    }
}

/// Show every app window (main + any monitor windows) and surface them, then
/// remove the tray icon (we're back to normal taskbar use). Monitor windows are
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
    let _ = app.remove_tray_by_id(TRAY_ID);
}

/// Minimize (or restore) every secondary window to follow the main window, so
/// peeks and torn-off tabs don't linger on screen when the app is minimized.
fn sync_minimize_secondary(app: &AppHandle, minimized: bool) {
    for (label, win) in app.webview_windows() {
        if label == "main" || label == "splash" {
            continue;
        }
        if minimized {
            let _ = win.minimize();
        } else {
            let _ = win.unminimize();
        }
    }
}

/// Confirm exiting while a monitor window is still showing. The dialog is shown
/// non-blocking (a blocking dialog from the window-event callback would stall the
/// main event loop): "Exit" quits the app, "Minimize to Tray" hides every window
/// so background sampling keeps running.
fn confirm_exit_with_monitor(app: AppHandle) {
    app.dialog()
        .message("A monitoring window is still open. Are you sure you want to exit?")
        .title("Exit DB Sage?")
        .buttons(MessageDialogButtons::OkCancelCustom(
            "Exit".into(),
            "Minimize to Tray".into(),
        ))
        .show(move |exit| {
            if exit {
                app.exit(0);
            } else {
                hide_all_to_tray(&app);
            }
        });
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    /* Both rustls crypto backends end up linked (sqlx/reqwest enable `ring`,
       mysql_async enables `aws-lc-rs`), and rustls panics at first TLS use
       unless one is installed as the process default. Must run before any
       connection is opened. */
    let _ = rustls::crypto::ring::default_provider().install_default();
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_dialog::init())
        .plugin(
            /* Don't let the plugin manage the VISIBLE flag: the main window
             * launches hidden (config) and is shown only once boot completes,
             * so a restored "visible" would defeat the splash. The splash window
             * is always centered, so skip its saved state entirely. */
            tauri_plugin_window_state::Builder::default()
                .with_state_flags(
                    tauri_plugin_window_state::StateFlags::all()
                        & !tauri_plugin_window_state::StateFlags::VISIBLE,
                )
                .skip_initial_state("splash")
                .build(),
        )
        .manage(AppState::default())
        .setup(|app| {
            /* Re-key per-connection stores from profile id to host (idempotent).
             * Best-effort: a migration hiccup must never block app launch. */
            let _ = store::migrate::host_rekey(app.handle());

            /* No tray icon at startup — it's created on demand only when the user
             * picks "Minimize to Tray" (see hide_all_to_tray) and removed again on
             * restore, so the app never shows in both the taskbar and the tray. */

            /* Closing the MAIN window quits the whole app. Edge case: if any
             * monitor window is still showing, background sampling would be lost,
             * so confirm first — offering "Exit" or "Minimize to Tray" (the old
             * hide-everything behavior, which keeps sampling alive). Monitor
             * windows keep their default close (they're torn down individually —
             * that's the "stop monitoring this connection" gesture). */
            if let Some(main) = app.get_webview_window("main") {
                let handle = app.handle().clone();
                /* Mirror the main window's minimize/restore onto every secondary
                 * window (peeks, torn-off tabs, monitor, admin), so they don't get
                 * left floating when the app is sent to the taskbar. Minimize has
                 * no dedicated event, so we read the state on resize and act only on
                 * a transition. */
                let was_minimized = std::sync::Arc::new(std::sync::atomic::AtomicBool::new(false));
                let main_win = main.clone();
                main.on_window_event(move |event| match event {
                    WindowEvent::CloseRequested { api, .. } => {
                        let monitor_showing = handle.webview_windows().iter().any(|(label, win)| {
                            label.starts_with("monitor-") && win.is_visible().unwrap_or(false)
                        });
                        if monitor_showing {
                            api.prevent_close();
                            confirm_exit_with_monitor(handle.clone());
                        } else {
                            handle.exit(0);
                        }
                    }
                    WindowEvent::Resized(_) => {
                        let minimized = main_win.is_minimized().unwrap_or(false);
                        let prev = was_minimized
                            .swap(minimized, std::sync::atomic::Ordering::Relaxed);
                        if prev != minimized {
                            sync_minimize_secondary(&handle, minimized);
                        }
                    }
                    _ => {}
                });
            }
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            profiles::list_profiles,
            profiles::save_profile,
            profiles::reorder_profiles,
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
            query::suggest_column_values,
            query::execute_query,
            query::analyze_query,
            query::cancel_query,
            query::update_cell,
            query::insert_row,
            query::insert_rows,
            query::delete_row,
            query::delete_rows_by_values,
            query::duplicate_row,
            query::check_row_conflicts,
            query::table_exists,
            query::create_table,
            query::copy_table,
            query::cancel_table_copy,
            query::json_import_preview,
            query::import_json_rows,
            query::cancel_json_import,
            query::truncate_table,
            query::drop_table,
            query::rename_table,
            query::column_definitions,
            query::list_collations,
            query::index_definitions,
            query::foreign_key_definitions,
            query::truncate_blockers,
            query::table_auto_increment,
            query::table_comment,
            query::table_schema_meta,
            query::database_schema,
            query::export_table_sql,
            query::cancel_table_sql_export,
            query::run_ddl,
            backup::backup_database,
            backup::cancel_backup,
            backup::inspect_backup,
            backup::restore_database,
            backup::cancel_restore,
            backup::swap_database,
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
            monitoring::server_resources,
            monitoring::global_status,
            monitoring::global_variables,
            monitoring::kill_process,
            monitoring::open_monitor_window,
            monitoring::monitor_history,
            relations::list_relations,
            relations::save_relation,
            relations::delete_relation,
            relations::export_relations_file,
            export::write_text_file,
            relations::preview_relations_import,
            relations::import_relations_file,
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
            windows::read_window_seed,
            windows::open_tab_window,
            windows::open_peek_window,
            windows::list_open_peeks,
            windows::set_peek_state,
            windows::open_help_window,
            windows::close_all_peeks,
            windows::close_peeks,
            windows::arrange_peeks,
            windows::set_tabstrip_rect,
            windows::get_tabstrip_rect,
            windows::mouse_left_button_down,
            windows::cursor_position,
        ])
        .run(tauri::generate_context!())
        .expect("error while running DBSage");
}
