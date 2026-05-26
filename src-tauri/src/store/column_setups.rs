use crate::error::AppResult;
use serde_json::Value;
use std::collections::BTreeMap;
use std::path::PathBuf;
use tauri::{AppHandle, Manager};

/**
 * Per-table column setup (visibility, filters, JSON "Show" extraction), stored
 * opaquely as JSON so the format stays flexible. column_setups.json layout:
 *   { "<profile-id>::<database>::<table>": <setup JSON> }
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
