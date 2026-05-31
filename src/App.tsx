import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import {
  DndContext,
  DragOverlay,
  PointerSensor,
  pointerWithin,
  useSensor,
  useSensors,
  type DragEndEvent,
  type DragStartEvent,
} from "@dnd-kit/core";
import { Table as Table2, PlugsConnected } from "@phosphor-icons/react";
import { TitleBar } from "./components/TitleBar";
import { ConnectionTree } from "./components/ConnectionTree";
import { Tabs } from "./components/Tabs";
import { Splitter } from "./components/Splitter";
import { AboutDialog } from "./components/AboutDialog";
import {
  StateTransferDialog,
  type TransferMode,
} from "./components/StateTransferDialog";
import { Toaster } from "./components/Toaster";
import { SqlExportProgress } from "./components/SqlExportProgress";
import { CopyProgress } from "./components/CopyProgress";
import { CopyTableMenu } from "./components/CopyTableMenu";
import { getCurrentWindow, Window } from "@tauri-apps/api/window";
import { checkForUpdate, getAppVersion, type UpdateInfo } from "./lib/updater";
import { useUi } from "./state/ui";
import { useStore } from "./state/store";
import { useZoomShortcuts } from "./hooks/useZoomShortcuts";

/** What a tree row / DB-view tile carries while being dragged. */
type DragData =
  | {
      source: "dbview";
      tabId: string;
      profileId: string;
      db: string;
      grabbed: string;
      names: string[];
    }
  | { source: "tree"; profileId: string; db: string; table: string }
  | { source: "connection"; profileId: string; name: string };

/** What a drop target advertises (read off the droppable's data). */
type OverData =
  | { kind: "dbv-folder"; folderId: string }
  | { kind: "dbv-up" }
  | { kind: "tree-folder"; profileId: string; db: string; folderId: string }
  | { kind: "tree-db"; profileId: string; db: string }
  | { kind: "connection-row"; profileId: string };

export default function App() {
  const sidebarWidth = useUi((s) => s.sidebarWidth);
  const treeZoom = useUi((s) => s.treeZoom);
  const tabsZoom = useUi((s) => s.tabsZoom);
  const setFocusedPane = useUi((s) => s.setFocusedPane);
  const focusedPane = useUi((s) => s.focusedPane);

  const tableCopyPrompt = useUi((s) => s.tableCopyPrompt);
  const openTableCopyPrompt = useUi((s) => s.openTableCopyPrompt);
  const closeTableCopyPrompt = useUi((s) => s.closeTableCopyPrompt);
  const setTablesFolder = useStore((s) => s.setTablesFolder);
  const assignTableFolder = useStore((s) => s.assignTableFolder);
  const copyTablesToDatabase = useStore((s) => s.copyTablesToDatabase);

  const [aboutOpen, setAboutOpen] = useState(false);
  const [transferMode, setTransferMode] = useState<TransferMode | null>(null);
  const [appVersion, setAppVersion] = useState("");
  const [startupUpdate, setStartupUpdate] = useState<UpdateInfo | null>(null);
  const [drag, setDrag] = useState<{
    label: string;
    count: number;
    kind: "table" | "connection";
  } | null>(null);

  useZoomShortcuts();

  /* Ctrl+W closes the active tab (routes through requestCloseTab so dirty
     designer tabs still hit the unsaved-changes confirmation). */
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (!(e.ctrlKey || e.metaKey)) return;
      if (e.key !== "w" && e.key !== "W") return;
      e.preventDefault();
      const { activeTabId, requestCloseTab } = useStore.getState();
      if (activeTabId) requestCloseTab(activeTabId);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  /**
   * One app-level drag context spans both panes so a table can be dragged from
   * the DB view onto the tree (and vice versa) — dnd-kit only connects
   * draggables and droppables that share a context.
   */
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 5 } })
  );

  const onDragStart = (e: DragStartEvent) => {
    const a = e.active.data.current as DragData | undefined;
    if (!a) return;
    if (a.source === "dbview")
      setDrag({ label: a.grabbed, count: a.names.length, kind: "table" });
    else if (a.source === "connection")
      setDrag({ label: a.name, count: 1, kind: "connection" });
    else setDrag({ label: a.table, count: 1, kind: "table" });
  };

  const onDragEnd = (e: DragEndEvent) => {
    setDrag(null);
    const a = e.active.data.current as DragData | undefined;
    const o = e.over?.data.current as OverData | undefined;
    if (!a || !o) return;

    if (a.source === "connection") {
      if (o.kind === "connection-row" && o.profileId !== a.profileId) {
        useStore.getState().reorderProfiles(a.profileId, o.profileId);
      }
      return;
    }

    const names = a.source === "dbview" ? a.names : [a.table];

    if (o.kind === "dbv-folder" || o.kind === "dbv-up") {
      if (a.source !== "dbview") return;
      setTablesFolder(a.tabId, names, o.kind === "dbv-up" ? null : o.folderId);
      return;
    }
    if (o.kind === "tree-folder") {
      /* Folder assignment is only meaningful within the same connection + db. */
      if (o.profileId !== a.profileId || o.db !== a.db) return;
      for (const t of names) assignTableFolder(a.profileId, a.db, t, o.folderId);
      return;
    }
    if (o.kind === "tree-db") {
      const crossConnection = o.profileId !== a.profileId;
      /* Same connection + same database is a no-op; cross-connection to a
         like-named database is a legitimate copy. */
      if (!crossConnection && o.db === a.db) return;
      const targetConnectionName = crossConnection
        ? useStore.getState().profiles.find((p) => p.id === o.profileId)?.name
        : undefined;
      const rect = e.over!.rect;
      openTableCopyPrompt({
        profileId: a.profileId,
        sourceDb: a.db,
        tables: names,
        targetProfileId: o.profileId,
        targetDb: o.db,
        targetConnectionName,
        x: Math.round(rect.left + 16),
        y: Math.round(rect.top + rect.height),
      });
    }
  };

  /**
   * Boot sequence. The standalone splash window (declared in tauri.conf.json) is
   * already on screen while this runs, and the main window stays hidden, so the
   * heavy lifting — loading the saved connection profiles — happens behind it.
   * Once the tree is populated we reveal the main window and close the splash.
   */
  useEffect(() => {
    let cancelled = false;
    const startedAt = Date.now();
    (async () => {
      const version = await getAppVersion().catch(() => "");
      if (!cancelled) setAppVersion(version);
      await useStore.getState().loadProfiles();
      if (cancelled) return;
      /* TEMP (remove before publish): keep the splash up for at least 3s so it
         can be eyeballed even when boot is near-instant. */
      const minSplashMs = 3000;
      const remaining = minSplashMs - (Date.now() - startedAt);
      if (remaining > 0) await new Promise((r) => setTimeout(r, remaining));
      if (cancelled) return;
      /* Let React paint the populated tree before the window appears. */
      await new Promise((r) => requestAnimationFrame(() => r(null)));
      await getCurrentWindow().show();
      await getCurrentWindow().setFocus();
      const splash = await Window.getByLabel("splash");
      await splash?.close();
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  /** Silent check on launch; surfaces a dot in the title bar if an update exists. */
  useEffect(() => {
    let cancelled = false;
    checkForUpdate()
      .then((info) => {
        if (!cancelled && info) setStartupUpdate(info);
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, []);

  return (
    <div data-el="app-root" className="h-screen w-screen flex flex-col bg-zinc-950 text-zinc-200">
      <TitleBar
        onAbout={() => setAboutOpen(true)}
        onExport={() => setTransferMode("export")}
        onImport={() => setTransferMode("import")}
        updateAvailable={startupUpdate !== null}
      />
      <DndContext
        sensors={sensors}
        collisionDetection={pointerWithin}
        onDragStart={onDragStart}
        onDragEnd={onDragEnd}
        onDragCancel={() => setDrag(null)}
      >
        <div className="flex-1 min-h-0 flex">
          <div
            data-el="sidebar-pane"
            onPointerDownCapture={() => setFocusedPane("tree")}
            data-focused={focusedPane === "tree"}
            style={{
              width: sidebarWidth,
              ...(treeZoom !== 1 && { zoom: treeZoom }),
            }}
            className="shrink-0 h-full overflow-hidden"
          >
            <ConnectionTree />
          </div>
          <Splitter />
          <div
            data-el="main-pane"
            onPointerDownCapture={() => setFocusedPane("tabs")}
            data-focused={focusedPane === "tabs"}
            style={tabsZoom !== 1 ? { zoom: tabsZoom } : undefined}
            className="flex-1 min-w-0 h-full overflow-hidden"
          >
            <Tabs />
          </div>
        </div>
        {createPortal(
          <DragOverlay dropAnimation={null}>
            {drag ? (
              <div className="inline-flex items-center gap-2 rounded border border-accent-500/60 bg-zinc-900/95 px-2.5 py-1 text-xs text-zinc-100 shadow-xl shadow-black/60">
                {drag.kind === "connection" ? (
                  <PlugsConnected size={13} className="text-accent-400 shrink-0" />
                ) : (
                  <Table2 size={13} className="text-accent-400 shrink-0" />
                )}
                {drag.label}
                {drag.count > 1 && (
                  <span className="rounded-full bg-accent-500/20 text-accent-200 px-1.5 text-[10px] font-semibold tabular-nums">
                    {drag.count}
                  </span>
                )}
              </div>
            ) : null}
          </DragOverlay>,
          document.body
        )}
      </DndContext>

      {tableCopyPrompt && (
        <CopyTableMenu
          x={tableCopyPrompt.x}
          y={tableCopyPrompt.y}
          tables={tableCopyPrompt.tables}
          targetDb={tableCopyPrompt.targetDb}
          targetConnectionName={tableCopyPrompt.targetConnectionName}
          onClose={closeTableCopyPrompt}
          onCopy={(includeData) => {
            const p = tableCopyPrompt;
            closeTableCopyPrompt();
            copyTablesToDatabase(
              p.profileId,
              p.sourceDb,
              p.tables,
              p.targetProfileId,
              p.targetDb,
              includeData
            );
          }}
        />
      )}
      <AboutDialog
        open={aboutOpen}
        version={appVersion}
        initialUpdateInfo={startupUpdate}
        onClose={() => setAboutOpen(false)}
      />
      {transferMode && (
        <StateTransferDialog
          mode={transferMode}
          onClose={() => setTransferMode(null)}
        />
      )}
      <Toaster />
      <SqlExportProgress />
      <CopyProgress />
    </div>
  );
}
