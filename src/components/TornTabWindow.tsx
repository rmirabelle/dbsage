import { useEffect, useState } from "react";
import {
  Table as Table2,
  Database,
  ShareNetwork,
  Code,
  ArrowSquareIn,
} from "@phosphor-icons/react";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { emitTo } from "@tauri-apps/api/event";
import { ipc } from "../ipc";
import { revealWindow } from "../lib/revealWindow";
import { setWindowGlyphIcon, GLYPHS, type Glyph } from "../lib/windowIcon";
import { useStore, isQueryTabDirty } from "../state/store";
import { useUi } from "../state/ui";
import { useZoomShortcuts } from "../hooks/useZoomShortcuts";
import { TabBody, tabTitle } from "./Tabs";
import { TabDndProvider } from "./TabDndProvider";
import { WindowControls } from "./WindowControls";
import { UnsavedChangesModal } from "./UnsavedChangesModal";
import { Toaster } from "./Toaster";
import { CopyProgress } from "./CopyProgress";
import { SqlExportProgress } from "./SqlExportProgress";
import type { Tab } from "../types";

/** The main window's tab-strip rectangle in screen CSS pixels. */
interface ScreenRect {
  left: number;
  top: number;
  right: number;
  bottom: number;
}

const inRect = (x: number, y: number, r: ScreenRect | null) =>
  !!r && x >= r.left && x <= r.right && y >= r.top && y <= r.bottom;

/** Tears down the in-flight drag watch (move listener + mouseup handler). */
let cancelWatch: (() => void) | null = null;

/** Set true right before a close that must skip the unsaved-changes guard — a
 * dock hand-off (the tab moves to the main window, nothing is lost) or a
 * confirmed discard. Per-window: each torn window is its own JS context. */
let bypassCloseGuard = false;

/**
 * While a window drag is in progress, watch whether the titlebar is over the
 * main window's tab bar — highlighting it and, on release there, handing the tab
 * back so the main window re-docks it (this window then closes). This only
 * *observes* the drag; initiation is native (`data-tauri-drag-region` for a
 * titlebar press, or `startDragging` to continue a tear-off), so it never gates
 * on IPC and the drag always starts on the first press.
 */
async function armDockWatch() {
  cancelWatch?.();
  const win = getCurrentWindow();
  const p = { scale: 1, w: 0, rect: null as ScreenRect | null };
  let lastInside = false;
  let unMoved: (() => void) | null = null;
  let done = false;

  const cleanup = () => {
    if (done) return;
    done = true;
    window.removeEventListener("mouseup", onUp);
    unMoved?.();
    if (cancelWatch === cleanup) cancelWatch = null;
  };
  const onUp = () => {
    const wasInside = lastInside;
    cleanup();
    if (wasInside) {
      const st = useStore.getState();
      const docked = st.tabs.find((t) => t.id === st.activeTabId);
      if (docked) {
        emitTo("main", "dbsage://dock-tab", docked)
          .then(() => {
            bypassCloseGuard = true;
            win.close();
          })
          .catch(() => {});
        return;
      }
    }
    emitTo("main", "dbsage://tab-dock-hint", { active: false }).catch(() => {});
  };
  cancelWatch = cleanup;
  /* The native move loop swallows `mouseup`, so poll the real button state to
     learn when the drag is released; the `mouseup` listener is a fast-path for
     the rare case it does arrive. */
  window.addEventListener("mouseup", onUp);
  const poll = async () => {
    if (done) return;
    let held = true;
    try {
      held = await ipc.mouseLeftButtonDown();
    } catch {
      /* if we can't tell, assume still held and keep polling */
    }
    if (done) return;
    if (!held) onUp();
    else setTimeout(poll, 30);
  };
  setTimeout(poll, 60);

  /* Params for hit-testing the titlebar's middle against the bar; best-effort. */
  Promise.all([win.scaleFactor(), win.innerSize(), ipc.getTabstripRect<ScreenRect>()])
    .then(([s, size, r]) => {
      p.scale = s;
      p.w = size.width / s;
      p.rect = r;
    })
    .catch(() => {});

  unMoved = await win.onMoved(({ payload }) => {
    if (!p.rect) return;
    const now = inRect(payload.x / p.scale + p.w / 2, payload.y / p.scale + 18, p.rect);
    if (now !== lastInside) {
      lastInside = now;
      emitTo("main", "dbsage://tab-dock-hint", { active: now }).catch(() => {});
    }
  });
}

/**
 * Standalone window host for a tab torn off the main window's tab bar. The
 * serialized `Tab` is handed over via `take_window_seed`; we seed this window's
 * own store with it and render through the same `TabBody` the main window uses,
 * so the grid/query/designer all work unchanged. Connection pools live in the
 * shared Rust backend, so it reuses the main window's open connection.
 */
export function TornTabWindow({ label }: { label: string }) {
  const [missing, setMissing] = useState(false);
  const [confirmClose, setConfirmClose] = useState(false);
  const tabs = useStore((s) => s.tabs);
  const activeTabId = useStore((s) => s.activeTabId);
  const active = tabs.find((t) => t.id === activeTabId) ?? null;
  const title = active ? tabTitle(active) : null;
  const tabsZoom = useUi((s) => s.tabsZoom);

  /* Guard the OS close: a dirty query window confirms before discarding its
     edits. Dock hand-offs and a confirmed discard set `bypassCloseGuard` so they
     pass straight through. */
  useEffect(() => {
    const un = getCurrentWindow().onCloseRequested((event) => {
      if (bypassCloseGuard) return;
      const st = useStore.getState();
      const t = st.tabs.find((x) => x.id === st.activeTabId);
      if (t && t.kind === "query" && isQueryTabDirty(t)) {
        event.preventDefault();
        setConfirmClose(true);
      }
    });
    return () => {
      un.then((f) => f());
    };
  }, []);

  /* Ctrl+wheel / Ctrl+= zoom works here too, driving the shared tabs zoom. */
  useZoomShortcuts();

  /* Taskbar/window title reads "{content} - DB Sage"; tracks renames (query /
     designer) since it's keyed on the live tab title. */
  useEffect(() => {
    if (title) getCurrentWindow().setTitle(`${title} - DB Sage`).catch(() => {});
  }, [title]);

  useEffect(() => {
    ipc
      .readWindowSeed<Tab>(label)
      .then(async (seed) => {
        if (!seed) {
          setMissing(true);
          await revealWindow();
          return;
        }
        useStore.setState({ tabs: [seed], activeTabId: seed.id });
        /* Query tabs offer a connection switcher (needs the profile list) and a
           database dropdown (needs the connection's tree). connectProfile is
           idempotent — the Rust pool is already open and shared — and populates
           both `connections` and `trees[profileId].databases`. */
        useStore.getState().loadProfiles().catch(() => {});
        useStore.getState().connectProfile(seed.profileId).catch(() => {});
        const glyph = glyphForKind(seed.kind);
        if (glyph) setWindowGlyphIcon(glyph);
        await revealWindow();
      })
      .catch(async () => {
        setMissing(true);
        await revealWindow();
      });
  }, [label]);

  return (
    <div className="h-screen flex flex-col bg-zinc-950 text-zinc-200 overflow-hidden">
      <TornTabTitleBar tab={active} />
      {/* The tab body zooms with the shared tabs zoom, same as the main
          window's tabs pane; the titlebar above is chrome and stays fixed. */}
      <div
        className="flex-1 min-h-0 flex flex-col"
        style={tabsZoom !== 1 ? { zoom: tabsZoom } : undefined}
      >
        {active ? (
          <TabDndProvider>
            <TabBody tab={active} />
          </TabDndProvider>
        ) : (
          <div className="flex-1 flex items-center justify-center text-zinc-500 text-xs">
            {missing ? "This tab is no longer available." : "Loading…"}
          </div>
        )}
      </div>
      <Toaster />
      <SqlExportProgress />
      <CopyProgress />
      {confirmClose && (
        <UnsavedChangesModal
          message={
            <p>
              This query has unsaved changes. Close the window without saving
              them?
            </p>
          }
          discardLabel="Close Without Saving"
          onCancel={() => setConfirmClose(false)}
          onDiscard={() => {
            bypassCloseGuard = true;
            getCurrentWindow().close();
          }}
        />
      )}
    </div>
  );
}

function TornTabTitleBar({ tab }: { tab: Tab | null }) {
  const { Icon, color } = tabChrome(tab);

  /* `data-tauri-drag-region` starts the native window drag synchronously in the
     webview's own mousedown handler (no IPC round-trip — so it grabs on the
     first press); the pointerdown only arms the JS dock-detection watcher. */
  const onPointerDown = (e: React.PointerEvent) => {
    if (e.button !== 0) return;
    if ((e.target as HTMLElement).closest("button")) return;
    armDockWatch();
  };

  return (
    <div
      data-el="torn-tab-titlebar"
      data-tauri-drag-region
      onPointerDown={onPointerDown}
      className="h-9 shrink-0 flex items-center justify-between bg-zinc-950 border-b border-zinc-800/80 pl-3 select-none"
    >
      <div
        data-tauri-drag-region
        className="flex items-center gap-2 text-zinc-300 pointer-events-none min-w-0"
      >
        <Icon size={16} className={`${color} shrink-0`} />
        <span className="text-[13px] font-semibold text-zinc-100 truncate">
          {tab ? tabTitle(tab) : "DB Sage"}
        </span>
        {tab && (
          <span className="text-[10px] text-zinc-500 truncate">
            {tab.profileName} / {tab.database}
          </span>
        )}
      </div>
      <div className="flex items-center shrink-0">
        {tab && (
          <button
            onClick={() => {
              emitTo("main", "dbsage://dock-tab", tab)
                .then(() => {
                  bypassCloseGuard = true;
                  getCurrentWindow().close();
                })
                .catch(() => {});
            }}
            title="Reattach to the main window"
            aria-label="Reattach to the main window"
            className="mr-1 p-1 rounded text-zinc-400 hover:text-accent-300 hover:bg-zinc-800 transition-colors"
          >
            <ArrowSquareIn size={16} />
          </button>
        )}
        <WindowControls />
      </div>
    </div>
  );
}

/** The window-icon glyph for a torn-off tab's kind (matches its titlebar icon). */
function glyphForKind(kind: Tab["kind"]): Glyph | null {
  switch (kind) {
    case "rows":
      return GLYPHS.table;
    case "query":
      return GLYPHS.query;
    case "relations":
      return GLYPHS.relations;
    case "create-table":
      return GLYPHS.tableDesigner;
    default:
      return null;
  }
}

function tabChrome(tab: Tab | null) {
  switch (tab?.kind) {
    case "database":
      return { Icon: Database, color: "text-accent-400" };
    case "relations":
      return { Icon: ShareNetwork, color: "text-violet-400" };
    case "query":
      return { Icon: Code, color: "text-emerald-400" };
    case "create-table":
      return { Icon: Table2, color: "text-orange-400" };
    default:
      return { Icon: Table2, color: "text-emerald-400" };
  }
}
