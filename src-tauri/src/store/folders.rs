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
 * folders.json layout. Keyed by connection HOST (not the profile id) so folders
 * follow the server and import cleanly across installations:
 *   { "<host>": { "<database>": [Folder, ...] } }
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

pub fn list(app: &AppHandle, host: &str, database: &str) -> AppResult<Vec<Folder>> {
    let file = load_file(app)?;
    Ok(file
        .get(host)
        .and_then(|m| m.get(database))
        .cloned()
        .unwrap_or_default())
}

pub fn create(
    app: &AppHandle,
    host: &str,
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
    file.entry(host.to_string())
        .or_default()
        .entry(database.to_string())
        .or_default()
        .push(folder.clone());
    save_file(app, &file)?;
    Ok(folder)
}

pub fn rename(
    app: &AppHandle,
    host: &str,
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
        .get_mut(host)
        .and_then(|m| m.get_mut(database))
        .ok_or_else(|| AppError::Other(format!("no folders for {host}/{database}")))?;
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
    host: &str,
    database: &str,
    folder_id: &str,
) -> AppResult<()> {
    let mut file = load_file(app)?;
    if let Some(by_db) = file.get_mut(host) {
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
    host: &str,
    database: &str,
    table: &str,
    folder_id: Option<&str>,
) -> AppResult<()> {
    let mut file = load_file(app)?;
    let folders = file
        .entry(host.to_string())
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
    host: &str,
    database: &str,
    old_name: &str,
    new_name: &str,
) -> AppResult<()> {
    let mut file = load_file(app)?;
    if let Some(folders) = file
        .get_mut(host)
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
/// within its (host, database) bucket. Returns the number of folders processed.
pub fn import_merge(app: &AppHandle, incoming: &FoldersFile) -> AppResult<usize> {
    let mut file = load_file(app)?;
    let mut count = 0;
    for (host, by_db) in incoming {
        for (database, folders) in by_db {
            let list = file
                .entry(host.clone())
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

/// Re-key the store from random profile id to connection host, merging when two
/// connections share a host. Idempotent: keys that aren't a known profile id
/// (already a host, or orphaned) are left untouched, so re-running is a no-op.
pub fn migrate_to_host(
    app: &AppHandle,
    host_by_id: &BTreeMap<String, String>,
) -> AppResult<()> {
    let file = load_file(app)?;
    let mut changed = false;
    let mut out: FoldersFile = BTreeMap::new();
    for (key, by_db) in file {
        let new_key = match host_by_id.get(&key) {
            Some(host) => {
                changed = true;
                host.clone()
            }
            None => key,
        };
        let dest = out.entry(new_key).or_default();
        for (database, mut list) in by_db {
            dest.entry(database).or_default().append(&mut list);
        }
    }
    if !changed {
        return Ok(());
    }
    for by_db in out.values_mut() {
        for list in by_db.values_mut() {
            let mut seen = std::collections::HashSet::new();
            list.retain(|f| seen.insert(f.id.clone()));
        }
    }
    save_file(app, &out)
}
