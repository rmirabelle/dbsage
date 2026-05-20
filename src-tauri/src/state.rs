use sqlx::MySqlPool;
use std::collections::HashMap;
use tokio::sync::RwLock;

#[derive(Default)]
pub struct AppState {
    pub pools: RwLock<HashMap<String, MySqlPool>>,
}
