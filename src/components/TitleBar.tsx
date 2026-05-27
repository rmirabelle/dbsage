import { useEffect, useRef, useState, type ReactNode } from "react";
import {
  Database,
  DownloadSimple,
  FileArrowDown,
  FileArrowUp,
  MagnifyingGlassPlus,
  MagnifyingGlassMinus,
  ArrowCounterClockwise,
  Info,
} from "@phosphor-icons/react";
import { useUi, ZOOM_BOUNDS } from "../state/ui";
import { WindowControls } from "./WindowControls";

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
                  <span className={MENU_LABEL_CLASS}>
                    <FileArrowDown size={14} className={MENU_ICON_CLASS} />
                    Import Settings…
                  </span>
                </button>
                <button
                  data-el="menu-export-state"
                  onClick={() => {
                    close();
                    onExport();
                  }}
                  className={MENU_ITEM_CLASS}
                >
                  <span className={MENU_LABEL_CLASS}>
                    <FileArrowUp size={14} className={MENU_ICON_CLASS} />
                    Export Settings…
                  </span>
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
                  <span className={MENU_LABEL_CLASS}>
                    <MagnifyingGlassPlus size={14} className={MENU_ICON_CLASS} />
                    Zoom In
                  </span>
                  <span className="text-[10px] text-zinc-500">Ctrl +</span>
                </button>
                <button
                  data-el="menu-zoom-out"
                  onClick={() => zoomFocused(-ZOOM_BOUNDS.STEP)}
                  className={MENU_ITEM_CLASS}
                >
                  <span className={MENU_LABEL_CLASS}>
                    <MagnifyingGlassMinus size={14} className={MENU_ICON_CLASS} />
                    Zoom Out
                  </span>
                  <span className="text-[10px] text-zinc-500">Ctrl −</span>
                </button>
                <button
                  data-el="menu-zoom-reset"
                  onClick={() => resetFocusedZoom()}
                  className={MENU_ITEM_CLASS}
                >
                  <span className={MENU_LABEL_CLASS}>
                    <ArrowCounterClockwise size={14} className={MENU_ICON_CLASS} />
                    Reset Zoom
                  </span>
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
                <span className={MENU_LABEL_CLASS}>
                  <Info size={14} className={MENU_ICON_CLASS} />
                  About DB Sage
                </span>
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

      <WindowControls />
    </div>
  );
}

const MENU_ITEM_CLASS =
  "flex w-full items-center justify-between gap-6 px-3 py-1.5 text-left text-[12px] text-zinc-200 hover:bg-zinc-800";
const MENU_LABEL_CLASS = "flex items-center gap-2.5";
const MENU_ICON_CLASS = "text-accent-400 shrink-0";

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

