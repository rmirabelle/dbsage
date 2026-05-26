import { useEffect, useRef, useState, type ReactNode } from "react";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { Database, DownloadSimple } from "@phosphor-icons/react";
import { useUi, ZOOM_BOUNDS } from "../state/ui";

/** Zoom the currently-focused pane (tree or tabs). */
const zoomFocused = (delta: number) => {
  const { focusedPane, bumpZoom } = useUi.getState();
  bumpZoom(focusedPane, delta);
};
const resetFocusedZoom = () => {
  const { focusedPane, resetZoom } = useUi.getState();
  resetZoom(focusedPane);
};

interface Props {
  onAbout: () => void;
  onExport: () => void;
  onImport: () => void;
  updateAvailable?: boolean;
}

export function TitleBar({ onAbout, onExport, onImport, updateAvailable }: Props) {
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
      data-el="titlebar"
      data-tauri-drag-region
      className="h-9 flex items-center justify-between bg-zinc-950 border-b border-zinc-800/80 px-3 select-none"
    >
      <div className="flex items-center">
        <div
          data-tauri-drag-region
          className="flex items-center gap-2 pr-3 text-zinc-300 pointer-events-none"
        >
          <Database size={16} className="text-accent-400" />
          <span className="text-[12px] font-bold tracking-wide text-accent-400">DB Sage</span>
        </div>
        <nav data-el="app-menu" className="flex items-center">
          <TitleBarMenu label="File">
            {(close) => (
              <>
                <button
                  data-el="menu-import-state"
                  onClick={() => {
                    close();
                    onImport();
                  }}
                  className={MENU_ITEM_CLASS}
                >
                  <span>Import Settings…</span>
                </button>
                <button
                  data-el="menu-export-state"
                  onClick={() => {
                    close();
                    onExport();
                  }}
                  className={MENU_ITEM_CLASS}
                >
                  <span>Export Settings…</span>
                </button>
              </>
            )}
          </TitleBarMenu>
          <TitleBarMenu label="View">
            {() => (
              <>
                <button
                  data-el="menu-zoom-in"
                  onClick={() => zoomFocused(ZOOM_BOUNDS.STEP)}
                  className={MENU_ITEM_CLASS}
                >
                  <span>Zoom In</span>
                  <span className="text-[10px] text-zinc-500">Ctrl +</span>
                </button>
                <button
                  data-el="menu-zoom-out"
                  onClick={() => zoomFocused(-ZOOM_BOUNDS.STEP)}
                  className={MENU_ITEM_CLASS}
                >
                  <span>Zoom Out</span>
                  <span className="text-[10px] text-zinc-500">Ctrl −</span>
                </button>
                <button
                  data-el="menu-zoom-reset"
                  onClick={() => resetFocusedZoom()}
                  className={MENU_ITEM_CLASS}
                >
                  <span>Reset Zoom</span>
                  <span className="text-[10px] text-zinc-500">Ctrl 0</span>
                </button>
              </>
            )}
          </TitleBarMenu>
          <TitleBarMenu label="Help">
            {(close) => (
              <button
                data-el="menu-about"
                onClick={() => {
                  close();
                  onAbout();
                }}
                className={MENU_ITEM_CLASS}
              >
                <span>About DB Sage</span>
              </button>
            )}
          </TitleBarMenu>
          {updateAvailable && (
            <button
              data-el="titlebar-update-btn"
              onClick={onAbout}
              title="A new version is available"
              className="ml-2 inline-flex items-center gap-1.5 h-6 px-2.5 rounded text-[11px] font-semibold bg-accent-500 text-[#042f2e] hover:bg-accent-400 transition-colors"
            >
              <DownloadSimple size={14} weight="bold" />
              Update available
            </button>
          )}
        </nav>
      </div>

      <div className="flex items-center">
        <button
          data-el="titlebar-minimize-btn"
          aria-label="Minimize"
          onClick={() => win.minimize()}
          className="h-9 w-11 inline-flex items-center justify-center text-zinc-400 hover:bg-zinc-800/80 hover:text-zinc-100 transition"
        >
          <MinimizeIcon />
        </button>
        <button
          data-el="titlebar-maximize-btn"
          aria-label={maximized ? "Restore" : "Maximize"}
          onClick={() => win.toggleMaximize()}
          className="h-9 w-11 inline-flex items-center justify-center text-zinc-400 hover:bg-zinc-800/80 hover:text-zinc-100 transition"
        >
          {maximized ? <RestoreIcon /> : <MaximizeIcon />}
        </button>
        <button
          data-el="titlebar-close-btn"
          aria-label="Close"
          onClick={() => win.close()}
          className="h-9 w-11 inline-flex items-center justify-center text-zinc-400 hover:bg-red-600 hover:text-white transition"
        >
          <CloseIcon />
        </button>
      </div>
    </div>
  );
}

const MENU_ITEM_CLASS =
  "flex w-full items-center justify-between gap-6 px-3 py-1.5 text-left text-[12px] text-zinc-200 hover:bg-zinc-800";

function TitleBarMenu({
  label,
  children,
}: {
  label: string;
  children: (close: () => void) => ReactNode;
}) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    window.addEventListener("mousedown", onDown);
    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("mousedown", onDown);
      window.removeEventListener("keydown", onKey);
    };
  }, [open]);

  return (
    <div ref={ref} className="relative">
      <button
        data-el={`menu-${label.toLowerCase()}`}
        onClick={() => setOpen((o) => !o)}
        className={`h-9 px-3 text-[12px] transition hover:bg-zinc-800/80 hover:text-zinc-100 ${
          open ? "bg-zinc-800/80 text-zinc-100" : "text-zinc-300"
        }`}
      >
        {label}
      </button>
      {open && (
        <div
          data-el={`menu-${label.toLowerCase()}-dropdown`}
          className="absolute left-0 top-full z-50 min-w-[200px] rounded-b border border-zinc-800 bg-zinc-900/95 backdrop-blur-sm py-1 shadow-xl shadow-black/50"
        >
          {children(() => setOpen(false))}
        </div>
      )}
    </div>
  );
}

const glyphProps = {
  width: 10,
  height: 10,
  viewBox: "0 0 10 10",
  fill: "none",
  stroke: "currentColor",
  strokeWidth: 1,
  shapeRendering: "geometricPrecision" as const,
};

function MinimizeIcon() {
  return (
    <svg {...glyphProps}>
      <path d="M0.5 5h9" />
    </svg>
  );
}

function MaximizeIcon() {
  return (
    <svg {...glyphProps}>
      <rect x="0.5" y="0.5" width="9" height="9" />
    </svg>
  );
}

/** Two overlapping squares — the Windows "restore down" glyph shown when maximized. */
function RestoreIcon() {
  return (
    <svg {...glyphProps}>
      <rect x="0.5" y="2.5" width="7" height="7" />
      <path d="M2.5 2.5v-2h7v7h-2" />
    </svg>
  );
}

function CloseIcon() {
  return (
    <svg {...glyphProps}>
      <path d="M0.5 0.5l9 9M9.5 0.5l-9 9" />
    </svg>
  );
}
