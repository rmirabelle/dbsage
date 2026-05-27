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
use tauri::AppHandle;

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

    let bundle = StateBundle {
        app: APP_TAG.to_string(),
        format: BUNDLE_FORMAT.to_string(),
        version: BUNDLE_VERSION,
        exported_at: Utc::now(),
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

#[tauri::command]
pub async fn import_state(
    app: AppHandle,
    path: String,
    passphrase: String,
    selection: CategorySelection,
) -> AppResult<StateCounts> {
    let bundle = decode_bundle(&path, &passphrase)?;

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
