use sqlx::{MySqlPool, SqlitePool};
use std::collections::HashMap;
use std::sync::atomic::{AtomicBool, AtomicU64};
use std::sync::Mutex;
use tokio::sync::{OnceCell, RwLock};

#[derive(Default)]
pub struct AppState {
    pub pools: RwLock<HashMap<String, MySqlPool>>,
    /// Thread/connection id of the currently-running ad-hoc query per query-tab
    /// token, so a Stop request can `KILL QUERY` it from another connection.
    pub running_queries: RwLock<HashMap<String, u32>>,
    /// Set true to ask the in-progress SQL-script export to stop streaming. Only
    /// one export runs at a time (the UI blocks behind a modal).
    pub cancel_sql_export: AtomicBool,
    /// Set true to ask the in-progress table copy to stop. Only one copy runs at
    /// a time (the UI blocks behind a modal).
    pub cancel_copy: AtomicBool,
    /// Profile id + connection id of the statement a same-connection copy is
    /// currently running, so a cancel can `KILL QUERY` it (the cross-connection
    /// path stops via the `cancel_copy` flag instead). None when no copy
    /// statement is in flight.
    pub copy_kill: RwLock<Option<(String, u32)>>,
    /// Lazily-opened SQLite pool for the monitor history database.
    pub monitor_history: OnceCell<SqlitePool>,
    /// Running background samplers, keyed by profile id, so a monitor window's
    /// close can abort the matching one. Sync Mutex — touched from window-event
    /// callbacks (non-async).
    pub samplers: Mutex<HashMap<String, tokio::task::AbortHandle>>,
    /// Seed payloads for secondary windows (torn-off tabs, peeks), keyed by the
    /// new window's label. The window reads (and removes) its seed on mount via
    /// `take_window_seed` — each window is a separate JS context, so this is how
    /// the spawning window hands it the tab/peek to render.
    pub window_seeds: Mutex<HashMap<String, serde_json::Value>>,
    /// Live peek-window registry, keyed by window label → its seed descriptor.
    /// Lets a saved table view capture every open peek (`list_open_peeks`). The
    /// window's Destroyed event removes its entry.
    pub peeks: Mutex<HashMap<String, serde_json::Value>>,
    /// Monotonic counter for unique secondary-window labels (`tab-<n>`,
    /// `peek-<n>`) within a session.
    pub window_counter: AtomicU64,
    /// Main window's tab-strip rectangle in screen CSS pixels, published by the
    /// main window so a dragging tab-window can hit-test it for re-docking.
    pub tabstrip_rect: Mutex<Option<serde_json::Value>>,
}
