use crate::error::{AppError, AppResult};
use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};
use std::path::PathBuf;
use tauri::{AppHandle, Manager};

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ConnectionProfile {
    pub id: String,
    pub name: String,
    pub host: String,
    pub port: u16,
    pub username: String,
    #[serde(default)]
    pub default_database: Option<String>,
    pub created_at: DateTime<Utc>,
    pub updated_at: DateTime<Utc>,
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
struct ProfilesFile {
    #[serde(default)]
    profiles: Vec<ConnectionProfile>,
}

fn profiles_path(app: &AppHandle) -> AppResult<PathBuf> {
    let dir = app.path().app_config_dir()?;
    std::fs::create_dir_all(&dir)?;
    Ok(dir.join("profiles.json"))
}

pub fn load_all(app: &AppHandle) -> AppResult<Vec<ConnectionProfile>> {
    let path = profiles_path(app)?;
    if !path.exists() {
        return Ok(Vec::new());
    }
    let bytes = std::fs::read(&path)?;
    if bytes.is_empty() {
        return Ok(Vec::new());
    }
    let file: ProfilesFile = serde_json::from_slice(&bytes)?;
    Ok(file.profiles)
}

fn save_all(app: &AppHandle, profiles: &[ConnectionProfile]) -> AppResult<()> {
    let path = profiles_path(app)?;
    let file = ProfilesFile {
        profiles: profiles.to_vec(),
    };
    let bytes = serde_json::to_vec_pretty(&file)?;
    let tmp = path.with_extension("json.tmp");
    std::fs::write(&tmp, bytes)?;
    std::fs::rename(&tmp, &path)?;
    Ok(())
}

pub fn upsert(app: &AppHandle, profile: ConnectionProfile) -> AppResult<ConnectionProfile> {
    let mut all = load_all(app)?;
    let now = Utc::now();
    if let Some(existing) = all.iter_mut().find(|p| p.id == profile.id) {
        *existing = ConnectionProfile {
            updated_at: now,
            created_at: existing.created_at,
            ..profile
        };
        let result = existing.clone();
        save_all(app, &all)?;
        Ok(result)
    } else {
        let mut new_profile = profile;
        new_profile.created_at = now;
        new_profile.updated_at = now;
        all.push(new_profile.clone());
        save_all(app, &all)?;
        Ok(new_profile)
    }
}

/// Reorder the stored profiles to match the given id order. Ids not present in
/// `order` keep their relative position at the end (stable sort), so a stale or
/// partial list can never drop a profile.
pub fn reorder(app: &AppHandle, order: &[String]) -> AppResult<()> {
    let mut all = load_all(app)?;
    all.sort_by_key(|p| {
        order
            .iter()
            .position(|id| id == &p.id)
            .unwrap_or(usize::MAX)
    });
    save_all(app, &all)
}

pub fn delete(app: &AppHandle, id: &str) -> AppResult<()> {
    let mut all = load_all(app)?;
    let before = all.len();
    all.retain(|p| p.id != id);
    if all.len() == before {
        return Err(AppError::ProfileNotFound(id.to_string()));
    }
    save_all(app, &all)
}

pub fn get(app: &AppHandle, id: &str) -> AppResult<ConnectionProfile> {
    load_all(app)?
        .into_iter()
        .find(|p| p.id == id)
        .ok_or_else(|| AppError::ProfileNotFound(id.to_string()))
}

/// Merge imported profiles into the store, upserting by id and preserving the
/// incoming timestamps. Returns the number of profiles processed.
pub fn import_merge(app: &AppHandle, incoming: Vec<ConnectionProfile>) -> AppResult<usize> {
    let mut all = load_all(app)?;
    let count = incoming.len();
    for profile in incoming {
        if let Some(existing) = all.iter_mut().find(|p| p.id == profile.id) {
            *existing = profile;
        } else {
            all.push(profile);
        }
    }
    save_all(app, &all)?;
    Ok(count)
}
