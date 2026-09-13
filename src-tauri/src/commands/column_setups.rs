use crate::error::AppResult;
use crate::store::column_setups;
use crate::store::profiles;
use crate::store::relations;
use serde::Serialize;
use serde_json::Value;
use std::collections::HashSet;
use tauri::AppHandle;

/// Per-table setups are keyed by connection HOST so they follow the server and
/// import across installations; resolve the host from the profile.
fn key(app: &AppHandle, profile_id: &str, database: &str, table: &str) -> AppResult<String> {
    let host = profiles::get(app, profile_id)?.host;
    Ok(format!("{host}::{database}::{table}"))
}

#[tauri::command]
pub async fn get_column_setup(
    app: AppHandle,
    profile_id: String,
    database: String,
    table: String,
) -> AppResult<Option<Value>> {
    column_setups::get(&app, &key(&app, &profile_id, &database, &table)?)
}

/// A table whose saved layout holds peeks, and how many of them point at a
/// relation that still exists.
#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PeekLayoutTable {
    table: String,
    peeks: usize,
}

/// Count the peeks in an integrated-peek state (visible, hidden, and nested)
/// whose relation id is in `live`.
fn count_live_peeks(peek_all: &Value, live: &HashSet<&str>) -> usize {
    let mut total = 0;
    for list in ["peeks", "hiddenPeeks"] {
        let Some(peeks) = peek_all.get(list).and_then(Value::as_array) else { continue };
        for peek in peeks {
            if peek.get("id").and_then(Value::as_str).is_some_and(|id| live.contains(id)) {
                total += 1;
            }
            if let Some(child) = peek.get("childPeekAll").filter(|v| !v.is_null()) {
                total += count_live_peeks(child, live);
            }
        }
    }
    total
}

/// Tables in a database whose saved layout would lose peeks if the database's
/// relations were deleted. Used to warn before Clear All.
#[tauri::command]
pub async fn list_peek_layout_tables(
    app: AppHandle,
    profile_id: String,
    database: String,
) -> AppResult<Vec<PeekLayoutTable>> {
    let host = profiles::get(&app, &profile_id)?.host;
    let relations = relations::list(&app, &host, &database)?;
    let live: HashSet<&str> = relations.iter().map(|r| r.id.as_str()).collect();
    let prefix = format!("{host}::{database}::");
    let mut tables = Vec::new();
    for (key, setup) in column_setups::export_all(&app)? {
        let Some(table) = key.strip_prefix(&prefix) else { continue };
        let Some(peek_all) = setup.get("peekAll").filter(|v| !v.is_null()) else { continue };
        let peeks = count_live_peeks(peek_all, &live);
        if peeks > 0 {
            tables.push(PeekLayoutTable { table: table.to_string(), peeks });
        }
    }
    Ok(tables)
}

#[tauri::command]
pub async fn save_column_setup(
    app: AppHandle,
    profile_id: String,
    database: String,
    table: String,
    setup: Value,
) -> AppResult<()> {
    column_setups::set(&app, &key(&app, &profile_id, &database, &table)?, setup)
}

#[cfg(test)]
mod tests {
    use super::count_live_peeks;
    use serde_json::json;
    use std::collections::HashSet;

    #[test]
    fn counts_visible_hidden_and_nested_peeks_with_live_relations() {
        let live: HashSet<&str> = ["a", "b", "c"].into_iter().collect();
        let peek_all = json!({
            "peeks": [
                { "id": "a", "childPeekAll": { "peeks": [{ "id": "b" }, { "id": "stale" }] } },
                { "id": "gone" }
            ],
            "hiddenPeeks": [{ "id": "c" }]
        });
        assert_eq!(count_live_peeks(&peek_all, &live), 3);
    }
}
