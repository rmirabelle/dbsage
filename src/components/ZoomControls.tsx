import {
  Minus,
  Plus,
  ArrowCounterClockwise as RotateCcw,
} from "@phosphor-icons/react";
import { useUi, ZOOM_BOUNDS, type PaneId } from "../state/ui";

export function ZoomControls({ pane }: { pane: PaneId }) {
  const zoom = useUi((s) => (pane === "tree" ? s.treeZoom : s.tabsZoom));
  const bumpZoom = useUi((s) => s.bumpZoom);
  const resetZoom = useUi((s) => s.resetZoom);

  const atMin = zoom <= ZOOM_BOUNDS.MIN + 1e-6;
  const atMax = zoom >= ZOOM_BOUNDS.MAX - 1e-6;
  const isDefault = Math.abs(zoom - 1) < 1e-6;

  return (
    <div data-el="zoom-controls" className="flex items-center gap-px text-zinc-500">
      <button
        data-el="zoom-out-btn"
        onClick={() => bumpZoom(pane, -ZOOM_BOUNDS.STEP)}
        disabled={atMin}
        aria-label="Zoom out"
        title="Zoom out (Ctrl+−)"
        className="h-5 w-5 inline-flex items-center justify-center rounded hover:bg-zinc-800 hover:text-zinc-200 disabled:opacity-30 disabled:hover:bg-transparent"
      >
        <Minus size={13} />
      </button>
      <button
        data-el="zoom-reset-btn"
        onClick={() => resetZoom(pane)}
        disabled={isDefault}
        aria-label="Reset zoom"
        title={`Reset zoom (Ctrl+0) · ${Math.round(zoom * 100)}%`}
        className="h-5 min-w-[2.5rem] px-1 inline-flex items-center justify-center rounded text-[10px] font-mono hover:bg-zinc-800 hover:text-zinc-200 disabled:opacity-50 disabled:hover:bg-transparent"
      >
        {isDefault ? "100%" : <span className="inline-flex items-center gap-1"><RotateCcw size={10} />{Math.round(zoom * 100)}%</span>}
      </button>
      <button
        data-el="zoom-in-btn"
        onClick={() => bumpZoom(pane, ZOOM_BOUNDS.STEP)}
        disabled={atMax}
        aria-label="Zoom in"
        title="Zoom in (Ctrl+=)"
        className="h-5 w-5 inline-flex items-center justify-center rounded hover:bg-zinc-800 hover:text-zinc-200 disabled:opacity-30 disabled:hover:bg-transparent"
      >
        <Plus size={13} />
      </button>
    </div>
  );
}
