use crate::error::AppResult;
use crate::state::AppState;
use serde_json::{json, Value};
use std::sync::atomic::Ordering;
use tauri::{
    AppHandle, LogicalPosition, LogicalSize, Manager, PhysicalPosition, PhysicalSize, State,
    WebviewUrl, WebviewWindowBuilder, WindowEvent,
};

/**
 * Secondary-window plumbing for tear-off tabs and independent peek windows.
 *
 * Every window loads the same SPA bundle and learns its role from its label
 * (`tab-<n>`, `peek-<n>`) — see `src/main.tsx`. The spawning window can't pass
 * props across the JS-context boundary, so it stashes a seed payload here keyed
 * by the new window's label; the window pulls it on mount via `take_window_seed`.
 * Connection pools live in the shared `AppState`, so these windows reuse the
 * main window's open connections with no reconnection.
 */

/// SPA url for a secondary window: the Vite dev server under `tauri dev` (where
/// `WebviewUrl::App` would resolve against the asset protocol and load blank),
/// the bundled assets in release. Mirrors `open_monitor_window`.
fn app_url(app: &AppHandle) -> WebviewUrl {
    match (cfg!(debug_assertions), app.config().build.dev_url.clone()) {
        (true, Some(dev)) => WebviewUrl::External(dev),
        _ => WebviewUrl::App("index.html".into()),
    }
}

fn next_label(state: &AppState, prefix: &str) -> String {
    let n = state.window_counter.fetch_add(1, Ordering::Relaxed);
    format!("{prefix}-{n}")
}

/// Read the seed payload stashed for `label`. Non-destructive so a window that
/// reloads (HMR in dev, or any webview reload) re-seeds correctly instead of
/// coming up empty; the entry is removed when the window is destroyed.
#[tauri::command]
pub fn read_window_seed(state: State<'_, AppState>, label: String) -> Option<Value> {
    state.window_seeds.lock().unwrap().get(&label).cloned()
}

/// Open a torn-off tab in its own window at the given screen position (CSS px).
/// `seed` is the serialized `Tab`; the window seeds its store with it.
#[tauri::command]
pub async fn open_tab_window(
    app: AppHandle,
    state: State<'_, AppState>,
    seed: Value,
    title: String,
    x: f64,
    y: f64,
    width: f64,
    height: f64,
) -> AppResult<()> {
    let label = next_label(&state, "tab");
    state
        .window_seeds
        .lock()
        .unwrap()
        .insert(label.clone(), seed);
    let win = WebviewWindowBuilder::new(&app, &label, app_url(&app))
        /* Title is composed by the caller as "content — type — DB Sage". */
        .title(title)
        .min_inner_size(480.0, 320.0)
        .decorations(false)
        /* Start hidden so the webview's white default background never flashes;
           the window reveals itself once React has painted (see TornTabWindow). */
        .visible(false)
        .build()?;
    /* Set geometry after build so the window-state plugin's restore (which runs
       during build for the reused label) can't override where we want it. */
    let _ = win.set_size(LogicalSize::new(width, height));
    let _ = win.set_position(LogicalPosition::new(x, y));
    let on_close = app.clone();
    let lbl = label.clone();
    win.on_window_event(move |event| {
        if matches!(event, WindowEvent::Destroyed) {
            if let Some(state) = on_close.try_state::<AppState>() {
                state.window_seeds.lock().unwrap().remove(&lbl);
            }
        }
    });
    Ok(())
}

/// A peek's identity: everything but the match value. Two peeks with the same
/// source and target are the same window — the value live-follows the source
/// selection, so it never distinguishes them.
fn peek_identity(v: &Value) -> Option<[String; 6]> {
    let o = v.as_object()?;
    let s = |k: &str| Some(o.get(k)?.as_str()?.to_string());
    let t = |k: &str| Some(o.get("target")?.get(k)?.as_str()?.to_string());
    Some([
        s("profileId")?,
        s("database")?,
        s("sourceTable")?,
        s("sourceColumn")?,
        t("table")?,
        t("column")?,
    ])
}

/// Open an independent peek window at the given screen position (CSS px). `seed`
/// is the peek descriptor (`{ profileId, profileName, database, target,
/// sourceTable, sourceColumn }`). Registered in `AppState.peeks` until closed.
/// If an identical peek is already open it is focused instead of duplicated.
#[tauri::command]
pub async fn open_peek_window(
    app: AppHandle,
    state: State<'_, AppState>,
    seed: Value,
    x: f64,
    y: f64,
    width: f64,
    height: f64,
) -> AppResult<()> {
    if let Some(key) = peek_identity(&seed) {
        let existing = state
            .peeks
            .lock()
            .unwrap()
            .iter()
            .find_map(|(label, desc)| {
                (peek_identity(desc).as_ref() == Some(&key)).then(|| label.clone())
            });
        if let Some(label) = existing {
            if let Some(win) = app.get_webview_window(&label) {
                let _ = win.unminimize();
                let _ = win.set_focus();
                return Ok(());
            }
        }
    }
    let label = next_label(&state, "peek");
    state
        .window_seeds
        .lock()
        .unwrap()
        .insert(label.clone(), seed.clone());
    state.peeks.lock().unwrap().insert(label.clone(), seed);
    let builder = WebviewWindowBuilder::new(&app, &label, app_url(&app))
        .title("DB Sage")
        .min_inner_size(360.0, 120.0)
        .decorations(false)
        /* Hidden until painted, to avoid a white flash (revealed by PeekWindow). */
        .visible(false);
    /* A peek is OWNED by the main window: Windows keeps an owned window above
       its owner in the z-order, so the peek stays visible while you work in the
       table it was launched from — without being topmost over other apps (the
       old always_on_top approach). Owned windows also hide when the owner is
       minimized and close with it. */
    #[cfg(windows)]
    let builder = match app.get_webview_window("main") {
        Some(main) => builder.owner(&main)?,
        None => builder,
    };
    let win = builder.build()?;
    let _ = win.set_size(LogicalSize::new(width, height));
    let _ = win.set_position(LogicalPosition::new(x, y));
    let on_close = app.clone();
    let lbl = label.clone();
    win.on_window_event(move |event| {
        if matches!(event, WindowEvent::Destroyed) {
            if let Some(state) = on_close.try_state::<AppState>() {
                state.peeks.lock().unwrap().remove(&lbl);
                state.window_seeds.lock().unwrap().remove(&lbl);
            }
        }
    });
    Ok(())
}

/// Every open peek window's descriptor, enriched with its current screen
/// position and size (CSS px) so a saved table view can restore it faithfully.
#[tauri::command]
pub fn list_open_peeks(app: AppHandle, state: State<'_, AppState>) -> Vec<Value> {
    let registry = state.peeks.lock().unwrap().clone();
    let mut out = Vec::new();
    for (label, desc) in registry {
        let Some(win) = app.get_webview_window(&label) else {
            continue;
        };
        let mut obj = desc;
        if let Value::Object(ref mut m) = obj {
            m.insert("label".into(), json!(label));
        }
        if let (Ok(pos), Ok(size), Ok(scale)) =
            (win.outer_position(), win.inner_size(), win.scale_factor())
        {
            if let Value::Object(ref mut m) = obj {
                m.insert("x".into(), json!(pos.x as f64 / scale));
                m.insert("y".into(), json!(pos.y as f64 / scale));
                m.insert("width".into(), json!(size.width as f64 / scale));
                m.insert("height".into(), json!(size.height as f64 / scale));
            }
        }
        out.push(obj);
    }
    out
}

/// Merge a peek window's current view state (hidden columns, Inspector
/// visibility, sort, filters, column widths, JSON display paths) into its
/// registry (and seed) entry, so a saved table view captures the peek exactly
/// as it looks, and a webview reload re-seeds with it. `patch` is an object
/// whose keys overwrite the stored ones. No-op if the peek isn't registered
/// (already closed).
#[tauri::command]
pub fn set_peek_state(state: State<'_, AppState>, label: String, patch: Value) {
    let Value::Object(fields) = patch else {
        return;
    };
    if let Some(Value::Object(m)) = state.peeks.lock().unwrap().get_mut(&label) {
        for (k, v) in &fields {
            m.insert(k.clone(), v.clone());
        }
    }
    if let Some(Value::Object(m)) = state.window_seeds.lock().unwrap().get_mut(&label) {
        for (k, v) in fields {
            m.insert(k, v);
        }
    }
}

/// Open the Help library in its own window (or focus it if already open), so
/// it can stay beside the app while the user works. Labelled `help`; the SPA
/// renders the Help view for that label.
#[tauri::command]
pub async fn open_help_window(app: AppHandle) -> AppResult<()> {
    let label = "help";
    if let Some(win) = app.get_webview_window(label) {
        let _ = win.set_focus();
        return Ok(());
    }
    WebviewWindowBuilder::new(&app, label, app_url(&app))
        .title("DB Sage — Help")
        .inner_size(1400.0, 860.0)
        .min_inner_size(760.0, 480.0)
        .decorations(false)
        .build()?;
    Ok(())
}

/// Publish the main window's tab-strip rectangle (screen CSS px) so a dragging
/// tab-window can hit-test it for re-docking. `rect` is `{ left, top, right,
/// bottom }` or `null` to clear.
#[tauri::command]
pub fn set_tabstrip_rect(state: State<'_, AppState>, rect: Option<Value>) {
    *state.tabstrip_rect.lock().unwrap() = rect;
}

/// Close every open peek window at once. Driven from a peek's titlebar; each
/// window's Destroyed handler cleans up its own registry entry.
#[tauri::command]
pub fn close_all_peeks(app: AppHandle, state: State<'_, AppState>) {
    let labels: Vec<String> = state.peeks.lock().unwrap().keys().cloned().collect();
    for label in labels {
        if let Some(win) = app.get_webview_window(&label) {
            let _ = win.close();
        }
    }
}

/// Arrange every open peek window in neat columns beside the main window.
/// The first column starts 10px right of the main window's visible edge. Each
/// column spans exactly the main window's height: the first peek's top matches
/// the main window's top, the last peek's bottom matches its bottom, and the
/// heights in between are shared evenly with 10px gaps. Widths are never
/// changed. Peeks stack in opening order; when one column would squeeze peeks
/// below `MIN_H`, they are split evenly across more columns, each new column
/// starting 10px right of the widest peek in the previous one. Math is in
/// physical pixels of the main window's monitor; positions are corrected for
/// each window's invisible resize frame so visible edges line up.
#[tauri::command]
pub fn arrange_peeks(app: AppHandle, state: State<'_, AppState>) {
    const GAP: i32 = 10;
    const MIN_H: i32 = 120;

    let Some(main) = app.get_webview_window("main") else {
        return;
    };
    let (Ok(main_pos), Ok(main_size)) = (main.inner_position(), main.inner_size()) else {
        return;
    };
    let top = main_pos.y;
    let main_h = main_size.height as i32;
    let start_x = main_pos.x + main_size.width as i32 + GAP;

    /* Peeks in opening order (labels are `peek-<n>`). */
    let mut labels: Vec<String> = state.peeks.lock().unwrap().keys().cloned().collect();
    labels.retain(|l| app.get_webview_window(l).is_some());
    labels.sort_by_key(|l| {
        l.rsplit('-')
            .next()
            .and_then(|n| n.parse::<u64>().ok())
            .unwrap_or(u64::MAX)
    });
    let n = labels.len() as i32;
    if n == 0 {
        return;
    }

    /* How many peeks fit one column at MIN_H, then split evenly across
       columns (earlier columns take the remainder). */
    let per_col = ((main_h + GAP) / (MIN_H + GAP)).clamp(1, n);
    let cols = (n + per_col - 1) / per_col;
    let base_rows = n / cols;
    let extra = n % cols;

    let mut next = 0usize;
    let mut col_x = start_x;
    for c in 0..cols {
        let rows = base_rows + if c < extra { 1 } else { 0 };
        /* Share the main window's height evenly; the first rows absorb the
           rounding remainder so the last bottom lands exactly on main's. */
        let avail = main_h - GAP * (rows - 1);
        let base_h = avail / rows;
        let rem = avail % rows;
        let mut y = top;
        let mut col_width = 0;
        for r in 0..rows {
            let label = &labels[next];
            next += 1;
            let Some(win) = app.get_webview_window(label) else {
                continue;
            };
            let _ = win.unminimize();
            if win.is_maximized().unwrap_or(false) {
                let _ = win.unmaximize();
            }
            let h = base_h + if r < rem { 1 } else { 0 };
            let w = win.inner_size().map(|s| s.width as i32).unwrap_or(0);
            /* set_position moves the outer (frame) rect; we want the visible
               client rect at (col_x, y), so subtract the frame inset. */
            let (fx, fy) = match (win.outer_position(), win.inner_position()) {
                (Ok(o), Ok(i)) => (i.x - o.x, i.y - o.y),
                _ => (0, 0),
            };
            let _ = win.set_position(PhysicalPosition::new(col_x - fx, y - fy));
            let _ = win.set_size(PhysicalSize::new(w as u32, h as u32));
            col_width = col_width.max(w);
            y += h + GAP;
        }
        col_x += col_width + GAP;
    }
}

/// Close the named peek windows (e.g. those launched from a table whose tab
/// is closing). Unknown labels are ignored.
#[tauri::command]
pub fn close_peeks(app: AppHandle, labels: Vec<String>) {
    for label in labels {
        if let Some(win) = app.get_webview_window(&label) {
            let _ = win.close();
        }
    }
}

/// The last-published tab-strip rectangle, fetched once by a tab-window at the
/// start of a drag.
#[tauri::command]
pub fn get_tabstrip_rect(state: State<'_, AppState>) -> Option<Value> {
    state.tabstrip_rect.lock().unwrap().clone()
}

/// Whether the primary (left) mouse button is currently held. A torn-off window
/// being dragged natively can't see the `mouseup` (the OS move loop swallows
/// it), so it polls this to learn when the drag is released and finalize a dock.
#[tauri::command]
pub fn mouse_left_button_down() -> bool {
    #[cfg(windows)]
    {
        /* High-order bit of GetAsyncKeyState(VK_LBUTTON) is set while down. */
        unsafe { (GetAsyncKeyState(0x01) as u16 & 0x8000) != 0 }
    }
    #[cfg(not(windows))]
    {
        false
    }
}

/// Current mouse-cursor position in physical screen pixels, straight from the
/// OS. WebView2 drops the DOM `mouseleave` when the pointer flicks out of the
/// window fast (no exit sample lands inside the page), so titlebar hover state
/// is cleared by polling this against the window's client rect instead — the OS
/// always knows where the cursor really is, independent of event sampling.
#[tauri::command]
pub fn cursor_position() -> (i32, i32) {
    #[cfg(windows)]
    {
        let mut p = POINT { x: 0, y: 0 };
        unsafe {
            GetCursorPos(&mut p);
        }
        (p.x, p.y)
    }
    #[cfg(not(windows))]
    {
        (0, 0)
    }
}

#[cfg(windows)]
#[repr(C)]
struct POINT {
    x: i32,
    y: i32,
}

#[cfg(windows)]
#[link(name = "user32")]
extern "system" {
    fn GetAsyncKeyState(v_key: i32) -> i16;
    fn GetCursorPos(lp_point: *mut POINT) -> i32;
}
