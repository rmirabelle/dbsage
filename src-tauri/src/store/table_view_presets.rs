use crate::error::AppResult;
use serde_json::Value;
use std::collections::BTreeMap;
use std::path::PathBuf;
use tauri::{AppHandle, Manager};

/**
 * Named table-view presets (visible columns, widths, sort, filters, JSON show),
 * stored opaquely as JSON so the format stays flexible. Keyed by connection HOST
 * (not the profile id) so presets follow the server and import cleanly across
 * installations. table_view_presets.json layout:
 *   { "<host>::<database>::<table>": [ { "name": ..., "setup": ... }, ... ] }
 */
pub type PresetsFile = BTreeMap<String, Value>;

fn path(app: &AppHandle) -> AppResult<PathBuf> {
    let dir = app.path().app_config_dir()?;
    std::fs::create_dir_all(&dir)?;
    Ok(dir.join("table_view_presets.json"))
}

fn load_file(app: &AppHandle) -> AppResult<PresetsFile> {
    let p = path(app)?;
    if !p.exists() {
        return Ok(PresetsFile::default());
    }
    let bytes = std::fs::read(&p)?;
    if bytes.is_empty() {
        return Ok(PresetsFile::default());
    }
    Ok(serde_json::from_slice(&bytes)?)
}

fn save_file(app: &AppHandle, file: &PresetsFile) -> AppResult<()> {
    let p = path(app)?;
    let bytes = serde_json::to_vec_pretty(file)?;
    let tmp = p.with_extension("json.tmp");
    std::fs::write(&tmp, bytes)?;
    std::fs::rename(&tmp, &p)?;
    Ok(())
}

fn preset_name(p: &Value) -> Option<&str> {
    p.get("name").and_then(Value::as_str)
}

/// The presets saved for one table, in insertion order (empty when none).
pub fn list(app: &AppHandle, key: &str) -> AppResult<Vec<Value>> {
    Ok(load_file(app)?
        .get(key)
        .and_then(Value::as_array)
        .cloned()
        .unwrap_or_default())
}

/// Upsert a preset by its `name` field (replacing a same-named preset in place).
pub fn save(app: &AppHandle, key: &str, preset: Value) -> AppResult<()> {
    let name = preset_name(&preset).map(str::to_string);
    let mut file = load_file(app)?;
    let entry = file
        .entry(key.to_string())
        .or_insert_with(|| Value::Array(Vec::new()));
    if let Some(arr) = entry.as_array_mut() {
        match name.as_deref().and_then(|n| {
            arr.iter().position(|p| preset_name(p) == Some(n))
        }) {
            Some(i) => arr[i] = preset,
            None => arr.push(preset),
        }
    }
    save_file(app, &file)
}

/// Remove a preset by name; drops the table's entry entirely when it empties.
pub fn delete(app: &AppHandle, key: &str, name: &str) -> AppResult<()> {
    let mut file = load_file(app)?;
    if let Some(arr) = file.get_mut(key).and_then(Value::as_array_mut) {
        arr.retain(|p| preset_name(p) != Some(name));
        if arr.is_empty() {
            file.remove(key);
        }
    }
    save_file(app, &file)
}

/// Table names (within the given host + database) that have at least one saved
/// preset. One file read, filtered by the `host::database::` prefix.
pub fn tables_with_presets(
    app: &AppHandle,
    host: &str,
    database: &str,
) -> AppResult<Vec<String>> {
    let prefix = format!("{host}::{database}::");
    Ok(load_file(app)?
        .iter()
        .filter_map(|(key, value)| {
            let table = key.strip_prefix(&prefix)?;
            let has = value.as_array().map(|a| !a.is_empty()).unwrap_or(false);
            has.then(|| table.to_string())
        })
        .collect())
}

pub fn export_all(app: &AppHandle) -> AppResult<PresetsFile> {
    load_file(app)
}

/// Merge imported presets into the store, upserting each preset by name within
/// its table key. Returns the number of presets processed.
pub fn import_merge(app: &AppHandle, incoming: &PresetsFile) -> AppResult<usize> {
    let mut file = load_file(app)?;
    let mut count = 0;
    for (key, value) in incoming {
        let Some(src) = value.as_array() else { continue };
        let entry = file
            .entry(key.clone())
            .or_insert_with(|| Value::Array(Vec::new()));
        if let Some(dst) = entry.as_array_mut() {
            for preset in src {
                match preset_name(preset)
                    .and_then(|n| dst.iter().position(|p| preset_name(p) == Some(n)))
                {
                    Some(i) => dst[i] = preset.clone(),
                    None => dst.push(preset.clone()),
                }
                count += 1;
            }
        }
    }
    save_file(app, &file)?;
    Ok(count)
}

/// Re-key the store from "<profile-id>::<db>::<table>" to "<host>::<db>::<table>"
/// (idempotent). Keys whose first segment isn't a known profile id are left as
/// is, so re-running is a no-op. Last-wins if two connections share a host.
pub fn migrate_to_host(
    app: &AppHandle,
    host_by_id: &BTreeMap<String, String>,
) -> AppResult<()> {
    let file = load_file(app)?;
    let mut changed = false;
    let mut out = PresetsFile::new();
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
