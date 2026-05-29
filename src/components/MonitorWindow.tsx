import { useEffect, useState } from "react";
import { Pulse } from "@phosphor-icons/react";
import { MonitoringView } from "./MonitoringView";
import { Toaster } from "./Toaster";
import { WindowControls } from "./WindowControls";
import { ipc } from "../ipc";

/**
 * Standalone window host for the server Monitoring view. Loaded when the app
 * boots with `?win=monitor&profile=<id>` (a window opened by the
 * `open_monitor_window` command). Renders its own custom titlebar — the window
 * is `decorations: false` like the main window — plus its own Toaster, since
 * each window is a separate JS context. Connection pools live in the shared Rust
 * backend, so the IPC calls reuse the main window's open connection.
 */
export function MonitorWindow({ profileId }: { profileId: string }) {
  const [name, setName] = useState("");

  useEffect(() => {
    ipc
      .listProfiles()
      .then((ps) => {
        const p = ps.find((x) => x.id === profileId);
        if (p) setName(p.name);
      })
      .catch(() => {});
  }, [profileId]);

  return (
    <div className="h-screen flex flex-col bg-zinc-950 text-zinc-200 overflow-hidden">
      <MonitorTitleBar title={name} />
      <div className="flex-1 min-h-0 flex flex-col">
        <MonitoringView profileId={profileId} />
      </div>
      <Toaster />
    </div>
  );
}

function MonitorTitleBar({ title }: { title: string }) {
  return (
    <div
      data-el="monitor-titlebar"
      data-tauri-drag-region
      className="h-9 shrink-0 flex items-center justify-between bg-zinc-950 border-b border-zinc-800/80 pl-3 select-none"
    >
      <div
        data-tauri-drag-region
        className="flex items-center gap-2 text-zinc-300 pointer-events-none"
      >
        <Pulse size={16} className="text-blue-400" />
        {title && (
          <span className="text-[15px] font-bold tracking-wide text-lime-400">
            {title}
          </span>
        )}
        <span className="text-[10px] font-semibold uppercase tracking-[0.14em] text-zinc-500">
          Monitor
        </span>
      </div>
      <WindowControls />
    </div>
  );
}
