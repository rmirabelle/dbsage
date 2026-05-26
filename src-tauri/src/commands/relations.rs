use crate::error::AppResult;
use crate::store::profiles;
use crate::store::relations::{self, Relation};
use tauri::AppHandle;

/// Connection identity for the per-connection stores is the host, resolved from
/// the profile so relations follow the server (and import across installations).
fn host_of(app: &AppHandle, profile_id: &str) -> AppResult<String> {
    Ok(profiles::get(app, profile_id)?.host)
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
