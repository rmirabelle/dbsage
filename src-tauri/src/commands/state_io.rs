use crate::crypto::{self, EncryptedFile, APP_TAG, ENCRYPTED_FORMAT};
use crate::error::{AppError, AppResult};
use crate::store::{
    column_setups::{self, ColumnSetupsFile},
    folders::{self, FoldersFile},
    profiles::{self, ConnectionProfile},
    relations::{self, RelationsFile},
    saved_queries::{self, SavedQueriesFile},
    secrets,
    table_view_presets::{self, PresetsFile},
};
use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};
use std::collections::BTreeMap;
use tauri::AppHandle;

pub mod mapping;
use mapping::ImportMapping;

const BUNDLE_FORMAT: &str = "dbsage-state";
const BUNDLE_VERSION: u32 = 1;

/**
 * The decrypted state bundle. Sections are independently optional so the format
 * stays additive: a future version can introduce e.g. `saved_queries` without
 * breaking older builds, and importing a partial bundle only touches the
 * sections it carries.
 */
#[derive(Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct StateBundle {
    app: String,
    format: String,
    version: u32,
    exported_at: DateTime<Utc>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    database_scope: Option<mapping::ImportSource>,
    #[serde(default)]
    profiles: Vec<PortableProfile>,
    #[serde(default)]
    relations: RelationsFile,
    #[serde(default)]
    folders: FoldersFile,
    #[serde(default)]
    column_setups: ColumnSetupsFile,
    #[serde(default)]
    table_view_presets: PresetsFile,
    #[serde(default)]
    saved_queries: SavedQueriesFile,
}

/// A connection profile plus its password (lifted out of the OS keyring so the
/// bundle is self-contained). The encrypted envelope is what keeps it safe.
#[derive(Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct PortableProfile {
    #[serde(flatten)]
    profile: ConnectionProfile,
    #[serde(default)]
    password: Option<String>,
}

/// Which state categories an export or import should touch. Defaults to all
/// false so a missing field never silently includes a category.
#[derive(Debug, Clone, Copy, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CategorySelection {
    #[serde(default)]
    profiles: bool,
    #[serde(default)]
    relations: bool,
    #[serde(default)]
    folders: bool,
    #[serde(default)]
    column_setups: bool,
    #[serde(default)]
    table_view_presets: bool,
    #[serde(default)]
    saved_queries: bool,
}

/// Per-category item counts — returned both as an import result and as a preview
/// of what an encrypted file contains.
#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct StateCounts {
    pub profiles: usize,
    pub relations: usize,
    pub folders: usize,
    pub column_setups: usize,
    pub table_view_presets: usize,
    pub saved_queries: usize,
}

fn count_tree<T>(tree: &std::collections::BTreeMap<String, std::collections::BTreeMap<String, Vec<T>>>) -> usize {
    tree.values().flat_map(|m| m.values()).map(Vec::len).sum()
}

fn count_presets(file: &PresetsFile) -> usize {
    file.values()
        .filter_map(serde_json::Value::as_array)
        .map(Vec::len)
        .sum()
}

fn count_saved_queries(file: &SavedQueriesFile) -> usize {
    file.values()
        .filter_map(serde_json::Value::as_array)
        .map(Vec::len)
        .sum()
}

#[tauri::command]
pub async fn export_state(
    app: AppHandle,
    path: String,
    passphrase: String,
    selection: CategorySelection,
    database_scope: Option<DatabaseScope>,
) -> AppResult<()> {
    /* Connections carry passwords, so they may only be exported encrypted.
       Everything else is non-sensitive and a passphrase is optional. */
    if selection.profiles && passphrase.is_empty() {
        return Err(AppError::Other(
            "a passphrase is required to export connections".to_string(),
        ));
    }

    let profiles = if selection.profiles {
        profiles::load_all(&app)?
            .into_iter()
            .map(|profile| {
                let password = secrets::get_password(&profile.id).ok().flatten();
                PortableProfile { profile, password }
            })
            .collect()
    } else {
        Vec::new()
    };

    let mut bundle = StateBundle {
        app: APP_TAG.to_string(),
        format: BUNDLE_FORMAT.to_string(),
        version: BUNDLE_VERSION,
        exported_at: Utc::now(),
        database_scope: None,
        profiles,
        relations: if selection.relations {
            relations::export_all(&app)?
        } else {
            Default::default()
        },
        folders: if selection.folders {
            folders::export_all(&app)?
        } else {
            Default::default()
        },
        column_setups: if selection.column_setups {
            column_setups::export_all(&app)?
        } else {
            Default::default()
        },
        table_view_presets: if selection.table_view_presets {
            table_view_presets::export_all(&app)?
        } else {
            Default::default()
        },
        saved_queries: if selection.saved_queries {
            saved_queries::export_all(&app)?
        } else {
            Default::default()
        },
    };

    if let Some(scope) = database_scope {
        let profile = profiles::get(&app, &scope.profile_id)?;
        mapping::scope_bundle(&mut bundle, &profile.host, &scope.database);
    }

    /* With a passphrase, encrypt; without one (non-sensitive data only), write
       the self-describing bundle as plaintext JSON. */
    let bytes = if passphrase.is_empty() {
        serde_json::to_vec_pretty(&bundle)?
    } else {
        let plaintext = serde_json::to_vec(&bundle)?;
        let encrypted = crypto::encrypt(&plaintext, &passphrase)?;
        serde_json::to_vec_pretty(&encrypted)?
    };

    let target = std::path::PathBuf::from(&path);
    let tmp = target.with_extension("tmp");
    std::fs::write(&tmp, bytes)?;
    std::fs::rename(&tmp, &target)?;
    Ok(())
}

/// Read + validate a state file into a bundle (shared by preview and import).
/// Handles both encrypted files and plaintext (passphrase-less) exports.
/// Pull (and clear) the `.dbsage` path the app was launched with, if any.
#[tauri::command]
pub fn take_launch_file(state: tauri::State<'_, crate::state::AppState>) -> Option<String> {
    state.launch_file.lock().ok()?.take()
}

/**
 * Which import flow a `.dbsage` file belongs to, without needing a passphrase:
 * "database" for a single-database export from the database toolbar, "app"
 * for a full settings export. Encrypted files are always full exports, since
 * database exports are written without a passphrase.
 */
#[tauri::command]
pub fn state_file_kind(path: String) -> AppResult<String> {
    let bytes = std::fs::read(&path)?;
    let value: serde_json::Value = serde_json::from_slice(&bytes)
        .map_err(|_| AppError::Other("not a DB Sage state file".to_string()))?;
    if value.get("app").and_then(serde_json::Value::as_str) != Some(APP_TAG) {
        return Err(AppError::Other("not a DB Sage state file".to_string()));
    }
    let scoped = value.get("format").and_then(serde_json::Value::as_str) == Some(BUNDLE_FORMAT)
        && value.get("databaseScope").map_or(false, |v| !v.is_null());
    Ok(if scoped { "database" } else { "app" }.to_string())
}

fn decode_bundle(path: &str, passphrase: &str) -> AppResult<StateBundle> {
    let bytes = std::fs::read(path)?;
    let value: serde_json::Value = serde_json::from_slice(&bytes)
        .map_err(|_| AppError::Other("not a DB Sage state file".to_string()))?;
    if value.get("app").and_then(serde_json::Value::as_str) != Some(APP_TAG) {
        return Err(AppError::Other("not a DB Sage state file".to_string()));
    }

    let bundle: StateBundle = match value.get("format").and_then(serde_json::Value::as_str) {
        Some(ENCRYPTED_FORMAT) => {
            let encrypted: EncryptedFile = serde_json::from_value(value)
                .map_err(|_| AppError::Other("not a DB Sage state file".to_string()))?;
            let plaintext = crypto::decrypt(&encrypted, passphrase)?;
            serde_json::from_slice(&plaintext)
                .map_err(|_| AppError::Other("decrypted contents are not valid".to_string()))?
        }
        Some(BUNDLE_FORMAT) => serde_json::from_value(value)
            .map_err(|_| AppError::Other("file contents are not valid".to_string()))?,
        _ => return Err(AppError::Other("not a DB Sage state file".to_string())),
    };

    if bundle.version > BUNDLE_VERSION {
        return Err(AppError::Other(
            "this file was created by a newer version of DB Sage".to_string(),
        ));
    }
    Ok(bundle)
}

/// Decrypt a state file and report how many items each category holds, so the
/// import dialog can pre-check the available categories.
#[tauri::command]
pub async fn preview_state(
    _app: AppHandle,
    path: String,
    passphrase: String,
) -> AppResult<StateCounts> {
    let bundle = decode_bundle(&path, &passphrase)?;
    Ok(StateCounts {
        profiles: bundle.profiles.len(),
        relations: count_tree(&bundle.relations),
        folders: count_tree(&bundle.folders),
        column_setups: bundle.column_setups.len(),
        table_view_presets: count_presets(&bundle.table_view_presets),
        saved_queries: count_saved_queries(&bundle.saved_queries),
    })
}

/// One host found in a workspace file, with the databases it carries and
/// whether the file also carries a connection for it.
#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ImportHost {
    host: String,
    databases: Vec<String>,
    has_profile: bool,
}

/// List the hosts a workspace file refers to, so the import dialog can offer
/// to re-point them at the user's own connections.
#[tauri::command]
pub async fn state_import_hosts(path: String, passphrase: String) -> AppResult<Vec<ImportHost>> {
    let bundle = decode_bundle(&path, &passphrase)?;
    let mut by_host: BTreeMap<String, Vec<String>> = BTreeMap::new();
    for source in mapping::sources(&bundle) {
        by_host.entry(source.host).or_default().push(source.database);
    }
    Ok(by_host
        .into_iter()
        .map(|(host, databases)| ImportHost {
            has_profile: bundle.profiles.iter().any(|p| p.profile.host == host),
            host,
            databases,
        })
        .collect())
}

/// Move a `{host: {database: items}}` tree from one host key to another,
/// merging into the destination when it already exists.
fn rekey_tree<T>(
    tree: &mut BTreeMap<String, BTreeMap<String, Vec<T>>>,
    host_map: &BTreeMap<String, String>,
) {
    for (from, to) in host_map {
        let Some(databases) = tree.remove(from) else { continue };
        let target = tree.entry(to.clone()).or_default();
        for (database, items) in databases {
            target.entry(database).or_default().extend(items);
        }
    }
}

/// Rewrite `host::rest` keys for the hosts in `host_map`.
fn rekey_prefixed(file: &mut BTreeMap<String, serde_json::Value>, host_map: &BTreeMap<String, String>) {
    let keys: Vec<String> = file.keys().cloned().collect();
    for key in keys {
        let Some((host, rest)) = key.split_once("::") else { continue };
        let Some(to) = host_map.get(host) else { continue };
        let value = file.remove(&key).expect("key came from the map");
        file.insert(format!("{to}::{rest}"), value);
    }
}

/// Re-point every feature keyed by a source host at the host the user chose.
/// Connection profiles keep their own host: they are what the user connects with.
fn rekey_hosts(bundle: &mut StateBundle, host_map: &BTreeMap<String, String>) {
    let host_map: BTreeMap<String, String> = host_map
        .iter()
        .filter(|(from, to)| !to.is_empty() && from != to)
        .map(|(from, to)| (from.clone(), to.clone()))
        .collect();
    if host_map.is_empty() {
        return;
    }
    rekey_tree(&mut bundle.relations, &host_map);
    rekey_tree(&mut bundle.folders, &host_map);
    rekey_prefixed(&mut bundle.column_setups, &host_map);
    rekey_prefixed(&mut bundle.table_view_presets, &host_map);
    rekey_prefixed(&mut bundle.saved_queries, &host_map);
}

#[tauri::command]
pub async fn import_state(
    app: AppHandle,
    state: tauri::State<'_, crate::state::AppState>,
    path: String,
    passphrase: String,
    selection: CategorySelection,
    mapping: Option<ImportMapping>,
    preview_token: Option<String>,
    host_map: Option<BTreeMap<String, String>>,
) -> AppResult<StateCounts> {
    let mut bundle = decode_bundle(&path, &passphrase)?;
    if let Some(host_map) = host_map {
        rekey_hosts(&mut bundle, &host_map);
    }
    if let Some(mapping) = mapping {
        let (prepared, preview) = mapping::prepare(&app, &state, bundle, &selection, &mapping).await?;
        if preview_token.as_deref() != Some(preview.token.as_str()) {
            return Err(AppError::Other("Settings or schema changed. Preview the import again before applying.".into()));
        }
        bundle = prepared;
    }

    merge_bundle(&app, bundle, selection)
}

fn merge_bundle(app: &AppHandle, bundle: StateBundle, selection: CategorySelection) -> AppResult<StateCounts> {

    let profiles = if selection.profiles {
        let mut bare = Vec::with_capacity(bundle.profiles.len());
        for entry in bundle.profiles {
            if let Some(password) = entry.password.filter(|p| !p.is_empty()) {
                secrets::set_password(&entry.profile.id, &password)?;
            }
            bare.push(entry.profile);
        }
        profiles::import_merge(&app, bare)?
    } else {
        0
    };

    Ok(StateCounts {
        profiles,
        relations: if selection.relations {
            relations::import_merge(&app, &bundle.relations)?
        } else {
            0
        },
        folders: if selection.folders {
            folders::import_merge(&app, &bundle.folders)?
        } else {
            0
        },
        column_setups: if selection.column_setups {
            column_setups::import_merge(&app, &bundle.column_setups)?
        } else {
            0
        },
        table_view_presets: if selection.table_view_presets {
            table_view_presets::import_merge(&app, &bundle.table_view_presets)?
        } else {
            0
        },
        saved_queries: if selection.saved_queries {
            saved_queries::import_merge(&app, &bundle.saved_queries)?
        } else {
            0
        },
    })
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DatabaseScope {
    profile_id: String,
    database: String,
}

#[cfg(test)]
mod tests {
    use super::*;

    fn bundle() -> StateBundle {
        let mut relations = RelationsFile::default();
        relations.entry("localhost".into()).or_default().insert("shop".into(), Vec::new());
        let mut folders = FoldersFile::default();
        folders.entry("localhost".into()).or_default().insert("shop".into(), Vec::new());
        folders.entry("10.0.0.5".into()).or_default().insert("crm".into(), Vec::new());
        let mut column_setups = ColumnSetupsFile::default();
        column_setups.insert("localhost::shop::orders".into(), serde_json::json!({}));
        let mut saved_queries = SavedQueriesFile::default();
        saved_queries.insert("localhost::shop".into(), serde_json::json!([]));
        StateBundle {
            app: APP_TAG.into(),
            format: BUNDLE_FORMAT.into(),
            version: BUNDLE_VERSION,
            exported_at: Utc::now(),
            database_scope: None,
            profiles: Vec::new(),
            relations,
            folders,
            column_setups,
            table_view_presets: PresetsFile::default(),
            saved_queries,
        }
    }

    #[test]
    fn rekey_moves_every_feature_and_leaves_other_hosts_alone() {
        let mut b = bundle();
        let map = BTreeMap::from([("localhost".to_string(), "192.168.1.20".to_string())]);
        rekey_hosts(&mut b, &map);
        assert!(b.relations.contains_key("192.168.1.20") && !b.relations.contains_key("localhost"));
        assert!(b.folders.contains_key("192.168.1.20") && b.folders.contains_key("10.0.0.5"));
        assert!(b.column_setups.contains_key("192.168.1.20::shop::orders"));
        assert!(b.saved_queries.contains_key("192.168.1.20::shop"));
    }

    #[test]
    fn rekey_ignores_empty_and_identity_mappings() {
        let mut b = bundle();
        let map = BTreeMap::from([
            ("localhost".to_string(), String::new()),
            ("10.0.0.5".to_string(), "10.0.0.5".to_string()),
        ]);
        rekey_hosts(&mut b, &map);
        assert!(b.relations.contains_key("localhost"));
        assert!(b.folders.contains_key("10.0.0.5"));
    }
}
