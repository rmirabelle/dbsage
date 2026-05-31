use crate::db::mysql::get_string;
use crate::error::{AppError, AppResult};
use crate::state::AppState;
use crate::store::monitor_history as history;
use serde::Serialize;
use sqlx::mysql::MySqlRow;
use sqlx::{Executor, MySqlPool, Row};
use std::collections::BTreeMap;
use std::time::Duration;
use tauri::{AppHandle, Manager, State, WebviewUrl, WebviewWindowBuilder, WindowEvent};

/// Background sampling cadence for persisted history (coarser than the live view).
const SAMPLE_INTERVAL_SECS: u64 = 15;

async fn pool_for(state: &State<'_, AppState>, profile_id: &str) -> AppResult<MySqlPool> {
    let pools = state.pools.read().await;
    pools
        .get(profile_id)
        .cloned()
        .ok_or_else(|| AppError::NotConnected(profile_id.to_string()))
}

/// A column value as a string, or None when SQL NULL. Tolerates binary
/// collations (INFORMATION_SCHEMA text columns sometimes arrive as bytes).
fn opt_string(row: &MySqlRow, i: usize) -> Option<String> {
    if let Ok(s) = row.try_get::<Option<String>, _>(i) {
        return s;
    }
    if let Ok(b) = row.try_get::<Option<Vec<u8>>, _>(i) {
        return b.map(|b| String::from_utf8_lossy(&b).into_owned());
    }
    None
}

/// One server thread/connection, as shown in the Activity view.
#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ProcessRow {
    pub id: u64,
    pub user: Option<String>,
    pub host: Option<String>,
    pub db: Option<String>,
    pub command: Option<String>,
    /// Seconds the thread has been in its current state.
    pub time: i64,
    pub state: Option<String>,
    /// The statement the thread is running (NULL when idle).
    pub info: Option<String>,
}

/// The live process list (all server threads), busiest first.
#[tauri::command]
pub async fn list_processes(
    state: State<'_, AppState>,
    profile_id: String,
) -> AppResult<Vec<ProcessRow>> {
    let pool = pool_for(&state, &profile_id).await?;
    /* SHOW FULL PROCESSLIST (not information_schema.PROCESSLIST) so the INFO
       column carries the full statement text — the server truncates it for the
       non-FULL variants, which clipped long queries in the Inspector. It runs
       over the simple query protocol (numeric columns arrive as text), and SHOW
       takes no ORDER BY, so we sort busiest-first here. Column order matches the
       old query: Id, User, Host, db, Command, Time, State, Info. */
    let rows = pool.fetch_all("SHOW FULL PROCESSLIST").await?;
    let mut out: Vec<ProcessRow> = rows
        .iter()
        .map(|r| ProcessRow {
            id: opt_string(r, 0).and_then(|s| s.parse().ok()).unwrap_or(0),
            user: opt_string(r, 1),
            host: opt_string(r, 2),
            db: opt_string(r, 3),
            command: opt_string(r, 4),
            time: opt_string(r, 5).and_then(|s| s.parse().ok()).unwrap_or(0),
            state: opt_string(r, 6),
            info: opt_string(r, 7),
        })
        .collect();
    out.sort_by(|a, b| b.time.cmp(&a.time));
    Ok(out)
}

/// True when a connection host points at this machine (mirrors the frontend's
/// `isLocalHost`), so host CPU only gets reported for a server we're running on.
fn is_local_host(host: &str) -> bool {
    matches!(
        host.trim().to_ascii_lowercase().as_str(),
        "localhost" | "127.0.0.1" | "::1" | ""
    )
}

/// Overall host CPU usage (%), measured as the delta since the previous call.
/// The `System` persists across calls so each reading reflects usage over the
/// poll interval; the first reading after startup is ~0.
fn host_cpu_percent() -> f64 {
    use once_cell::sync::Lazy;
    use std::sync::Mutex;
    static SYS: Lazy<Mutex<sysinfo::System>> = Lazy::new(|| Mutex::new(sysinfo::System::new()));
    let mut sys = SYS.lock().unwrap();
    sys.refresh_cpu_usage();
    sys.global_cpu_usage() as f64
}

/// Host/server resource usage for the vitals strip: MySQL's own allocated memory
/// (always, from performance_schema) and host CPU (only for a local server).
#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ServerResources {
    /// Bytes currently allocated by the server, or None when performance_schema
    /// memory instrumentation is unavailable.
    pub memory_bytes: Option<u64>,
    /// Host CPU usage (%), or None for a remote server (can't be read over SQL).
    pub cpu_percent: Option<f64>,
}

#[tauri::command]
pub async fn server_resources(
    app: AppHandle,
    state: State<'_, AppState>,
    profile_id: String,
) -> AppResult<ServerResources> {
    let pool = pool_for(&state, &profile_id).await?;
    /* CAST to CHAR so the SUM comes back as a text column `opt_string` can read
       (it only decodes String/Vec<u8> — an integer-typed column reads as None
       over the simple protocol). NULL (instrumentation off) → None, and a failed
       query (no performance_schema) is swallowed to None rather than erroring. */
    let memory_bytes = match pool
        .fetch_all(
            "SELECT CAST(SUM(CURRENT_NUMBER_OF_BYTES_USED) AS CHAR) \
             FROM performance_schema.memory_summary_global_by_event_name",
        )
        .await
    {
        Ok(rows) => rows
            .first()
            .and_then(|r| opt_string(r, 0))
            .and_then(|s| s.parse::<u64>().ok()),
        Err(_) => None,
    };

    let host = crate::store::profiles::get(&app, &profile_id)?.host;
    let cpu_percent = is_local_host(&host).then(host_cpu_percent);

    Ok(ServerResources {
        memory_bytes,
        cpu_percent,
    })
}

/// `SHOW GLOBAL STATUS` as a name→value map. The frontend picks the counters it
/// needs and diffs successive samples to derive rates (QPS, throughput, …).
/// Uses the simple query protocol (some SHOW forms reject the prepared one).
#[tauri::command]
pub async fn global_status(
    state: State<'_, AppState>,
    profile_id: String,
) -> AppResult<BTreeMap<String, String>> {
    let pool = pool_for(&state, &profile_id).await?;
    let rows = pool.fetch_all("SHOW GLOBAL STATUS").await?;
    Ok(rows
        .iter()
        .map(|r| (get_string(r, 0), get_string(r, 1)))
        .collect())
}

/// `SHOW GLOBAL VARIABLES` as a name→value map. Used for configuration the UI
/// surfaces (e.g. `long_query_time`, the slow-query threshold). Simple query
/// protocol, like `global_status`.
#[tauri::command]
pub async fn global_variables(
    state: State<'_, AppState>,
    profile_id: String,
) -> AppResult<BTreeMap<String, String>> {
    let pool = pool_for(&state, &profile_id).await?;
    let rows = pool.fetch_all("SHOW GLOBAL VARIABLES").await?;
    Ok(rows
        .iter()
        .map(|r| (get_string(r, 0), get_string(r, 1)))
        .collect())
}

/// Kill a thread's running statement (`query_only`) or its whole connection.
/// `id` is numeric, so interpolating it is injection-safe.
#[tauri::command]
pub async fn kill_process(
    state: State<'_, AppState>,
    profile_id: String,
    id: u64,
    query_only: bool,
) -> AppResult<()> {
    let pool = pool_for(&state, &profile_id).await?;
    let sql = if query_only {
        format!("KILL QUERY {id}")
    } else {
        format!("KILL {id}")
    };
    pool.execute(sql.as_str()).await?;
    Ok(())
}

/// Open (or focus) a standalone Monitoring window for a connection, so it can
/// stay up alongside the main window. One window per connection (keyed by the
/// profile id, which is a URL-safe UUID). MUST be async: a synchronous command
/// runs on the main thread, and `WebviewWindowBuilder::build()` needs the main
/// event loop to make progress — calling it from the main thread deadlocks
/// (a bare white window appears and the whole app freezes). The window shares
/// the app's connection pools via AppState.
#[tauri::command]
pub async fn open_monitor_window(app: AppHandle, profile_id: String) -> AppResult<()> {
    let label = format!("monitor-{profile_id}");
    if let Some(win) = app.get_webview_window(&label) {
        let _ = win.set_focus();
        return Ok(());
    }
    /* The window loads the same SPA as the main window and learns its role from
       its label (`monitor-<id>`) — no query string, since `WebviewUrl::App` is a
       file path and a `?…` suffix would be treated as part of the filename.
       In `tauri dev`, `WebviewUrl::App` resolves against the production asset
       protocol (not the Vite dev server), so a runtime window would load blank;
       point it at the dev server URL instead. Release builds use the bundled
       assets via `App`. */
    let monitor_url = match (cfg!(debug_assertions), app.config().build.dev_url.clone()) {
        (true, Some(dev)) => WebviewUrl::External(dev),
        _ => WebviewUrl::App("index.html".into()),
    };
    let win = WebviewWindowBuilder::new(&app, &label, monitor_url)
        .title("DB Sage — Monitor")
        .inner_size(1100.0, 720.0)
        .min_inner_size(720.0, 460.0)
        .decorations(false)
        .build()?;

    /* Begin persisting this connection's history, and stop when the monitor
       window is closed (its own X = "stop monitoring this connection"). Hiding
       to tray leaves the window alive, so sampling continues. */
    start_sampler(&app, profile_id.clone());
    let on_close = app.clone();
    win.on_window_event(move |event| {
        if matches!(event, WindowEvent::Destroyed) {
            stop_sampler(&on_close, &profile_id);
        }
    });
    Ok(())
}

/// One history sample for a connection: snapshot the tracked status counters.
async fn sample_once(app: &AppHandle, profile_id: &str) {
    let pool = {
        let state = app.state::<AppState>();
        let pools = state.pools.read().await;
        pools.get(profile_id).cloned()
    };
    let Some(pool) = pool else { return };
    if let Ok(rows) = pool.fetch_all("SHOW GLOBAL STATUS").await {
        let status: BTreeMap<String, String> = rows
            .iter()
            .map(|r| (get_string(r, 0), get_string(r, 1)))
            .collect();
        let _ = history::insert(app, profile_id, &status).await;
    }
}

/// Spawn a background sampler for a connection (idempotent — one per profile).
fn start_sampler(app: &AppHandle, profile_id: String) {
    let state = app.state::<AppState>();
    {
        let samplers = state.samplers.lock().unwrap();
        if samplers.contains_key(&profile_id) {
            return;
        }
    }
    let task_app = app.clone();
    let task_pid = profile_id.clone();
    let handle = tokio::spawn(async move {
        loop {
            sample_once(&task_app, &task_pid).await;
            tokio::time::sleep(Duration::from_secs(SAMPLE_INTERVAL_SECS)).await;
        }
    });
    state
        .samplers
        .lock()
        .unwrap()
        .insert(profile_id, handle.abort_handle());
}

/// Abort and forget a connection's sampler, if running.
fn stop_sampler(app: &AppHandle, profile_id: &str) {
    if let Some(handle) = app
        .state::<AppState>()
        .samplers
        .lock()
        .unwrap()
        .remove(profile_id)
    {
        handle.abort();
    }
}

/// Persisted history samples for a connection going back `since_secs` seconds.
#[tauri::command]
pub async fn monitor_history(
    app: AppHandle,
    profile_id: String,
    since_secs: i64,
) -> AppResult<Vec<history::Sample>> {
    let since_ts = chrono::Utc::now().timestamp() - since_secs;
    history::query(&app, &profile_id, since_ts).await
}
