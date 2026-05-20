import { TitleBar } from "./components/TitleBar";
import { ConnectionTree } from "./components/ConnectionTree";
import { TableTabs } from "./components/TableTabs";
import { Splitter } from "./components/Splitter";
import { useUi } from "./state/ui";
import { useZoomShortcuts } from "./hooks/useZoomShortcuts";

export default function App() {
  const sidebarWidth = useUi((s) => s.sidebarWidth);
  const treeZoom = useUi((s) => s.treeZoom);
  const tabsZoom = useUi((s) => s.tabsZoom);
  const setFocusedPane = useUi((s) => s.setFocusedPane);
  const focusedPane = useUi((s) => s.focusedPane);

  useZoomShortcuts();

  return (
    <div className="h-screen w-screen flex flex-col bg-zinc-950 text-zinc-200">
      <TitleBar />
      <div className="flex-1 min-h-0 flex">
        <div
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
          onPointerDownCapture={() => setFocusedPane("tabs")}
          data-focused={focusedPane === "tabs"}
          style={tabsZoom !== 1 ? { zoom: tabsZoom } : undefined}
          className="flex-1 min-w-0 h-full overflow-hidden"
        >
          <TableTabs />
        </div>
      </div>
    </div>
  );
}
