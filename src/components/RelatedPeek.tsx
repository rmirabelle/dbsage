import { useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { X, ArrowSquareOut, CircleNotch, ShareNetwork } from "@phosphor-icons/react";
import clsx from "clsx";
import { ipc } from "../ipc";
import { useUi } from "../state/ui";
import { useStore } from "../state/store";
import { DataGrid, gridContentWidth } from "./DataGrid";
import {
  relationTargets,
  peekableColumnsFor,
  relatedLabel,
  cellToFilterValue,
  type RelationTarget,
} from "../lib/relations";
import { useRelatedExistence, relKey } from "../lib/relatedExistence";
import type { ColumnFilter, Relation, RowsResult, SortSpec } from "../types";

const EMPTY_RELATIONS: Relation[] = [];

/** The resolved target of a relation peek: a table/column and the cell value to
 * match against it. */
export interface PeekTarget {
  table: string;
  column: string;
  value: string;
}

const PEEK_LIMIT = 1000;

/** Geometry for sizing the panel to its content. DataGrid's root uses
 * `contain: strict`, so it can't size to content itself — we compute the height
 * from the row count instead and let the grid scroll only once we hit the cap. */
const ROW_H = 26; // mirrors DataGrid ROW_HEIGHT
const GRID_HEADER_H = 44; // DataGrid sticky header (name + type rows)
const EMPTY_REGION_H = 160; // DataGrid "No rows" block
const TOOLBAR_H = 40; // peek header bar (h-10)
const BORDER = 3; // border-[3px]; included in height via box-border, so add it back

const MIN_PEEK_W = 800;
const MIN_PEEK_H = 160;

type PaneRect = { left: number; top: number; width: number; height: number };

/** Clamp a top-left (screen px). The left edge may travel until it sits 40px
 *  short of the OS window's right edge (the peek can park almost fully off-
 *  screen to the right). Vertical bounds remain inside the pane. */
function clampToPane(
  x: number,
  y: number,
  winW: number,
  winH: number,
  pane: PaneRect | null
) {
  if (!pane) return { x, y };
  const maxX = window.innerWidth - 40;
  const maxY = pane.top + Math.max(0, pane.height - winH);
  return {
    x: Math.min(Math.max(x, pane.left), maxX),
    y: Math.min(Math.max(y, pane.top), maxY),
  };
}

export function RelatedPeek({
  profileId,
  database,
  target,
  initialX,
  initialY,
  zIndex,
  onFocus,
  onOpenPeek,
  onActiveValueChange,
  onOpenAsTab,
  onClose,
}: {
  profileId: string;
  database: string;
  target: PeekTarget;
  initialX: number;
  initialY: number;
  zIndex: number;
  /** Called when the window is interacted with, so the parent can raise it. */
  onFocus: () => void;
  /** Open a child peek for a relation found on this peek's own table. */
  onOpenPeek: (
    target: RelationTarget,
    ctx: {
      sourceTable: string;
      sourceColumn: string;
      value: string;
      anchorX: number;
      anchorY: number;
    }
  ) => void;
  /** Report this peek's selected value so child peeks can follow it. */
  onActiveValueChange?: (column: string, value: string) => void;
  onOpenAsTab: () => void;
  onClose: () => void;
}) {
  const [sort, setSort] = useState<SortSpec | null>(null);
  const [extraFilters, setExtraFilters] = useState<ColumnFilter[]>([]);
  const [hiddenColumns, setHiddenColumns] = useState<string[]>([]);
  const [jsonDisplay, setJsonDisplay] = useState<Record<string, string>>({});
  const [columnWidths, setColumnWidths] = useState<Record<string, number>>({});
  const [activeCell, setActiveCell] = useState<{
    rowIndex: number;
    column: string;
  } | null>(null);

  const [data, setData] = useState<RowsResult | null>(null);
  const [total, setTotal] = useState<number | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const tabsZoom = useUi((s) => s.tabsZoom);

  /** On-screen rect of the tabs pane, so the peek can be sized, placed, and
   * dragged within it. Measured from the main pane's edges, which are reliable
   * layout positions regardless of the pane's own CSS zoom. */
  const [pane, setPane] = useState<PaneRect | null>(null);

  /** User-set on-screen size (px). null = auto-size to content. */
  const [size, setSize] = useState<{ w: number; h: number } | null>(null);
  useEffect(() => {
    const measure = () => {
      const el = document.querySelector('[data-el="main-pane"]');
      if (!el) return setPane(null);
      const r = el.getBoundingClientRect();
      setPane({
        left: r.left,
        top: r.top,
        width: Math.max(0, window.innerWidth - r.left),
        height: Math.max(0, r.bottom - r.top),
      });
    };
    measure();
    window.addEventListener("resize", measure);
    return () => window.removeEventListener("resize", measure);
  }, []);

  const [pos, setPos] = useState({ x: initialX, y: initialY });
  const posRef = useRef(pos);
  posRef.current = pos;

  /** Live clamp bounds (pane rect + the window's on-screen size), read during a
   * drag so the window stays fully inside the tabs pane. */
  const clampRef = useRef<{
    pane: typeof pane;
    winW: number;
    winH: number;
  }>({ pane: null, winW: 0, winH: 0 });

  /** Drag the window by its header (ignoring clicks on the header's buttons). */
  const onHeaderPointerDown = (e: React.PointerEvent) => {
    if ((e.target as HTMLElement).closest("button")) return;
    onFocus();
    const startX = e.clientX;
    const startY = e.clientY;
    const origin = posRef.current;
    const onMove = (ev: PointerEvent) => {
      const c = clampRef.current;
      setPos(
        clampToPane(
          origin.x + (ev.clientX - startX),
          origin.y + (ev.clientY - startY),
          c.winW,
          c.winH,
          c.pane
        )
      );
    };
    const onUp = () => {
      document.removeEventListener("pointermove", onMove);
      document.removeEventListener("pointerup", onUp);
      document.body.style.userSelect = "";
    };
    document.body.style.userSelect = "none";
    document.addEventListener("pointermove", onMove);
    document.addEventListener("pointerup", onUp);
  };

  /** Resize from any edge or corner. `dir` says which edges move; dragging the
   * west/north edges also shifts the top-left anchor (`pos`). Sizes are screen
   * px, so the pointer delta maps 1:1 regardless of the panel's CSS zoom. */
  const startResize = (
    e: React.PointerEvent,
    dir: { n?: boolean; s?: boolean; e?: boolean; w?: boolean }
  ) => {
    e.preventDefault();
    e.stopPropagation();
    onFocus();
    const startX = e.clientX;
    const startY = e.clientY;
    const startW = clampRef.current.winW;
    const startH = clampRef.current.winH;
    const start = posRef.current;
    const onMove = (ev: PointerEvent) => {
      const c = clampRef.current;
      const dx = ev.clientX - startX;
      const dy = ev.clientY - startY;
      let w = startW;
      let h = startH;
      let x = start.x;
      let y = start.y;
      if (dir.e) w = startW + dx;
      if (dir.s) h = startH + dy;
      if (dir.w) {
        w = startW - dx;
        x = start.x + dx;
      }
      if (dir.n) {
        h = startH - dy;
        y = start.y + dy;
      }
      /* Honor the minimum, keeping the opposite (anchored) edge in place. */
      if (w < MIN_PEEK_W) {
        if (dir.w) x -= MIN_PEEK_W - w;
        w = MIN_PEEK_W;
      }
      if (h < MIN_PEEK_H) {
        if (dir.n) y -= MIN_PEEK_H - h;
        h = MIN_PEEK_H;
      }
      /* Keep the window inside the tabs pane. */
      if (c.pane) {
        const right = c.pane.left + c.pane.width;
        const bottom = c.pane.top + c.pane.height;
        if (dir.w && x < c.pane.left) {
          w -= c.pane.left - x;
          x = c.pane.left;
        }
        if (dir.n && y < c.pane.top) {
          h -= c.pane.top - y;
          y = c.pane.top;
        }
        if (dir.e && x + w > right) w = right - x;
        if (dir.s && y + h > bottom) h = bottom - y;
        w = Math.max(w, MIN_PEEK_W);
        h = Math.max(h, MIN_PEEK_H);
      }
      setSize({ w, h });
      if (dir.w || dir.n) setPos({ x, y });
    };
    const onUp = () => {
      document.removeEventListener("pointermove", onMove);
      document.removeEventListener("pointerup", onUp);
      document.body.style.userSelect = "";
    };
    document.body.style.userSelect = "none";
    document.addEventListener("pointermove", onMove);
    document.addEventListener("pointerup", onUp);
  };

  const baseFilter: ColumnFilter = {
    column: target.column,
    op: "equals",
    value: target.value,
  };
  /** The equality match always applies; header filters refine it further. */
  const filters = [baseFilter, ...extraFilters];
  const filtersKey = JSON.stringify(filters);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);
    ipc
      .fetchRows({
        profileId,
        database,
        table: target.table,
        limit: PEEK_LIMIT,
        offset: 0,
        sort,
        filters,
      })
      .then((res) => {
        if (cancelled) return;
        setData(res);
      })
      .catch((e) => {
        if (!cancelled) setError(String(e));
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [profileId, database, target.table, filtersKey, sort]);

  useEffect(() => {
    let cancelled = false;
    ipc
      .countRows({ profileId, database, table: target.table, filters })
      .then((n) => {
        if (!cancelled) setTotal(n);
      })
      .catch(() => {
        if (!cancelled) setTotal(null);
      });
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [profileId, database, target.table, filtersKey]);

  const onFilterChange = (column: string, filter: ColumnFilter | null) =>
    setExtraFilters((prev) => {
      const rest = prev.filter((f) => f.column !== column);
      return filter ? [...rest, filter] : rest;
    });

  /* Relations for this peek's OWN table, so it can itself be peeked from. */
  const relations =
    useStore((s) => s.relations[`${profileId}::${database}`]) ??
    EMPTY_RELATIONS;
  const peekableColumns = useMemo(
    () => peekableColumnsFor(relations, target.table),
    [relations, target.table]
  );
  const activeColumnName = activeCell?.column ?? null;
  const activeValue =
    activeCell && data
      ? data.rows[activeCell.rowIndex]?.[activeCell.column]
      : undefined;
  const peekValue = cellToFilterValue(activeValue);
  const relMatches = useMemo(
    () =>
      activeColumnName
        ? relationTargets(relations, target.table, activeColumnName)
        : [],
    [relations, target.table, activeColumnName]
  );
  const hasRelation = !!activeCell && peekValue != null && relMatches.length > 0;
  /** Disable peeking into relation targets with no matching rows (optimistically
   * enabled while the check is in flight). */
  const { exists: relExists, pending: relExistPending } = useRelatedExistence(
    profileId,
    database,
    relMatches,
    hasRelation ? peekValue : null
  );
  const nonEmptyMatches = relMatches.filter((m) => relExists[relKey(m)] !== false);
  const canPeek =
    hasRelation && (relExistPending || nonEmptyMatches.length > 0);
  const peekBtnLabel = relatedLabel(relMatches);
  const relatedTitle = !activeCell
    ? "Select a cell to peek into a related table"
    : peekValue == null
    ? "This cell is NULL — nothing to match on"
    : relMatches.length === 0
    ? `No relation defined on ${target.table}.${activeColumnName ?? ""}`
    : !relExistPending && nonEmptyMatches.length === 0
    ? `No related rows in ${relMatches.map((m) => m.table).join(", ")}`
    : `Peek into ${(nonEmptyMatches.length > 0 ? nonEmptyMatches : relMatches)
        .map((m) => m.table)
        .join(", ")}`;

  const [picker, setPicker] = useState<{
    x: number;
    y: number;
    matches: RelationTarget[];
  } | null>(null);

  const openChild = (t: RelationTarget) => {
    if (peekValue == null || !activeColumnName) return;
    onOpenPeek(t, {
      sourceTable: target.table,
      sourceColumn: activeColumnName,
      value: peekValue,
      anchorX: posRef.current.x,
      anchorY: posRef.current.y,
    });
  };

  const onRelatedClick = (e: React.MouseEvent<HTMLButtonElement>) => {
    /** A single relation on this column opens directly. When several are defined
     * (the "x tables" label), always show the picker so the user chooses which —
     * never silently auto-open one. */
    if (relMatches.length === 1) {
      openChild(relMatches[0]);
      return;
    }
    const rect = e.currentTarget.getBoundingClientRect();
    setPicker({ x: rect.left, y: rect.bottom + 4, matches: relMatches });
  };

  /* Clear a stale active cell when the rows change (re-fetch / sort / filter). */
  useEffect(() => {
    setActiveCell(null);
  }, [data?.rows]);

  /* Live-follow: report this peek's selected value so the parent can update any
     child peeks launched from this peek's column. */
  const onActiveValueChangeRef = useRef(onActiveValueChange);
  onActiveValueChangeRef.current = onActiveValueChange;
  useEffect(() => {
    if (!activeColumnName || peekValue == null) return;
    onActiveValueChangeRef.current?.(activeColumnName, peekValue);
  }, [activeColumnName, peekValue]);

  const shown = data?.rows.length ?? 0;
  const capped = total != null && total > PEEK_LIMIT;

  /** Height that fits the content; capped to the pane height below, where the
   * grid scrolls. Floored 30px above the natural single-row height so short
   * results aren't cramped. */
  const MIN_PANEL_H = TOOLBAR_H + GRID_HEADER_H + ROW_H + 2 + 30;
  const bodyH =
    loading && !data
      ? 140
      : GRID_HEADER_H + (shown === 0 ? EMPTY_REGION_H : shown * ROW_H) + 2;
  const panelH =
    Math.max(MIN_PANEL_H, TOOLBAR_H + (error ? 52 : 0) + bodyH) + BORDER * 2;

  /** Auto-size the window to a fraction of the tabs pane (never wider than it,
   * minus an inset), unless the user has dragged it to an explicit `size`. The
   * inner panel is zoomed, so divide on-screen sizes by zoom to get CSS sizes. */
  const PANE_INSET = 16;
  const DEFAULT_W_FRACTION = 0.8;
  const paneW = pane?.width ?? 0.82 * window.innerWidth;
  const paneH = pane?.height ?? 0.8 * window.innerHeight;
  const maxScreenW = Math.max(MIN_PEEK_W, paneW - PANE_INSET * 2);
  /** The window's top stays anchored at its launch point; it may grow downward
   * to the pane's bottom edge but no further, so it never extends off-screen and
   * never grows up over the rows it was launched from. */
  const maxScreenH = Math.max(
    MIN_PEEK_H,
    pane ? pane.top + pane.height - pos.y : paneH - PANE_INSET
  );
  /** Default cap: never wider than ~80% of the pane (wide grids still scroll). */
  const defaultWinW = Math.min(Math.round(paneW * DEFAULT_W_FRACTION), maxScreenW);
  /** Shrink to fit the grid's own columns when they're narrower than the cap, so
   * a few-column peek isn't needlessly wide. (+16 CSS px for borders + a possible
   * vertical scrollbar; the panel is zoomed, so convert to on-screen px.) */
  const autoWinW = data
    ? Math.max(
        MIN_PEEK_W,
        Math.min(
          (gridContentWidth(data.columns, data.rows, columnWidths, hiddenColumns) +
            16) *
            tabsZoom,
          defaultWinW
        )
      )
    : defaultWinW;
  const autoWinH = Math.min(panelH * tabsZoom, maxScreenH);
  const winW = size
    ? Math.min(Math.max(size.w, MIN_PEEK_W), maxScreenW)
    : autoWinW;
  const winH = size
    ? Math.min(Math.max(size.h, MIN_PEEK_H), maxScreenH)
    : autoWinH;
  const innerWidth = winW / tabsZoom;
  const innerHeight = size ? winH / tabsZoom : panelH;
  const innerMaxHeight = (size ? winH : maxScreenH) / tabsZoom;
  clampRef.current = { pane, winW, winH };

  return (
    <>
    {createPortal(
    /* Outer wrapper carries the (screen-space) position so drag math is
       unaffected by zoom; the inner panel carries `zoom` to match the tabs
       pane, since the body portal otherwise escapes that zoom. vh-based caps
       are divided by zoom so the on-screen cap stays ~80vh. */
    <div
      data-el="related-peek"
      onMouseDown={onFocus}
      style={{ position: "fixed", left: pos.x, top: pos.y, zIndex }}
    >
      <div
        style={{
          zoom: tabsZoom,
          width: innerWidth,
          height: innerHeight,
          maxHeight: innerMaxHeight,
        }}
        className="flex flex-col rounded-lg border-[3px] border-emerald-500 bg-zinc-950 shadow-2xl shadow-black/60 overflow-hidden"
      >
        <div
          onPointerDown={onHeaderPointerDown}
          className="dbs-toolbar shrink-0 h-10 pl-3 pr-2 flex items-center gap-2 border-b border-zinc-800/60 cursor-move select-none"
        >
          <ShareNetwork size={16} className="text-violet-400 shrink-0" />
          <span className="flex-1 min-w-0 text-[13px] text-zinc-200 truncate">
            <span className="font-semibold text-zinc-100">{target.table}</span>
            <span className="text-zinc-500"> where </span>
            <span className="font-mono text-zinc-300">{target.column}</span>
            <span className="text-zinc-500"> = </span>
            <span className="font-mono text-accent-300">
              {JSON.stringify(target.value)}
            </span>
          </span>
          <span className="text-[11px] text-zinc-500 shrink-0">
            {total == null
              ? `${shown} shown`
              : capped
              ? `${shown} of ${total.toLocaleString()} (first ${PEEK_LIMIT})`
              : `${total.toLocaleString()} row${total === 1 ? "" : "s"}`}
          </span>

          <button
            data-el="peek-related-btn"
            disabled={!canPeek}
            onClick={onRelatedClick}
            className={clsx(
              "shrink-0 inline-flex items-center gap-1.5 px-2 py-1 rounded text-[11px] font-semibold transition-colors",
              canPeek
                ? "bg-violet-500 text-violet-950 hover:bg-violet-400"
                : "bg-zinc-800 text-zinc-600 cursor-not-allowed"
            )}
            title={relatedTitle}
          >
            <ShareNetwork size={14} />
            {peekBtnLabel}
          </button>
          <button
            data-el="peek-open-tab-btn"
            onClick={onOpenAsTab}
            className="shrink-0 inline-flex items-center gap-1.5 px-2 py-1 rounded text-[11px] font-semibold bg-accent-500 text-[#042f2e] hover:bg-accent-400 transition-colors"
            title="Open this related table as a full, filtered tab"
          >
            <ArrowSquareOut size={15} />
            Open Table
          </button>
          <button
            data-el="peek-close-btn"
            onClick={onClose}
            className="p-1 rounded text-zinc-400 hover:text-zinc-100 hover:bg-zinc-800"
            aria-label="Close"
          >
            <X size={16} />
          </button>
        </div>

        {error && (
          <div className="shrink-0 mx-3 mt-3 rounded bg-rose-950/40 border border-rose-900/60 px-3 py-2 text-[11px] text-rose-300 break-words">
            {error}
          </div>
        )}

        {loading && !data ? (
          <div className="flex-1 flex items-center justify-center text-zinc-500 text-xs gap-2">
            <CircleNotch size={16} className="animate-spin" /> Loading related rows…
          </div>
        ) : data ? (
          <div className="relative flex-1 min-h-0 flex flex-col">
          <DataGrid
            readOnly
            columns={data.columns}
            rows={data.rows}
            offset={data.offset}
            sort={sort}
            filters={extraFilters}
            hiddenColumns={hiddenColumns}
            jsonDisplay={jsonDisplay}
            columnWidths={columnWidths}
            peekableColumns={peekableColumns}
            activeCell={activeCell}
            clearActiveCellOnRowSelect
            onActiveCellChange={setActiveCell}
            onColumnWidthsChange={setColumnWidths}
            onSortChange={setSort}
            onFilterChange={onFilterChange}
            onHiddenColumnsChange={setHiddenColumns}
            onJsonShow={(column, path) =>
              setJsonDisplay((prev) => {
                const next = { ...prev };
                if (path) next[column] = path;
                else delete next[column];
                return next;
              })
            }
            onCellEdit={async () => {}}
          />
          <div className="pointer-events-none absolute inset-0 bg-violet-500/[0.06]" />
          </div>
        ) : (
          <div className="flex-1" />
        )}
      </div>

      {/* Edge + corner resize handles. Edges are thin strips; corners are small
          squares layered above them. */}
      <div onPointerDown={(e) => startResize(e, { n: true })} className="absolute top-0 inset-x-0 z-10 h-1 cursor-ns-resize" />
      <div onPointerDown={(e) => startResize(e, { s: true })} className="absolute bottom-0 inset-x-0 z-10 h-1 cursor-ns-resize" />
      <div onPointerDown={(e) => startResize(e, { w: true })} className="absolute left-0 inset-y-0 z-10 w-1 cursor-ew-resize" />
      <div onPointerDown={(e) => startResize(e, { e: true })} className="absolute right-0 inset-y-0 z-10 w-1 cursor-ew-resize" />
      <div onPointerDown={(e) => startResize(e, { n: true, w: true })} className="absolute top-0 left-0 z-20 h-3 w-3 cursor-nwse-resize" />
      <div onPointerDown={(e) => startResize(e, { n: true, e: true })} className="absolute top-0 right-0 z-20 h-3 w-3 cursor-nesw-resize" />
      <div onPointerDown={(e) => startResize(e, { s: true, w: true })} className="absolute bottom-0 left-0 z-20 h-3 w-3 cursor-nesw-resize" />
      <div
        data-el="peek-resize-handle"
        onPointerDown={(e) => startResize(e, { s: true, e: true })}
        title="Drag to resize"
        className="absolute bottom-0 right-0 z-20 h-4 w-4 cursor-nwse-resize"
      >
        <div className="absolute bottom-[3px] right-[3px] h-2 w-2 border-b-2 border-r-2 border-zinc-400/70" />
      </div>
    </div>,
    document.body
    )}

    {picker &&
      createPortal(
        <>
          <div
            className="fixed inset-0"
            style={{ zIndex: zIndex + 1 }}
            onMouseDown={() => setPicker(null)}
          />
          <div
            data-el="peek-related-picker"
            style={{ top: picker.y, left: picker.x, zIndex: zIndex + 2 }}
            className="dbs-context-menu fixed w-max rounded border border-zinc-700 bg-zinc-900/95 backdrop-blur-sm py-1 shadow-xl shadow-black/60 text-zinc-200"
          >
            <div className="px-3 py-1 text-[10px] uppercase tracking-wide text-zinc-500">
              Peek into
            </div>
            {picker.matches.map((m) => (
              <button
                key={`${m.table}::${m.column}`}
                onClick={() => {
                  setPicker(null);
                  openChild(m);
                }}
                className="flex w-full items-center gap-1 px-3 py-1.5 text-left text-[12px] hover:bg-zinc-800 whitespace-nowrap"
              >
                <span className="font-medium text-zinc-100">{m.table}</span>
                <span className="font-mono text-zinc-500">.{m.column}</span>
              </button>
            ))}
          </div>
        </>,
        document.body
      )}
    </>
  );
}
