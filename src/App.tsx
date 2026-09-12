import { useEffect, useState } from "react";
import { ipc } from "./ipc";
import { TitleBar } from "./components/TitleBar";
import { ConnectionTree } from "./components/ConnectionTree";
import { Tabs } from "./components/Tabs";
import { Splitter } from "./components/Splitter";
import { TabDndProvider } from "./components/TabDndProvider";
import { AboutDialog } from "./components/AboutDialog";
import {
  StateTransferDialog,
  type TransferMode,
} from "./components/StateTransferDialog";
import { Toaster } from "./components/Toaster";
import { SqlExportProgress } from "./components/SqlExportProgress";
import { BackupProgress } from "./components/BackupProgress";
import { RestoreWizard } from "./components/RestoreWizard";
import { CopyProgress } from "./components/CopyProgress";
import { CopyTableMenu } from "./components/CopyTableMenu";
import { ImportDatabaseFileDialog } from "./components/ImportDatabaseFileDialog";
import { SettingsDialog } from "./components/SettingsDialog";
import { notifyError } from "./state/notify";
import { getCurrentWindow, Window } from "@tauri-apps/api/window";
import { listen } from "@tauri-apps/api/event";
import type { Tab } from "./types";
import { checkForUpdate, getAppVersion, type UpdateInfo } from "./lib/updater";
import { useUi } from "./state/ui";
import { useStore } from "./state/store";
import { useZoomShortcuts } from "./hooks/useZoomShortcuts";

export default function App() {
  const sidebarWidth = useUi((s) => s.sidebarWidth);
  const treeZoom = useUi((s) => s.treeZoom);
  const tabsZoom = useUi((s) => s.tabsZoom);
  const setFocusedPane = useUi((s) => s.setFocusedPane);
  const focusedPane = useUi((s) => s.focusedPane);

  const tableCopyPrompt = useUi((s) => s.tableCopyPrompt);
  const closeTableCopyPrompt = useUi((s) => s.closeTableCopyPrompt);
  const copyTablesToDatabase = useStore((s) => s.copyTablesToDatabase);
  const restoreTarget = useStore((s) => s.restoreTarget);
  const closeRestore = useStore((s) => s.closeRestore);

  const [aboutOpen, setAboutOpen] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [transferMode, setTransferMode] = useState<TransferMode | null>(null);
  /** File pre-selected in the Import Settings dialog (opened from a .dbsage file). */
  const [importPath, setImportPath] = useState<string | null>(null);
  /** A single-database settings file opened from Explorer. */
  const [dbImportPath, setDbImportPath] = useState<string | null>(null);
  const [appVersion, setAppVersion] = useState("");
  const [startupUpdate, setStartupUpdate] = useState<UpdateInfo | null>(null);

  useZoomShortcuts();

  /* F1 opens the Help library in its own window from anywhere in the main
     window, so it can stay open beside the app. */
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "F1") return;
      e.preventDefault();
      ipc.openHelpWindow().catch(() => {});
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

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

  /* Drag handling (DB-view tiles ↔ tree, connection reorder) lives in
     TabDndProvider so torn-off tab windows get the same context. */

  /**
   * Route an opened .dbsage file to the right import dialog: a single-database
   * export gets the multi-database picker, a full export (or an encrypted file,
   * which needs a passphrase) gets Import Settings with the file pre-selected.
   */
  const openSettingsFile = async (path: string) => {
    let kind: "app" | "database" = "app";
    try { kind = await ipc.stateFileKind(path); }
    catch (e) { notifyError(`Could not open ${path.split(/[\\/]/).pop()}: ${String(e)}`); return; }
    if (kind === "database") { setDbImportPath(path); }
    else { setImportPath(path); setTransferMode("import"); }
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
      const launch = await ipc.takeLaunchFile().catch(() => null);
      if (launch && !cancelled) await openSettingsFile(launch);
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  /* A .dbsage file double-clicked while the app is already running arrives
     from the single-instance plugin. */
  useEffect(() => {
    const un = listen<string>("dbsage://open-file", (e) => void openSettingsFile(e.payload));
    return () => { un.then((f) => f()); };
  }, []);

  /* Re-docking: a torn-off tab window drags over the tab bar (hint) and drops
     (dock) — both arrive as events from the dragging window. */
  useEffect(() => {
    const unHint = listen<{ active: boolean }>(
      "dbsage://tab-dock-hint",
      (e) => useStore.getState().setTabDropActive(!!e.payload.active)
    );
    const unDock = listen<Tab>("dbsage://dock-tab", async (e) => {
      useStore.getState().dockTab(e.payload);
      await getCurrentWindow().setFocus();
    });
    return () => {
      unHint.then((f) => f());
      unDock.then((f) => f());
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
        onHelp={() => ipc.openHelpWindow().catch(() => {})}
        onAbout={() => setAboutOpen(true)}
        onSettings={() => setSettingsOpen(true)}
        updateAvailable={startupUpdate !== null}
      />
      <TabDndProvider>
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
      </TabDndProvider>

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
      {settingsOpen && (
        <SettingsDialog
          onClose={() => setSettingsOpen(false)}
          childOpen={transferMode !== null}
          onImport={() => setTransferMode("import")}
          onExport={() => setTransferMode("export")}
        />
      )}
      {transferMode && (
        <StateTransferDialog
          mode={transferMode}
          initialPath={transferMode === "import" ? importPath ?? undefined : undefined}
          onClose={() => { setTransferMode(null); setImportPath(null); }}
        />
      )}
      {dbImportPath && (
        <ImportDatabaseFileDialog path={dbImportPath} onClose={() => setDbImportPath(null)} />
      )}
      <Toaster />
      <SqlExportProgress />
      <BackupProgress />
      <CopyProgress />
      {restoreTarget && (
        <RestoreWizard
          profileId={restoreTarget.profileId}
          onClose={closeRestore}
        />
      )}
    </div>
  );
}
