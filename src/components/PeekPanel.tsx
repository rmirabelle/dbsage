import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import {
  ArrowSquareOut,
  Binoculars,
  CircleNotch,
  PencilSimple,
  Plus,
  ShareNetwork,
  Warning,
  X,
} from "@phosphor-icons/react";
import clsx from "clsx";
import { emit, listen } from "@tauri-apps/api/event";
import {
  currentMonitor,
  getCurrentWindow,
  PhysicalPosition,
  PhysicalSize,
} from "@tauri-apps/api/window";
import { ipc } from "../ipc";
import { useStore } from "../state/store";
import { useUi } from "../state/ui";
import { DataGrid } from "./DataGrid";
import { ExpandedPanel } from "./ExpandedPanel";
import { RelationEditDialog } from "./RelationEditDialog";
import { WindowControls } from "./WindowControls";
import {
  rowRelationTargets,
  peekableColumnsFor,
  cellToFilterValue,
  type RelationTarget,
  type RowRelationTarget,
} from "../lib/relations";
import {
  relKey,
  checkRelatedExistence,
  TABLE_CHANGED_EVENT,
  type TableChanged,
} from "../lib/relatedExistence";
import {
  deleteRowsWithCascade,
  previewCascadeTargets,
} from "../lib/rowDelete";
import { useBackdropDismiss } from "../lib/useBackdropDismiss";
import { useAnchoredPosition } from "../lib/useAnchoredPosition";
import { useNativeMenuLayer } from "../lib/useNativeMenuLayer";
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
/** Viewport margin kept around the relations picker. */
const PICKER_MARGIN = 8;

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

  const [picker, setPicker] = useState<{
    x: number;
    y: number;
    matches: (RowRelationTarget & { exists: boolean })[];
    /** The cell whose row supplies the relation values. */
    cell: { rowIndex: number; column: string };
    /** True while a newly-clicked cell's existence checks are in flight; the
     * menu stays open with every entry disabled until they resolve. */
    pending?: boolean;
  } | null>(null);
  const pickerRequestRef = useRef(0);
  const pickerRef = useRef<HTMLDivElement>(null);
  const [pickerRevision, setPickerRevision] = useState(0);
  const { style: pickerStyle } = useAnchoredPosition(
    picker?.x ?? 0,
    picker?.y ?? 0,
    PICKER_MARGIN,
    pickerRef,
    pickerRevision
  );
  useNativeMenuLayer(picker !== null);

  /**
   * A peek is its own OS window, so the picker can't spill past its bottom
   * edge. When the menu would overflow, temporarily grow the window by the
   * overflow (sliding it up if that would leave the monitor's work area), then
   * re-anchor the menu; the original bounds are restored when the menu closes.
   */
  const grownRef = useRef<{ size: PhysicalSize; pos: PhysicalPosition } | null>(
    null
  );
  useLayoutEffect(() => {
    const el = pickerRef.current;
    if (!picker || !el) return;
    const menuHeight = el.getBoundingClientRect().height;
    const overflow = picker.y + menuHeight + PICKER_MARGIN - window.innerHeight;
    if (overflow <= 0) return;
    let cancelled = false;
    (async () => {
      const win = getCurrentWindow();
      const [size, pos, scale, monitor] = await Promise.all([
        win.innerSize(),
        win.outerPosition(),
        win.scaleFactor(),
        currentMonitor(),
      ]);
      if (cancelled) return;
      if (!grownRef.current) grownRef.current = { size, pos };
      const extra = Math.ceil(overflow * scale);
      let y = pos.y;
      if (monitor) {
        const bottom = monitor.workArea.position.y + monitor.workArea.size.height;
        const past = pos.y + size.height + extra - bottom;
        if (past > 0) y = Math.max(monitor.workArea.position.y, pos.y - past);
      }
      const resized = new Promise<void>((resolve) => {
        const done = () => {
          window.removeEventListener("resize", done);
          resolve();
        };
        window.addEventListener("resize", done);
        window.setTimeout(done, 200);
      });
      if (y !== pos.y) await win.setPosition(new PhysicalPosition(pos.x, y));
      await win.setSize(new PhysicalSize(size.width, size.height + extra));
      await resized;
      if (!cancelled) setPickerRevision((r) => r + 1);
    })();
    return () => {
      cancelled = true;
    };
  }, [picker]);

  const pickerOpen = picker !== null;
  useEffect(() => {
    if (pickerOpen) return;
    const restore = () => {
      const orig = grownRef.current;
      if (!orig) return;
      grownRef.current = null;
      const win = getCurrentWindow();
      void win.setSize(orig.size).then(() => win.setPosition(orig.pos));
    };
    restore();
    return restore;
  }, [pickerOpen]);

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

  /** Right-clicking any cell opens every relation available from its row, with
   * that column's own relations first. Each choice reads its own source-column
   * value. Left-click remains dedicated to grid selection. */
  const openRelationsMenu = async (cell: {
    rowIndex: number;
    column: string;
    x: number;
    y: number;
  }) => {
    const request = ++pickerRequestRef.current;
    if (!data) {
      setPicker(null);
      return;
    }
    /* Moving to a different cell: keep the menu open but disable every entry
       NOW, so the previous cell's enabled/disabled states never linger while
       the new cell's existence checks are in flight. */
    setPicker((p) =>
      p ? { ...p, x: cell.x, y: cell.y, pending: true } : p
    );
    const row = data.rows[cell.rowIndex];
    const matches = row
      ? rowRelationTargets(relations, target.table, cell.column, row)
      : [];
    /* Prime the existence cache before showing the menu so targets with no
       related rows render disabled from the first frame. The menu shows even
       when every target is empty — greyed-out items tell the user relations
       exist but hold no matching rows here. */
    const checked = await Promise.all(
      matches.map(async (m) => {
        if (m.value == null) return { ...m, exists: false };
        const exists = await checkRelatedExistence(
          profileId,
          database,
          [m],
          m.value
        );
        return { ...m, exists: exists[relKey(m)] !== false };
      })
    );
    if (request !== pickerRequestRef.current) return;
    setPicker({
      x: cell.x,
      y: cell.y,
      matches: checked,
      cell: { rowIndex: cell.rowIndex, column: cell.column },
    });
  };

  /** Listener-based dismissal (no backdrop): left-click outside, any key, or
   * scrolling. Right-clicks on grid cells are handled by their context menu. */
  useEffect(() => {
    if (!picker) return;
    const close = () => {
      pickerRequestRef.current += 1;
      setPicker(null);
    };
    const onDown = (e: MouseEvent) => {
      if (
        e.button === 2 &&
        (e.target as HTMLElement).closest('[data-el="grid-cell"]')
      ) {
        return;
      }
      if (!pickerRef.current?.contains(e.target as Node)) close();
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") close();
    };
    window.addEventListener("mousedown", onDown);
    window.addEventListener("keydown", onKey);
    window.addEventListener("scroll", close, true);
    return () => {
      window.removeEventListener("mousedown", onDown);
      window.removeEventListener("keydown", onKey);
      window.removeEventListener("scroll", close, true);
    };
  }, [picker]);

  /* Rows changed in one of the menu's target tables (deleted from another
     window, say): its enabled/disabled entries are stale — re-check them. */
  useEffect(() => {
    if (!picker) return;
    const { cell, x, y, matches } = picker;
    const un = listen<TableChanged>(TABLE_CHANGED_EVENT, (e) => {
      const m = e.payload;
      if (
        m.profileId === profileId &&
        m.database === database &&
        matches.some((t) => t.table === m.table)
      ) {
        void openRelationsMenu({ ...cell, x, y });
      }
    });
    return () => {
      un.then((f) => f());
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
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
          data-el="peek-inspector-btn"
          onClick={() => setExpanded(!expanded)}
          disabled={!data}
          className={clsx(
            "shrink-0 inline-flex items-center justify-center p-1 rounded transition-colors disabled:opacity-40",
            expanded
              ? "bg-zinc-700 text-emerald-300"
              : "bg-zinc-800 text-zinc-400 hover:bg-zinc-700 hover:text-zinc-200"
          )}
          title="Toggle the Inspector panel"
          aria-label="Toggle the Inspector panel"
        >
          <Binoculars size={15} />
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
          <div className="relative flex-1 min-h-0 flex flex-col">
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
              suggestSource={{ profileId, database, table: target.table }}
              resultCopy
              peekableColumns={peekableColumns}
              activeCell={activeCell}
              clearActiveCellOnRowSelect
              onActiveCellChange={setActiveCell}
              onCellContextMenu={(cell) => {
                void openRelationsMenu(cell);
              }}
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
          {expanded && (
            <ExpandedPanel
              readOnly
              editable={false}
              column={activeColumn}
              value={activeValue}
              rowOrdinal={activeRowOrdinal}
              onClose={() => setExpanded(false)}
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

      {picker &&
        createPortal(
          <div
            ref={pickerRef}
            data-el="peek-related-picker"
            style={pickerStyle}
            className="dbs-context-menu fixed z-50 w-max overflow-hidden rounded border border-violet-500 bg-zinc-900/95 backdrop-blur-sm shadow-xl shadow-black/60 text-zinc-200"
          >
            <div
              style={{ fontSize: 13 * tabsZoom }}
              className="flex w-full items-center gap-3 bg-violet-600 px-3 py-1.5 font-semibold text-violet-50"
            >
              <span className="flex-1">Relations</span>
              <button
                data-el="relation-picker-new"
                style={{ fontSize: 11 * tabsZoom }}
                onClick={() => {
                  const column = picker.cell.column;
                  setPicker(null);
                  setRelDialog({ relation: null, column });
                }}
                className="inline-flex items-center gap-1.5 rounded bg-violet-500 px-2 py-1 font-semibold text-white transition-colors hover:bg-violet-400"
                aria-label="New Relation"
                title={`New relation from ${picker.cell.column}`}
              >
                <Plus size={13} weight="bold" />
                New Relation
              </button>
            </div>
            {picker.matches.map((m) => {
              const noValue = m.value == null;
              const empty = !picker.pending && !noValue && !m.exists;
              const disabled = picker.pending || noValue || empty;
              const label = m.relation.name?.trim() || m.table;
              return (
                <div
                  key={m.relation.id}
                  className="flex items-stretch whitespace-nowrap"
                >
                  <button
                    disabled={disabled}
                    onClick={() => {
                      setPicker(null);
                      openChild(m);
                    }}
                    title={
                      noValue
                        ? `${m.sourceColumn} is NULL in this row`
                        : empty
                        ? `No related rows in ${m.table}`
                        : undefined
                    }
                    className={clsx(
                      "flex min-w-0 flex-1 items-center gap-3 px-3 py-1.5 text-left text-[12px]",
                      disabled
                        ? "cursor-not-allowed opacity-40"
                        : "hover:bg-zinc-800"
                    )}
                  >
                    <span
                      className={clsx(
                        "shrink-0 rounded px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide",
                        m.relation.kind === "has_many"
                          ? "bg-accent-500/15 text-accent-300"
                          : "bg-amber-500/15 text-amber-300"
                      )}
                    >
                      {m.relation.kind === "has_many" ? "has many" : "has one"}
                    </span>
                    <span className="flex-1 font-medium text-zinc-100">
                      {label}
                    </span>
                  </button>
                  <button
                    data-el="relation-picker-edit"
                    onClick={() => {
                      setPicker(null);
                      setRelDialog({
                        relation: m.relation,
                        column: m.sourceColumn,
                      });
                    }}
                    className="flex w-9 shrink-0 items-center justify-center border-l border-zinc-800 text-violet-400 hover:bg-zinc-800 hover:text-violet-300"
                    aria-label={`Edit relation ${label}`}
                    title="Edit relation"
                  >
                    <PencilSimple size={16} />
                  </button>
                </div>
              );
            })}
          </div>,
          document.body
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
