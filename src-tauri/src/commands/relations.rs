use crate::error::AppResult;
use crate::store::relations::{self, Relation};
use tauri::AppHandle;

#[tauri::command]
pub async fn list_relations(
    app: AppHandle,
    profile_id: String,
    database: String,
) -> AppResult<Vec<Relation>> {
    relations::list(&app, &profile_id, &database)
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
        &profile_id,
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
    relations::delete(&app, &profile_id, &database, &id)
}
