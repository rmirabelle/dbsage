use sqlx::MySqlPool;
use std::collections::HashMap;
use tokio::sync::RwLock;

#[derive(Default)]
pub struct AppState {
    pub pools: RwLock<HashMap<String, MySqlPool>>,
    /// Thread/connection id of the currently-running ad-hoc query per query-tab
    /// token, so a Stop request can `KILL QUERY` it from another connection.
    pub running_queries: RwLock<HashMap<String, u32>>,
}
