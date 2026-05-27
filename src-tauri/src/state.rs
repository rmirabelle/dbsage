use sqlx::{MySqlPool, SqlitePool};
use std::collections::HashMap;
use std::sync::atomic::AtomicBool;
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
    /// Lazily-opened SQLite pool for the monitor history database.
    pub monitor_history: OnceCell<SqlitePool>,
    /// Running background samplers, keyed by profile id, so a monitor window's
    /// close can abort the matching one. Sync Mutex — touched from window-event
    /// callbacks (non-async).
    pub samplers: Mutex<HashMap<String, tokio::task::AbortHandle>>,
}
