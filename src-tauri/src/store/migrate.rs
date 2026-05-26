use crate::error::AppResult;
use crate::store::{column_setups, folders, profiles, relations, table_view_presets};
use std::collections::BTreeMap;
use tauri::AppHandle;

/// One-time, idempotent migration of the per-connection stores from the random
/// profile id to the connection host. Relations, folders, column setups, and
/// table-view presets are now keyed by host so they follow the server and
/// import cleanly across installations; older on-disk data was keyed by profile
/// id. Re-running is a no-op (host keys never match a profile id), so this is
/// safe to call on every startup.
pub fn host_rekey(app: &AppHandle) -> AppResult<()> {
    let host_by_id: BTreeMap<String, String> = profiles::load_all(app)?
        .into_iter()
        .filter(|p| !p.host.is_empty())
        .map(|p| (p.id, p.host))
        .collect();
    if host_by_id.is_empty() {
        return Ok(());
    }
    relations::migrate_to_host(app, &host_by_id)?;
    folders::migrate_to_host(app, &host_by_id)?;
    column_setups::migrate_to_host(app, &host_by_id)?;
    table_view_presets::migrate_to_host(app, &host_by_id)?;
    Ok(())
}
