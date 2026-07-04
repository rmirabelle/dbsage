import { useEffect, useState } from "react";
import { emitTo, listen } from "@tauri-apps/api/event";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { ipc } from "../ipc";
import { useZoomShortcuts } from "../hooks/useZoomShortcuts";
import { revealWindow } from "../lib/revealWindow";
import { setWindowGlyphIcon, GLYPHS } from "../lib/windowIcon";
import { useStore } from "../state/store";
import { PeekPanel } from "./PeekPanel";
import { Toaster } from "./Toaster";
import type { PeekSeed, PeekTarget } from "../types";
import type { RelationTarget } from "../lib/relations";

/** Broadcast payload that drives cross-window peek live-follow. */
interface PeekFollow {
  profileId: string;
  database: string;
  sourceTable: string;
  sourceColumn: string;
  value: string;
}

/**
 * Standalone window host for a relation peek. Each peek lives in its own OS
 * window (`peek-<n>`) so it stays put across tab switches and "Open Table", and
 * is dismissed only by closing the window. The seed (which table/column/value
 * to show) is handed over via `take_window_seed`; connection pools live in the
 * shared Rust backend, so the grid loads through the main window's connection.
 */
export function PeekWindow({ label }: { label: string }) {
  const [seed, setSeed] = useState<PeekSeed | null>(null);
  const [target, setTarget] = useState<PeekTarget | null>(null);
  const [missing, setMissing] = useState(false);

  /* Ctrl+wheel / Ctrl+= zoom works here too, driving the shared tabs zoom
     (focusedPane defaults to "tabs" in this window's own ui store). */
  useZoomShortcuts();

  useEffect(() => {
    setWindowGlyphIcon(GLYPHS.relations);
  }, []);

  /* Taskbar/window title reads "{table} - DB Sage" (the peeked table). */
  useEffect(() => {
    if (seed) {
      getCurrentWindow()
        .setTitle(`${seed.target.table} - DB Sage`)
        .catch(() => {});
    }
  }, [seed]);

  useEffect(() => {
    ipc
      .readWindowSeed<PeekSeed>(label)
      .then((s) => {
        if (!s) {
          setMissing(true);
          return;
        }
        setSeed(s);
        setTarget(s.target);
        /* This window has its own store instance — load the relations for its
           database so the peek can itself be peeked from. */
        useStore.getState().loadRelations(s.profileId, s.database).catch(() => {});
        revealWindow();
      })
      .catch(() => {
        setMissing(true);
        revealWindow();
      });
  }, [label]);

  /* Live-follow: when the source table+column this peek was launched from gets a
     new selection (in the main window or another peek), update our match value
     so the grid re-fetches the related rows — the key linkage that makes peeks
     track the source row. */
  useEffect(() => {
    if (!seed) return;
    const un = listen<PeekFollow>("dbsage://peek-follow", (e) => {
      const m = e.payload;
      if (
        m.profileId === seed.profileId &&
        m.database === seed.database &&
        m.sourceTable === seed.sourceTable &&
        m.sourceColumn === seed.sourceColumn
      ) {
        setTarget((t) => (t && t.value !== m.value ? { ...t, value: m.value } : t));
      }
    });
    return () => {
      un.then((f) => f());
    };
  }, [seed]);

  /** Open a child peek for a relation found on this peek's own table. */
  const openChildPeek = (
    target: RelationTarget,
    sourceColumn: string,
    value: string
  ) => {
    if (!seed) return;
    const childSeed: PeekSeed = {
      profileId: seed.profileId,
      profileName: seed.profileName,
      database: seed.database,
      target: { table: target.table, column: target.column, value },
      sourceTable: seed.target.table,
      sourceColumn,
    };
    /* Offset from this window so the child doesn't land exactly on top. */
    ipc
      .openPeekWindow(childSeed, window.screenX + 40, window.screenY + 40, 900, 440)
      .catch(() => {});
  };

  /** Promote this peek's table to a full, filtered tab — handled by the main
   * window — then close this window: the tab supersedes the peek (the one
   * exception to the peeks-stay-open rule). */
  const openAsTab = () => {
    if (!seed) return;
    emitTo("main", "dbsage://open-table-as-tab", {
      profileId: seed.profileId,
      profileName: seed.profileName,
      database: seed.database,
      target: target ?? seed.target,
    })
      .then(() => getCurrentWindow().close())
      .catch(() => {});
  };

  return (
    <div className="h-screen flex flex-col bg-zinc-950 text-zinc-200 overflow-hidden">
      {seed && target ? (
        <PeekPanel
          profileId={seed.profileId}
          database={seed.database}
          target={target}
          initialHiddenColumns={seed.hiddenColumns}
          onHiddenColumnsChange={(hidden) =>
            ipc.setPeekColumns(label, hidden).catch(() => {})
          }
          initialInspectorOpen={seed.inspectorOpen}
          onInspectorOpenChange={(open) =>
            ipc.setPeekInspector(label, open).catch(() => {})
          }
          onOpenChildPeek={openChildPeek}
          onOpenAsTab={openAsTab}
        />
      ) : (
        <div className="flex-1 flex items-center justify-center text-zinc-500 text-xs">
          {missing ? "This peek is no longer available." : "Loading…"}
        </div>
      )}
      <Toaster />
    </div>
  );
}
