use crate::error::{AppError, AppResult};
use crate::store::profiles;
use crate::store::relations::{self, Relation};
use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};
use tauri::AppHandle;

const RELATIONS_EXPORT_FORMAT: &str = "dbsage-relations";
const RELATIONS_EXPORT_VERSION: u32 = 1;

#[derive(Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct RelationsExport {
    format: String,
    version: u32,
    database: String,
    exported_at: DateTime<Utc>,
    relations: Vec<Relation>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RelationsImportPreview {
    database: String,
    count: usize,
}

/// Connection identity for the per-connection stores is the host, resolved from
/// the profile so relations follow the server (and import across installations).
fn host_of(app: &AppHandle, profile_id: &str) -> AppResult<String> {
    Ok(profiles::get(app, profile_id)?.host)
}

fn read_relations_export(path: &str) -> AppResult<RelationsExport> {
    let bytes = std::fs::read(path)?;
    let export: RelationsExport = serde_json::from_slice(&bytes)?;
    if export.format != RELATIONS_EXPORT_FORMAT {
        return Err(AppError::Other(
            "not a DB Sage relations export file".to_string(),
        ));
    }
    if export.version != RELATIONS_EXPORT_VERSION {
        return Err(AppError::Other(format!(
            "unsupported relations export version: {}",
            export.version
        )));
    }
    for relation in &export.relations {
        if relation.from_table.is_empty()
            || relation.from_column.is_empty()
            || relation.to_table.is_empty()
            || relation.to_column.is_empty()
        {
            return Err(AppError::Other(
                "relations export contains an incomplete relation".to_string(),
            ));
        }
        if relation.kind != "has_one" && relation.kind != "has_many" {
            return Err(AppError::Other(format!(
                "relations export contains an invalid relation kind: {}",
                relation.kind
            )));
        }
    }
    Ok(export)
}

#[tauri::command]
pub async fn list_relations(
    app: AppHandle,
    profile_id: String,
    database: String,
) -> AppResult<Vec<Relation>> {
    relations::list(&app, &host_of(&app, &profile_id)?, &database)
}

#[tauri::command]
#[allow(clippy::too_many_arguments)]
pub async fn save_relation(
    app: AppHandle,
    profile_id: String,
    database: String,
    id: Option<String>,
    from_table: String,
    from_column: String,
    to_table: String,
    to_column: String,
    kind: String,
    name: Option<String>,
) -> AppResult<Relation> {
    relations::save(
        &app,
        &host_of(&app, &profile_id)?,
        &database,
        id.as_deref(),
        &from_table,
        &from_column,
        &to_table,
        &to_column,
        &kind,
        name.as_deref().unwrap_or(""),
    )
}

#[tauri::command]
pub async fn delete_relation(
    app: AppHandle,
    profile_id: String,
    database: String,
    id: String,
) -> AppResult<()> {
    relations::delete(&app, &host_of(&app, &profile_id)?, &database, &id)
}

#[tauri::command]
pub async fn export_relations_file(
    app: AppHandle,
    profile_id: String,
    database: String,
    path: String,
) -> AppResult<usize> {
    let list = relations::list(&app, &host_of(&app, &profile_id)?, &database)?;
    let count = list.len();
    let export = RelationsExport {
        format: RELATIONS_EXPORT_FORMAT.to_string(),
        version: RELATIONS_EXPORT_VERSION,
        database,
        exported_at: Utc::now(),
        relations: list,
    };
    std::fs::write(path, serde_json::to_vec_pretty(&export)?)?;
    Ok(count)
}

#[tauri::command]
pub async fn preview_relations_import(path: String) -> AppResult<RelationsImportPreview> {
    let export = read_relations_export(&path)?;
    Ok(RelationsImportPreview {
        database: export.database,
        count: export.relations.len(),
    })
}

#[tauri::command]
pub async fn import_relations_file(
    app: AppHandle,
    profile_id: String,
    database: String,
    path: String,
) -> AppResult<usize> {
    let export = read_relations_export(&path)?;
    relations::replace_database(
        &app,
        &host_of(&app, &profile_id)?,
        &database,
        export.relations,
    )
}
