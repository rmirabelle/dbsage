import { helpHandlers } from "../state/help";
import { useContext, useEffect, useId, useMemo, useRef, useState, type CSSProperties, type ReactNode, type RefObject } from "react";
import { findPeekLocation, type PeekLocation } from "../lib/peekNavigation";
import { PeekNavigation } from "./PeekNavigation";
import { CaretDoubleRight, ShareNetwork, X } from "@phosphor-icons/react";
import { createPortal } from "react-dom";
import { followIntegratedPeeks, resizeIntegratedPeek, refreshPeekRelations, toggleIntegratedPeek } from "../lib/integratedPeek";
import { useAnchoredPosition } from "../lib/useAnchoredPosition";
import { oneRowGridHeight } from "../lib/gridMeasure";
import { useStore } from "../state/store";
import type { IntegratedPeekState, PeekViewState, RowRecord } from "../types";
import { PeekTab } from "./PeekTab";
import { PeekPanel } from "./PeekPanel";
import { PeekDepth, peekDepthColor, peekDepthTint } from "./PeekDepth";

/** Inspector chrome (28 + 36), one 20px text line, 16px padding, and border. */
export const SINGLE_ROW_INSPECTOR_HEIGHT = 101;

export function IntegratedPeekPanel({ table, state, row, rowsRef, relationsPanel, onClose, onChange, active = true, parentLocation, dock = "bottom", selectionBlocked = false, parentTitle }: {
  selectionBlocked?: boolean;
  /** The breadcrumb from the root table down to the hosting peek (`table ›
   * relation › …`) when this panel is nested under a peek; its tabs are then
   * shorter and their help text shows the full trail. */
  parentTitle?: string;
  dock?: "bottom" | "right";
  parentLocation?: PeekLocation;
  table: string;
  state: IntegratedPeekState;
  row: RowRecord | null;
  rowsRef: RefObject<HTMLDivElement | null>;
  relationsPanel?: ReactNode;
  onClose: () => void;
  onChange: (update: (current: IntegratedPeekState) => IntegratedPeekState) => void;
  active?: boolean;
}) {
  const idPrefix = useId();
  const rightDock = dock === "right";
  const depth = useContext(PeekDepth);
  const depthColor = peekDepthColor(depth);
  const inherited = useContext(PeekNavigation);
  const locations = parentLocation ? [...inherited, parentLocation] : inherited;
  const panelRef = useRef<HTMLDivElement>(null);
  const dragCleanup = useRef<(() => void) | null>(null);
  const [maxHeight, setMaxHeight] = useState(Infinity);
  const seed = state.peeks[0] ?? state.hiddenPeeks?.[0];
  const relations = useStore((s) => seed ? s.relations[`${seed.profileId}::${seed.database}`] : undefined);
  const refreshed = useMemo(() => relations ? refreshPeekRelations(state, relations) : state, [state, relations]);
  useEffect(() => {
    if (refreshed !== state && relations) onChange((current) => refreshPeekRelations(current, relations));
  }, [refreshed, state, relations, onChange]);
  const followed = useMemo(() => followIntegratedPeeks(refreshed.peeks, row), [refreshed.peeks, row]);
  const peeks = selectionBlocked ? [] : followed.filter((p) => !findPeekLocation(locations, p.profileId, p.database, p.target, p.kind ?? "has_many", p.sourceTable));
  const activeId = peeks.some((p) => p.id === state.activeId) ? state.activeId : peeks[0]?.id ?? "";
  const [visited, setVisited] = useState(() => new Set([activeId]));
  useEffect(() => {
    setVisited((prev) => prev.has(activeId) ? prev : new Set([...prev, activeId]));
    const frame = requestAnimationFrame(() => {
      if (active) document.getElementById(`${idPrefix}tab-${activeId}`)?.scrollIntoView({ block: "nearest", inline: "nearest" });
    });
    return () => cancelAnimationFrame(frame);
  }, [activeId, active, idPrefix]);

  /** Reserve parent rows even when the window or either Inspector is resized. */
  useEffect(() => {
    const panel = panelRef.current;
    const rows = rowsRef.current;
    if (!panel || !rows) return;
    const measure = () => {
      const total = rightDock ? panel.parentElement?.clientWidth ?? 0 : panel.offsetHeight + rows.offsetHeight;
      if (total === 0) return;
      /* Bottom dock keeps the parent grid tall enough for its header, one
         row, and the horizontal scrollbar; right dock keeps 240px of width. */
      setMaxHeight(Math.max(0, total - Math.min(rightDock ? 240 : oneRowGridHeight(rows), total / 3)));
    };
    const observer = new ResizeObserver(measure);
    observer.observe(panel);
    observer.observe(rows);
    if (panel.parentElement) observer.observe(panel.parentElement);
    measure();
    return () => observer.disconnect();
  }, [rowsRef, rightDock]);
  useEffect(() => () => dragCleanup.current?.(), []);

  const change = (patch: Partial<IntegratedPeekState>) => {
    onChange((current) => ({ ...current, ...patch }));
  };
  const select = (id: string) => {
    setVisited((prev) => new Set([...prev, id]));
    change({ activeId: id });
  };
  /** Right-click menu on a tab: closes that peek (unchecks its relation). */
  const [tabMenu, setTabMenu] = useState<{ id: string; x: number; y: number } | null>(null);
  useEffect(() => {
    if (!tabMenu) return;
    const close = () => setTabMenu(null);
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") close(); };
    window.addEventListener("click", close);
    window.addEventListener("contextmenu", close);
    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("click", close);
      window.removeEventListener("contextmenu", close);
      window.removeEventListener("keydown", onKey);
    };
  }, [tabMenu]);
  const closePeek = (id: string) => {
    setTabMenu(null);
    onChange((current) => {
      const peek = current.peeks.find((p) => p.id === id);
      return peek ? toggleIntegratedPeek(current, peek) : current;
    });
  };
  const updateView = (id: string, patch: PeekViewState) => {
    onChange((current) => ({ ...current,
      peeks: current.peeks.map((p) => p.id === id ? { ...p, ...patch } : p),
      hiddenPeeks: current.hiddenPeeks?.map((p) => p.id === id ? { ...p, ...patch } : p),
    }));
  };
  const height = Math.min(rightDock ? state.width ?? 600 : state.height, maxHeight);
  const resize = (size: number) => change(rightDock ? { width: size } : { height: size });
  const panelStyle: CSSProperties & { "--peek-tint": string } = {
    width: rightDock ? height : undefined,
    height: rightDock ? "100%" : height,
    "--peek-tint": peekDepthTint(depth), backgroundColor: "var(--peek-tint)",
  };

  return (
    <PeekDepth.Provider value={depth + 1}>
    <div ref={panelRef} data-el="integrated-peek-panel" data-peek-depth={depth + 1}
      style={panelStyle}
      className={`relative min-w-0 min-h-0 flex flex-col border-zinc-800 bg-zinc-950 text-zinc-200 ${rightDock ? "shrink-0 border-l" : depth > 0 ? "shrink" : "shrink border-t"}`}>
      <div role="separator" aria-label="Resize Relations workspace" aria-orientation={rightDock ? "vertical" : "horizontal"}
        className={`absolute z-10 hover:bg-violet-500/40 ${rightDock ? "top-0 bottom-0 left-0 w-1.5 -translate-x-1/2 cursor-ew-resize" : "top-0 left-0 right-0 h-1.5 -translate-y-1/2 cursor-ns-resize"}`}
        {...helpHandlers("Drag to resize · double-click to split the available rows area evenly")}
        onDoubleClick={() => resize(rightDock ? (panelRef.current?.parentElement?.clientWidth ?? 1200) / 2 : ((panelRef.current?.offsetHeight ?? height) + (rowsRef.current?.offsetHeight ?? 0)) / 2)}
        onPointerDown={(e) => {
          e.preventDefault();
          dragCleanup.current?.();
          const panel = panelRef.current;
          if (!panel) return;
          const startHeight = rightDock ? panel.offsetWidth : panel.offsetHeight;
          const scale = (rightDock ? panel.getBoundingClientRect().width : panel.getBoundingClientRect().height) / (startHeight || 1);
          const startY = rightDock ? e.clientX : e.clientY;
          const cursor = document.body.style.cursor;
          const selection = document.body.style.userSelect;
          document.body.style.cursor = rightDock ? "ew-resize" : "ns-resize";
          document.body.style.userSelect = "none";
          const move = (event: PointerEvent) => resize(resizeIntegratedPeek(startHeight, (rightDock ? event.clientX : event.clientY) - startY, scale, maxHeight, rightDock ? 320 : 140));
          const cleanup = () => {
            document.body.style.cursor = cursor;
            document.body.style.userSelect = selection;
            document.removeEventListener("pointermove", move);
            document.removeEventListener("pointerup", cleanup);
            document.removeEventListener("pointercancel", cleanup);
            dragCleanup.current = null;
          };
          dragCleanup.current = cleanup;
          document.addEventListener("pointermove", move);
          document.addEventListener("pointerup", cleanup);
          document.addEventListener("pointercancel", cleanup);
        }} />
      <div hidden style={{ display: "none" }} className="dbs-toolbar h-7 shrink-0 px-3 flex items-center gap-2 border-b border-zinc-800/60 text-[11px]">
        <ShareNetwork size={13} className="text-violet-400" />
        <span className="flex-1 min-w-0 truncate font-semibold text-violet-300" {...helpHandlers(`${table} Relations`)}>{table} Relations</span>
        <button onClick={onClose}
          aria-label="Close Peek ALL panel" {...helpHandlers("Close Peek ALL panel")}
          className="p-1 rounded text-zinc-400 hover:text-zinc-100 hover:bg-zinc-800"><X size={13} /></button>
      </div>
      <div className="flex flex-1 min-h-0 overflow-hidden">
      {relationsPanel && (state.relationsCollapsed ? (
        <button type="button" data-el="master-relations-expand"
          aria-label="Expand master Relations panel" aria-expanded={false}
          {...helpHandlers("Expand the master Relations panel")}
          onClick={() => change({ relationsCollapsed: false })}
          className="flex w-7 shrink-0 flex-col items-center gap-2 border-r border-zinc-700 py-2 text-zinc-400 hover:bg-zinc-800 hover:text-zinc-100">
          <CaretDoubleRight size={15} />
          <span className="text-[11px] [writing-mode:vertical-rl]">Relations</span>
        </button>
      ) : relationsPanel)}
      <div className="flex flex-col flex-1 min-w-0 min-h-0">
      <div role="tablist" aria-label="Relation peeks" className="flex shrink-0 overflow-x-auto bg-zinc-950"
        style={depth > 0 ? { backgroundColor: peekDepthTint(depth - 1) } : undefined}>
        {peeks.map((p) => <PeekTab key={p.id} idPrefix={idPrefix} peek={p} active={p.id === activeId} accentColor={depthColor} parentTitle={parentTitle} onSelect={() => select(p.id)} onContextMenu={(x, y) => setTabMenu({ id: p.id, x, y })} />)}
        <div className="flex-1 border-b border-zinc-700" />
      </div>
      <div className="flex-1 min-h-0 overflow-hidden">
        {peeks.map((p) => <div key={p.id} role="tabpanel" id={`${idPrefix}panel-${p.id}`}
          aria-labelledby={`${idPrefix}tab-${p.id}`} hidden={p.id !== activeId} className="h-full bg-[var(--peek-tint,#2d2a3b)]">
          <PeekNavigation.Provider value={parentLocation ? [...inherited, { ...parentLocation, childTable: p.target.table }] : inherited}>
          {(visited.has(p.id) || p.id === activeId) && <PeekPanel key={JSON.stringify([p.id, p.title, p.sourceTable, p.sourceColumn, p.target.table, p.target.column, p.kind])} active={active && p.id === activeId}
            profileName={p.profileName}
            parentTable={table}
            parentSolo={state.solo ?? false}
            profileId={p.profileId} database={p.database} target={p.target} initialView={p} title={p.title} trail={`${parentTitle ?? table} › ${p.title}`}
            onViewChange={(patch) => updateView(p.id, patch)} />}
          </PeekNavigation.Provider>
        </div>)}
        {peeks.length === 0 && <div role="status" className="p-4 text-sm text-zinc-500">{selectionBlocked ? "Select a single row or cell to view relations." : state.peeks.length ? "Related records are already displayed above." : "Click a relation name to open a peek tab."}</div>}
      </div>
      </div>
      </div>
    </div>
    {tabMenu && <PeekTabMenu x={tabMenu.x} y={tabMenu.y} onClose={() => closePeek(tabMenu.id)} />}
    </PeekDepth.Provider>
  );
}

function PeekTabMenu({ x, y, onClose }: { x: number; y: number; onClose: () => void }) {
  const { ref, style } = useAnchoredPosition(x, y);
  return createPortal(
    <div ref={ref} data-el="peek-tab-menu" style={style} onClick={(e) => e.stopPropagation()}
      className="dbs-context-menu fixed z-50 min-w-[140px] rounded border border-zinc-700 bg-zinc-900/95 backdrop-blur-sm py-1 shadow-xl shadow-black/60">
      <button className="flex w-full items-center gap-2.5 px-3 py-1.5 text-left text-zinc-200 hover:bg-zinc-800" onClick={onClose}>
        <X size={14} className="shrink-0 text-rose-400" />
        Close
      </button>
    </div>,
    document.body
  );
}
