use crate::db::mysql::{get_string, quote_ident, result_columns};
use crate::error::{AppError, AppResult};
use crate::state::AppState;
use chrono::Utc;
use futures_util::TryStreamExt;
use serde::{Deserialize, Serialize};
use serde_json::Value;
use sqlx::mysql::MySqlRow;
use sqlx::{Executor, MySqlPool, Row};
use std::io::{Read, Write};
use std::sync::atomic::Ordering;
use tauri::{AppHandle, Emitter, State};
use zip::write::SimpleFileOptions;

/** Archive format version, written to the manifest so a future reader can refuse
 * or adapt to an incompatible layout. */
const FORMAT_VERSION: u32 = 1;

/** Rows per INSERT batch. Each batch becomes exactly one physical line in the
 * `data/<i>.sql` entry, so restore can split on newlines without a SQL tokenizer. */
const BATCH_ROWS: usize = 200;

/** One table's entry in the backup manifest. */
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct BackupTable {
    pub name: String,
    pub row_count: u64,
    /** Base filename (no dir/extension) used for this table's `schema/` and
     * `data/` entries — derived from the table name but filesystem-safe and
     * unique. Restore reads the entries by this, not by reconstructing the name. */
    pub entry: String,
}

/** The `manifest.json` at the root of a `.dbbak` archive. Object lists hold names
 * only; the actual DDL/data lives in index-addressed entries (`schema/0.sql`,
 * `data/0.sql`, `views/0.sql`, …) so table names with odd characters never need to
 * be sanitized into file paths. */
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct BackupManifest {
    pub format: u32,
    pub database: String,
    pub server_version: String,
    pub app_version: String,
    /** RFC3339 UTC timestamp. */
    pub created_at: String,
    pub charset: String,
    pub collation: String,
    pub tables: Vec<BackupTable>,
    pub views: Vec<String>,
    pub routines: Vec<String>,
    pub triggers: Vec<String>,
    pub events: Vec<String>,
    /** Counts of the DB Sage app metadata stored alongside (in `metadata.json`). */
    pub metadata: MetadataCounts,
}

/** Summary counts of the app metadata captured in a backup, for the restore UI. */
#[derive(Debug, Clone, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct MetadataCounts {
    pub relations: usize,
    pub saved_queries: usize,
    pub view_presets: usize,
}

/** DB Sage app metadata for a database — virtual relations, saved queries, and
 * named table-view presets — captured into `metadata.json` so a backup carries a
 * database's annotations, not just its SQL. Keyed to the source on backup and
 * re-keyed to the target on restore. */
#[derive(Debug, Clone, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct BackupMetadata {
    pub relations: Vec<crate::store::relations::Relation>,
    pub saved_queries: Vec<Value>,
    /** Table name → its saved view presets. */
    pub view_presets: std::collections::BTreeMap<String, Vec<Value>>,
}

/** Restore selection, chosen in the restore wizard. */
#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RestoreOptions {
    /** Names of the tables to restore (a subset of the manifest's tables). */
    pub tables: Vec<String>,
    pub include_schema: bool,
    pub include_data: bool,
    /** Emit `DROP TABLE IF EXISTS` before each table's CREATE. */
    pub drop_existing: bool,
    /** Restore the non-table objects (views, routines, triggers, events). */
    pub include_objects: bool,
    /** Restore the DB Sage app metadata (relations, saved queries, view presets). */
    pub include_metadata: bool,
}

/* --------------------------------------------------------------------------- */
/* Small helpers                                                               */
/* --------------------------------------------------------------------------- */

async fn pool_for(state: &State<'_, AppState>, profile_id: &str) -> AppResult<MySqlPool> {
    let pools = state.pools.read().await;
    pools
        .get(profile_id)
        .cloned()
        .ok_or_else(|| AppError::NotConnected(profile_id.to_string()))
}

fn opt<'r, T>(row: &'r MySqlRow, i: usize) -> Option<T>
where
    T: sqlx::Decode<'r, sqlx::MySql> + sqlx::Type<sqlx::MySql>,
{
    row.try_get::<Option<T>, _>(i).ok().flatten()
}

/** Quote a string as a MySQL literal, escaping the characters that would break a
 * single-line INSERT. Newlines/carriage-returns become `\n`/`\r` escapes so each
 * batch stays on one physical line (MySQL interprets them back to the real bytes). */
fn sql_quote_line(s: &str) -> String {
    let mut out = String::with_capacity(s.len() + 2);
    out.push('\'');
    for ch in s.chars() {
        match ch {
            '\\' => out.push_str("\\\\"),
            '\'' => out.push_str("\\'"),
            '\n' => out.push_str("\\n"),
            '\r' => out.push_str("\\r"),
            _ => out.push(ch),
        }
    }
    out.push('\'');
    out
}

/** Render one cell as a MySQL literal for an INSERT (single-line variant). Mirrors
 * the query module's `sql_literal` but uses `sql_quote_line` for string types. */
fn sql_literal_line(row: &MySqlRow, i: usize, ty: &str) -> String {
    let null = || "NULL".to_string();
    match ty {
        "BOOLEAN" | "TINYINT" | "SMALLINT" | "MEDIUMINT" | "INT" | "BIGINT" => {
            opt::<i64>(row, i).map(|n| n.to_string()).unwrap_or_else(null)
        }
        "TINYINT UNSIGNED" | "SMALLINT UNSIGNED" | "MEDIUMINT UNSIGNED" | "INT UNSIGNED"
        | "BIGINT UNSIGNED" => opt::<u64>(row, i).map(|n| n.to_string()).unwrap_or_else(null),
        "FLOAT" | "DOUBLE" => opt::<f64>(row, i).map(|n| n.to_string()).unwrap_or_else(null),
        "DECIMAL" => opt::<bigdecimal::BigDecimal>(row, i)
            .map(|d| d.to_string())
            .unwrap_or_else(null),
        "YEAR" => opt::<u16>(row, i).map(|y| y.to_string()).unwrap_or_else(null),
        "DATE" => opt::<chrono::NaiveDate>(row, i)
            .map(|d| sql_quote_line(&d.to_string()))
            .unwrap_or_else(null),
        "TIME" => opt::<chrono::NaiveTime>(row, i)
            .map(|t| sql_quote_line(&t.to_string()))
            .unwrap_or_else(null),
        "DATETIME" | "TIMESTAMP" => opt::<chrono::NaiveDateTime>(row, i)
            .map(|d| sql_quote_line(&d.format("%Y-%m-%d %H:%M:%S").to_string()))
            .unwrap_or_else(null),
        "JSON" => opt::<Value>(row, i)
            .map(|v| sql_quote_line(&v.to_string()))
            .unwrap_or_else(null),
        "BLOB" | "TINYBLOB" | "MEDIUMBLOB" | "LONGBLOB" | "VARBINARY" | "BINARY" => {
            opt::<Vec<u8>>(row, i)
                .map(|b| {
                    if b.is_empty() {
                        "''".to_string()
                    } else {
                        let mut hex = String::with_capacity(2 + b.len() * 2);
                        hex.push_str("0x");
                        for byte in &b {
                            hex.push_str(&format!("{byte:02x}"));
                        }
                        hex
                    }
                })
                .unwrap_or_else(null)
        }
        _ => opt::<String>(row, i)
            .map(|s| sql_quote_line(&s))
            .unwrap_or_else(null),
    }
}

/** Skip a (possibly quoted) identifier token starting at byte `i`. Multibyte UTF-8
 * bytes never collide with the ASCII delimiters scanned here, so byte indexing
 * stays on char boundaries. */
fn skip_quoted_token(bytes: &[u8], mut i: usize) -> usize {
    if i >= bytes.len() {
        return i;
    }
    let q = bytes[i];
    if q == b'`' || q == b'\'' || q == b'"' {
        i += 1;
        while i < bytes.len() {
            if bytes[i] == q {
                if i + 1 < bytes.len() && bytes[i + 1] == q {
                    i += 2;
                    continue;
                }
                i += 1;
                break;
            }
            i += 1;
        }
    } else {
        while i < bytes.len() && bytes[i] != b' ' && bytes[i] != b'@' {
            i += 1;
        }
    }
    i
}

/** Remove the `DEFINER=user@host` clause from an object DDL so a restore doesn't
 * fail when that account is absent on the target server (standard mysqldump-style
 * behavior for portable dumps). */
fn strip_definer(ddl: &str) -> String {
    let Some(pos) = ddl.find("DEFINER=") else {
        return ddl.to_string();
    };
    let bytes = ddl.as_bytes();
    let mut i = pos + "DEFINER=".len();
    i = skip_quoted_token(bytes, i);
    if i < bytes.len() && bytes[i] == b'@' {
        i += 1;
    }
    i = skip_quoted_token(bytes, i);
    if i < bytes.len() && bytes[i] == b' ' {
        i += 1;
    }
    let mut out = String::with_capacity(ddl.len());
    out.push_str(&ddl[..pos]);
    out.push_str(&ddl[i..]);
    out
}

/** Make a table name safe to use as a zip entry filename: keep alphanumerics and
 * `._-`, replace everything else with `_`. */
fn sanitize_filename(name: &str) -> String {
    let s: String = name
        .chars()
        .map(|c| {
            if c.is_ascii_alphanumeric() || c == '_' || c == '-' || c == '.' {
                c
            } else {
                '_'
            }
        })
        .collect();
    if s.is_empty() {
        "table".to_string()
    } else {
        s
    }
}

/** Derive a unique, filesystem-safe base name per table (preserving order), so
 * two names that sanitize to the same string don't collide in the archive. */
fn unique_entries(names: &[String]) -> Vec<String> {
    let mut used = std::collections::HashSet::new();
    let mut out = Vec::with_capacity(names.len());
    for name in names {
        let base = sanitize_filename(name);
        let mut candidate = base.clone();
        let mut n = 2;
        while !used.insert(candidate.clone()) {
            candidate = format!("{base}_{n}");
            n += 1;
        }
        out.push(candidate);
    }
    out
}

/* --------------------------------------------------------------------------- */
/* Backup                                                                       */
/* --------------------------------------------------------------------------- */

/// Write a `.dbbak` archive (a zip) containing the full structure and data of a
/// database. Reads everything inside a single `START TRANSACTION WITH CONSISTENT
/// SNAPSHOT` on one connection, so the dump is a lock-free, point-in-time snapshot
/// (InnoDB MVCC) that doesn't block concurrent readers/writers. Streams each
/// table's rows straight into the archive. Emits `db-backup-progress`
/// ({ phase, table, tableIndex, tableCount, done, total }). Returns `false` (and
/// writes nothing) when the user cancels.
#[tauri::command]
pub async fn backup_database(
    app: AppHandle,
    state: State<'_, AppState>,
    profile_id: String,
    database: String,
    path: String,
) -> AppResult<bool> {
    state.cancel_backup.store(false, Ordering::Relaxed);
    let pool = pool_for(&state, &profile_id).await?;
    let mut conn = pool.acquire().await?;

    /* Lock-free consistent snapshot for the whole dump (InnoDB). */
    (&mut *conn)
        .execute("SET SESSION TRANSACTION ISOLATION LEVEL REPEATABLE READ")
        .await?;
    (&mut *conn)
        .execute("START TRANSACTION WITH CONSISTENT SNAPSHOT")
        .await?;

    /* Server + schema metadata for the manifest. */
    let server_version = {
        let row = (&mut *conn).fetch_one("SELECT VERSION()").await?;
        get_string(&row, 0)
    };
    let (charset, collation) = {
        let row = sqlx::query(
            "SELECT DEFAULT_CHARACTER_SET_NAME, DEFAULT_COLLATION_NAME \
             FROM INFORMATION_SCHEMA.SCHEMATA WHERE SCHEMA_NAME = ?",
        )
        .bind(&database)
        .fetch_one(&mut *conn)
        .await?;
        (get_string(&row, 0), get_string(&row, 1))
    };

    /* Split base tables from views via SHOW FULL TABLES (Table_type column). */
    let mut table_names: Vec<String> = Vec::new();
    let mut view_names: Vec<String> = Vec::new();
    {
        let rows = sqlx::query(&format!("SHOW FULL TABLES IN {}", quote_ident(&database)))
            .fetch_all(&mut *conn)
            .await?;
        for r in &rows {
            let name = get_string(r, 0);
            if get_string(r, 1) == "VIEW" {
                view_names.push(name);
            } else {
                table_names.push(name);
            }
        }
    }
    let routine_names = object_names(
        &mut conn,
        "SELECT ROUTINE_NAME FROM INFORMATION_SCHEMA.ROUTINES WHERE ROUTINE_SCHEMA = ? \
         ORDER BY ROUTINE_NAME",
        &database,
    )
    .await?;
    let trigger_names = {
        let rows = sqlx::query(&format!("SHOW TRIGGERS IN {}", quote_ident(&database)))
            .fetch_all(&mut *conn)
            .await?;
        rows.iter().map(|r| get_string(r, 0)).collect::<Vec<_>>()
    };
    let event_names = object_names(
        &mut conn,
        "SELECT EVENT_NAME FROM INFORMATION_SCHEMA.EVENTS WHERE EVENT_SCHEMA = ? \
         ORDER BY EVENT_NAME",
        &database,
    )
    .await?;

    /* Open the archive over a temp file; rename into place only on success. */
    let target = std::path::PathBuf::from(&path);
    let tmp = target.with_extension("dbbak-tmp");
    let file = std::fs::File::create(&tmp)?;
    let mut zip = zip::ZipWriter::new(file);
    let opts = SimpleFileOptions::default().compression_method(zip::CompressionMethod::Deflated);

    let table_count = table_names.len();
    let entries = unique_entries(&table_names);
    let mut manifest_tables: Vec<BackupTable> = Vec::with_capacity(table_count);

    for (idx, table) in table_names.iter().enumerate() {
        let entry = &entries[idx];
        let qualified = format!("{}.{}", quote_ident(&database), quote_ident(table));

        /* Schema: keep AUTO_INCREMENT so the restored table resumes its sequence. */
        let create_sql = {
            let row = sqlx::query(&format!("SHOW CREATE TABLE {qualified}"))
                .fetch_one(&mut *conn)
                .await?;
            get_string(&row, 1)
        };
        zip.start_file(format!("schema/{entry}.sql"), opts)?;
        zip.write_all(create_sql.as_bytes())?;

        let total: u64 = sqlx::query_scalar::<_, i64>(&format!("SELECT COUNT(*) FROM {qualified}"))
            .fetch_one(&mut *conn)
            .await
            .unwrap_or(0)
            .max(0) as u64;
        let _ = app.emit(
            "db-backup-progress",
            serde_json::json!({
                "phase": "table", "table": table,
                "tableIndex": idx + 1, "tableCount": table_count,
                "done": 0u64, "total": total,
            }),
        );

        /* Insertable columns only (generated columns can't be written to). */
        let insertable = insertable_columns(&mut conn, &database, table).await?;
        zip.start_file(format!("data/{entry}.sql"), opts)?;

        if !insertable.is_empty() {
            let col_list = insertable
                .iter()
                .map(|c| quote_ident(c))
                .collect::<Vec<_>>()
                .join(", ");
            let prefix = format!(
                "INSERT INTO {} ({}) VALUES ",
                quote_ident(table),
                col_list
            );
            let select_sql = format!("SELECT {col_list} FROM {qualified}");

            let mut stream = sqlx::query(&select_sql).fetch(&mut *conn);
            let mut col_types: Vec<(String, String)> = Vec::new();
            let mut batch: Vec<String> = Vec::with_capacity(BATCH_ROWS);
            let mut done: u64 = 0;
            let mut last_emit: u64 = 0;
            let mut cancelled = false;

            while let Some(row) = stream.try_next().await? {
                if state.cancel_backup.load(Ordering::Relaxed) {
                    cancelled = true;
                    break;
                }
                if col_types.is_empty() {
                    col_types = result_columns(&row);
                }
                let values = col_types
                    .iter()
                    .enumerate()
                    .map(|(j, (_, ty))| sql_literal_line(&row, j, ty))
                    .collect::<Vec<_>>()
                    .join(", ");
                batch.push(format!("({values})"));
                done += 1;
                if batch.len() >= BATCH_ROWS {
                    let line = format!("{prefix}{};\n", batch.join(","));
                    zip.write_all(line.as_bytes())?;
                    batch.clear();
                }
                if done - last_emit >= 500 {
                    last_emit = done;
                    let _ = app.emit(
                        "db-backup-progress",
                        serde_json::json!({
                            "phase": "table", "table": table,
                            "tableIndex": idx + 1, "tableCount": table_count,
                            "done": done, "total": total,
                        }),
                    );
                }
            }
            drop(stream);

            if cancelled {
                let _ = conn.detach();
                drop(zip);
                let _ = std::fs::remove_file(&tmp);
                return Ok(false);
            }
            if !batch.is_empty() {
                let line = format!("{prefix}{};\n", batch.join(","));
                zip.write_all(line.as_bytes())?;
            }
        }

        manifest_tables.push(BackupTable {
            name: table.clone(),
            row_count: total,
            entry: entry.clone(),
        });
    }

    /* Non-table objects: one entry each, executed as a single statement on restore
       (no DELIMITER juggling needed when statements are sent one at a time). */
    for (i, name) in view_names.iter().enumerate() {
        let ddl = show_create(&mut conn, "VIEW", &database, name, 1).await?;
        write_object_entry(&mut zip, opts, "views", i, &ddl)?;
    }
    for (i, name) in routine_names.iter().enumerate() {
        let ddl = create_routine_ddl(&mut conn, &database, name).await?;
        write_object_entry(&mut zip, opts, "routines", i, &ddl)?;
    }
    for (i, name) in trigger_names.iter().enumerate() {
        let ddl = show_create(&mut conn, "TRIGGER", &database, name, 2).await?;
        write_object_entry(&mut zip, opts, "triggers", i, &ddl)?;
    }
    for (i, name) in event_names.iter().enumerate() {
        let ddl = show_create(&mut conn, "EVENT", &database, name, 3).await?;
        write_object_entry(&mut zip, opts, "events", i, &ddl)?;
    }

    /* DB Sage app metadata (relations, saved queries, view presets) for this DB. */
    let metadata = gather_metadata(&app, &profile_id, &database)?;
    zip.start_file("metadata.json", opts)?;
    zip.write_all(serde_json::to_string_pretty(&metadata)?.as_bytes())?;

    let manifest = BackupManifest {
        format: FORMAT_VERSION,
        database: database.clone(),
        server_version,
        app_version: env!("CARGO_PKG_VERSION").to_string(),
        created_at: Utc::now().to_rfc3339(),
        charset,
        collation,
        tables: manifest_tables,
        views: view_names,
        routines: routine_names,
        triggers: trigger_names,
        events: event_names,
        metadata: MetadataCounts {
            relations: metadata.relations.len(),
            saved_queries: metadata.saved_queries.len(),
            view_presets: metadata.view_presets.values().map(|v| v.len()).sum(),
        },
    };
    zip.start_file("manifest.json", opts)?;
    zip.write_all(serde_json::to_string_pretty(&manifest)?.as_bytes())?;
    zip.finish()?;

    std::fs::rename(&tmp, &target)?;
    Ok(true)
}

/// Ask an in-progress backup to stop.
#[tauri::command]
pub async fn cancel_backup(state: State<'_, AppState>) -> AppResult<()> {
    state.cancel_backup.store(true, Ordering::Relaxed);
    Ok(())
}

/* --------------------------------------------------------------------------- */
/* Backup helpers                                                               */
/* --------------------------------------------------------------------------- */

/** Run a single-column name query bound to a schema, returning the values. */
async fn object_names(
    conn: &mut sqlx::pool::PoolConnection<sqlx::MySql>,
    sql: &str,
    database: &str,
) -> AppResult<Vec<String>> {
    let rows = sqlx::query(sql).bind(database).fetch_all(&mut **conn).await?;
    Ok(rows.iter().map(|r| get_string(r, 0)).collect())
}

/** Column names that can appear in an INSERT (excludes generated columns). */
async fn insertable_columns(
    conn: &mut sqlx::pool::PoolConnection<sqlx::MySql>,
    database: &str,
    table: &str,
) -> AppResult<Vec<String>> {
    let rows = sqlx::query(
        "SELECT COLUMN_NAME, EXTRA FROM INFORMATION_SCHEMA.COLUMNS \
         WHERE TABLE_SCHEMA = ? AND TABLE_NAME = ? ORDER BY ORDINAL_POSITION",
    )
    .bind(database)
    .bind(table)
    .fetch_all(&mut **conn)
    .await?;
    Ok(rows
        .iter()
        .filter(|r| !get_string(r, 1).to_uppercase().contains("GENERATED"))
        .map(|r| get_string(r, 0))
        .collect())
}

/** `SHOW CREATE <kind> db.name`, returning the DDL at `ddl_col` with DEFINER stripped. */
async fn show_create(
    conn: &mut sqlx::pool::PoolConnection<sqlx::MySql>,
    kind: &str,
    database: &str,
    name: &str,
    ddl_col: usize,
) -> AppResult<String> {
    let qualified = format!("{}.{}", quote_ident(database), quote_ident(name));
    let row = sqlx::query(&format!("SHOW CREATE {kind} {qualified}"))
        .fetch_one(&mut **conn)
        .await?;
    Ok(strip_definer(&get_string(&row, ddl_col)))
}

/** Routines need PROCEDURE-or-FUNCTION discrimination; try procedure first. */
async fn create_routine_ddl(
    conn: &mut sqlx::pool::PoolConnection<sqlx::MySql>,
    database: &str,
    name: &str,
) -> AppResult<String> {
    if let Ok(ddl) = show_create(conn, "PROCEDURE", database, name, 2).await {
        return Ok(ddl);
    }
    show_create(conn, "FUNCTION", database, name, 2).await
}

/** Read the DB Sage app metadata (relations, saved queries, view presets) for a
 * database from the local stores, keyed by the profile's host. */
fn gather_metadata(
    app: &AppHandle,
    profile_id: &str,
    database: &str,
) -> AppResult<BackupMetadata> {
    let host = crate::store::profiles::get(app, profile_id)?.host;
    let relations = crate::store::relations::list(app, &host, database)?;
    let saved_queries =
        crate::store::saved_queries::list(app, &format!("{host}::{database}"))?;
    let mut view_presets = std::collections::BTreeMap::new();
    for table in crate::store::table_view_presets::tables_with_presets(app, &host, database)? {
        let presets = crate::store::table_view_presets::list(
            app,
            &format!("{host}::{database}::{table}"),
        )?;
        if !presets.is_empty() {
            view_presets.insert(table, presets);
        }
    }
    Ok(BackupMetadata {
        relations,
        saved_queries,
        view_presets,
    })
}

fn write_object_entry<W: Write + std::io::Seek>(
    zip: &mut zip::ZipWriter<W>,
    opts: SimpleFileOptions,
    dir: &str,
    index: usize,
    ddl: &str,
) -> AppResult<()> {
    zip.start_file(format!("{dir}/{index}.sql"), opts)?;
    zip.write_all(ddl.as_bytes())?;
    Ok(())
}

/* --------------------------------------------------------------------------- */
/* Inspect                                                                      */
/* --------------------------------------------------------------------------- */

/// Read just the `manifest.json` from a `.dbbak` archive (powers the restore
/// wizard's table picker and summary).
#[tauri::command]
pub async fn inspect_backup(path: String) -> AppResult<BackupManifest> {
    let file = std::fs::File::open(&path)?;
    let mut archive =
        zip::ZipArchive::new(file).map_err(|e| AppError::Other(format!("not a backup: {e}")))?;
    let mut entry = archive
        .by_name("manifest.json")
        .map_err(|e| AppError::Other(format!("missing manifest: {e}")))?;
    let mut s = String::new();
    entry.read_to_string(&mut s)?;
    Ok(serde_json::from_str(&s)?)
}

/* --------------------------------------------------------------------------- */
/* Restore                                                                      */
/* --------------------------------------------------------------------------- */

/// Restore selected objects from a `.dbbak` archive into `target_database`,
/// creating it if needed. The wizard defaults the target to a fresh copy DB so
/// the original is never touched (MySQL DDL auto-commits, so restore can't be one
/// atomic transaction). Emits `db-restore-progress`. Returns `false` on cancel.
#[tauri::command]
pub async fn restore_database(
    app: AppHandle,
    state: State<'_, AppState>,
    profile_id: String,
    target_database: String,
    path: String,
    options: RestoreOptions,
) -> AppResult<bool> {
    state.cancel_restore.store(false, Ordering::Relaxed);
    let pool = pool_for(&state, &profile_id).await?;

    /* Read the manifest first (separate scope so the archive borrow is released). */
    let manifest = inspect_backup(path.clone()).await?;

    /* Create the target schema with the source's charset/collation. */
    {
        let mut conn = pool.acquire().await?;
        let mut create = format!(
            "CREATE DATABASE IF NOT EXISTS {}",
            quote_ident(&target_database)
        );
        if !manifest.charset.is_empty() {
            create.push_str(&format!(" CHARACTER SET {}", manifest.charset));
        }
        if !manifest.collation.is_empty() {
            create.push_str(&format!(" COLLATE {}", manifest.collation));
        }
        (&mut *conn).execute(create.as_str()).await?;
    }

    let mut conn = pool.acquire().await?;
    (&mut *conn)
        .execute(format!("USE {}", quote_ident(&target_database)).as_str())
        .await?;
    (&mut *conn).execute("SET FOREIGN_KEY_CHECKS = 0").await?;
    (&mut *conn).execute("SET UNIQUE_CHECKS = 0").await?;

    let file = std::fs::File::open(&path)?;
    let mut archive =
        zip::ZipArchive::new(file).map_err(|e| AppError::Other(format!("not a backup: {e}")))?;

    /* The selected subset of tables (their `entry` names locate the zip entries). */
    let selected: Vec<&BackupTable> = manifest
        .tables
        .iter()
        .filter(|t| options.tables.iter().any(|s| s == &t.name))
        .collect();
    let total = selected.len();

    for (step, table) in selected.iter().enumerate() {
        if state.cancel_restore.load(Ordering::Relaxed) {
            return Ok(false);
        }
        let _ = app.emit(
            "db-restore-progress",
            serde_json::json!({
                "phase": "table", "table": table.name,
                "tableIndex": step + 1, "tableCount": total,
                "done": step, "total": total,
            }),
        );

        if options.include_schema {
            if options.drop_existing {
                (&mut *conn)
                    .execute(format!("DROP TABLE IF EXISTS {}", quote_ident(&table.name)).as_str())
                    .await?;
            }
            let ddl = read_entry(&mut archive, &format!("schema/{}.sql", table.entry))?;
            (&mut *conn).execute(ddl.as_str()).await?;
        }

        if options.include_data {
            let data = read_entry(&mut archive, &format!("data/{}.sql", table.entry))?;
            for line in data.lines() {
                if line.trim().is_empty() {
                    continue;
                }
                if state.cancel_restore.load(Ordering::Relaxed) {
                    return Ok(false);
                }
                (&mut *conn).execute(line).await?;
            }
        }
    }

    /* Non-table objects: tables-first ordering already done above. Object DDLs
       (notably views) carry the source schema name qualified in backticks; rewrite
       it to the target so a restore into a differently-named copy stays self-
       contained. A same-name restore makes this a no-op. */
    if options.include_objects {
        let from = format!("{}.", quote_ident(&manifest.database));
        let to = format!("{}.", quote_ident(&target_database));
        for (i, _) in manifest.views.iter().enumerate() {
            restore_object(&mut conn, &mut archive, "views", i, &from, &to).await?;
        }
        for (i, _) in manifest.routines.iter().enumerate() {
            restore_object(&mut conn, &mut archive, "routines", i, &from, &to).await?;
        }
        for (i, _) in manifest.triggers.iter().enumerate() {
            restore_object(&mut conn, &mut archive, "triggers", i, &from, &to).await?;
        }
        for (i, _) in manifest.events.iter().enumerate() {
            restore_object(&mut conn, &mut archive, "events", i, &from, &to).await?;
        }
    }

    (&mut *conn).execute("SET FOREIGN_KEY_CHECKS = 1").await?;
    (&mut *conn).execute("SET UNIQUE_CHECKS = 1").await?;

    /* App metadata, re-keyed to the target host + database. Tolerant of older
       backups that predate metadata.json. */
    if options.include_metadata {
        if let Ok(meta_str) = read_entry(&mut archive, "metadata.json") {
            let meta: BackupMetadata = serde_json::from_str(&meta_str)?;
            restore_metadata(&app, &profile_id, &target_database, &meta)?;
        }
    }
    Ok(true)
}

/** Merge a backup's app metadata into the local stores, keyed to the target
 * host + database. Reuses each store's id/name-based `import_merge`. */
fn restore_metadata(
    app: &AppHandle,
    profile_id: &str,
    target_database: &str,
    meta: &BackupMetadata,
) -> AppResult<()> {
    let host = crate::store::profiles::get(app, profile_id)?.host;

    if !meta.relations.is_empty() {
        let mut by_db = std::collections::BTreeMap::new();
        by_db.insert(target_database.to_string(), meta.relations.clone());
        let mut file = std::collections::BTreeMap::new();
        file.insert(host.clone(), by_db);
        crate::store::relations::import_merge(app, &file)?;
    }
    if !meta.saved_queries.is_empty() {
        let mut file = std::collections::BTreeMap::new();
        file.insert(
            format!("{host}::{target_database}"),
            Value::Array(meta.saved_queries.clone()),
        );
        crate::store::saved_queries::import_merge(app, &file)?;
    }
    if !meta.view_presets.is_empty() {
        let mut file = std::collections::BTreeMap::new();
        for (table, presets) in &meta.view_presets {
            file.insert(
                format!("{host}::{target_database}::{table}"),
                Value::Array(presets.clone()),
            );
        }
        crate::store::table_view_presets::import_merge(app, &file)?;
    }
    Ok(())
}

/// Ask an in-progress restore to stop.
#[tauri::command]
pub async fn cancel_restore(state: State<'_, AppState>) -> AppResult<()> {
    state.cancel_restore.store(true, Ordering::Relaxed);
    Ok(())
}

/** Read a zip entry fully into a String. */
fn read_entry<R: Read + std::io::Seek>(
    archive: &mut zip::ZipArchive<R>,
    name: &str,
) -> AppResult<String> {
    let mut entry = archive
        .by_name(name)
        .map_err(|e| AppError::Other(format!("missing entry {name}: {e}")))?;
    let mut s = String::new();
    entry.read_to_string(&mut s)?;
    Ok(s)
}

/** Execute a single object's DDL entry, rewriting any backtick-qualified `from`
 * schema reference to `to` so the object points at the restore target. */
async fn restore_object<R: Read + std::io::Seek>(
    conn: &mut sqlx::pool::PoolConnection<sqlx::MySql>,
    archive: &mut zip::ZipArchive<R>,
    dir: &str,
    index: usize,
    from: &str,
    to: &str,
) -> AppResult<()> {
    let ddl = read_entry(archive, &format!("{dir}/{index}.sql"))?;
    (&mut **conn).execute(ddl.replace(from, to).as_str()).await?;
    Ok(())
}

/* --------------------------------------------------------------------------- */
/* Swap                                                                         */
/* --------------------------------------------------------------------------- */

/** A schema's non-table objects, captured (name + DDL) before a swap rearranges
 * things, so they can be recreated in the destination schema. */
struct Objects {
    views: Vec<(String, String)>,
    routines: Vec<(String, String)>,
    triggers: Vec<(String, String)>,
    events: Vec<(String, String)>,
}

/// Make a restored copy live under the original name without `RENAME DATABASE`
/// (which MySQL lacks): stash the current `live` database aside as `<live>_old_<ts>`
/// and move the `restored` copy's contents into `live`. Tables move via a single
/// atomic cross-schema `RENAME TABLE`; views/routines/triggers/events are recreated
/// (schema references rewritten to the destination). The emptied `restored`
/// database is dropped. Returns the stash name (the rollback point). A later
/// "revert" is just `swap_database(live, stash)`.
#[tauri::command]
pub async fn swap_database(
    app: AppHandle,
    state: State<'_, AppState>,
    profile_id: String,
    live_database: String,
    restored_database: String,
) -> AppResult<String> {
    let pool = pool_for(&state, &profile_id).await?;
    let mut conn = pool.acquire().await?;

    let ts = Utc::now().format("%Y%m%d_%H%M%S").to_string();
    let stash = format!("{live_database}_old_{ts}");

    let live_tables = base_tables(&mut conn, &live_database).await?;
    let restored_tables = base_tables(&mut conn, &restored_database).await?;
    let live_objs = capture_objects(&mut conn, &live_database).await?;
    let restored_objs = capture_objects(&mut conn, &restored_database).await?;

    (&mut *conn)
        .execute(format!("CREATE DATABASE {}", quote_ident(&stash)).as_str())
        .await?;
    (&mut *conn).execute("SET FOREIGN_KEY_CHECKS = 0").await?;

    /* Triggers must go before their tables move (a table can't be moved across
       schemas while it owns triggers). Drop all of live's non-table objects too,
       so the restored copy's same-named objects can later land in `live`. */
    drop_objects(&mut conn, &live_database, &live_objs).await?;
    for (name, _) in &restored_objs.triggers {
        (&mut *conn)
            .execute(
                format!(
                    "DROP TRIGGER IF EXISTS {}.{}",
                    quote_ident(&restored_database),
                    quote_ident(name)
                )
                .as_str(),
            )
            .await?;
    }

    /* One atomic statement: live tables → stash, restored tables → live. */
    let mut moves: Vec<String> = Vec::new();
    for t in &live_tables {
        moves.push(format!(
            "{}.{} TO {}.{}",
            quote_ident(&live_database),
            quote_ident(t),
            quote_ident(&stash),
            quote_ident(t)
        ));
    }
    for t in &restored_tables {
        moves.push(format!(
            "{}.{} TO {}.{}",
            quote_ident(&restored_database),
            quote_ident(t),
            quote_ident(&live_database),
            quote_ident(t)
        ));
    }
    if !moves.is_empty() {
        (&mut *conn)
            .execute(format!("RENAME TABLE {}", moves.join(", ")).as_str())
            .await?;
    }

    /* Recreate the old objects in the stash, and the restored copy's in live. */
    recreate_objects(&mut conn, &stash, &live_objs, &live_database).await?;
    recreate_objects(&mut conn, &live_database, &restored_objs, &restored_database).await?;

    (&mut *conn)
        .execute(format!("DROP DATABASE {}", quote_ident(&restored_database)).as_str())
        .await?;
    (&mut *conn).execute("SET FOREIGN_KEY_CHECKS = 1").await?;

    /* App metadata follows the data: old live's metadata → stash, restored copy's
       → the live name. Order matters (free the live key first). */
    if let Ok(host) = crate::store::profiles::get(&app, &profile_id).map(|p| p.host) {
        let _ = crate::store::relations::move_database(&app, &host, &live_database, &stash);
        let _ = crate::store::saved_queries::move_database(&app, &host, &live_database, &stash);
        let _ =
            crate::store::table_view_presets::move_database(&app, &host, &live_database, &stash);
        let _ =
            crate::store::relations::move_database(&app, &host, &restored_database, &live_database);
        let _ = crate::store::saved_queries::move_database(
            &app,
            &host,
            &restored_database,
            &live_database,
        );
        let _ = crate::store::table_view_presets::move_database(
            &app,
            &host,
            &restored_database,
            &live_database,
        );
    }

    Ok(stash)
}

async fn base_tables(
    conn: &mut sqlx::pool::PoolConnection<sqlx::MySql>,
    database: &str,
) -> AppResult<Vec<String>> {
    let rows = sqlx::query(&format!("SHOW FULL TABLES IN {}", quote_ident(database)))
        .fetch_all(&mut **conn)
        .await?;
    Ok(rows
        .iter()
        .filter(|r| get_string(r, 1) != "VIEW")
        .map(|r| get_string(r, 0))
        .collect())
}

async fn capture_objects(
    conn: &mut sqlx::pool::PoolConnection<sqlx::MySql>,
    database: &str,
) -> AppResult<Objects> {
    let mut views = Vec::new();
    let mut routines = Vec::new();
    let mut triggers = Vec::new();
    let mut events = Vec::new();

    let view_rows = sqlx::query(&format!("SHOW FULL TABLES IN {}", quote_ident(database)))
        .fetch_all(&mut **conn)
        .await?;
    for r in &view_rows {
        if get_string(r, 1) == "VIEW" {
            let name = get_string(r, 0);
            let ddl = show_create(conn, "VIEW", database, &name, 1).await?;
            views.push((name, ddl));
        }
    }
    for name in object_names(
        conn,
        "SELECT ROUTINE_NAME FROM INFORMATION_SCHEMA.ROUTINES WHERE ROUTINE_SCHEMA = ?",
        database,
    )
    .await?
    {
        let ddl = create_routine_ddl(conn, database, &name).await?;
        routines.push((name, ddl));
    }
    let trig_rows = sqlx::query(&format!("SHOW TRIGGERS IN {}", quote_ident(database)))
        .fetch_all(&mut **conn)
        .await?;
    for r in &trig_rows {
        let name = get_string(r, 0);
        let ddl = show_create(conn, "TRIGGER", database, &name, 2).await?;
        triggers.push((name, ddl));
    }
    for name in object_names(
        conn,
        "SELECT EVENT_NAME FROM INFORMATION_SCHEMA.EVENTS WHERE EVENT_SCHEMA = ?",
        database,
    )
    .await?
    {
        let ddl = show_create(conn, "EVENT", database, &name, 3).await?;
        events.push((name, ddl));
    }
    Ok(Objects {
        views,
        routines,
        triggers,
        events,
    })
}

async fn drop_objects(
    conn: &mut sqlx::pool::PoolConnection<sqlx::MySql>,
    database: &str,
    objs: &Objects,
) -> AppResult<()> {
    for (name, _) in &objs.triggers {
        (&mut **conn)
            .execute(
                format!(
                    "DROP TRIGGER IF EXISTS {}.{}",
                    quote_ident(database),
                    quote_ident(name)
                )
                .as_str(),
            )
            .await?;
    }
    for (name, _) in &objs.views {
        (&mut **conn)
            .execute(
                format!(
                    "DROP VIEW IF EXISTS {}.{}",
                    quote_ident(database),
                    quote_ident(name)
                )
                .as_str(),
            )
            .await?;
    }
    for (name, ddl) in &objs.routines {
        let kind = if ddl.to_uppercase().contains("FUNCTION") {
            "FUNCTION"
        } else {
            "PROCEDURE"
        };
        (&mut **conn)
            .execute(
                format!(
                    "DROP {kind} IF EXISTS {}.{}",
                    quote_ident(database),
                    quote_ident(name)
                )
                .as_str(),
            )
            .await?;
    }
    for (name, _) in &objs.events {
        (&mut **conn)
            .execute(
                format!(
                    "DROP EVENT IF EXISTS {}.{}",
                    quote_ident(database),
                    quote_ident(name)
                )
                .as_str(),
            )
            .await?;
    }
    Ok(())
}

/** Recreate captured objects into `target`, rewriting any backtick-qualified
 * references to `source` so the bodies point at the destination schema. Order:
 * routines (no deps), views (need tables), triggers, events. */
async fn recreate_objects(
    conn: &mut sqlx::pool::PoolConnection<sqlx::MySql>,
    target: &str,
    objs: &Objects,
    source: &str,
) -> AppResult<()> {
    let from = format!("{}.", quote_ident(source));
    let to = format!("{}.", quote_ident(target));
    let use_target = format!("USE {}", quote_ident(target));

    let groups = [&objs.routines, &objs.views, &objs.triggers, &objs.events];
    for group in groups {
        for (_, ddl) in group {
            (&mut **conn).execute(use_target.as_str()).await?;
            let rewritten = ddl.replace(&from, &to);
            (&mut **conn).execute(rewritten.as_str()).await?;
        }
    }
    Ok(())
}
