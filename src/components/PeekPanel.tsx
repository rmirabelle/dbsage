import { useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import {
  ArrowSquareOut,
  CircleNotch,
  ShareNetwork,
} from "@phosphor-icons/react";
import clsx from "clsx";
import { emit } from "@tauri-apps/api/event";
import { ipc } from "../ipc";
import { useStore } from "../state/store";
import { useUi } from "../state/ui";
import { DataGrid } from "./DataGrid";
import { WindowControls } from "./WindowControls";
import {
  relationTargets,
  peekableColumnsFor,
  cellToFilterValue,
  type RelationTarget,
} from "../lib/relations";
import { useRelatedExistence, relKey } from "../lib/relatedExistence";
import type { ColumnFilter, PeekTarget, Relation, RowsResult, SortSpec } from "../types";

const EMPTY_RELATIONS: Relation[] = [];
const PEEK_LIMIT = 1000;

/**
 * The body of a peek: a read-only, filtered grid of rows in `target.table`
 * where `target.column = target.value`, plus the controls to peek further into
 * its own relations or promote it to a full tab. Fills its container — geometry
 * (position, size, resize) is the OS window's job now (see {@link PeekWindow}),
 * not an in-app overlay's.
 */
export function PeekPanel({
  profileId,
  database,
  target,
  initialHiddenColumns,
  onHiddenColumnsChange,
  onOpenChildPeek,
  onOpenAsTab,
}: {
  profileId: string;
  database: string;
  target: PeekTarget;
  /** Columns hidden when the peek was restored from a saved view (empty for a
   * freshly-launched peek). */
  initialHiddenColumns?: string[];
  /** Report the peek's current hidden columns so the host can persist them for
   * saved-view capture. */
  onHiddenColumnsChange?: (hidden: string[]) => void;
  /** Peek into a relation found on this peek's own table (opens a new window). */
  onOpenChildPeek: (target: RelationTarget, sourceColumn: string, value: string) => void;
  /** Promote this peek's table to a full, filtered tab in the main window. */
  onOpenAsTab: () => void;
}) {
  const tabsZoom = useUi((s) => s.tabsZoom);
  const [sort, setSort] = useState<SortSpec | null>(null);
  const [extraFilters, setExtraFilters] = useState<ColumnFilter[]>([]);
  const [hiddenColumns, setHiddenColumns] = useState<string[]>(
    initialHiddenColumns ?? []
  );
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
        if (!cancelled) setData(res);
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

  /* Broadcast this peek's selection so peeks launched from its table+column
     (nested peeks) live-follow it, just like the main grid drives its peeks. */
  useEffect(() => {
    if (!activeColumnName || peekValue == null) return;
    emit("dbsage://peek-follow", {
      profileId,
      database,
      sourceTable: target.table,
      sourceColumn: activeColumnName,
      value: peekValue,
    });
  }, [activeColumnName, peekValue, target.table, profileId, database]);

  const relMatches = useMemo(
    () =>
      activeColumnName
        ? relationTargets(relations, target.table, activeColumnName)
        : [],
    [relations, target.table, activeColumnName]
  );
  const hasRelation = !!activeCell && peekValue != null && relMatches.length > 0;
  /** Mark relation targets with no matching rows so the dropdown disables them
   * (optimistically enabled while the check is in flight). */
  const { exists: relExists } = useRelatedExistence(
    profileId,
    database,
    relMatches,
    hasRelation ? peekValue : null
  );

  const [picker, setPicker] = useState<{
    x: number;
    y: number;
    matches: RelationTarget[];
    /** The cell the menu is anchored to, so re-clicking it toggles closed. */
    cell: { rowIndex: number; column: string };
  } | null>(null);
  const pickerRef = useRef<HTMLDivElement>(null);

  const openChild = (t: RelationTarget) => {
    if (peekValue == null || !activeColumnName) return;
    onOpenChildPeek(t, activeColumnName, peekValue);
  };

  /** Single-clicking a relation cell selects it (unchanged) AND drops the
   * relation menu just below it — same treatment as the main table view —
   * and clicking the same cell again toggles it closed. Non-relation/NULL
   * cells dismiss the menu. (Peek grids are read-only, so there's no
   * double-click-edit case here.) */
  const onCellMenu = (
    cell: { rowIndex: number; column: string; rect: DOMRect } | null
  ) => {
    if (!cell || !data) {
      setPicker(null);
      return;
    }
    if (
      picker &&
      picker.cell.rowIndex === cell.rowIndex &&
      picker.cell.column === cell.column
    ) {
      setPicker(null);
      return;
    }
    const value = cellToFilterValue(data.rows[cell.rowIndex]?.[cell.column]);
    const matches = relationTargets(relations, target.table, cell.column);
    if (value == null || matches.length === 0) {
      setPicker(null);
      return;
    }
    setPicker({
      x: cell.rect.left,
      y: cell.rect.bottom + 4,
      matches,
      cell: { rowIndex: cell.rowIndex, column: cell.column },
    });
  };

  /** Listener-based dismissal (no backdrop, so the next cell click lands):
   * mousedown outside the menu, any key, or scrolling the grid away. */
  useEffect(() => {
    if (!picker) return;
    const close = () => setPicker(null);
    const onDown = (e: MouseEvent) => {
      /* Grid-cell mousedowns are arbitrated by onCellMenu on the subsequent
         click (open / move / same-cell toggle) — closing here too would defeat
         the toggle. */
      if ((e.target as HTMLElement).closest('[data-el="grid-cell"]')) return;
      if (!pickerRef.current?.contains(e.target as Node)) close();
    };
    window.addEventListener("mousedown", onDown);
    window.addEventListener("keydown", close);
    window.addEventListener("scroll", close, true);
    return () => {
      window.removeEventListener("mousedown", onDown);
      window.removeEventListener("keydown", close);
      window.removeEventListener("scroll", close, true);
    };
  }, [picker]);

  /* Clear a stale active cell when the rows change (re-fetch / sort / filter). */
  useEffect(() => {
    setActiveCell(null);
  }, [data?.rows]);

  const shown = data?.rows.length ?? 0;
  const capped = total != null && total > PEEK_LIMIT;

  return (
    <div className="h-full w-full flex flex-col bg-zinc-950">
      <div
        data-el="peek-titlebar"
        data-tauri-drag-region
        className="dbs-toolbar shrink-0 h-10 pl-3 flex items-center gap-2 border-b border-zinc-800/60 select-none"
      >
        <ShareNetwork size={16} className="text-violet-400 shrink-0 pointer-events-none" />
        <span className="flex-1 min-w-0 text-[13px] text-zinc-200 truncate pointer-events-none">
          <span className="font-semibold text-zinc-100">{target.table}</span>
          <span className="text-zinc-500"> where </span>
          <span className="font-mono text-zinc-300">{target.column}</span>
          <span className="text-zinc-500"> = </span>
          <span className="font-mono text-accent-300">
            {JSON.stringify(target.value)}
          </span>
        </span>
        <span className="text-[11px] text-zinc-500 shrink-0 pointer-events-none">
          {total == null
            ? `${shown} shown`
            : capped
            ? `${shown} of ${total.toLocaleString()} (first ${PEEK_LIMIT})`
            : `${total.toLocaleString()} row${total === 1 ? "" : "s"}`}
        </span>

        <button
          data-el="peek-open-tab-btn"
          onClick={onOpenAsTab}
          className="shrink-0 inline-flex items-center justify-center p-1 rounded bg-emerald-500 text-emerald-950 hover:bg-emerald-400 transition-colors"
          title="Open this related table as a full, filtered tab"
          aria-label="Open this related table as a full, filtered tab"
        >
          <ArrowSquareOut size={15} />
        </button>
        <WindowControls onCloseAll={() => ipc.closeAllPeeks().catch(() => {})} />
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
        /* The grid zooms with the shared tabs zoom (same scale as the main
           window's table views); the titlebar above is window chrome and stays
           fixed, mirroring the main window's layout. */
        <div
          className="relative flex-1 min-h-0 flex flex-col"
          style={tabsZoom !== 1 ? { zoom: tabsZoom } : undefined}
        >
          <DataGrid
            readOnly
            hideValueTooltip
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
            onCellMenu={onCellMenu}
            onColumnWidthsChange={setColumnWidths}
            onSortChange={setSort}
            onFilterChange={onFilterChange}
            onHiddenColumnsChange={(hidden) => {
              setHiddenColumns(hidden);
              onHiddenColumnsChange?.(hidden);
            }}
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

      {picker &&
        createPortal(
          <div
            ref={pickerRef}
            data-el="peek-related-picker"
            style={{ top: picker.y, left: picker.x }}
            className="dbs-context-menu fixed z-50 w-max rounded border border-zinc-700 bg-zinc-900/95 backdrop-blur-sm py-1 shadow-xl shadow-black/60 text-zinc-200"
          >
            <div className="px-3 py-1 text-[10px] uppercase tracking-wide text-zinc-500">
              Peek into
            </div>
            {picker.matches.map((m) => {
              const empty = relExists[relKey(m)] === false;
              return (
                <button
                  key={`${m.table}::${m.column}`}
                  disabled={empty}
                  onClick={() => {
                    setPicker(null);
                    openChild(m);
                  }}
                  title={empty ? `No related rows in ${m.table}` : undefined}
                  className={clsx(
                    "flex w-full items-center gap-1 px-3 py-1.5 text-left text-[12px] whitespace-nowrap",
                    empty ? "cursor-not-allowed opacity-40" : "hover:bg-zinc-800"
                  )}
                >
                  <span className="font-medium text-zinc-100">{m.table}</span>
                  <span className="font-mono text-zinc-500">.{m.column}</span>
                </button>
              );
            })}
          </div>,
          document.body
        )}
    </div>
  );
}
