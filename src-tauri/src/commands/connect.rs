use crate::db::mysql::build_pool;
use crate::error::{AppError, AppResult};
use crate::state::AppState;
use crate::store::{profiles, secrets};
use serde::Deserialize;
use tauri::{AppHandle, State};

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TestConnectionInput {
    pub host: String,
    pub port: u16,
    pub username: String,
    pub password: String,
    pub default_database: Option<String>,
}

#[tauri::command]
pub async fn test_connection(input: TestConnectionInput) -> AppResult<()> {
    let pool = build_pool(
        &input.host,
        input.port,
        &input.username,
        &input.password,
        input.default_database.as_deref(),
    )
    .await?;
    sqlx::query("SELECT 1").execute(&pool).await?;
    pool.close().await;
    Ok(())
}

#[tauri::command]
pub async fn open_connection(
    app: AppHandle,
    state: State<'_, AppState>,
    profile_id: String,
) -> AppResult<()> {
    {
        let pools = state.pools.read().await;
        if pools.contains_key(&profile_id) {
            return Ok(());
        }
    }

    let profile = profiles::get(&app, &profile_id)?;
    let password = secrets::get_password(&profile_id)?
        .ok_or_else(|| AppError::Other(format!("no password stored for profile {profile_id}")))?;

    let pool = build_pool(
        &profile.host,
        profile.port,
        &profile.username,
        &password,
        profile.default_database.as_deref(),
    )
    .await?;

    let mut pools = state.pools.write().await;
    pools.insert(profile_id, pool);
    Ok(())
}

#[tauri::command]
pub async fn close_connection(
    state: State<'_, AppState>,
    profile_id: String,
) -> AppResult<()> {
    let mut pools = state.pools.write().await;
    if let Some(pool) = pools.remove(&profile_id) {
        pool.close().await;
    }
    Ok(())
}

#[tauri::command]
pub async fn is_connected(state: State<'_, AppState>, profile_id: String) -> AppResult<bool> {
    let pools = state.pools.read().await;
    Ok(pools.contains_key(&profile_id))
}
