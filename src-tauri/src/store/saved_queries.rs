use crate::error::AppResult;
use serde_json::Value;
use std::collections::BTreeMap;
use std::path::PathBuf;
use tauri::{AppHandle, Manager};

/**
 * Named saved queries (a name + the SQL text), stored opaquely as JSON so the
 * format stays flexible. Keyed by connection HOST + database (not the profile
 * id) so queries follow the server and import cleanly across installations.
 * saved_queries.json layout:
 *   { "<host>::<database>": [ { "name": ..., "sql": ... }, ... ] }
 */
pub type SavedQueriesFile = BTreeMap<String, Value>;

fn path(app: &AppHandle) -> AppResult<PathBuf> {
    let dir = app.path().app_config_dir()?;
    std::fs::create_dir_all(&dir)?;
    Ok(dir.join("saved_queries.json"))
}

fn load_file(app: &AppHandle) -> AppResult<SavedQueriesFile> {
    let p = path(app)?;
    if !p.exists() {
        return Ok(SavedQueriesFile::default());
    }
    let bytes = std::fs::read(&p)?;
    if bytes.is_empty() {
        return Ok(SavedQueriesFile::default());
    }
    Ok(serde_json::from_slice(&bytes)?)
}

fn save_file(app: &AppHandle, file: &SavedQueriesFile) -> AppResult<()> {
    let p = path(app)?;
    let bytes = serde_json::to_vec_pretty(file)?;
    let tmp = p.with_extension("json.tmp");
    std::fs::write(&tmp, bytes)?;
    std::fs::rename(&tmp, &p)?;
    Ok(())
}

fn query_name(q: &Value) -> Option<&str> {
    q.get("name").and_then(Value::as_str)
}

/// The saved queries for one database, in insertion order (empty when none).
pub fn list(app: &AppHandle, key: &str) -> AppResult<Vec<Value>> {
    Ok(load_file(app)?
        .get(key)
        .and_then(Value::as_array)
        .cloned()
        .unwrap_or_default())
}

/// Upsert a query by its `name` field (replacing a same-named query in place).
pub fn save(app: &AppHandle, key: &str, query: Value) -> AppResult<()> {
    let name = query_name(&query).map(str::to_string);
    let mut file = load_file(app)?;
    let entry = file
        .entry(key.to_string())
        .or_insert_with(|| Value::Array(Vec::new()));
    if let Some(arr) = entry.as_array_mut() {
        match name.as_deref().and_then(|n| {
            arr.iter().position(|q| query_name(q) == Some(n))
        }) {
            Some(i) => arr[i] = query,
            None => arr.push(query),
        }
    }
    save_file(app, &file)
}

/// Remove a query by name; drops the database's entry entirely when it empties.
pub fn delete(app: &AppHandle, key: &str, name: &str) -> AppResult<()> {
    let mut file = load_file(app)?;
    if let Some(arr) = file.get_mut(key).and_then(Value::as_array_mut) {
        arr.retain(|q| query_name(q) != Some(name));
        if arr.is_empty() {
            file.remove(key);
        }
    }
    save_file(app, &file)
}

pub fn export_all(app: &AppHandle) -> AppResult<SavedQueriesFile> {
    load_file(app)
}

/// Merge imported saved queries into the store, upserting each query by name
/// within its database key. Returns the number of queries processed.
pub fn import_merge(app: &AppHandle, incoming: &SavedQueriesFile) -> AppResult<usize> {
    let mut file = load_file(app)?;
    let mut count = 0;
    for (key, value) in incoming {
        let Some(src) = value.as_array() else { continue };
        let entry = file
            .entry(key.clone())
            .or_insert_with(|| Value::Array(Vec::new()));
        if let Some(dst) = entry.as_array_mut() {
            for query in src {
                match query_name(query)
                    .and_then(|n| dst.iter().position(|q| query_name(q) == Some(n)))
                {
                    Some(i) => dst[i] = query.clone(),
                    None => dst.push(query.clone()),
                }
                count += 1;
            }
        }
    }
    save_file(app, &file)?;
    Ok(count)
}
