use crate::error::AppResult;
use crate::state::AppState;
use crate::store::{
    profiles::{self, ConnectionProfile},
    secrets,
};
use chrono::Utc;
use serde::{Deserialize, Serialize};
use tauri::{AppHandle, State};
use uuid::Uuid;

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ProfileInput {
    pub id: Option<String>,
    pub name: String,
    pub host: String,
    pub port: u16,
    pub username: String,
    pub password: Option<String>,
    pub default_database: Option<String>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ProfileView {
    #[serde(flatten)]
    pub profile: ConnectionProfile,
    pub has_password: bool,
}

fn view_for(profile: ConnectionProfile) -> ProfileView {
    let has_password = secrets::get_password(&profile.id)
        .ok()
        .flatten()
        .is_some();
    ProfileView {
        profile,
        has_password,
    }
}

#[tauri::command]
pub async fn list_profiles(app: AppHandle) -> AppResult<Vec<ProfileView>> {
    let profiles = profiles::load_all(&app)?;
    Ok(profiles.into_iter().map(view_for).collect())
}

#[tauri::command]
pub async fn save_profile(app: AppHandle, input: ProfileInput) -> AppResult<ProfileView> {
    let id = input.id.unwrap_or_else(|| Uuid::new_v4().to_string());
    let now = Utc::now();
    let profile = ConnectionProfile {
        id: id.clone(),
        name: input.name,
        host: input.host,
        port: input.port,
        username: input.username,
        default_database: input.default_database.filter(|s| !s.is_empty()),
        created_at: now,
        updated_at: now,
    };
    let saved = profiles::upsert(&app, profile)?;
    if let Some(pw) = input.password.filter(|s| !s.is_empty()) {
        secrets::set_password(&saved.id, &pw)?;
    }
    Ok(view_for(saved))
}

#[tauri::command]
pub async fn reorder_profiles(app: AppHandle, ids: Vec<String>) -> AppResult<()> {
    profiles::reorder(&app, &ids)
}

#[tauri::command]
pub async fn delete_profile(
    app: AppHandle,
    state: State<'_, AppState>,
    id: String,
) -> AppResult<()> {
    {
        let mut pools = state.pools.write().await;
        if let Some(pool) = pools.remove(&id) {
            pool.close().await;
        }
    }
    secrets::delete_password(&id)?;
    profiles::delete(&app, &id)?;
    Ok(())
}
