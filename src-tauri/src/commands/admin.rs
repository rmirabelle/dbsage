use crate::db::mysql::get_string;
use crate::error::{AppError, AppResult};
use crate::state::AppState;
use serde::Serialize;
use sqlx::{Executor, MySqlPool};
use tauri::{AppHandle, Manager, State, WebviewUrl, WebviewWindowBuilder};
#[cfg(windows)]
use serde::Deserialize;

/**
 * Local-server administration commands (Windows only).
 *
 * These reach outside SQL to the host OS — the Windows Service Control Manager,
 * the `my.ini` config file, and the server log files — so they only make sense
 * for a connection whose host is the local machine. Read-only operations run
 * unelevated; privileged writes (service control, config save) shell out through
 * `Start-Process -Verb RunAs`, which raises a single UAC prompt per action. Every
 * command compiles on all platforms but the non-Windows path returns an
 * "unsupported" error.
 */

/// Sentinel error message the UI matches to stay silent when the user dismisses
/// the UAC consent dialog (rather than showing a scary failure toast).
pub const UAC_CANCELLED: &str = "uac_cancelled";

/// MySQL Windows service summary surfaced to the Admin panel.
#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ServiceInfo {
    pub name: String,
    pub display_name: Option<String>,
    /// `Win32_Service.State`: "Running", "Stopped", "Paused", …
    pub state: String,
    /// `Win32_Service.StartMode`: "Auto", "Manual", "Disabled", …
    pub start_mode: String,
    pub bin_path: Option<String>,
    /// `--defaults-file=` parsed out of the service binPath, when present.
    pub defaults_file: Option<String>,
}

#[cfg(windows)]
#[derive(Deserialize)]
#[serde(rename_all = "PascalCase")]
struct RawSvc {
    name: String,
    display_name: Option<String>,
    state: Option<String>,
    start_mode: Option<String>,
    path_name: Option<String>,
}

/// Run a PowerShell one-liner with no console window and return the raw output
/// (caller inspects the exit code; elevated ops succeed/fail by code, not stderr).
#[cfg(windows)]
fn powershell_output(script: &str) -> AppResult<std::process::Output> {
    use std::os::windows::process::CommandExt;
    const CREATE_NO_WINDOW: u32 = 0x0800_0000;
    std::process::Command::new("powershell.exe")
        .args(["-NoProfile", "-NonInteractive", "-Command", script])
        .creation_flags(CREATE_NO_WINDOW)
        .output()
        .map_err(|e| AppError::Other(format!("failed to run powershell: {e}")))
}

/// Run a read-only PowerShell query, erroring if it exits non-zero.
#[cfg(windows)]
fn powershell_read(script: &str) -> AppResult<String> {
    let out = powershell_output(script)?;
    if !out.status.success() {
        let err = String::from_utf8_lossy(&out.stderr);
        return Err(AppError::Other(format!("powershell error: {}", err.trim())));
    }
    Ok(String::from_utf8_lossy(&out.stdout).into_owned())
}

/**
 * Run a `cmd /c <inner>` command elevated via a single UAC prompt. `inner` is
 * built entirely from values we control (service name from our own CIM query,
 * fixed verbs), never raw user input. Maps a dismissed UAC dialog to
 * [`UAC_CANCELLED`] so the UI can ignore it.
 */
#[cfg(windows)]
fn run_elevated_cmd(inner: &str) -> AppResult<()> {
    let inner_ps = inner.replace('\'', "''");
    let script = format!(
        "$ErrorActionPreference='Stop'; \
         try {{ $p = Start-Process -FilePath cmd.exe -ArgumentList '/c','{inner_ps}' \
         -Verb RunAs -PassThru -Wait -WindowStyle Hidden; exit $p.ExitCode }} \
         catch {{ exit 1223 }}"
    );
    let out = powershell_output(&script)?;
    match out.status.code() {
        Some(0) => Ok(()),
        /* 1223 = ERROR_CANCELLED: user clicked "No" on the UAC prompt. */
        Some(1223) => Err(AppError::Other(UAC_CANCELLED.into())),
        Some(code) => Err(AppError::Other(format!(
            "elevated operation failed (exit {code})"
        ))),
        None => Err(AppError::Other("elevated operation was terminated".into())),
    }
}

/// Extract a `--defaults-file=<path>` value (quoted or bare) from a binPath.
#[cfg(windows)]
fn parse_defaults_file(bin_path: &str) -> Option<String> {
    let flag = "--defaults-file=";
    let idx = bin_path.to_lowercase().find(flag)?;
    let rest = bin_path[idx + flag.len()..].trim_start();
    if let Some(after_quote) = rest.strip_prefix('"') {
        let end = after_quote.find('"')?;
        Some(after_quote[..end].to_string())
    } else {
        rest.split_whitespace().next().map(|s| s.to_string())
    }
}

/**
 * Find the local MySQL Windows service (binPath mentions `mysqld`). Read-only,
 * unelevated CIM query. Returns `None` for portable/XAMPP installs with no
 * registered service. PowerShell 5.1 unwraps a single-element array, so we
 * tolerate both an array and a bare object from `ConvertTo-Json`.
 */
#[cfg(windows)]
fn find_service() -> AppResult<Option<ServiceInfo>> {
    let script = "@(Get-CimInstance Win32_Service | \
         Where-Object { $_.PathName -match 'mysqld' } | \
         Select-Object Name,DisplayName,State,StartMode,PathName) | ConvertTo-Json";
    let json = powershell_read(script)?;
    let trimmed = json.trim();
    if trimmed.is_empty() {
        return Ok(None);
    }
    let raw: Option<RawSvc> = if let Ok(v) = serde_json::from_str::<Vec<RawSvc>>(trimmed) {
        v.into_iter().next()
    } else {
        Some(serde_json::from_str::<RawSvc>(trimmed)?)
    };
    Ok(raw.map(|s| {
        let bin_path = s.path_name;
        let defaults_file = bin_path.as_deref().and_then(parse_defaults_file);
        ServiceInfo {
            name: s.name,
            display_name: s.display_name,
            state: s.state.unwrap_or_else(|| "Unknown".into()),
            start_mode: s.start_mode.unwrap_or_else(|| "Unknown".into()),
            bin_path,
            defaults_file,
        }
    }))
}

/// Resolve the service name or fail with a clear message (used by control ops).
#[cfg(windows)]
fn require_service_name() -> AppResult<String> {
    find_service()?
        .map(|s| s.name)
        .ok_or_else(|| AppError::Other("No MySQL Windows service was found.".into()))
}

/**
 * Report the local MySQL service state, startup type, and binPath. Read-only and
 * unelevated. Returns `None` when no MySQL service is installed.
 */
#[tauri::command]
pub async fn mysql_service_status(profile_id: String) -> AppResult<Option<ServiceInfo>> {
    let _ = &profile_id;
    #[cfg(windows)]
    {
        find_service()
    }
    #[cfg(not(windows))]
    {
        Err(AppError::Other(
            "Server administration is only available on Windows".into(),
        ))
    }
}

/**
 * Start, stop, or restart the local MySQL service (elevated). `action` is one of
 * "start" | "stop" | "restart". Raises one UAC prompt.
 */
#[tauri::command]
pub async fn service_control(profile_id: String, action: String) -> AppResult<()> {
    let _ = &profile_id;
    #[cfg(windows)]
    {
        let svc = require_service_name()?;
        let inner = match action.as_str() {
            "start" => format!("net start \"{svc}\""),
            "stop" => format!("net stop \"{svc}\""),
            "restart" => format!("net stop \"{svc}\" & net start \"{svc}\""),
            other => return Err(AppError::Other(format!("unknown action: {other}"))),
        };
        run_elevated_cmd(&inner)
    }
    #[cfg(not(windows))]
    {
        let _ = action;
        Err(AppError::Other(
            "Server administration is only available on Windows".into(),
        ))
    }
}

/**
 * Change the service startup type (elevated). `mode` is one of
 * "auto" | "manual" | "disabled". Raises one UAC prompt.
 */
#[tauri::command]
pub async fn set_service_start_mode(profile_id: String, mode: String) -> AppResult<()> {
    let _ = &profile_id;
    #[cfg(windows)]
    {
        let svc = require_service_name()?;
        /* `sc config` wants `demand` for Manual and a space after `start=`. */
        let sc_mode = match mode.as_str() {
            "auto" => "auto",
            "manual" => "demand",
            "disabled" => "disabled",
            other => return Err(AppError::Other(format!("unknown start mode: {other}"))),
        };
        run_elevated_cmd(&format!("sc config \"{svc}\" start= {sc_mode}"))
    }
    #[cfg(not(windows))]
    {
        let _ = mode;
        Err(AppError::Other(
            "Server administration is only available on Windows".into(),
        ))
    }
}

/**
 * Open (or focus) the standalone Server Admin window for a connection. Mirrors
 * `open_monitor_window`: the window shares the SPA bundle and learns its role
 * from its label (`admin-<id>`). Must be async so the webview's event loop can
 * make progress (a sync command would deadlock the main thread).
 */
#[tauri::command]
pub async fn open_admin_window(app: AppHandle, profile_id: String) -> AppResult<()> {
    let label = format!("admin-{profile_id}");
    if let Some(win) = app.get_webview_window(&label) {
        let _ = win.set_focus();
        return Ok(());
    }
    let url = match (cfg!(debug_assertions), app.config().build.dev_url.clone()) {
        (true, Some(dev)) => WebviewUrl::External(dev),
        _ => WebviewUrl::App("index.html".into()),
    };
    WebviewWindowBuilder::new(&app, &label, url)
        .title("DB Sage — Server Admin")
        .inner_size(1000.0, 700.0)
        .min_inner_size(720.0, 480.0)
        .decorations(false)
        .build()?;
    Ok(())
}

/* ----------------------------------------------------------------------------
 * Log files
 *
 * Where each log goes is server configuration we read over SQL (@@variables);
 * the bytes themselves live on the local disk (or, with `log_output=TABLE`, in
 * `mysql.general_log` / `mysql.slow_log`, or — for an empty `log_error` — in the
 * Windows Event Log). These commands are pure reads and need no elevation.
 * ------------------------------------------------------------------------- */

/// Resolved log destinations for a connection, for the Admin "Logs" panel.
#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct LogConfig {
    pub datadir: Option<String>,
    /// `log_output`: "FILE", "TABLE", "NONE", or a combo like "FILE,TABLE".
    pub log_output: String,
    /// Resolved error-log path, or `None` when routed to the Event Log.
    pub error_log: Option<String>,
    pub error_to_eventlog: bool,
    pub slow_log_file: Option<String>,
    pub slow_log_enabled: bool,
    pub general_log_file: Option<String>,
    pub general_log_enabled: bool,
}

/// One log's tail content plus where it came from (so the UI can label it).
#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct LogTail {
    /// "file" | "table" | "eventlog" | "disabled" | "missing" | "denied"
    pub source: String,
    pub path: Option<String>,
    pub content: String,
}

async fn pool_for(state: &State<'_, AppState>, profile_id: &str) -> AppResult<MySqlPool> {
    let pools = state.pools.read().await;
    pools
        .get(profile_id)
        .cloned()
        .ok_or_else(|| AppError::NotConnected(profile_id.to_string()))
}

/// Read one global variable's value (`name` is a fixed literal — injection-safe).
async fn get_var(pool: &MySqlPool, name: &str) -> AppResult<Option<String>> {
    let rows = pool
        .fetch_all(format!("SHOW GLOBAL VARIABLES LIKE '{name}'").as_str())
        .await?;
    Ok(rows.first().map(|r| get_string(r, 1)))
}

fn is_on(v: Option<String>) -> bool {
    v.map(|s| s.eq_ignore_ascii_case("on") || s == "1")
        .unwrap_or(false)
}

/// Join a relative log path against the data directory; absolute paths pass through.
fn resolve_path(datadir: Option<&str>, p: &str) -> String {
    let path = std::path::Path::new(p);
    if path.is_absolute() {
        return p.to_string();
    }
    match datadir {
        Some(d) => std::path::Path::new(d)
            .join(p)
            .to_string_lossy()
            .into_owned(),
        None => p.to_string(),
    }
}

async fn build_log_config(pool: &MySqlPool) -> AppResult<LogConfig> {
    let datadir = get_var(pool, "datadir").await?;
    let log_output = get_var(pool, "log_output").await?.unwrap_or_else(|| "FILE".into());
    let log_error = get_var(pool, "log_error").await?;
    let slow_file = get_var(pool, "slow_query_log_file").await?;
    let slow_on = is_on(get_var(pool, "slow_query_log").await?);
    let general_file = get_var(pool, "general_log_file").await?;
    let general_on = is_on(get_var(pool, "general_log").await?);

    let dref = datadir.as_deref();
    /* An empty or "stderr" log_error means the error log is the Windows Event Log. */
    let (error_log, error_to_eventlog) = match log_error.as_deref() {
        None | Some("") | Some("stderr") => (None, true),
        Some(p) => (Some(resolve_path(dref, p)), false),
    };
    let slow_log_file = slow_file.map(|p| resolve_path(dref, &p));
    let general_log_file = general_file.map(|p| resolve_path(dref, &p));

    Ok(LogConfig {
        datadir,
        log_output,
        error_log,
        error_to_eventlog,
        slow_log_file,
        slow_log_enabled: slow_on,
        general_log_file,
        general_log_enabled: general_on,
    })
}

/// Read the last `max_bytes` of a file, tolerating missing/locked files.
async fn read_file_tail(path: &str, max_bytes: u64) -> AppResult<LogTail> {
    use tokio::io::{AsyncReadExt, AsyncSeekExt};
    match tokio::fs::File::open(path).await {
        Ok(mut f) => {
            let len = f.metadata().await?.len();
            let start = len.saturating_sub(max_bytes);
            f.seek(std::io::SeekFrom::Start(start)).await?;
            let mut buf = Vec::new();
            f.read_to_end(&mut buf).await?;
            Ok(LogTail {
                source: "file".into(),
                path: Some(path.to_string()),
                content: String::from_utf8_lossy(&buf).into_owned(),
            })
        }
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => Ok(LogTail {
            source: "missing".into(),
            path: Some(path.to_string()),
            content: String::new(),
        }),
        Err(e) if e.kind() == std::io::ErrorKind::PermissionDenied => Ok(LogTail {
            source: "denied".into(),
            path: Some(path.to_string()),
            content: "Permission denied reading this log file.".into(),
        }),
        Err(e) => Err(e.into()),
    }
}

/// Read recent rows from `mysql.slow_log` / `mysql.general_log` (log_output=TABLE).
async fn read_table_log(pool: &MySqlPool, kind: &str, max_rows: u32) -> AppResult<LogTail> {
    let sql = match kind {
        "slow" => "SELECT start_time, user_host, query_time, sql_text \
                   FROM mysql.slow_log ORDER BY start_time DESC LIMIT ?",
        _ => "SELECT event_time, user_host, command_type, argument \
              FROM mysql.general_log ORDER BY event_time DESC LIMIT ?",
    };
    let rows = sqlx::query(sql).bind(max_rows).fetch_all(pool).await?;
    let mut lines: Vec<String> = rows
        .iter()
        .map(|r| {
            format!(
                "{}  {}  {}\n{}",
                get_string(r, 0),
                get_string(r, 1),
                get_string(r, 2),
                get_string(r, 3)
            )
        })
        .collect();
    lines.reverse();
    Ok(LogTail {
        source: "table".into(),
        path: None,
        content: lines.join("\n\n"),
    })
}

/// Best-effort read of recent MySQL Event Log entries (Windows, empty log_error).
#[cfg(windows)]
fn read_eventlog_tail() -> AppResult<LogTail> {
    let script = "try { Get-WinEvent -ProviderName 'MySQL' -MaxEvents 200 -ErrorAction Stop | \
         Sort-Object TimeCreated | \
         ForEach-Object { \"$($_.TimeCreated)  $($_.Message)\" } | Out-String } catch { '' }";
    let content = powershell_read(script).unwrap_or_default();
    let content = if content.trim().is_empty() {
        "The error log is routed to the Windows Event Log (no MySQL provider events found).".into()
    } else {
        content
    };
    Ok(LogTail {
        source: "eventlog".into(),
        path: None,
        content,
    })
}

fn disabled_tail(message: &str) -> LogTail {
    LogTail {
        source: "disabled".into(),
        path: None,
        content: message.into(),
    }
}

/// Resolved log destinations for the connection (paths, table vs file, enabled).
#[tauri::command]
pub async fn log_config(state: State<'_, AppState>, profile_id: String) -> AppResult<LogConfig> {
    let pool = pool_for(&state, &profile_id).await?;
    build_log_config(&pool).await
}

/**
 * Tail one log (`kind` = "error" | "slow" | "general"). Resolves the right
 * source (file, `mysql.*_log` table, or the Windows Event Log) and returns up to
 * `max_bytes` of the most recent content.
 */
#[tauri::command]
pub async fn read_log_tail(
    state: State<'_, AppState>,
    profile_id: String,
    kind: String,
    max_bytes: u64,
) -> AppResult<LogTail> {
    let pool = pool_for(&state, &profile_id).await?;
    let cfg = build_log_config(&pool).await?;
    let uses_table = cfg.log_output.to_uppercase().contains("TABLE");
    /* ~200 table rows is a comparable amount of context to a byte-bounded file tail. */
    let max_rows = 200u32;

    match kind.as_str() {
        "error" => {
            if cfg.error_to_eventlog {
                #[cfg(windows)]
                {
                    return read_eventlog_tail();
                }
                #[cfg(not(windows))]
                {
                    return Ok(disabled_tail("The error log is not written to a file."));
                }
            }
            match cfg.error_log {
                Some(p) => read_file_tail(&p, max_bytes).await,
                None => Ok(disabled_tail("No error log is configured.")),
            }
        }
        "slow" => {
            if uses_table {
                read_table_log(&pool, "slow", max_rows).await
            } else if !cfg.slow_log_enabled {
                Ok(disabled_tail("The slow query log is disabled."))
            } else if let Some(p) = cfg.slow_log_file {
                read_file_tail(&p, max_bytes).await
            } else {
                Ok(disabled_tail("No slow query log file is configured."))
            }
        }
        "general" => {
            if uses_table {
                read_table_log(&pool, "general", max_rows).await
            } else if !cfg.general_log_enabled {
                Ok(disabled_tail("The general query log is disabled."))
            } else if let Some(p) = cfg.general_log_file {
                read_file_tail(&p, max_bytes).await
            } else {
                Ok(disabled_tail("No general query log file is configured."))
            }
        }
        other => Err(AppError::Other(format!("unknown log kind: {other}"))),
    }
}

/* ----------------------------------------------------------------------------
 * my.ini (option file)
 *
 * MySQL on Windows can read its option file from several locations; the one the
 * running server actually uses is whatever `--defaults-file=` on the service
 * binPath points at, otherwise the first existing file in the standard search
 * order. Reading is unelevated; saving goes through an elevated copy (the file
 * usually lives under ProgramData/Program Files) and keeps a `.bak`.
 * ------------------------------------------------------------------------- */

/// One candidate option-file location and whether it exists on disk.
#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct IniCandidate {
    pub path: String,
    pub exists: bool,
}

/// The resolved (applied) option file plus all candidate locations.
#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct IniResolution {
    pub resolved: Option<String>,
    pub candidates: Vec<IniCandidate>,
}

/// Extract the executable path (first quoted or whitespace-delimited token).
#[cfg(windows)]
fn parse_exe_path(bin_path: &str) -> Option<std::path::PathBuf> {
    let s = bin_path.trim();
    let exe = if let Some(rest) = s.strip_prefix('"') {
        rest.split('"').next()?.to_string()
    } else {
        s.split_whitespace().next()?.to_string()
    };
    Some(std::path::PathBuf::from(exe))
}

/// Build the Windows option-file search order, resolving the applied file.
#[cfg(windows)]
fn resolve_ini() -> AppResult<IniResolution> {
    use std::path::PathBuf;

    let svc = find_service()?;
    let defaults_file = svc.as_ref().and_then(|s| s.defaults_file.clone());

    let mut paths: Vec<PathBuf> = Vec::new();
    /* `--defaults-file` (if set) overrides everything — list it first. */
    if let Some(df) = &defaults_file {
        paths.push(PathBuf::from(df));
    }
    if let Ok(windir) = std::env::var("WINDIR") {
        paths.push(PathBuf::from(&windir).join("my.ini"));
        paths.push(PathBuf::from(&windir).join("my.cnf"));
    }
    let sysdrive = std::env::var("SystemDrive").unwrap_or_else(|_| "C:".into());
    paths.push(PathBuf::from(format!("{sysdrive}\\my.ini")));
    paths.push(PathBuf::from(format!("{sysdrive}\\my.cnf")));
    /* The install dir (basedir) is the grandparent of `…\bin\mysqld.exe`. */
    if let Some(exe) = svc.as_ref().and_then(|s| s.bin_path.as_deref()).and_then(parse_exe_path) {
        if let Some(basedir) = exe.parent().and_then(|p| p.parent()) {
            paths.push(basedir.join("my.ini"));
            paths.push(basedir.join("my.cnf"));
        }
    }

    let mut seen = std::collections::HashSet::new();
    let mut candidates = Vec::new();
    for p in paths {
        let s = p.to_string_lossy().into_owned();
        if !seen.insert(s.clone()) {
            continue;
        }
        candidates.push(IniCandidate {
            exists: p.exists(),
            path: s,
        });
    }

    /* Resolved = the explicit defaults-file, else the first existing candidate. */
    let resolved = defaults_file
        .filter(|df| std::path::Path::new(df).exists())
        .or_else(|| {
            candidates
                .iter()
                .find(|c| c.exists)
                .map(|c| c.path.clone())
        });

    Ok(IniResolution {
        resolved,
        candidates,
    })
}

/// Resolve which option file the local server uses, plus all candidates.
#[tauri::command]
pub async fn resolve_my_ini(profile_id: String) -> AppResult<IniResolution> {
    let _ = &profile_id;
    #[cfg(windows)]
    {
        resolve_ini()
    }
    #[cfg(not(windows))]
    {
        Err(AppError::Other(
            "Server administration is only available on Windows".into(),
        ))
    }
}

/// Read an option file's text (unelevated; most are world-readable).
#[tauri::command]
pub async fn read_my_ini(path: String) -> AppResult<String> {
    match tokio::fs::read_to_string(&path).await {
        Ok(s) => Ok(s),
        Err(e) if e.kind() == std::io::ErrorKind::PermissionDenied => Err(AppError::Other(
            "Permission denied reading the option file.".into(),
        )),
        Err(e) => Err(e.into()),
    }
}

/**
 * Save an option file (elevated). Writes the new text to a temp file unelevated,
 * then raises one UAC prompt to back up the original to `<path>.bak` and copy the
 * temp over it. The server must be restarted for changes to take effect.
 */
#[tauri::command]
pub async fn save_my_ini(path: String, content: String) -> AppResult<()> {
    #[cfg(windows)]
    {
        let tmp = std::env::temp_dir().join(format!("dbsage_myini_{}.tmp", uuid::Uuid::new_v4()));
        tokio::fs::write(&tmp, content.as_bytes()).await?;
        let tmp_s = tmp.to_string_lossy().into_owned();
        let result = run_elevated_cmd(&format!(
            "copy /Y \"{path}\" \"{path}.bak\" & copy /Y \"{tmp_s}\" \"{path}\""
        ));
        let _ = tokio::fs::remove_file(&tmp).await;
        result
    }
    #[cfg(not(windows))]
    {
        let _ = (path, content);
        Err(AppError::Other(
            "Server administration is only available on Windows".into(),
        ))
    }
}
