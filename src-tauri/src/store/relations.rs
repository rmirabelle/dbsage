use crate::error::{AppError, AppResult};
use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};
use std::collections::BTreeMap;
use std::path::PathBuf;
use tauri::{AppHandle, Manager};

/// A virtual (app-defined) relationship between two tables. Independent of any
/// MySQL foreign key — `from_table.from_column` joins to `to_table.to_column`.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Relation {
    pub id: String,
    pub from_table: String,
    pub from_column: String,
    pub to_table: String,
    pub to_column: String,
    /// "has_one" (belongs-to) or "has_many".
    pub kind: String,
    #[serde(default)]
    pub name: String,
    pub created_at: DateTime<Utc>,
    pub updated_at: DateTime<Utc>,
}

/**
 * relations.json layout (mirrors folders.json). Keyed by connection HOST (not
 * the profile id) so relations follow the server and import cleanly across
 * installations:
 *   { "<host>": { "<database>": [Relation, ...] } }
 */
pub type RelationsFile = BTreeMap<String, BTreeMap<String, Vec<Relation>>>;

fn relations_path(app: &AppHandle) -> AppResult<PathBuf> {
    let dir = app.path().app_config_dir()?;
    std::fs::create_dir_all(&dir)?;
    Ok(dir.join("relations.json"))
}

fn load_file(app: &AppHandle) -> AppResult<RelationsFile> {
    let path = relations_path(app)?;
    if !path.exists() {
        return Ok(RelationsFile::default());
    }
    let bytes = std::fs::read(&path)?;
    if bytes.is_empty() {
        return Ok(RelationsFile::default());
    }
    Ok(serde_json::from_slice(&bytes)?)
}

fn save_file(app: &AppHandle, file: &RelationsFile) -> AppResult<()> {
    let path = relations_path(app)?;
    let bytes = serde_json::to_vec_pretty(file)?;
    let tmp = path.with_extension("json.tmp");
    std::fs::write(&tmp, bytes)?;
    std::fs::rename(&tmp, &path)?;
    Ok(())
}

pub fn list(app: &AppHandle, host: &str, database: &str) -> AppResult<Vec<Relation>> {
    let file = load_file(app)?;
    Ok(file
        .get(host)
        .and_then(|m| m.get(database))
        .cloned()
        .unwrap_or_default())
}

/// Create or update a relation. When `id` is supplied and found, updates it in
/// place; otherwise creates a new relation with a generated id.
#[allow(clippy::too_many_arguments)]
pub fn save(
    app: &AppHandle,
    host: &str,
    database: &str,
    id: Option<&str>,
    from_table: &str,
    from_column: &str,
    to_table: &str,
    to_column: &str,
    kind: &str,
    name: &str,
) -> AppResult<Relation> {
    if from_table.is_empty()
        || from_column.is_empty()
        || to_table.is_empty()
        || to_column.is_empty()
    {
        return Err(AppError::Other(
            "relation requires both tables and both columns".to_string(),
        ));
    }
    if kind != "has_one" && kind != "has_many" {
        return Err(AppError::Other(format!("invalid relation kind: {kind}")));
    }

    let now = Utc::now();
    let mut file = load_file(app)?;
    let list = file
        .entry(host.to_string())
        .or_default()
        .entry(database.to_string())
        .or_default();

    let editing_index = id
        .filter(|s| !s.is_empty())
        .and_then(|id| list.iter().position(|r| r.id == id));
    let same_endpoint = |r: &Relation| {
        r.from_table == from_table
            && r.from_column == from_column
            && r.to_table == to_table
            && r.to_column == to_column
    };
    let already_had_endpoint = editing_index
        .map(|index| same_endpoint(&list[index]))
        .unwrap_or(false);
    let duplicates_another = list
        .iter()
        .enumerate()
        .any(|(index, r)| Some(index) != editing_index && same_endpoint(r));
    if duplicates_another && !already_had_endpoint {
        return Err(AppError::Other(format!(
            "relation already exists: {from_table}.{from_column} -> {to_table}.{to_column}"
        )));
    }

    if let Some(id) = id.filter(|s| !s.is_empty()) {
        if let Some(r) = list.iter_mut().find(|r| r.id == id) {
            r.from_table = from_table.to_string();
            r.from_column = from_column.to_string();
            r.to_table = to_table.to_string();
            r.to_column = to_column.to_string();
            r.kind = kind.to_string();
            r.name = name.to_string();
            r.updated_at = now;
            let result = r.clone();
            save_file(app, &file)?;
            return Ok(result);
        }
    }

    let relation = Relation {
        id: uuid::Uuid::new_v4().to_string(),
        from_table: from_table.to_string(),
        from_column: from_column.to_string(),
        to_table: to_table.to_string(),
        to_column: to_column.to_string(),
        kind: kind.to_string(),
        name: name.to_string(),
        created_at: now,
        updated_at: now,
    };
    list.push(relation.clone());
    save_file(app, &file)?;
    Ok(relation)
}

pub fn delete(app: &AppHandle, host: &str, database: &str, id: &str) -> AppResult<()> {
    let mut file = load_file(app)?;
    if let Some(by_db) = file.get_mut(host) {
        if let Some(list) = by_db.get_mut(database) {
            list.retain(|r| r.id != id);
        }
    }
    save_file(app, &file)?;
    Ok(())
}

/// Replace one database's complete relation set. Used by the Relations view's
/// explicit overwrite import; other hosts and databases remain untouched.
pub fn replace_database(
    app: &AppHandle,
    host: &str,
    database: &str,
    relations: Vec<Relation>,
) -> AppResult<usize> {
    let count = relations.len();
    let mut file = load_file(app)?;
    if relations.is_empty() {
        if let Some(by_db) = file.get_mut(host) {
            by_db.remove(database);
        }
        if file.get(host).is_some_and(BTreeMap::is_empty) {
            file.remove(host);
        }
    } else {
        file.entry(host.to_string())
            .or_default()
            .insert(database.to_string(), relations);
    }
    save_file(app, &file)?;
    Ok(count)
}

pub fn export_all(app: &AppHandle) -> AppResult<RelationsFile> {
    load_file(app)
}

/// Move a database's relations from `from_db` to `to_db` (within one host),
/// overwriting any existing entry at the destination. Used by the backup swap so
/// app metadata follows the data into its new schema name.
pub fn move_database(app: &AppHandle, host: &str, from_db: &str, to_db: &str) -> AppResult<()> {
    if from_db == to_db {
        return Ok(());
    }
    let mut file = load_file(app)?;
    if let Some(by_db) = file.get_mut(host) {
        if let Some(list) = by_db.remove(from_db) {
            by_db.insert(to_db.to_string(), list);
            save_file(app, &file)?;
        }
    }
    Ok(())
}

/// Merge an imported relations tree into the store, upserting each relation by
/// id within its (host, database) bucket. Returns the number of relations
/// processed.
pub fn import_merge(app: &AppHandle, incoming: &RelationsFile) -> AppResult<usize> {
    let mut file = load_file(app)?;
    let mut count = 0;
    for (host, by_db) in incoming {
        for (database, relations) in by_db {
            let list = file
                .entry(host.clone())
                .or_default()
                .entry(database.clone())
                .or_default();
            for relation in relations {
                if let Some(existing) = list.iter_mut().find(|r| r.id == relation.id) {
                    *existing = relation.clone();
                } else {
                    list.push(relation.clone());
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
    let mut out: RelationsFile = BTreeMap::new();
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
            list.retain(|r| seen.insert(r.id.clone()));
        }
    }
    save_file(app, &out)
}
