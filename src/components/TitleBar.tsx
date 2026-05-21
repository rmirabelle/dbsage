import { useEffect, useState } from "react";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { Minus, Square, X, Database, Info } from "@phosphor-icons/react";

interface Props {
  onAbout: () => void;
  updateAvailable?: boolean;
}

export function TitleBar({ onAbout, updateAvailable }: Props) {
  const [maximized, setMaximized] = useState(false);

  useEffect(() => {
    const win = getCurrentWindow();
    let unlistenFn: (() => void) | undefined;
    win.isMaximized().then(setMaximized);
    win.onResized(() => {
      win.isMaximized().then(setMaximized);
    }).then((fn) => {
      unlistenFn = fn;
    });
    return () => {
      if (unlistenFn) unlistenFn();
    };
  }, []);

  const win = getCurrentWindow();

  return (
    <div
      data-tauri-drag-region
      className="h-9 flex items-center justify-between bg-zinc-950 border-b border-zinc-800/80 px-3 select-none"
    >
      <div data-tauri-drag-region className="flex items-center gap-2 text-zinc-300 pointer-events-none">
        <Database size={14} className="text-accent-400" />
        <span className="text-[12px] font-medium tracking-wide">DBSage</span>
      </div>

      <div className="flex items-center">
        <button
          aria-label={updateAvailable ? "About — update available" : "About"}
          title={updateAvailable ? "Update available" : "About DBSage"}
          onClick={onAbout}
          className="relative h-9 w-11 inline-flex items-center justify-center text-zinc-400 hover:bg-zinc-800/80 hover:text-zinc-100 transition"
        >
          <Info size={15} />
          {updateAvailable && (
            <span className="absolute right-2.5 top-2 h-2 w-2 rounded-full bg-accent-400 ring-2 ring-zinc-950" />
          )}
        </button>
        <button
          aria-label="Minimize"
          onClick={() => win.minimize()}
          className="h-9 w-11 inline-flex items-center justify-center text-zinc-400 hover:bg-zinc-800/80 hover:text-zinc-100 transition"
        >
          <Minus size={14} />
        </button>
        <button
          aria-label={maximized ? "Restore" : "Maximize"}
          onClick={() => win.toggleMaximize()}
          className="h-9 w-11 inline-flex items-center justify-center text-zinc-400 hover:bg-zinc-800/80 hover:text-zinc-100 transition"
        >
          <Square size={12} weight="bold" />
        </button>
        <button
          aria-label="Close"
          onClick={() => win.close()}
          className="h-9 w-11 inline-flex items-center justify-center text-zinc-400 hover:bg-red-600 hover:text-white transition"
        >
          <X size={14} />
        </button>
      </div>
    </div>
  );
}
