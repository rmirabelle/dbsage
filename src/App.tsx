import { useEffect, useState } from "react";
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
import { checkForUpdate, getAppVersion, type UpdateInfo } from "./lib/updater";
import { useUi } from "./state/ui";
import { useZoomShortcuts } from "./hooks/useZoomShortcuts";

export default function App() {
  const sidebarWidth = useUi((s) => s.sidebarWidth);
  const treeZoom = useUi((s) => s.treeZoom);
  const tabsZoom = useUi((s) => s.tabsZoom);
  const setFocusedPane = useUi((s) => s.setFocusedPane);
  const focusedPane = useUi((s) => s.focusedPane);

  const [aboutOpen, setAboutOpen] = useState(false);
  const [transferMode, setTransferMode] = useState<TransferMode | null>(null);
  const [appVersion, setAppVersion] = useState("");
  const [startupUpdate, setStartupUpdate] = useState<UpdateInfo | null>(null);

  useZoomShortcuts();

  useEffect(() => {
    getAppVersion().then(setAppVersion).catch(() => {});
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
    </div>
  );
}
