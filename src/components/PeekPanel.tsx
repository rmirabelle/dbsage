import { helpHandlers } from "../state/help";
import { useContext, useEffect, useMemo, useRef, useState } from "react";
import { findPeekLocation, type PeekLocation } from "../lib/peekNavigation";
import { PeekNavigation, revealPeekRows } from "./PeekNavigation";
import { toggleIntegratedPeek, setIntegratedPeekSolo } from "../lib/integratedPeek";
import {
  ArrowSquareOut,
  Binoculars,
  CircleNotch,
  ShareNetwork,
  Table,
} from "@phosphor-icons/react";
import clsx from "clsx";
import { oneRowGridHeight } from "../lib/gridMeasure";
import { listen } from "@tauri-apps/api/event";
import { TABLE_CHANGED_EVENT, invalidateRelatedExistence, type TableChanged } from "../lib/relatedExistence";
import { editRows, type CellEdit } from "../lib/editRows";
import { findSameRow, firstFilteredCell } from "../lib/sameRow";
import { ipc } from "../ipc";
import { useStore } from "../state/store";
import { notifyError } from "../state/notify";
import { DataGrid } from "./DataGrid";
import { ExpandedPanel } from "./ExpandedPanel";
import { RelationEditDialog } from "./RelationEditDialog";
import { RelationsPanel } from "./RelationsPanel";
import { IntegratedPeekPanel } from "./IntegratedPeekPanel";
import {
  peekableColumnsFor,
  type RowRelationTarget,
} from "../lib/relations";
import {
  deleteRowsWithCascade,
  previewCascadeTargets,
} from "../lib/rowDelete";
import type {
  CascadeTarget,
  ColumnFilter,
  PeekTarget,
  PeekViewState,
  IntegratedPeekState,
  Relation,
  RowsResult,
  SortSpec,
} from "../types";

const EMPTY_RELATIONS: Relation[] = [];
const PEEK_LIMIT = 1000;

/** Shortest panel (CSS px) that can still show the Inspector under the
 * titlebar with a usable slice of grid above it. Below this the Inspector
 * button is disabled and an open Inspector is hidden until the panel grows. */
const INSPECTOR_MIN_PANEL_H = 220;


export function PeekPanel({
  profileId,
  profileName = "",
  database,
  target,
  parentTable,
  parentSolo = false,
  initialView,
  title,
  trail,
  onViewChange,
  active = true,
}: {
  profileId: string;
  profileName?: string;
  database: string;
  target: PeekTarget;
  parentTable?: string;
  parentSolo?: boolean;
  active?: boolean;
  /** The grid state (hidden columns, sort, filters, widths, JSON display) and
   * Inspector visibility to start from — set when restoring a saved view or
   * re-seeding after a reload; a freshly-launched peek starts from defaults. */
  initialView?: PeekViewState;
  /** This peek's relation name, named as the parent in nested tabs' help text. */
  title?: string;
  /** Breadcrumb from the root table to this peek, shown in nested tabs' help. */
  trail?: string;
  /** Report every change to that state so the host can persist it for
   * saved-view capture. */
  onViewChange?: (patch: PeekViewState) => void;
}) {
  const rootRef = useRef<HTMLDivElement>(null);
  const peekRowsRef = useRef<HTMLDivElement>(null);
  const ancestorLocations = useContext(PeekNavigation);
  const [childPeekAll, setChildPeekAll] = useState(initialView?.childPeekAll ?? null);
  const [relationsSolo, setRelationsSolo] = useState(initialView?.childPeekAll?.solo ?? initialView?.relationsSolo ?? parentSolo);
  const childPeekRef = useRef(childPeekAll);
  const [childPeekOpen, setChildPeekOpen] = useState(initialView?.childPeekOpen ?? Boolean(initialView?.childPeekAll));
  const changeChildren = (next: IntegratedPeekState) => {
    childPeekRef.current = next;
    setChildPeekAll(next);
    onViewChange?.({ childPeekAll: next });
  };
  const showChildren = (open: boolean) => {
    setChildPeekOpen(open);
    onViewChange?.({ childPeekOpen: open });
  };
  const [hostHeight, setHostHeight] = useState(window.innerHeight);
  const [sort, setSort] = useState<SortSpec | null>(initialView?.sort ?? null);
  const [extraFilters, setExtraFilters] = useState<ColumnFilter[]>(
    initialView?.filters ?? []
  );
  const [hiddenColumns, setHiddenColumns] = useState<string[]>(
    initialView?.hiddenColumns ?? [...new Set(["id", target.column])]
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
      relationsSolo,
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sort, extraFilters, hiddenColumns, jsonDisplay, columnWidths, relationsSolo]);
  const [activeCell, setActiveCell] = useState<{
    rowIndex: number;
    column: string;
  } | null>(null);
  const [selectedRows, setSelectedRows] = useState<number[]>([]);
  const [cellSelectionSpansRows, setCellSelectionSpansRows] = useState(false);
  /* The user's (or saved View's) choice for the Relations panel; undefined
     means untouched, and the panel then opens when the peeked table has
     relations defined from it (same default as a table tab). */
  const [relationsOpenPref, setRelationsOpenPref] = useState<boolean | undefined>(
    initialView?.relationsOpen
  );
  const setRelationsOpen = (open: boolean) => {
    if (open && childPeekRef.current?.closed) {
      changeChildren({ ...childPeekRef.current, closed: false });
      showChildren(childPeekRef.current.peeks.length > 0);
    }
    setRelationsOpenPref(open);
    onViewChange?.({ relationsOpen: open });
  };
  /* Report the active column so a saved view can re-select it on restore. */
  const activeColumnName = activeCell?.column ?? null;
  useEffect(() => {
    onViewChange?.({ activeColumn: activeColumnName });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeColumnName]);

  const [data, setData] = useState<RowsResult | null>(null);
  const [loadedMatch, setLoadedMatch] = useState<string | null>(null);
  const matchKey = JSON.stringify([profileId, database, target.table, target.column, target.value]);
  const [total, setTotal] = useState<number | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  /** Bumped after a delete so the rows and count re-fetch. */
  const [reloadKey, setReloadKey] = useState(0);

  useEffect(() => {
    const un = listen<TableChanged>(TABLE_CHANGED_EVENT, ({ payload: m }) => {
      if (m.profileId === profileId && m.database === database && m.table === target.table) {
        setReloadKey((k) => k + 1);
      }
    });
    return () => { void un.then((f) => f()); };
  }, [profileId, database, target.table]);

  const baseFilter: ColumnFilter = {
    column: target.column,
    op: "equals",
    value: target.value ?? "",
  };
  /** The equality match always applies; header filters refine it further. */
  const filters = [baseFilter, ...extraFilters];
  const filtersKey = JSON.stringify(filters);
  /** No row to match (the parent has no selection): show nothing, fetch nothing. */
  const unmatched = target.value == null;

  useEffect(() => {
    if (unmatched) {
      setData((d) => (d ? { ...d, rows: [], total: 0 } : d));
      setLoading(false);
      setError(null);
      return;
    }
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
        if (!cancelled) { setData(res); setLoadedMatch(matchKey); }
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
    if (unmatched) {
      setTotal(0);
      return;
    }
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
  const tableRelations = relations.filter((r) => r.fromTable === target.table);
  const onlyReturnsToParent = tableRelations.length === 1 && tableRelations[0].toTable === parentTable;
  const relationsOpen =
    relationsOpenPref ?? (tableRelations.length > 0 && !onlyReturnsToParent);
  const relationsVisible = !childPeekAll?.closed && relationsOpen;
  /** The collapsed Relations strip draws no border of its own; the grid and
   * the panels below it each draw a left border, so the gap between them
   * shows no line. */
  const relationsStrip = !childPeekAll?.closed && !relationsOpen;
  const childPanelVisible = childPeekOpen && !!childPeekAll && !childPeekAll.closed;
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
  /** Relations require one unambiguous source row. */
  const relationsSelectionBlocked = selectedRows.length > 1 || cellSelectionSpansRows;
  const relationsRow =
    loadedMatch === matchKey && !unmatched && !relationsSelectionBlocked
      ? activeRow ?? (data && selectedRows.length ? data.rows[selectedRows[0]] ?? null : null)
      : null;

  const currentLocation: PeekLocation = {
    profileId, database, table: target.table, target, filters: extraFilters, row: relationsRow,
    label: `Return to ${target.table} above`,
    reveal: () => revealPeekRows(peekRowsRef.current, activeCell?.rowIndex ?? selectedRows[0]),
  };
  const destination = (t: RowRelationTarget) => findPeekLocation(ancestorLocations, profileId, database, t, t.relation.kind, target.table);
  const toggleChildPeek = (t: RowRelationTarget) => {
    const existing = destination(t);
    if (existing) { existing.reveal(); return; }
    const previous = childPeekRef.current ?? { solo: relationsSolo, height: (peekRowsRef.current?.offsetHeight ?? 320) / 2, activeId: "", peeks: [] };
    const next = toggleIntegratedPeek(previous, {
      id: t.relation.id, title: t.relation.name?.trim() || t.table,
      profileId, profileName, database, sourceTable: target.table, sourceColumn: t.sourceColumn,
      target: { table: t.table, column: t.column, value: t.value }, kind: t.relation.kind,
    });
    changeChildren(next);
    showChildren(next.peeks.length > 0);
  };

  /** The Inspector panel for the selected cell. Starts closed on a
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
    () => false
  );
  useEffect(() => {
    const onResize = () => {
      const height = rootRef.current?.offsetHeight ?? 0;
      setHostHeight(height);
      setTooShortForInspector(height < INSPECTOR_MIN_PANEL_H);
    };
    const observer = new ResizeObserver(onResize);
    if (rootRef.current) observer.observe(rootRef.current);
    onResize();
    window.addEventListener("resize", onResize);
    return () => { observer.disconnect(); window.removeEventListener("resize", onResize); };
  }, []);
  const showInspector = expanded && !tooShortForInspector;
  useEffect(() => {
    if (!active || !expanded) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.target instanceof Element && e.target.closest('[data-el="peek-panel"]') !== rootRef.current) return;
      if (e.key === "Escape") setExpanded(false);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [expanded, active]);

  const [relDialog, setRelDialog] = useState<{
    relation: Relation | null;
    column: string;
  } | null>(null);

  const hasPrimaryKey = data?.columns.some((c) => c.key === "PRI") ?? false;
  const updateCells = async (edits: CellEdit[]) => {
    if (!data || loading || loadedMatch !== matchKey || unmatched) {
      throw new Error("Wait for the related rows to finish loading before editing.");
    }
    try {
      await editRows(data.columns, data.rows, edits, (update) =>
        ipc.updateCell({ profileId, database, table: target.table, ...update }));
    } finally {
      invalidateRelatedExistence(profileId, database, target.table);
      setReloadKey((key) => key + 1);
    }
  };
  const updateCell = (rowIndex: number, column: string, value: string | null) =>
    updateCells([{ rowIndex, column, value }]);
  const insertRows = async (rows: { column: string; value: string | null }[][]) => {
    if (loading || loadedMatch !== matchKey || unmatched) {
      throw new Error("Wait for the related rows to finish loading before inserting.");
    }
    await ipc.insertRows({ profileId, database, table: target.table, rows });
    invalidateRelatedExistence(profileId, database, target.table);
    setReloadKey((key) => key + 1);
  };
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

  /* Rows changed (re-fetch / sort / filter / the parent row moved on): keep the
     active cell when its column still exists and a row still sits at its
     index, so an open Inspector shows the new row's value at once instead of
     going blank until the cell is clicked again. Otherwise clear it. A fresh
     object is set so effects keyed on the cell (related panels, pinned menu)
     re-run for the new row. */
  const seenRowsRef = useRef(data?.rows);
  const seenFiltersRef = useRef(JSON.stringify(extraFilters));
  useEffect(() => {
    const oldRows = seenRowsRef.current;
    seenRowsRef.current = data?.rows;
    const nextFilters = JSON.stringify(extraFilters);
    const filtered = seenFiltersRef.current !== nextFilters;
    seenFiltersRef.current = nextFilters;
    setActiveCell((cell) => {
      if (filtered && data) {
        const idx = cell ? findSameRow(data.columns, oldRows, cell.rowIndex, data.rows) : -1;
        if (cell && idx >= 0 && data.columns.some((c) => c.name === cell.column)) return { rowIndex: idx, column: cell.column };
        return firstFilteredCell(data.columns, data.rows, hiddenColumns);
      }
      if (!cell || !data) return null;
      if (!data.columns.some((c) => c.name === cell.column)) return null;
      /* Same row still present (by key, else by every cell): follow it.
         Otherwise (the parent row moved on) keep the column on the same
         row index when one exists, so an open Inspector stays useful. */
      const idx = findSameRow(data.columns, oldRows, cell.rowIndex, data.rows);
      if (idx >= 0) return { rowIndex: idx, column: cell.column };
      if (cell.rowIndex < data.rows.length) return { ...cell };
      return null;
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [data?.rows]);

  /* When rows arrive and nothing is selected, select the first row: the
     saved View's column if restoring, else the first column. This makes the
     Relations panel (and an open Inspector) active at once. Only skipped when
     the user has a row selection of their own. */
  const restoreColumnRef = useRef(initialView?.activeColumn ?? null);
  /* The column last selected in this peek. When the peek is emptied (the
     parent lost its row) and later reconnected, the selection returns to
     this column, not the first one — as if it had never been interrupted. */
  const lastColumnRef = useRef<string | null>(null);
  useEffect(() => {
    if (activeCell) lastColumnRef.current = activeCell.column;
  }, [activeCell]);
  useEffect(() => {
    if (!data || data.rows.length === 0) return;
    if (activeCell || selectedRows.length > 0) return;
    const wanted = restoreColumnRef.current ?? lastColumnRef.current;
    restoreColumnRef.current = null;
    const column =
      wanted && !hiddenColumns.includes(wanted) && data.columns.some((c) => c.name === wanted)
        ? wanted
        : data.columns.find((c) => !hiddenColumns.includes(c.name))?.name;
    if (column) setActiveCell({ rowIndex: 0, column });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [data]);

  const shown = data?.rows.length ?? 0;
  const capped = total != null && total > PEEK_LIMIT;

  return (
    <div ref={rootRef} data-el="peek-panel"
      className="h-full w-full flex flex-col overflow-hidden bg-[var(--peek-tint,#2d2a3b)]">
      <div
        data-el="peek-titlebar"
        className="dbs-toolbar shrink-0 h-10 pl-3 pr-2 flex items-center gap-2 select-none bg-[var(--peek-tint,#2d2a3b)] bg-none"
      >
        <Table size={16} className="text-emerald-400 shrink-0 pointer-events-none" />
        <span className="min-w-0 shrink text-[13px] text-zinc-200 truncate pointer-events-none">
          <span className="font-semibold text-zinc-100 mr-3">{target.table}</span>
          <span className="text-zinc-500"> where </span>
          <span className="font-mono text-zinc-500">{target.column}</span>
          <span className="text-zinc-500"> = </span>
          {unmatched ? (
            <span className="italic text-zinc-500">no row selected</span>
          ) : (
            <span className="font-mono text-zinc-500">
              {JSON.stringify(target.value)}
            </span>
          )}
        </span>

        <span className="flex-1 pointer-events-none" />

        <span className="text-[11px] text-zinc-500 shrink-0 pointer-events-none mr-3">
          {total == null
            ? `${shown} shown`
            : capped
            ? `${shown} of ${total.toLocaleString()} (first ${PEEK_LIMIT})`
            : `${total.toLocaleString()} row${total === 1 ? "" : "s"}`}
        </span>

        <button
          type="button"
          data-el="peek-open-table-btn"
          onClick={() => void useStore.getState().openTable(profileId, profileName, database, target.table, {
            filters: unmatched ? extraFilters : filters,
            sort,
            rows: data?.rows ?? [],
            activeCell,
            selectedRows,
          }).catch((error) => notifyError(String(error)))}
          className="shrink-0 inline-flex items-center justify-center px-1.5 py-1 rounded text-zinc-300 bg-zinc-800 hover:bg-zinc-700 hover:text-zinc-100 transition-colors"
          {...helpHandlers(`Open ${target.table} as a table with the same filter and selection`)}
          aria-label={`Open ${target.table} as a table`}
        >
          <ArrowSquareOut size={15} />
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
          {...helpHandlers("Show or collapse the Relations list; open peek tabs remain visible")}
          aria-label="Toggle the Relations list"
          aria-pressed={relationsOpen}
        >
          <ShareNetwork size={15} />
          Relations
        </button>

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
          {...helpHandlers(tooShortForInspector
              ? "The panel is too short for the Inspector"
              : "Toggle the Inspector panel")}
          aria-label="Toggle the Inspector panel"
        >
          <Binoculars size={15} />
          Inspector
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
        <div
          className="flex-1 min-h-0 flex"
        >
          <div className="relative flex-1 min-w-0 min-h-0 flex flex-col">
            <div ref={peekRowsRef} className="flex-1 min-h-0 flex flex-col">
            <DataGrid
              key={matchKey}
              readOnly={loading || loadedMatch !== matchKey || unmatched}
              hideValueTooltip
              columns={data.columns}
              rows={data.rows}
              offset={data.offset}
              sort={sort}
              filters={filters}
              lockedFilterColumns={[target.column]}
              hideColumnTypes
              peekBackground
              contentBorderLeft={relationsStrip}
              hiddenColumns={hiddenColumns}
              jsonDisplay={jsonDisplay}
              columnWidths={columnWidths}
              suggestSource={{ profileId, database, table: target.table }}
              copyTarget={{ database, table: target.table }}
              resultCopy
              peekableColumns={peekableColumns}
              activeCell={activeCell}
              clearActiveCellOnRowSelect
              onActiveCellChange={setActiveCell}
              onSelectionChange={setSelectedRows}
              onCellSelectionSpansRowsChange={setCellSelectionSpansRows}
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
              onCellEdit={updateCell}
              onBatchEdit={updateCells}
              onInsertRows={insertRows}
              canDuplicateRows={hasPrimaryKey}
              onDeleteRows={hasPrimaryKey ? deleteRows : undefined}
              onCascadePreview={hasPrimaryKey ? previewCascade : undefined}
            />
            </div>
            {(showInspector || childPanelVisible) && <div className={clsx("shrink-0 flex flex-col min-h-0 mt-[10px]", relationsStrip && "border-l border-zinc-700")}>
            {showInspector && (
              <ExpandedPanel
                key={matchKey}
                editable={hasPrimaryKey && !loading && loadedMatch === matchKey && !unmatched}
                onSave={activeCell ? (value) => updateCell(activeCell.rowIndex, activeCell.column, value) : undefined}
                column={activeColumn}
                value={activeValue}
                rowOrdinal={activeRowOrdinal}
                onClose={() => setExpanded(false)}
                initialHeight={initialView?.inspectorHeight}
                initialSearch={initialView?.inspectorSearch}
                onSearchChange={(inspectorSearch) => onViewChange?.({ inspectorSearch })}
                initialExpandAll={initialView?.inspectorExpandAll}
                onExpandAllChange={(inspectorExpandAll) => onViewChange?.({ inspectorExpandAll })}
                heightLimit={Math.max(80, hostHeight - 40 - 10 - oneRowGridHeight(peekRowsRef.current)
                  - (childPanelVisible ? childPeekAll?.height ?? 0 : 0))}
                onHeightChange={(px) => onViewChange?.({ inspectorHeight: px })}
              />
            )}
            {childPanelVisible && childPeekAll && <IntegratedPeekPanel table={target.table} state={childPeekAll}
              selectionBlocked={relationsSelectionBlocked}
              parentTitle={trail ?? title ?? target.table}
              parentLocation={currentLocation}
              row={relationsRow} rowsRef={peekRowsRef} active={active}
              onClose={() => showChildren(false)}
              onChange={(update) => {
                if (childPeekRef.current) changeChildren(update(childPeekRef.current));
              }} />}
            </div>}
          </div>
          {relationsVisible ? (
            <RelationsPanel
              solo={relationsSolo}
              onSoloChange={(solo) => {
                setRelationsSolo(solo);
                if (childPeekRef.current) changeChildren(setIntegratedPeekSolo(childPeekRef.current, solo));
              }}
              hideFilterButtons
              profileId={profileId}
              database={database}
              table={target.table}
              relations={relations}
              row={relationsRow}
              column={activeCell?.column ?? null}
              onSelect={toggleChildPeek}
              openRelationIds={childPeekAll?.peeks.map((p) => p.id) ?? []}
              returnLabel={(t) => destination(t)?.label}
              hideReturnRelations
              activeRelationId={childPeekOpen ? childPeekAll?.activeId : undefined}
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
          ) : (
            <button type="button" data-el="relations-panel-collapsed"
              aria-label={`Show ${target.table} Relations`} aria-expanded={false}
              {...helpHandlers("Show Relations")} onClick={() => setRelationsOpen(true)}
              className="order-first w-[20px] shrink-0 self-stretch bg-[var(--peek-tint,#2d2a3b)] focus-visible:outline focus-visible:outline-violet-400" />
          )}
        </div>
      ) : (
        <div className="flex-1" />
      )}

      {active && relDialog && (
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

    </div>
  );
}
