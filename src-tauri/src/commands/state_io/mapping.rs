use super::*;
use crate::db::mysql::get_string;
use crate::state::AppState;
use serde_json::Value;
use std::collections::{BTreeMap, BTreeSet};
use std::hash::{Hash, Hasher};
use tauri::State;

type Schema = BTreeMap<String, BTreeSet<String>>;

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq, PartialOrd, Ord)]
#[serde(rename_all = "camelCase")]
pub struct ImportSource {
    pub(super) host: String,
    pub(super) database: String,
}

#[derive(Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ImportMapping {
    source_host: String,
    source_database: String,
    profile_id: String,
    database: String,
    overwrite: bool,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct MappingPreview {
    pub token: String,
    counts: StateCounts,
    notices: Vec<String>,
}

fn sources(bundle: &StateBundle) -> Vec<ImportSource> {
    let mut pairs = BTreeSet::new();
    if let Some(scope) = &bundle.database_scope {
        pairs.insert((scope.host.clone(), scope.database.clone()));
    }
    for key in bundle.saved_queries.keys() {
        if let Some((host, database)) = key.rsplit_once("::") {
            pairs.insert((host.to_string(), database.to_string()));
        }
    }
    for (host, databases) in &bundle.relations {
        for database in databases.keys() {
            pairs.insert((host.clone(), database.clone()));
        }
    }
    for (host, databases) in &bundle.folders {
        for database in databases.keys() {
            pairs.insert((host.clone(), database.clone()));
        }
    }
    for key in bundle
        .column_setups
        .keys()
        .chain(bundle.table_view_presets.keys())
    {
        if let Some((prefix, _)) = key.rsplit_once("::") {
            if let Some((host, database)) = prefix.rsplit_once("::") {
                pairs.insert((host.to_string(), database.to_string()));
            }
        }
    }
    pairs
        .into_iter()
        .map(|(host, database)| ImportSource { host, database })
        .collect()
}

pub(super) fn scope_bundle(bundle: &mut StateBundle, host: &str, database: &str) {
    bundle.profiles.clear();
    bundle.database_scope = Some(ImportSource {
        host: host.into(),
        database: database.into(),
    });
    bundle.relations.retain(|key, _| key == host);
    for databases in bundle.relations.values_mut() {
        databases.retain(|key, _| key == database);
    }
    bundle.folders.retain(|key, _| key == host);
    for databases in bundle.folders.values_mut() {
        databases.retain(|key, _| key == database);
    }
    let prefix = format!("{host}::{database}::");
    bundle
        .column_setups
        .retain(|key, _| key.starts_with(&prefix));
    bundle
        .table_view_presets
        .retain(|key, _| key.starts_with(&prefix));
    bundle
        .saved_queries
        .retain(|key, _| key == &format!("{host}::{database}"));
}

fn single_source(bundle: &StateBundle) -> AppResult<ImportSource> {
    let available = sources(bundle);
    if available.len() != 1 {
        return Err(AppError::Other("Choose a single-database settings file exported from the database toolbar. This file contains multiple databases or no database identity.".into()));
    }
    Ok(available[0].clone())
}

/** Database toolbar imports have a single source and an already selected destination. */
#[tauri::command]
pub async fn import_database_settings(
    app: AppHandle,
    state: State<'_, AppState>,
    path: String,
    passphrase: String,
    profile_id: String,
    database: String,
    preview_only: bool,
) -> AppResult<MappingPreview> {
    let bundle = decode_bundle(&path, &passphrase)?;
    let source = single_source(&bundle)?;
    let queries = bundle
        .saved_queries
        .get(&format!("{}::{}", source.host, source.database))
        .cloned();
    let selection = CategorySelection {
        profiles: false,
        relations: true,
        folders: true,
        column_setups: true,
        table_view_presets: true,
        saved_queries: false,
    };
    let mapping = ImportMapping {
        source_host: source.host.clone(),
        source_database: source.database.clone(),
        profile_id: profile_id.clone(),
        database: database.clone(),
        overwrite: true,
    };
    let (mut prepared, mut preview) = prepare(&app, &state, bundle, &selection, &mapping).await?;
    if let Some(queries) = queries {
        let profile = profiles::get(&app, &profile_id)?;
        prepared
            .saved_queries
            .insert(format!("{}::{database}", profile.host), queries);
        preview.counts.saved_queries = count_saved_queries(&prepared.saved_queries);
        if preview.counts.saved_queries > 0 {
            preview.notices.push("Saved queries are copied unchanged; explicit database names inside SQL are not rewritten.".into());
        }
    }
    preview.notices.push("Folders are merged: tables already in a destination folder stay there, and only unfoldered tables move into imported folders. Existing folders are kept.".into());
    if !preview_only {
        let profile = profiles::get(&app, &profile_id)?;
        let replacement_folders = prepared.folders.remove(&profile.host)
            .and_then(|mut databases| databases.remove(&database)).unwrap_or_default();
        preview.counts = merge_bundle(
            &app,
            prepared,
            CategorySelection {
                saved_queries: true,
                folders: false,
                ..selection
            },
        )?;
        preview.counts.folders = folders::merge_database(&app, &profile.host, &database, replacement_folders)?;
    }
    Ok(preview)
}

#[tauri::command]
pub async fn state_import_sources(
    path: String,
    passphrase: String,
) -> AppResult<Vec<ImportSource>> {
    Ok(sources(&decode_bundle(&path, &passphrase)?))
}

#[tauri::command]
pub async fn preview_state_mapping(
    app: AppHandle,
    state: State<'_, AppState>,
    path: String,
    passphrase: String,
    selection: CategorySelection,
    mapping: ImportMapping,
) -> AppResult<MappingPreview> {
    Ok(prepare(
        &app,
        &state,
        decode_bundle(&path, &passphrase)?,
        &selection,
        &mapping,
    )
    .await?
    .1)
}

fn has_column(schema: &Schema, table: &str, column: &str) -> bool {
    schema
        .get(table)
        .is_some_and(|columns| columns.contains(column))
}

fn text<'a>(value: &'a Value, key: &str) -> &'a str {
    value.get(key).and_then(Value::as_str).unwrap_or("")
}

struct Mapper<'a> {
    schema: &'a Schema,
    profile: &'a ConnectionProfile,
    mapping: &'a ImportMapping,
    relation_ids: BTreeMap<String, String>,
    notices: Vec<String>,
}

impl Mapper<'_> {
    fn column(&mut self, table: &str, column: &str) -> bool {
        let valid = has_column(self.schema, table, column);
        if !valid {
            self.notices.push(format!(
                "Skipped setting for missing column {table}.{column}."
            ));
        }
        valid
    }

    fn setup(&mut self, setup: &mut Value, table: &str) {
        let Some(obj) = setup.as_object_mut() else {
            return;
        };
        for key in ["hiddenColumns"] {
            if let Some(items) = obj.get_mut(key).and_then(Value::as_array_mut) {
                items.retain(|item| item.as_str().is_some_and(|col| self.column(table, col)));
            }
        }
        for key in ["columnWidths", "jsonDisplay", "columnAliases"] {
            if let Some(items) = obj.get_mut(key).and_then(Value::as_object_mut) {
                items.retain(|col, _| self.column(table, col));
            }
        }
        for key in ["filters", "extraFilters"] {
            if let Some(filters) = obj.get_mut(key).and_then(Value::as_array_mut) {
                filters.retain(|filter| {
                    if !self.column(table, text(filter, "column")) {
                        return false;
                    }
                    if let Some(relation) = filter.get("relation") {
                        return self.column(text(relation, "table"), text(relation, "column"));
                    }
                    true
                });
            }
        }
        if let Some(sort) = obj.get("sort").filter(|sort| !sort.is_null()) {
            if !self.column(table, text(sort, "column")) {
                obj.insert("sort".into(), Value::Null);
            }
        }
        if let Some(column) = obj.get("activeColumn").and_then(Value::as_str) {
            if !self.column(table, column) {
                obj.insert("activeColumn".into(), Value::Null);
            }
        }
        for key in ["peekAll", "childPeekAll"] {
            if let Some(workspace) = obj.get_mut(key) {
                self.workspace(workspace);
            }
        }
        for key in ["peeks", "hostedPeeks"] {
            if let Some(peeks) = obj.get_mut(key).and_then(Value::as_array_mut) {
                peeks.retain_mut(|peek| self.peek(peek));
            }
        }
        repair_active(obj, "activeHostedPeek", "hostedPeeks");
    }

    fn workspace(&mut self, workspace: &mut Value) {
        let Some(obj) = workspace.as_object_mut() else {
            return;
        };
        let active = obj
            .get("activeId")
            .and_then(Value::as_str)
            .unwrap_or("")
            .to_string();
        if let Some(mapped) = self.relation_ids.get(&active) {
            obj.insert("activeId".into(), mapped.clone().into());
        }
        for key in ["peeks", "hiddenPeeks"] {
            if let Some(peeks) = obj.get_mut(key).and_then(Value::as_array_mut) {
                peeks.retain_mut(|peek| self.peek(peek));
            }
        }
        repair_active(obj, "activeId", "peeks");
    }

    fn peek(&mut self, peek: &mut Value) -> bool {
        let table = text(&peek["target"], "table").to_string();
        if !self.column(&table, text(&peek["target"], "column"))
            || !self.column(text(peek, "sourceTable"), text(peek, "sourceColumn"))
        {
            return false;
        }
        let id = text(peek, "id").to_string();
        if !id.is_empty() {
            let Some(mapped) = self.relation_ids.get(&id) else {
                self.notices.push(format!(
                    "Skipped peek {id}: its relation is not available at the destination."
                ));
                return false;
            };
            peek["id"] = mapped.clone().into();
        }
        peek["profileId"] = self.profile.id.clone().into();
        peek["profileName"] = self.profile.name.clone().into();
        peek["database"] = self.mapping.database.clone().into();
        peek["target"]["value"] = Value::Null;
        if let Some(obj) = peek.as_object_mut() {
            obj.remove("label");
            obj.remove("fromView");
            if let Some(active) = obj.get("activeHostedPeek").and_then(Value::as_str) {
                if let Some(mapped) = self.relation_ids.get(active) {
                    obj.insert("activeHostedPeek".into(), mapped.clone().into());
                }
            }
        }
        self.setup(peek, &table);
        true
    }
}

fn repair_active(obj: &mut serde_json::Map<String, Value>, field: &str, list: &str) {
    if !obj.contains_key(field) {
        return;
    }
    let active = obj.get(field).and_then(Value::as_str).unwrap_or("");
    let peeks = obj.get(list).and_then(Value::as_array);
    if !peeks.is_some_and(|items| items.iter().any(|p| text(p, "id") == active)) {
        let next = peeks
            .and_then(|items| items.first())
            .map(|p| text(p, "id"))
            .unwrap_or("")
            .to_string();
        obj.insert(field.into(), next.into());
    }
}

fn same_join(a: &relations::Relation, b: &relations::Relation) -> bool {
    a.from_table == b.from_table
        && a.from_column == b.from_column
        && a.to_table == b.to_table
        && a.to_column == b.to_column
        && a.kind == b.kind
}

pub(super) async fn prepare(
    app: &AppHandle,
    state: &AppState,
    bundle: StateBundle,
    selection: &CategorySelection,
    mapping: &ImportMapping,
) -> AppResult<(StateBundle, MappingPreview)> {
    if selection.profiles || selection.saved_queries {
        return Err(AppError::Other("Mapped imports support layouts, relations, folders and saved views. Import connections or SQL separately.".into()));
    }
    if !sources(&bundle).contains(&ImportSource {
        host: mapping.source_host.clone(),
        database: mapping.source_database.clone(),
    }) {
        return Err(AppError::Other(
            "Select a source database contained in the export.".into(),
        ));
    }
    let profile = profiles::get(app, &mapping.profile_id)?;
    let pool = state
        .pools
        .read()
        .await
        .get(&mapping.profile_id)
        .cloned()
        .ok_or_else(|| {
            AppError::Other("Connect to the destination before previewing the import.".into())
        })?;
    let rows = sqlx::query("SELECT TABLE_NAME, COLUMN_NAME FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_SCHEMA = ? ORDER BY TABLE_NAME, ORDINAL_POSITION")
        .bind(&mapping.database).fetch_all(&pool).await?;
    let mut schema = Schema::new();
    for row in rows {
        schema
            .entry(get_string(&row, 0))
            .or_default()
            .insert(get_string(&row, 1));
    }
    if schema.is_empty() {
        return Err(AppError::Other(
            "The destination database has no accessible tables or columns.".into(),
        ));
    }
    let existing_relations = relations::list(app, &profile.host, &mapping.database)?;
    let existing_folders = folders::list(app, &profile.host, &mapping.database)?;
    let existing_setups = column_setups::export_all(app)?;
    let existing_presets = table_view_presets::export_all(app)?;
    map_bundle(
        bundle,
        selection,
        mapping,
        &profile,
        &schema,
        &existing_relations,
        &existing_folders,
        &existing_setups,
        &existing_presets,
    )
}

#[allow(clippy::too_many_arguments)]
fn map_bundle(
    mut bundle: StateBundle,
    selection: &CategorySelection,
    mapping: &ImportMapping,
    profile: &ConnectionProfile,
    schema: &Schema,
    existing_relations: &[relations::Relation],
    existing_folders: &[folders::Folder],
    existing_setups: &ColumnSetupsFile,
    existing_presets: &PresetsFile,
) -> AppResult<(StateBundle, MappingPreview)> {
    let mut mapper = Mapper {
        schema,
        profile,
        mapping,
        relation_ids: existing_relations
            .iter()
            .filter(|r| {
                has_column(schema, &r.from_table, &r.from_column)
                    && has_column(schema, &r.to_table, &r.to_column)
            })
            .map(|r| (r.id.clone(), r.id.clone()))
            .collect(),
        notices: vec![],
    };
    let source_relations = bundle
        .relations
        .remove(&mapping.source_host)
        .and_then(|mut dbs| dbs.remove(&mapping.source_database))
        .unwrap_or_default();
    let mut incoming_relations = vec![];
    for mut relation in source_relations {
        mapper.relation_ids.remove(&relation.id);
        if !mapper.column(&relation.from_table, &relation.from_column)
            || !mapper.column(&relation.to_table, &relation.to_column)
        {
            mapper.notices.push(format!(
                "Skipped relation {}: missing table or column.",
                relation.name
            ));
            continue;
        }
        let original_id = relation.id.clone();
        let matched = existing_relations
            .iter()
            .find(|r| same_join(r, &relation))
            .or_else(|| {
                if mapping.overwrite {
                    existing_relations.iter().find(|r| r.id == relation.id)
                } else {
                    None
                }
            });
        if let Some(existing) = matched {
            relation.id = existing.id.clone();
        } else if existing_relations.iter().any(|r| r.id == relation.id) {
            mapper.notices.push(format!(
                "Skipped relation {}: its ID belongs to a different destination relation.",
                relation.name
            ));
            continue;
        }
        if selection.relations || matched.is_some() {
            mapper.relation_ids.insert(original_id, relation.id.clone());
        }
        if selection.relations {
            if matched.is_some() && !mapping.overwrite {
                mapper
                    .notices
                    .push(format!("Kept existing relation {}.", relation.name));
            } else {
                if matched.is_some() {
                    mapper
                        .notices
                        .push(format!("Replace existing relation {}.", relation.name));
                }
                incoming_relations.push(relation);
            }
        }
    }
    bundle.relations.clear();
    if !incoming_relations.is_empty() {
        bundle
            .relations
            .entry(profile.host.clone())
            .or_default()
            .insert(mapping.database.clone(), incoming_relations);
    }
    let source_folders = bundle
        .folders
        .remove(&mapping.source_host)
        .and_then(|mut dbs| dbs.remove(&mapping.source_database))
        .unwrap_or_default();
    bundle.folders.clear();
    if selection.folders {
        for mut folder in source_folders {
            folder.tables.retain(|table| {
                let exists = schema.contains_key(table);
                if !exists {
                    mapper.notices.push(format!(
                        "Skipped missing table {table} in folder {}.",
                        folder.name
                    ));
                }
                exists
            });
            let existing = existing_folders
                .iter()
                .find(|f| f.id == folder.id || f.name.to_lowercase() == folder.name.to_lowercase());
            if let Some(existing) = existing {
                if !mapping.overwrite {
                    mapper
                        .notices
                        .push(format!("Kept existing folder {}.", folder.name));
                    continue;
                }
                mapper
                    .notices
                    .push(format!("Merge into existing folder {}.", folder.name));
                folder.id = existing.id.clone();
            }
            bundle
                .folders
                .entry(profile.host.clone())
                .or_default()
                .entry(mapping.database.clone())
                .or_default()
                .push(folder);
        }
    }
    let prefix = format!("{}::{}::", mapping.source_host, mapping.source_database);
    let destination = format!("{}::{}::", profile.host, mapping.database);
    let mut mapped_setups = BTreeMap::new();
    if selection.column_setups {
        for (key, mut setup) in bundle.column_setups {
            let Some(table) = key.strip_prefix(&prefix) else {
                continue;
            };
            if !schema.contains_key(table) {
                mapper
                    .notices
                    .push(format!("Skipped layout for missing table {table}."));
                continue;
            }
            let target = format!("{destination}{table}");
            if !mapping.overwrite && existing_setups.contains_key(&target) {
                mapper
                    .notices
                    .push(format!("Kept existing layout for {table}."));
                continue;
            }
            if existing_setups.contains_key(&target) {
                mapper
                    .notices
                    .push(format!("Replace existing layout for {table}."));
            }
            mapper.setup(&mut setup, table);
            mapped_setups.insert(target, setup);
        }
    }
    bundle.column_setups = mapped_setups;
    let mut mapped_presets = BTreeMap::new();
    if selection.table_view_presets {
        for (key, mut presets) in bundle.table_view_presets {
            let Some(table) = key.strip_prefix(&prefix) else {
                continue;
            };
            if !schema.contains_key(table) {
                mapper
                    .notices
                    .push(format!("Skipped saved views for missing table {table}."));
                continue;
            }
            let target = format!("{destination}{table}");
            if let Some(items) = presets.as_array_mut() {
                items.retain_mut(|preset| {
                    let name = text(preset, "name").to_string();
                    let exists = existing_presets
                        .get(&target)
                        .and_then(Value::as_array)
                        .is_some_and(|items| items.iter().any(|p| text(p, "name") == name));
                    if exists && !mapping.overwrite {
                        mapper
                            .notices
                            .push(format!("Kept existing view {table} / {name}."));
                        return false;
                    }
                    if exists {
                        mapper
                            .notices
                            .push(format!("Replace existing view {table} / {name}."));
                    }
                    if let Some(setup) = preset.get_mut("setup") {
                        mapper.setup(setup, table);
                    }
                    true
                });
                if !items.is_empty() {
                    mapped_presets.insert(target, presets);
                }
            }
        }
    }
    bundle.table_view_presets = mapped_presets;
    bundle.profiles.clear();
    bundle.saved_queries.clear();
    mapper.notices.sort();
    mapper.notices.dedup();
    let counts = StateCounts {
        profiles: 0,
        saved_queries: 0,
        relations: count_tree(&bundle.relations),
        folders: count_tree(&bundle.folders),
        column_setups: bundle.column_setups.len(),
        table_view_presets: count_presets(&bundle.table_view_presets),
    };
    /* Bind approval to the prepared output, destination schema and current settings. */
    let mut hash = std::collections::hash_map::DefaultHasher::new();
    serde_json::to_string(&(
        &bundle,
        mapping,
        schema,
        existing_relations,
        existing_folders,
        existing_setups,
        existing_presets,
        &mapper.notices,
    ))?
    .hash(&mut hash);
    Ok((
        bundle,
        MappingPreview {
            token: format!("{:x}", hash.finish()),
            counts,
            notices: mapper.notices,
        },
    ))
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    fn fixture() -> (
        StateBundle,
        CategorySelection,
        ImportMapping,
        ConnectionProfile,
        Schema,
    ) {
        let bundle = serde_json::from_value(json!({
            "app": APP_TAG, "format": BUNDLE_FORMAT, "version": 1, "exportedAt": "2026-09-08T00:00:00Z",
            "relations": {"localhost": {"source": [{"id":"r", "name":"Customer", "fromTable":"orders", "fromColumn":"customer_id",
                "toTable":"customers", "toColumn":"id", "kind":"has_one"}]}},
            "folders": {"localhost": {"source": [{"id":"f", "name":"Sales", "tables":["orders", "missing"], "created_at":"2026-09-08T00:00:00Z", "updated_at":"2026-09-08T00:00:00Z"}]}},
            "columnSetups": {
                "localhost::source::orders": {"hiddenColumns":["customer_id","removed"], "columnWidths":{"customer_id":120,"removed":50},
                    "jsonDisplay":{"removed":"name"}, "sort":{"column":"removed","direction":"asc"},
                    "filters":[{"column":"customer_id","op":"equals","value":"3"},{"column":"removed","op":"equals","value":"x"}],
                    "peekAll":{"height":240,"activeId":"r","peeks":[{"id":"r","profileId":"old","profileName":"Old","database":"source",
                        "sourceTable":"orders","sourceColumn":"customer_id","target":{"table":"customers","column":"id","value":"123"},
                        "childPeekAll":{"height":100,"activeId":"gone","peeks":[{"id":"gone","sourceTable":"customers","sourceColumn":"id","target":{"table":"missing","column":"id","value":"1"}}]}}]}
                }, "localhost::source::missing": {}, "localhost::unselected::orders": {"hiddenColumns":["id"]}
            },
            "tableViewPresets":{"localhost::source::orders":[{"name":"Default","setup":{"filters":[{"column":"removed","op":"equals","value":"x"}]}}]},
            "savedQueries":{"localhost::source":[{"name":"Q","sql":"SELECT * FROM source.orders"}]}
        })).unwrap();
        let selection = CategorySelection {
            profiles: false,
            relations: true,
            folders: true,
            column_setups: true,
            table_view_presets: true,
            saved_queries: false,
        };
        let mapping = ImportMapping {
            source_host: "localhost".into(),
            source_database: "source".into(),
            profile_id: "new".into(),
            database: "destination".into(),
            overwrite: false,
        };
        let profile = serde_json::from_value(
            json!({"id":"new","name":"Friend","host":"remote","port":3306,"username":"u",
            "createdAt":"2026-09-08T00:00:00Z","updatedAt":"2026-09-08T00:00:00Z"}),
        )
        .unwrap();
        let schema = BTreeMap::from([
            (
                "orders".into(),
                BTreeSet::from(["id".into(), "customer_id".into()]),
            ),
            ("customers".into(), BTreeSet::from(["id".into()])),
        ]);
        (bundle, selection, mapping, profile, schema)
    }

    #[test]
    fn maps_only_selected_database_and_prunes_missing_schema_recursively() {
        let (bundle, selection, mapping, profile, schema) = fixture();
        let (out, preview) = map_bundle(
            bundle,
            &selection,
            &mapping,
            &profile,
            &schema,
            &[],
            &[],
            &BTreeMap::new(),
            &BTreeMap::new(),
        )
        .unwrap();
        assert_eq!(out.column_setups.len(), 1);
        assert!(out.profiles.is_empty() && out.saved_queries.is_empty());
        let setup = &out.column_setups["remote::destination::orders"];
        assert_eq!(setup["hiddenColumns"], json!(["customer_id"]));
        assert_eq!(setup["columnWidths"], json!({"customer_id":120}));
        assert_eq!(setup["jsonDisplay"], json!({}));
        assert!(setup["sort"].is_null());
        assert_eq!(setup["filters"].as_array().unwrap().len(), 1);
        let peek = &setup["peekAll"]["peeks"][0];
        assert_eq!(peek["profileId"], "new");
        assert_eq!(peek["profileName"], "Friend");
        assert_eq!(peek["database"], "destination");
        assert!(peek["target"]["value"].is_null());
        assert_eq!(peek["childPeekAll"]["peeks"], json!([]));
        assert_eq!(peek["childPeekAll"]["activeId"], "");
        assert_eq!(
            out.folders["remote"]["destination"][0].tables,
            vec!["orders"]
        );
        assert_eq!(
            out.table_view_presets["remote::destination::orders"][0]["setup"]["filters"],
            json!([])
        );
        assert_eq!(preview.counts.column_setups, 1);
        assert!(!preview.notices.is_empty());
    }

    #[test]
    fn keeps_existing_setups_and_views_unless_replacement_selected() {
        let (bundle, selection, mut mapping, profile, schema) = fixture();
        let existing = BTreeMap::from([(
            "remote::destination::orders".into(),
            json!({"hiddenColumns":["id"]}),
        )]);
        let presets = BTreeMap::from([(
            "remote::destination::orders".into(),
            json!([{"name":"Default","setup":{}}]),
        )]);
        let (_, preview) = map_bundle(
            bundle,
            &selection,
            &mapping,
            &profile,
            &schema,
            &[],
            &[],
            &existing,
            &presets,
        )
        .unwrap();
        assert_eq!(preview.counts.column_setups, 0);
        assert_eq!(preview.counts.table_view_presets, 0);
        mapping.overwrite = true;
        let (out, replaced) = map_bundle(
            fixture().0,
            &selection,
            &mapping,
            &profile,
            &schema,
            &[],
            &[],
            &existing,
            &presets,
        )
        .unwrap();
        assert_eq!(replaced.counts.column_setups, 1);
        assert_eq!(replaced.counts.table_view_presets, 1);
        assert_ne!(preview.token, replaced.token);
        assert_ne!(out.column_setups, existing);
    }

    #[test]
    fn reuses_destination_relation_ids_in_active_and_remembered_peeks() {
        let (mut bundle, mut selection, mapping, profile, schema) = fixture();
        let mut existing = bundle.relations["localhost"]["source"][0].clone();
        existing.id = "destination-id".into();
        let workspace = &mut bundle
            .column_setups
            .get_mut("localhost::source::orders")
            .unwrap()["peekAll"];
        workspace["hiddenPeeks"] = workspace["peeks"].clone();
        selection.relations = false;
        let (out, preview) = map_bundle(
            bundle,
            &selection,
            &mapping,
            &profile,
            &schema,
            &[existing],
            &[],
            &BTreeMap::new(),
            &BTreeMap::new(),
        )
        .unwrap();
        let workspace = &out.column_setups["remote::destination::orders"]["peekAll"];
        assert_eq!(workspace["activeId"], "destination-id");
        assert_eq!(workspace["peeks"][0]["id"], "destination-id");
        assert_eq!(workspace["hiddenPeeks"][0]["id"], "destination-id");
        assert_eq!(preview.counts.relations, 0);
    }

    #[test]
    fn unavailable_relations_remove_peeks_instead_of_binding_to_conflicting_ids() {
        let (bundle, selection, mapping, profile, schema) = fixture();
        let mut existing = bundle.relations["localhost"]["source"][0].clone();
        existing.from_column = "id".into();
        let (out, _) = map_bundle(
            bundle,
            &selection,
            &mapping,
            &profile,
            &schema,
            &[existing],
            &[],
            &BTreeMap::new(),
            &BTreeMap::new(),
        )
        .unwrap();
        assert_eq!(
            out.column_setups["remote::destination::orders"]["peekAll"]["peeks"],
            json!([])
        );
    }

    #[test]
    fn preview_token_is_repeatable_and_changes_with_destination_state() {
        let (_, selection, mapping, profile, schema) = fixture();
        let run = |existing: &ColumnSetupsFile| {
            map_bundle(
                fixture().0,
                &selection,
                &mapping,
                &profile,
                &schema,
                &[],
                &[],
                existing,
                &BTreeMap::new(),
            )
            .unwrap()
            .1
            .token
        };
        assert_eq!(run(&BTreeMap::new()), run(&BTreeMap::new()));
        assert_ne!(
            run(&BTreeMap::new()),
            run(&BTreeMap::from([(
                "remote::destination::orders".into(),
                json!({})
            )]))
        );
    }

    #[test]
    fn source_discovery_preserves_ipv6_hosts() {
        let mut bundle = fixture().0;
        bundle
            .column_setups
            .insert("::1::ipv6db::orders".into(), json!({}));
        assert!(sources(&bundle).contains(&ImportSource {
            host: "::1".into(),
            database: "ipv6db".into()
        }));
    }

    #[test]
    fn database_export_contains_only_the_selected_database_and_no_credentials() {
        let (mut bundle, _, _, profile, _) = fixture();
        bundle.profiles.push(PortableProfile {
            profile,
            password: Some("test-secret-not-for-export".into()),
        });
        bundle.saved_queries.insert(
            "localhost::unselected".into(),
            json!([{"name":"Private","sql":"SELECT 1"}]),
        );
        bundle
            .column_setups
            .insert("otherhost::source::orders".into(), json!({}));
        bundle
            .folders
            .insert("otherhost".into(), bundle.folders["localhost"].clone());
        scope_bundle(&mut bundle, "localhost", "source");
        assert_eq!(
            single_source(&bundle).unwrap(),
            ImportSource {
                host: "localhost".into(),
                database: "source".into()
            }
        );
        assert!(bundle.profiles.is_empty());
        assert_eq!(bundle.column_setups.len(), 2);
        assert_eq!(bundle.saved_queries.len(), 1);
        assert_eq!(bundle.folders.len(), 1);
        assert_eq!(bundle.relations.len(), 1);
        assert!(!serde_json::to_string(&bundle)
            .unwrap()
            .contains("test-secret-not-for-export"));
        assert!(!serde_json::to_string(&bundle)
            .unwrap()
            .contains("unselected"));
    }

    #[test]
    fn direct_import_requires_one_source_and_retains_identity_for_empty_exports() {
        let mut bundle = fixture().0;
        assert!(single_source(&bundle).is_err());
        scope_bundle(&mut bundle, "localhost", "empty_database");
        assert_eq!(single_source(&bundle).unwrap().database, "empty_database");
        assert!(bundle.column_setups.is_empty());
        let encoded = serde_json::to_string(&bundle).unwrap();
        let decoded: StateBundle = serde_json::from_str(&encoded).unwrap();
        assert_eq!(single_source(&decoded).unwrap().database, "empty_database");
    }

    #[test]
    fn database_package_applies_to_a_different_name_with_replacement() {
        let (mut bundle, selection, mut mapping, profile, schema) = fixture();
        scope_bundle(&mut bundle, "localhost", "source");
        mapping.overwrite = true;
        let mut existing = bundle.relations["localhost"]["source"][0].clone();
        existing.from_column = "id".into();
        let (out, _) = map_bundle(
            bundle,
            &selection,
            &mapping,
            &profile,
            &schema,
            &[existing],
            &[],
            &BTreeMap::new(),
            &BTreeMap::new(),
        )
        .unwrap();
        assert_eq!(
            out.relations["remote"]["destination"][0].from_column,
            "customer_id"
        );
        assert!(out
            .column_setups
            .contains_key("remote::destination::orders"));
        assert_eq!(
            out.column_setups["remote::destination::orders"]["peekAll"]["peeks"][0]["database"],
            "destination"
        );
    }

    #[test]
    fn standalone_and_hosted_saved_peeks_are_rebound_without_source_row_values() {
        let (mut bundle, selection, mapping, profile, schema) = fixture();
        let child =
            bundle.column_setups["localhost::source::orders"]["peekAll"]["peeks"][0].clone();
        let mut host = child.clone();
        host.as_object_mut().unwrap().remove("id");
        host["label"] = "peek-old".into();
        host["hostedPeeks"] = json!([child]);
        host["activeHostedPeek"] = "r".into();
        bundle
            .table_view_presets
            .get_mut("localhost::source::orders")
            .unwrap()[0]["setup"]["peeks"] = json!([host]);
        let (out, _) = map_bundle(
            bundle,
            &selection,
            &mapping,
            &profile,
            &schema,
            &[],
            &[],
            &BTreeMap::new(),
            &BTreeMap::new(),
        )
        .unwrap();
        let host = &out.table_view_presets["remote::destination::orders"][0]["setup"]["peeks"][0];
        assert_eq!(host["database"], "destination");
        assert!(host.get("label").is_none());
        assert!(host["target"]["value"].is_null());
        assert_eq!(host["hostedPeeks"][0]["profileId"], "new");
        assert!(host["hostedPeeks"][0]["target"]["value"].is_null());
    }

    #[test]
    fn disabled_categories_produce_no_writes_and_missing_relation_targets_drop_filters() {
        let (mut bundle, mut selection, mapping, profile, schema) = fixture();
        bundle
            .column_setups
            .get_mut("localhost::source::orders")
            .unwrap()["filters"] = json!([
            {"column":"customer_id","op":"hasrelated","relation":{"table":"missing","column":"id"}},
            {"column":"customer_id","op":"hasrelated","relation":{"table":"customers","column":"id"}}
        ]);
        selection.relations = false;
        selection.folders = false;
        selection.table_view_presets = false;
        let (out, preview) = map_bundle(
            bundle,
            &selection,
            &mapping,
            &profile,
            &schema,
            &[],
            &[],
            &BTreeMap::new(),
            &BTreeMap::new(),
        )
        .unwrap();
        assert!(
            out.relations.is_empty() && out.folders.is_empty() && out.table_view_presets.is_empty()
        );
        assert_eq!(preview.counts.relations, 0);
        assert_eq!(
            out.column_setups["remote::destination::orders"]["filters"]
                .as_array()
                .unwrap()
                .len(),
            1
        );
        assert_eq!(
            out.column_setups["remote::destination::orders"]["peekAll"]["peeks"],
            json!([])
        );
    }
}
