use crate::error::{AppError, AppResult};
use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};
use std::collections::BTreeMap;
use std::path::PathBuf;
use tauri::{AppHandle, Manager};

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Folder {
    pub id: String,
    pub name: String,
    #[serde(default)]
    pub tables: Vec<String>,
    pub created_at: DateTime<Utc>,
    pub updated_at: DateTime<Utc>,
}

/**
 * folders.json layout:
 *   { "<profile-id>": { "<database>": [Folder, ...] } }
 */
pub type FoldersFile = BTreeMap<String, BTreeMap<String, Vec<Folder>>>;

fn folders_path(app: &AppHandle) -> AppResult<PathBuf> {
    let dir = app.path().app_config_dir()?;
    std::fs::create_dir_all(&dir)?;
    Ok(dir.join("folders.json"))
}

fn load_file(app: &AppHandle) -> AppResult<FoldersFile> {
    let path = folders_path(app)?;
    if !path.exists() {
        return Ok(FoldersFile::default());
    }
    let bytes = std::fs::read(&path)?;
    if bytes.is_empty() {
        return Ok(FoldersFile::default());
    }
    Ok(serde_json::from_slice(&bytes)?)
}

fn save_file(app: &AppHandle, file: &FoldersFile) -> AppResult<()> {
    let path = folders_path(app)?;
    let bytes = serde_json::to_vec_pretty(file)?;
    let tmp = path.with_extension("json.tmp");
    std::fs::write(&tmp, bytes)?;
    std::fs::rename(&tmp, &path)?;
    Ok(())
}

pub fn list(app: &AppHandle, profile_id: &str, database: &str) -> AppResult<Vec<Folder>> {
    let file = load_file(app)?;
    Ok(file
        .get(profile_id)
        .and_then(|m| m.get(database))
        .cloned()
        .unwrap_or_default())
}

pub fn create(
    app: &AppHandle,
    profile_id: &str,
    database: &str,
    name: &str,
) -> AppResult<Folder> {
    let trimmed = name.trim();
    if trimmed.is_empty() {
        return Err(AppError::Other("folder name cannot be empty".to_string()));
    }
    let now = Utc::now();
    let folder = Folder {
        id: uuid::Uuid::new_v4().to_string(),
        name: trimmed.to_string(),
        tables: Vec::new(),
        created_at: now,
        updated_at: now,
    };
    let mut file = load_file(app)?;
    file.entry(profile_id.to_string())
        .or_default()
        .entry(database.to_string())
        .or_default()
        .push(folder.clone());
    save_file(app, &file)?;
    Ok(folder)
}

pub fn rename(
    app: &AppHandle,
    profile_id: &str,
    database: &str,
    folder_id: &str,
    new_name: &str,
) -> AppResult<Folder> {
    let trimmed = new_name.trim();
    if trimmed.is_empty() {
        return Err(AppError::Other("folder name cannot be empty".to_string()));
    }
    let mut file = load_file(app)?;
    let folders = file
        .get_mut(profile_id)
        .and_then(|m| m.get_mut(database))
        .ok_or_else(|| AppError::Other(format!("no folders for {profile_id}/{database}")))?;
    let folder = folders
        .iter_mut()
        .find(|f| f.id == folder_id)
        .ok_or_else(|| AppError::Other(format!("folder not found: {folder_id}")))?;
    folder.name = trimmed.to_string();
    folder.updated_at = Utc::now();
    let result = folder.clone();
    save_file(app, &file)?;
    Ok(result)
}

pub fn delete(
    app: &AppHandle,
    profile_id: &str,
    database: &str,
    folder_id: &str,
) -> AppResult<()> {
    let mut file = load_file(app)?;
    if let Some(by_db) = file.get_mut(profile_id) {
        if let Some(folders) = by_db.get_mut(database) {
            folders.retain(|f| f.id != folder_id);
        }
    }
    save_file(app, &file)?;
    Ok(())
}

/// Move a table into the given folder, or out of any folder when `folder_id` is None.
/// A table belongs to at most one folder: existing membership is cleared first.
pub fn set_table_folder(
    app: &AppHandle,
    profile_id: &str,
    database: &str,
    table: &str,
    folder_id: Option<&str>,
) -> AppResult<()> {
    let mut file = load_file(app)?;
    let folders = file
        .entry(profile_id.to_string())
        .or_default()
        .entry(database.to_string())
        .or_default();

    let now = Utc::now();
    for folder in folders.iter_mut() {
        if folder.tables.iter().any(|t| t == table) {
            folder.tables.retain(|t| t != table);
            folder.updated_at = now;
        }
    }

    if let Some(target_id) = folder_id {
        let target = folders
            .iter_mut()
            .find(|f| f.id == target_id)
            .ok_or_else(|| AppError::Other(format!("folder not found: {target_id}")))?;
        target.tables.push(table.to_string());
        target.updated_at = now;
    }

    save_file(app, &file)?;
    Ok(())
}

pub fn export_all(app: &AppHandle) -> AppResult<FoldersFile> {
    load_file(app)
}

/// Keep folder membership in sync when a table is renamed: replace `old_name`
/// with `new_name` in any folder under (profile, database).
pub fn rename_table(
    app: &AppHandle,
    profile_id: &str,
    database: &str,
    old_name: &str,
    new_name: &str,
) -> AppResult<()> {
    let mut file = load_file(app)?;
    if let Some(folders) = file
        .get_mut(profile_id)
        .and_then(|by_db| by_db.get_mut(database))
    {
        let now = Utc::now();
        for folder in folders.iter_mut() {
            let mut changed = false;
            for t in folder.tables.iter_mut() {
                if t == old_name {
                    *t = new_name.to_string();
                    changed = true;
                }
            }
            if changed {
                folder.updated_at = now;
            }
        }
    }
    save_file(app, &file)?;
    Ok(())
}

/// Merge an imported folders tree into the store, upserting each folder by id
/// within its (profile, database) bucket. Returns the number of folders
/// processed.
pub fn import_merge(app: &AppHandle, incoming: &FoldersFile) -> AppResult<usize> {
    let mut file = load_file(app)?;
    let mut count = 0;
    for (profile_id, by_db) in incoming {
        for (database, folders) in by_db {
            let list = file
                .entry(profile_id.clone())
                .or_default()
                .entry(database.clone())
                .or_default();
            for folder in folders {
                if let Some(existing) = list.iter_mut().find(|f| f.id == folder.id) {
                    *existing = folder.clone();
                } else {
                    list.push(folder.clone());
                }
                count += 1;
            }
        }
    }
    save_file(app, &file)?;
    Ok(count)
}
