import { useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import {
  ArrowSquareOut,
  Binoculars,
  CircleNotch,
  ShareNetwork,
  SquaresFour,
  Warning,
  X,
} from "@phosphor-icons/react";
import clsx from "clsx";
import { emit } from "@tauri-apps/api/event";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { ipc } from "../ipc";
import { useStore } from "../state/store";
import { useUi } from "../state/ui";
import { DataGrid } from "./DataGrid";
import { ExpandedPanel } from "./ExpandedPanel";
import { RelationEditDialog } from "./RelationEditDialog";
import { RelationsPanel } from "./RelationsPanel";
import { WindowControls } from "./WindowControls";
import {
  peekableColumnsFor,
  cellToFilterValue,
  type RelationTarget,
  type RowRelationTarget,
} from "../lib/relations";
import {
  deleteRowsWithCascade,
  previewCascadeTargets,
} from "../lib/rowDelete";
import { useBackdropDismiss } from "../lib/useBackdropDismiss";
import type {
  CascadeTarget,
  ColumnFilter,
  PeekTarget,
  PeekViewState,
  Relation,
  RowsResult,
  SortSpec,
} from "../types";

const EMPTY_RELATIONS: Relation[] = [];
const PEEK_LIMIT = 1000;

/**
 * The body of a peek: a read-only, filtered grid of rows in `target.table`
 * where `target.column = target.value`, plus the controls to peek further into
 * its own relations or promote it to a full tab. Fills its container — geometry
 * (position, size, resize) is the OS window's job now (see {@link PeekWindow}),
 * not an in-app overlay's.
 */
/** Shortest window (CSS px) that can still show the Inspector under the
 * titlebar with a usable slice of grid above it. Below this the Inspector
 * button is disabled and an open Inspector is hidden until the window grows. */
const INSPECTOR_MIN_WINDOW_H = 220;


export function PeekPanel({
  profileId,
  database,
  target,
  initialView,
  onViewChange,
  onOpenChildPeek,
  onOpenAsTab,
}: {
  profileId: string;
  database: string;
  target: PeekTarget;
  /** The grid state (hidden columns, sort, filters, widths, JSON display) and
   * Inspector visibility to start from — set when restoring a saved view or
   * re-seeding after a reload; a freshly-launched peek starts from defaults. */
  initialView?: PeekViewState;
  /** Report every change to that state so the host can persist it for
   * saved-view capture. */
  onViewChange?: (patch: PeekViewState) => void;
  /** Peek into a relation found on this peek's own table (opens a new window). */
  onOpenChildPeek: (target: RelationTarget, sourceColumn: string, value: string) => void;
  /** Promote this peek's table to a full, filtered tab in the main window. */
  onOpenAsTab: () => void;
}) {
  const tabsZoom = useUi((s) => s.tabsZoom);
  const [sort, setSort] = useState<SortSpec | null>(initialView?.sort ?? null);
  const [extraFilters, setExtraFilters] = useState<ColumnFilter[]>(
    initialView?.filters ?? []
  );
  const [hiddenColumns, setHiddenColumns] = useState<string[]>(
    initialView?.hiddenColumns ?? []
  );
  const [jsonDisplay, setJsonDisplay] = useState<Record<string, string>>(
    initialView?.jsonDisplay ?? {}
  );
  const [columnWidths, setColumnWidths] = useState<Record<string, number>>(
    initialView?.columnWidths ?? {}
  );

  /* Report the grid state whenever any part of it changes, so the registry
     always holds what a saved view should capture. */
  useEffect(() => {
    onViewChange?.({
      sort,
      filters: extraFilters,
      hiddenColumns,
      jsonDisplay,
      columnWidths,
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sort, extraFilters, hiddenColumns, jsonDisplay, columnWidths]);
  const [activeCell, setActiveCell] = useState<{
    rowIndex: number;
    column: string;
  } | null>(null);
  const [selectedRows, setSelectedRows] = useState<number[]>([]);
  const [relationsOpen, setRelationsOpenState] = useState(
    initialView?.relationsOpen ?? false
  );
  const setRelationsOpen = (open: boolean) => {
    setRelationsOpenState(open);
    onViewChange?.({ relationsOpen: open });
  };
  /* Report the active column so a saved view can re-select it on restore. */
  const activeColumnName = activeCell?.column ?? null;
  useEffect(() => {
    onViewChange?.({ activeColumn: activeColumnName });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeColumnName]);

  const [data, setData] = useState<RowsResult | null>(null);
  const [total, setTotal] = useState<number | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  /** Bumped after a delete so the rows and count re-fetch. */
  const [reloadKey, setReloadKey] = useState(0);

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
  }, [profileId, database, target.table, filtersKey, sort, reloadKey]);

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
  }, [profileId, database, target.table, filtersKey, reloadKey]);

  const onFilterChange = (column: string, filter: ColumnFilter | null) =>
    setExtraFilters((prev) => {
      /* The match column is fixed by the peek itself. */
      if (column === target.column) return prev;
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
  const activeColumn =
    activeCell && data
      ? data.columns.find((c) => c.name === activeCell.column) ?? null
      : null;
  const activeValue =
    activeCell && data
      ? data.rows[activeCell.rowIndex]?.[activeCell.column]
      : undefined;
  const activeRowOrdinal = activeCell ? activeCell.rowIndex + 1 : null;
  const activeRow =
    activeCell && data ? data.rows[activeCell.rowIndex] ?? null : null;
  /** The row the Relations panel describes: the active cell's, else the first
   * selected row (a row-header click clears the active cell). */
  const relationsRow =
    activeRow ??
    (data && selectedRows.length ? data.rows[selectedRows[0]] ?? null : null);

  /** The read-only Inspector panel for the selected cell. Starts closed on a
   * freshly-launched peek, but a saved view restores it open when it was showing
   * at save time. Every change reports up so the host persists it (via the peek
   * registry) for the next saved-view capture. */
  const [expanded, setExpandedState] = useState(
    initialView?.inspectorOpen ?? false
  );
  const setExpanded = (open: boolean) => {
    setExpandedState(open);
    onViewChange?.({ inspectorOpen: open });
  };
  const [tooShortForInspector, setTooShortForInspector] = useState(
    () => window.innerHeight < INSPECTOR_MIN_WINDOW_H
  );
  useEffect(() => {
    const onResize = () =>
      setTooShortForInspector(window.innerHeight < INSPECTOR_MIN_WINDOW_H);
    window.addEventListener("resize", onResize);
    return () => window.removeEventListener("resize", onResize);
  }, []);
  const showInspector = expanded && !tooShortForInspector;
  useEffect(() => {
    if (!expanded) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setExpanded(false);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [expanded]);

  /* Selecting any cell identifies its whole row. Broadcast every relation
     source value so nested peeks keep following even when the clicked cell
     itself is not a relation source column. */
  useEffect(() => {
    if (!activeRow) return;
    for (const sourceColumn of peekableColumns) {
      const value = cellToFilterValue(activeRow[sourceColumn]);
      if (value == null) continue;
      emit("dbsage://peek-follow", {
        profileId,
        database,
        sourceTable: target.table,
        sourceColumn,
        value,
      });
    }
  }, [activeRow, peekableColumns, target.table, profileId, database]);

  const [relDialog, setRelDialog] = useState<{
    relation: Relation | null;
    column: string;
  } | null>(null);

  /** Number of open peek windows the close-all confirmation will close; null when
   * the confirmation isn't showing. */
  const [confirmCloseAll, setConfirmCloseAll] = useState<number | null>(null);
  const closeConfirmBackdrop = useBackdropDismiss(
    () => setConfirmCloseAll(null),
    true
  );
  useEffect(() => {
    if (confirmCloseAll == null) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setConfirmCloseAll(null);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [confirmCloseAll]);

  const hasPrimaryKey = data?.columns.some((c) => c.key === "PRI") ?? false;
  const rowSet = () =>
    data
      ? {
          profileId,
          database,
          table: target.table,
          columns: data.columns,
          rows: data.rows,
        }
      : null;

  /** Same cascade preview as the main table view (see rowDelete.ts). */
  const previewCascade = (indices: number[]): Promise<CascadeTarget[]> => {
    const set = rowSet();
    return set
      ? previewCascadeTargets(set, relations, indices)
      : Promise.resolve([]);
  };

  /** Delete by primary key (cascading first), then re-fetch the peek. */
  const deleteRows = async (
    indices: number[],
    cascade: CascadeTarget[] | null
  ) => {
    const set = rowSet();
    if (!set) return;
    try {
      await deleteRowsWithCascade(set, indices, cascade);
    } finally {
      setReloadKey((k) => k + 1);
    }
  };

  const openChild = (t: RowRelationTarget) => {
    if (t.value == null) return;
    onOpenChildPeek(t, t.sourceColumn, t.value);
  };

  /** Closing every peek at once is easy to hit by accident (it's the corner-flush
   * button), so confirm first via a themed modal — and say how many it'll close.
   * When this is the only open peek there's nothing to confirm: just close it
   * like any normal window, skipping the dialog. (A failed enumeration counts as
   * solo too — closing only this window is the safe, non-destructive default.) */
  const requestCloseAll = async () => {
    let count = 0;
    try {
      count = (await ipc.listOpenPeeks()).length;
    } catch {
      /* fall through to the solo path below */
    }
    if (count <= 1) {
      getCurrentWindow().close();
      return;
    }
    setConfirmCloseAll(count);
  };

  /* Rows changed (re-fetch / sort / filter / the parent row moved on): keep the
     active cell when its column still exists and a row still sits at its
     index, so an open Inspector shows the new row's value at once instead of
     going blank until the cell is clicked again. Otherwise clear it. A fresh
     object is set so effects keyed on the cell (peek-follow, pinned menu)
     re-run for the new row. */
  useEffect(() => {
    setActiveCell((cell) => {
      if (!cell || !data) return null;
      if (cell.rowIndex >= data.rows.length) return null;
      if (!data.columns.some((c) => c.name === cell.column)) return null;
      return { ...cell };
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [data?.rows]);

  /* Restoring a saved view: once rows arrive, select the saved column on the
     first row so an open Inspector shows it right away. Applied once. */
  const restoreColumnRef = useRef(initialView?.activeColumn ?? null);
  useEffect(() => {
    const column = restoreColumnRef.current;
    if (!column || !data || data.rows.length === 0) return;
    restoreColumnRef.current = null;
    if (data.columns.some((c) => c.name === column))
      setActiveCell({ rowIndex: 0, column });
  }, [data]);

  const shown = data?.rows.length ?? 0;
  const capped = total != null && total > PEEK_LIMIT;

  return (
    <div className="h-full w-full flex flex-col overflow-hidden bg-zinc-950">
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
          data-el="peek-inspector-btn"
          onClick={() => setExpanded(!expanded)}
          disabled={!data || tooShortForInspector}
          className={clsx(
            "shrink-0 inline-flex items-center justify-center gap-1 px-1.5 py-1 rounded text-[11px] font-medium transition-colors disabled:opacity-40",
            showInspector
              ? "bg-zinc-700 text-emerald-300"
              : "bg-zinc-800 text-zinc-400 hover:bg-zinc-700 hover:text-zinc-200"
          )}
          title={
            tooShortForInspector
              ? "The window is too short for the Inspector"
              : "Toggle the Inspector panel"
          }
          aria-label="Toggle the Inspector panel"
        >
          <Binoculars size={15} />
          Inspector
        </button>

        <button
          data-el="peek-relations-btn"
          onClick={() => setRelationsOpen(!relationsOpen)}
          disabled={!data}
          className={clsx(
            "shrink-0 inline-flex items-center justify-center gap-1 px-1.5 py-1 rounded text-[11px] font-medium transition-colors disabled:opacity-40",
            relationsOpen
              ? "bg-violet-600 text-white hover:bg-violet-500"
              : "bg-zinc-800 text-violet-300 hover:bg-zinc-700 hover:text-violet-200"
          )}
          title="Toggle the Relations panel"
          aria-label="Toggle the Relations panel"
        >
          <ShareNetwork size={15} />
          Relations
        </button>

        <button
          data-el="peek-arrange-btn"
          onClick={() => ipc.arrangePeeks().catch(() => {})}
          className="shrink-0 inline-flex items-center justify-center p-1 rounded bg-zinc-800 text-zinc-400 hover:bg-zinc-700 hover:text-zinc-200 transition-colors"
          title="Arrange all peek windows in columns beside the main window"
          aria-label="Arrange all peek windows in columns beside the main window"
        >
          <SquaresFour size={15} />
        </button>

        <button
          data-el="peek-open-tab-btn"
          onClick={onOpenAsTab}
          className="shrink-0 inline-flex items-center justify-center p-1 rounded bg-emerald-500 text-emerald-950 hover:bg-emerald-400 transition-colors"
          title="Open this related table as a full, filtered tab"
          aria-label="Open this related table as a full, filtered tab"
        >
          <ArrowSquareOut size={15} />
        </button>
        <WindowControls onCloseAll={requestCloseAll} />
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
          className="flex-1 min-h-0 flex flex-col"
          style={tabsZoom !== 1 ? { zoom: tabsZoom } : undefined}
        >
          <div className="flex-1 min-h-0 flex">
          <div className="relative flex-1 min-w-0 min-h-0 flex flex-col">
            <DataGrid
              readOnly
              hideValueTooltip
              columns={data.columns}
              rows={data.rows}
              offset={data.offset}
              sort={sort}
              filters={filters}
              lockedFilterColumns={[target.column]}
              hiddenColumns={hiddenColumns}
              jsonDisplay={jsonDisplay}
              columnWidths={columnWidths}
              suggestSource={{ profileId, database, table: target.table }}
              resultCopy
              peekableColumns={peekableColumns}
              activeCell={activeCell}
              clearActiveCellOnRowSelect
              onActiveCellChange={setActiveCell}
              onSelectionChange={setSelectedRows}
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
              onDeleteRows={hasPrimaryKey ? deleteRows : undefined}
              onCascadePreview={hasPrimaryKey ? previewCascade : undefined}
            />
            <div className="pointer-events-none absolute inset-0 bg-violet-500/[0.06]" />
          </div>
          {relationsOpen && (
            <RelationsPanel
              profileId={profileId}
              database={database}
              table={target.table}
              relations={relations}
              row={relationsRow}
              column={activeCell?.column ?? null}
              onOpen={openChild}
              onNew={(column) =>
                setRelDialog({
                  relation: null,
                  column: column ?? data.columns[0]?.name ?? "",
                })
              }
              onEdit={(relation, column) => setRelDialog({ relation, column })}
              filters={extraFilters}
              onRelationFilter={(t, op) =>
                onFilterChange(
                  t.sourceColumn,
                  op
                    ? {
                        column: t.sourceColumn,
                        op,
                        value: "",
                        relation: { table: t.table, column: t.column },
                      }
                    : null
                )
              }
              onClose={() => setRelationsOpen(false)}
            />
          )}
          </div>
          {showInspector && (
            <ExpandedPanel
              readOnly
              editable={false}
              column={activeColumn}
              value={activeValue}
              rowOrdinal={activeRowOrdinal}
              onClose={() => setExpanded(false)}
              initialHeight={initialView?.inspectorHeight}
              onHeightChange={(px) => onViewChange?.({ inspectorHeight: px })}
            />
          )}
        </div>
      ) : (
        <div className="flex-1" />
      )}

      {relDialog && (
        <RelationEditDialog
          profileId={profileId}
          database={database}
          relation={relDialog.relation}
          from={{ table: target.table, column: relDialog.column }}
          onClose={() => setRelDialog(null)}
          onSaved={() => setRelDialog(null)}
          onDeleted={() => setRelDialog(null)}
        />
      )}

      {confirmCloseAll != null &&
        createPortal(
          <div
            className="fixed inset-0 z-[80] flex items-center justify-center bg-black/60 backdrop-blur-sm"
            {...closeConfirmBackdrop}
          >
            <div
              data-el="close-all-peeks-dialog"
              role="dialog"
              aria-modal="true"
              onClick={(e) => e.stopPropagation()}
              className="w-[400px] max-w-[90vw] rounded-lg border border-zinc-700 bg-zinc-900 shadow-2xl shadow-black/60"
            >
              <div className="flex items-center justify-between px-4 py-3 border-b border-zinc-800">
                <div className="flex items-center gap-2">
                  <Warning size={18} weight="fill" className="text-amber-400" />
                  <h2 className="text-sm font-semibold text-zinc-100">
                    Close peek windows
                  </h2>
                </div>
                <button
                  onClick={() => setConfirmCloseAll(null)}
                  className="text-zinc-500 hover:text-zinc-200"
                  aria-label="Close"
                >
                  <X size={18} />
                </button>
              </div>
              <div className="px-4 py-4 text-[12px] leading-relaxed text-zinc-300">
                There are{" "}
                <span className="font-semibold text-zinc-100">
                  {confirmCloseAll} open peek windows
                </span>
                . Close just this one, or all of them?
              </div>
              <div className="flex justify-end gap-2 border-t border-zinc-800 px-4 py-3">
                <button
                  onClick={() => setConfirmCloseAll(null)}
                  className="mr-auto px-3 py-1.5 rounded text-[12px] text-zinc-200 bg-zinc-800 hover:bg-zinc-700"
                >
                  Cancel
                </button>
                <button
                  data-el="close-this-peek-btn"
                  onClick={() => {
                    setConfirmCloseAll(null);
                    getCurrentWindow().close();
                  }}
                  className="px-3 py-1.5 rounded text-[12px] font-semibold bg-zinc-700 text-zinc-100 hover:bg-zinc-600 transition-colors"
                >
                  Close this
                </button>
                <button
                  data-el="close-all-peeks-confirm-btn"
                  onClick={() => {
                    setConfirmCloseAll(null);
                    ipc.closeAllPeeks().catch(() => {});
                  }}
                  className="px-3 py-1.5 rounded text-[12px] font-semibold bg-rose-500 text-white hover:bg-rose-400 transition-colors"
                >
                  Close all
                </button>
              </div>
            </div>
          </div>,
          document.body
        )}
    </div>
  );
}
