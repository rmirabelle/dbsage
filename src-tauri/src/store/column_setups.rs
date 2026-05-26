use crate::error::AppResult;
use serde_json::Value;
use std::collections::BTreeMap;
use std::path::PathBuf;
use tauri::{AppHandle, Manager};

/**
 * Per-table column setup (visibility, filters, JSON "Show" extraction), stored
 * opaquely as JSON so the format stays flexible. Keyed by connection HOST (not
 * the profile id) so setups follow the server and import cleanly across
 * installations. column_setups.json layout:
 *   { "<host>::<database>::<table>": <setup JSON> }
 */
pub type ColumnSetupsFile = BTreeMap<String, Value>;

fn path(app: &AppHandle) -> AppResult<PathBuf> {
    let dir = app.path().app_config_dir()?;
    std::fs::create_dir_all(&dir)?;
    Ok(dir.join("column_setups.json"))
}

fn load_file(app: &AppHandle) -> AppResult<ColumnSetupsFile> {
    let p = path(app)?;
    if !p.exists() {
        return Ok(ColumnSetupsFile::default());
    }
    let bytes = std::fs::read(&p)?;
    if bytes.is_empty() {
        return Ok(ColumnSetupsFile::default());
    }
    Ok(serde_json::from_slice(&bytes)?)
}

fn save_file(app: &AppHandle, file: &ColumnSetupsFile) -> AppResult<()> {
    let p = path(app)?;
    let bytes = serde_json::to_vec_pretty(file)?;
    let tmp = p.with_extension("json.tmp");
    std::fs::write(&tmp, bytes)?;
    std::fs::rename(&tmp, &p)?;
    Ok(())
}

/// True when a setup carries no visibility, filters, JSON-show, or width config
/// — such entries are dropped rather than stored, so the file doesn't accumulate
/// noise.
fn is_empty_setup(setup: &Value) -> bool {
    let empty_arr =
        |v: Option<&Value>| v.and_then(Value::as_array).map_or(true, |a| a.is_empty());
    let empty_obj =
        |v: Option<&Value>| v.and_then(Value::as_object).map_or(true, |o| o.is_empty());
    match setup.as_object() {
        Some(o) => {
            empty_arr(o.get("hiddenColumns"))
                && empty_arr(o.get("filters"))
                && empty_obj(o.get("jsonDisplay"))
                && empty_obj(o.get("columnWidths"))
        }
        None => true,
    }
}

pub fn get(app: &AppHandle, key: &str) -> AppResult<Option<Value>> {
    Ok(load_file(app)?.get(key).cloned())
}

pub fn set(app: &AppHandle, key: &str, setup: Value) -> AppResult<()> {
    let mut file = load_file(app)?;
    if is_empty_setup(&setup) {
        file.remove(key);
    } else {
        file.insert(key.to_string(), setup);
    }
    save_file(app, &file)
}

pub fn export_all(app: &AppHandle) -> AppResult<ColumnSetupsFile> {
    load_file(app)
}

/// Merge imported column setups into the store, upserting by key. Returns the
/// number of setups processed.
pub fn import_merge(app: &AppHandle, incoming: &ColumnSetupsFile) -> AppResult<usize> {
    let mut file = load_file(app)?;
    let mut count = 0;
    for (key, setup) in incoming {
        file.insert(key.clone(), setup.clone());
        count += 1;
    }
    save_file(app, &file)?;
    Ok(count)
}

/// Re-key the store from "<profile-id>::<db>::<table>" to "<host>::<db>::<table>"
/// (idempotent). Keys whose first segment isn't a known profile id are left as
/// is, so re-running is a no-op. Last-wins if two connections share a host.
pub fn migrate_to_host(
    app: &AppHandle,
    host_by_id: &std::collections::BTreeMap<String, String>,
) -> AppResult<()> {
    let file = load_file(app)?;
    let mut changed = false;
    let mut out = ColumnSetupsFile::new();
    for (key, value) in file {
        match host_by_id.iter().find_map(|(id, host)| {
            key.strip_prefix(&format!("{id}::"))
                .map(|rest| format!("{host}::{rest}"))
        }) {
            Some(new_key) => {
                changed = true;
                out.insert(new_key, value);
            }
            None => {
                out.insert(key, value);
            }
        }
    }
    if changed {
        save_file(app, &out)?;
    }
    Ok(())
}
