use sqlx::MySqlPool;
use std::collections::HashMap;
use std::sync::atomic::AtomicBool;
use tokio::sync::RwLock;

#[derive(Default)]
pub struct AppState {
    pub pools: RwLock<HashMap<String, MySqlPool>>,
    /// Thread/connection id of the currently-running ad-hoc query per query-tab
    /// token, so a Stop request can `KILL QUERY` it from another connection.
    pub running_queries: RwLock<HashMap<String, u32>>,
    /// Set true to ask the in-progress SQL-script export to stop streaming. Only
    /// one export runs at a time (the UI blocks behind a modal).
    pub cancel_sql_export: AtomicBool,
}
