use crate::error::AppResult;
use crate::state::AppState;
use serde_json::{json, Value};
use std::sync::atomic::Ordering;
use tauri::{
    AppHandle, LogicalPosition, LogicalSize, Manager, State, WebviewUrl, WebviewWindowBuilder,
    WindowEvent,
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

/// Open an independent peek window at the given screen position (CSS px). `seed`
/// is the peek descriptor (`{ profileId, profileName, database, target,
/// sourceTable, sourceColumn }`). Registered in `AppState.peeks` until closed.
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
    let label = next_label(&state, "peek");
    state
        .window_seeds
        .lock()
        .unwrap()
        .insert(label.clone(), seed.clone());
    state.peeks.lock().unwrap().insert(label.clone(), seed);
    let win = WebviewWindowBuilder::new(&app, &label, app_url(&app))
        .title("DB Sage")
        .min_inner_size(360.0, 200.0)
        .decorations(false)
        /* A peek floats above the main window so it stays visible while you work
           in the table it was launched from. */
        .always_on_top(true)
        /* Hidden until painted, to avoid a white flash (revealed by PeekWindow). */
        .visible(false)
        .build()?;
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

/// Record a peek window's current hidden-column set into its registry (and seed)
/// entry, so a saved table view captures the peek's column visibility alongside
/// its geometry, and a webview reload re-seeds with it. No-op if the peek isn't
/// registered (already closed).
#[tauri::command]
pub fn set_peek_columns(state: State<'_, AppState>, label: String, hidden_columns: Vec<String>) {
    if let Some(Value::Object(m)) = state.peeks.lock().unwrap().get_mut(&label) {
        m.insert("hiddenColumns".into(), json!(hidden_columns));
    }
    if let Some(Value::Object(m)) = state.window_seeds.lock().unwrap().get_mut(&label) {
        m.insert("hiddenColumns".into(), json!(hidden_columns));
    }
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
