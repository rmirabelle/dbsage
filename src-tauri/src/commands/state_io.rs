use crate::crypto::{self, EncryptedFile, APP_TAG, ENCRYPTED_FORMAT};
use crate::error::{AppError, AppResult};
use crate::store::{
    column_setups::{self, ColumnSetupsFile},
    folders::{self, FoldersFile},
    profiles::{self, ConnectionProfile},
    relations::{self, RelationsFile},
    secrets,
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

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ImportSummary {
    pub profiles: usize,
    pub relations: usize,
    pub folders: usize,
    pub column_setups: usize,
}

#[tauri::command]
pub async fn export_state(app: AppHandle, path: String, passphrase: String) -> AppResult<()> {
    if passphrase.is_empty() {
        return Err(AppError::Other("a passphrase is required".to_string()));
    }

    let profiles = profiles::load_all(&app)?
        .into_iter()
        .map(|profile| {
            let password = secrets::get_password(&profile.id).ok().flatten();
            PortableProfile { profile, password }
        })
        .collect();

    let bundle = StateBundle {
        app: APP_TAG.to_string(),
        format: BUNDLE_FORMAT.to_string(),
        version: BUNDLE_VERSION,
        exported_at: Utc::now(),
        profiles,
        relations: relations::export_all(&app)?,
        folders: folders::export_all(&app)?,
        column_setups: column_setups::export_all(&app)?,
    };

    let plaintext = serde_json::to_vec(&bundle)?;
    let encrypted = crypto::encrypt(&plaintext, &passphrase)?;
    let bytes = serde_json::to_vec_pretty(&encrypted)?;

    let target = std::path::PathBuf::from(&path);
    let tmp = target.with_extension("tmp");
    std::fs::write(&tmp, bytes)?;
    std::fs::rename(&tmp, &target)?;
    Ok(())
}

#[tauri::command]
pub async fn import_state(
    app: AppHandle,
    path: String,
    passphrase: String,
) -> AppResult<ImportSummary> {
    let bytes = std::fs::read(&path)?;
    let encrypted: EncryptedFile = serde_json::from_slice(&bytes)
        .map_err(|_| AppError::Other("not a DB Sage state file".to_string()))?;
    if encrypted.app != APP_TAG || encrypted.format != ENCRYPTED_FORMAT {
        return Err(AppError::Other("not a DB Sage state file".to_string()));
    }

    let plaintext = crypto::decrypt(&encrypted, &passphrase)?;
    let bundle: StateBundle = serde_json::from_slice(&plaintext)
        .map_err(|_| AppError::Other("decrypted contents are not valid".to_string()))?;
    if bundle.format != BUNDLE_FORMAT {
        return Err(AppError::Other(format!(
            "unsupported bundle format: {}",
            bundle.format
        )));
    }
    if bundle.version > BUNDLE_VERSION {
        return Err(AppError::Other(
            "this file was created by a newer version of DB Sage".to_string(),
        ));
    }

    let mut bare_profiles = Vec::with_capacity(bundle.profiles.len());
    for entry in bundle.profiles {
        if let Some(password) = entry.password.filter(|p| !p.is_empty()) {
            secrets::set_password(&entry.profile.id, &password)?;
        }
        bare_profiles.push(entry.profile);
    }

    let summary = ImportSummary {
        profiles: profiles::import_merge(&app, bare_profiles)?,
        relations: relations::import_merge(&app, &bundle.relations)?,
        folders: folders::import_merge(&app, &bundle.folders)?,
        column_setups: column_setups::import_merge(&app, &bundle.column_setups)?,
    };
    Ok(summary)
}
