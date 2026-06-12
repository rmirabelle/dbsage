import {
  useEffect,
  useMemo,
  useRef,
  useState,
  type ComponentType,
} from "react";
import { createPortal } from "react-dom";
import {
  X,
  CircleNotch as Loader2,
  ArrowsClockwise as RefreshCw,
  CaretLeft as ChevronLeft,
  CaretRight as ChevronRight,
  CaretUp,
  CaretDown,
  Table as Table2,
  Database,
  ShareNetwork,
  Binoculars,
  PencilSimple,
  Code,
  ArrowSquareOut,
  WarningCircle as AlertCircle,
} from "@phosphor-icons/react";
import clsx from "clsx";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { emit } from "@tauri-apps/api/event";
import { useStore, isDesignerTabDirty } from "../state/store";
import { notifyError, notifySuccess } from "../state/notify";
import { CloseTabConfirmDialog } from "./CloseTabConfirmDialog";
import { DataGrid } from "./DataGrid";
import { DatabaseView } from "./DatabaseView";
import { QueryView } from "./QueryView";
import { RelationsView } from "./RelationsView";
import { TableDesignerView } from "./TableDesignerView";
import { ExpandedPanel } from "./ExpandedPanel";
import { TableViewPresetMenu } from "./TableViewPresetMenu";
import { InsertRowDialog } from "./InsertRowDialog";
import appIconLarge from "../assets/app-icon-large.png";
import { ipc } from "../ipc";
import type { PeekSeed, Relation, RowsTab, Tab } from "../types";
import {
  relationTargets,
  peekableColumnsFor,
  relatedLabel,
  cellToFilterValue,
  type RelationTarget,
} from "../lib/relations";
import { useRelatedExistence, relKey } from "../lib/relatedExistence";

const EMPTY_RELATIONS: Relation[] = [];

/** Short display title for a tab (window title when torn off, tab-bar primary). */
export function tabTitle(tab: Tab): string {
  switch (tab.kind) {
    case "database":
      return tab.database;
    case "relations":
      return "Relations";
    case "query":
      return "Query";
    case "create-table":
      return (
        tab.tableName.trim() ||
        (tab.mode === "edit" ? tab.originalName : "New table")
      );
    default:
      return tab.table;
  }
}

export function Tabs() {
  const tabs = useStore((s) => s.tabs);
  const activeTabId = useStore((s) => s.activeTabId);
  const setActiveTab = useStore((s) => s.setActiveTab);
  const requestCloseTab = useStore((s) => s.requestCloseTab);
  const closeTab = useStore((s) => s.closeTab);
  const tabDropActive = useStore((s) => s.tabDropActive);

  const active = tabs.find((t) => t.id === activeTabId) ?? null;

  /** Publish the tab bar's on-screen rectangle (screen CSS px) so a torn-off
   * tab window can hit-test it for re-docking. Refreshed when the bar appears /
   * disappears and whenever this window moves or resizes. When there are no tabs
   * (the bar is hidden), accept drops on a band near the top of the window. */
  const barRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const publish = () => {
      const el = barRef.current;
      const rect = el
        ? (() => {
            const r = el.getBoundingClientRect();
            return {
              left: window.screenX + r.left,
              top: window.screenY + r.top,
              right: window.screenX + r.right,
              bottom: window.screenY + r.bottom,
            };
          })()
        : {
            left: window.screenX,
            top: window.screenY + 34,
            right: window.screenX + window.innerWidth,
            bottom: window.screenY + 74,
          };
      ipc.setTabstripRect(rect).catch(() => {});
    };
    publish();
    window.addEventListener("resize", publish);
    const w = getCurrentWindow();
    const moved = w.onMoved(publish);
    const resized = w.onResized(publish);
    return () => {
      window.removeEventListener("resize", publish);
      moved.then((f) => f());
      resized.then((f) => f());
    };
  }, [tabs.length]);

  /** Right-click tab menu (screen coords drive where the torn-off window opens). */
  const [tabMenu, setTabMenu] = useState<{
    tab: Tab;
    x: number;
    y: number;
    screenX: number;
    screenY: number;
  } | null>(null);

  /** Pop the tab out into its own window (near where it was right-clicked),
   * then drop it from this window. */
  const tearOff = (tab: Tab, screenX: number, screenY: number) => {
    const live = useStore.getState().tabs.find((t) => t.id === tab.id);
    if (!live) return;
    ipc
      .openTabWindow(
        live,
        `${tabTitle(live)} - DB Sage`,
        Math.max(0, screenX - 120),
        Math.max(0, screenY + 8),
        1000,
        680
      )
      .then(() => closeTab(tab.id))
      .catch((err) => notifyError(`Could not pop out the tab: ${String(err)}`));
  };

  return (
    <div className="w-full h-full flex flex-col bg-zinc-950 min-w-0">
      {tabs.length > 0 && (
      <div
        ref={barRef}
        data-el="tab-bar"
        className={clsx(
          "flex items-stretch border-b bg-zinc-950 overflow-hidden",
          tabDropActive
            ? "border-accent-500 ring-1 ring-inset ring-accent-500/70 bg-accent-500/5"
            : "border-zinc-800/80"
        )}
      >
        <div className="flex-1 flex items-stretch overflow-x-auto">
        {tabs.map((tab) => {
            let primary: string;
            let prefix: string | null = null;
            let secondary: string;
            let Icon: ComponentType<{ size?: number; className?: string }>;
            let iconColor: string;
            let dirty = false;
            if (tab.kind === "database") {
              primary = tab.database;
              secondary = tab.profileName;
              Icon = Database;
              iconColor = "text-accent-400";
            } else if (tab.kind === "relations") {
              primary = "Relations";
              secondary = `${tab.profileName} / ${tab.database}`;
              Icon = ShareNetwork;
              iconColor = "text-violet-400";
            } else if (tab.kind === "query") {
              primary = "Query";
              secondary = `${tab.profileName} / ${tab.database}`;
              Icon = Code;
              iconColor = "text-emerald-400";
            } else if (tab.kind === "create-table") {
              const editing = tab.mode === "edit";
              if (editing) {
                prefix = "Edit Table";
                primary = tab.tableName.trim() || tab.originalName;
              } else {
                primary = tab.tableName.trim() || "New table";
              }
              secondary = `${tab.profileName} / ${tab.database}`;
              Icon = editing ? TableEditIcon : Table2;
              iconColor = "text-orange-400";
              dirty = isDesignerTabDirty(tab);
            } else {
              primary = tab.table;
              secondary = `${tab.profileName} / ${tab.database}`;
              Icon = Table2;
              iconColor = "text-emerald-400";
            }
            return (
              <div
                key={tab.id}
                data-el="tab"
                onClick={() => setActiveTab(tab.id)}
                onContextMenu={(e) => {
                  e.preventDefault();
                  setActiveTab(tab.id);
                  setTabMenu({
                    tab,
                    x: e.clientX,
                    y: e.clientY,
                    screenX: e.screenX,
                    screenY: e.screenY,
                  });
                }}
                className={clsx(
                  "group flex items-center gap-2 pl-3 pr-1.5 border-r border-zinc-800/60 cursor-pointer min-w-0 max-w-[260px] shrink-0",
                  tab.id === activeTabId
                    ? "bg-zinc-900 text-zinc-100"
                    : "text-zinc-400 hover:bg-zinc-900/50"
                )}
              >
                <Icon
                  size={26}
                  className={clsx(
                    iconColor,
                    tab.id !== activeTabId && "opacity-60"
                  )}
                />
                <div className="min-w-0 flex flex-col leading-tight py-2.5">
                  <span
                    data-el="tab-title"
                    className="text-[13px] font-semibold mb-1 flex items-baseline min-w-0"
                  >
                    {prefix && (
                      <span className="text-[10px] text-zinc-500 font-normal uppercase mr-1 shrink-0">
                        {prefix}
                      </span>
                    )}
                    <span className="truncate">{primary}</span>
                    {dirty && (
                      <span
                        data-el="tab-dirty"
                        className="ml-0.5 shrink-0 text-red-500"
                        title="Unsaved changes"
                      >
                        *
                      </span>
                    )}
                  </span>
                  <span data-el="tab-subtitle" className="text-[10px] text-zinc-500 truncate">
                    {secondary}
                  </span>
                </div>
                {tab.kind !== "database" && (
                  <button
                    data-el="tab-popout-btn"
                    onClick={(e) => {
                      e.stopPropagation();
                      tearOff(tab, e.screenX, e.screenY);
                    }}
                    className="ml-1 p-0.5 rounded text-zinc-500 hover:text-accent-300 hover:bg-zinc-800 opacity-0 group-hover:opacity-100 transition"
                    aria-label="Open in new window"
                    title="Open in new window"
                  >
                    <ArrowSquareOut size={14} />
                  </button>
                )}
                <button
                  data-el="tab-close-btn"
                  onClick={(e) => {
                    e.stopPropagation();
                    requestCloseTab(tab.id);
                  }}
                  className="ml-0.5 p-0.5 rounded text-zinc-500 hover:text-zinc-100 hover:bg-zinc-800 opacity-0 group-hover:opacity-100 transition"
                  aria-label="Close tab"
                >
                  <X size={14} />
                </button>
              </div>
            );
        })}
        </div>
      </div>
      )}

      <div className="flex-1 min-h-0 flex flex-col">
        {active ? <TabBody tab={active} /> : <EmptyState />}
      </div>

      {tabMenu && (
        <TabContextMenu
          x={tabMenu.x}
          y={tabMenu.y}
          canPopOut={tabMenu.tab.kind !== "database"}
          onPopOut={() => tearOff(tabMenu.tab, tabMenu.screenX, tabMenu.screenY)}
          onClose={() => requestCloseTab(tabMenu.tab.id)}
          onDismiss={() => setTabMenu(null)}
        />
      )}

      <CloseTabConfirmDialog />
    </div>
  );
}

/** Right-click menu for a tab: pop it out into its own window, or close it. */
function TabContextMenu({
  x,
  y,
  canPopOut,
  onPopOut,
  onClose,
  onDismiss,
}: {
  x: number;
  y: number;
  canPopOut: boolean;
  onPopOut: () => void;
  onClose: () => void;
  onDismiss: () => void;
}) {
  useEffect(() => {
    const down = () => onDismiss();
    const key = (e: KeyboardEvent) => {
      if (e.key === "Escape") onDismiss();
    };
    window.addEventListener("mousedown", down);
    window.addEventListener("keydown", key);
    return () => {
      window.removeEventListener("mousedown", down);
      window.removeEventListener("keydown", key);
    };
  }, [onDismiss]);

  return createPortal(
    <div
      data-el="tab-context-menu"
      style={{ top: y, left: x }}
      onMouseDown={(e) => e.stopPropagation()}
      className="dbs-context-menu fixed z-50 w-max rounded border border-zinc-700 bg-zinc-900/95 backdrop-blur-sm py-1 shadow-xl shadow-black/60 text-zinc-200"
    >
      {canPopOut && (
        <button
          onClick={() => {
            onDismiss();
            onPopOut();
          }}
          className="flex w-full items-center gap-2.5 px-3 py-1.5 text-left text-[12px] hover:bg-zinc-800 whitespace-nowrap"
        >
          <ArrowSquareOut size={14} className="text-accent-400 shrink-0" />
          Open in New Window
        </button>
      )}
      <button
        onClick={() => {
          onDismiss();
          onClose();
        }}
        className="flex w-full items-center gap-2.5 px-3 py-1.5 text-left text-[12px] hover:bg-zinc-800 whitespace-nowrap"
      >
        <X size={14} className="text-zinc-400 shrink-0" />
        Close Tab
      </button>
    </div>,
    document.body
  );
}

export function TabBody({ tab }: { tab: Tab }) {
  if (tab.kind === "database") {
    return <DatabaseView tab={tab} />;
  }
  if (tab.kind === "relations") {
    return <RelationsView tab={tab} />;
  }
  if (tab.kind === "query") {
    return <QueryView tab={tab} />;
  }
  if (tab.kind === "create-table") {
    return <TableDesignerView tab={tab} />;
  }
  return <RowsTabBody tab={tab} />;
}

function RowsTabBody({ tab }: { tab: RowsTab }) {
  const setTabPage = useStore((s) => s.setTabPage);
  const setPageSize = useStore((s) => s.setPageSize);
  const refreshTab = useStore((s) => s.refreshTab);
  const countExactRows = useStore((s) => s.countExactRows);
  const setRowsSort = useStore((s) => s.setRowsSort);
  const setRowsFilter = useStore((s) => s.setRowsFilter);
  const setHiddenColumns = useStore((s) => s.setHiddenColumns);
  const setJsonDisplay = useStore((s) => s.setJsonDisplay);
  const setColumnWidths = useStore((s) => s.setColumnWidths);
  const saveTablePreset = useStore((s) => s.saveTablePreset);
  const applyTablePreset = useStore((s) => s.applyTablePreset);
  const deleteTablePreset = useStore((s) => s.deleteTablePreset);
  const clearTableView = useStore((s) => s.clearTableView);
  const updateCell = useStore((s) => s.updateCell);
  const insertRow = useStore((s) => s.insertRow);
  const deleteRows = useStore((s) => s.deleteRows);
  const openTableEditor = useStore((s) => s.openTableEditor);
  const loadRelations = useStore((s) => s.loadRelations);
  const setRowsActiveCell = useStore((s) => s.setRowsActiveCell);
  const relations =
    useStore((s) => s.relations[`${tab.profileId}::${tab.database}`]) ??
    EMPTY_RELATIONS;

  /** Selected cell lives in the store so it survives tab switches. */
  const activeCell = tab.activeCell;
  const setActiveCell = (cell: { rowIndex: number; column: string } | null) =>
    setRowsActiveCell(tab.id, cell);
  const [expanded, setExpanded] = useState(true);
  const [insertOpen, setInsertOpen] = useState(false);
  const [picker, setPicker] = useState<{
    x: number;
    y: number;
    matches: { table: string; column: string }[];
  } | null>(null);

  useEffect(() => {
    loadRelations(tab.profileId, tab.database).catch(() => {});
  }, [tab.profileId, tab.database, loadRelations]);

  /** Drop the active cell when the row set actually changes (page / refresh /
   * sort / filter), but NOT on remount — so switching tabs keeps the selection.
   * A ref tracks the rows identity seen on the previous render. */
  const seenRowsRef = useRef(tab.data?.rows);
  useEffect(() => {
    if (seenRowsRef.current !== tab.data?.rows) {
      seenRowsRef.current = tab.data?.rows;
      setRowsActiveCell(tab.id, null);
    }
  }, [tab.data?.rows, tab.id, setRowsActiveCell]);

  /** Esc collapses the expanded inspector panel. */
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      if (expanded) setExpanded(false);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [expanded]);

  const estimateTotal = tab.data?.total ?? null;
  const displayTotal = tab.exactTotal ?? estimateTotal;
  const isExactTotal = tab.exactTotal != null;
  const totalPages =
    displayTotal != null
      ? Math.max(1, Math.ceil(displayTotal / tab.pageSize))
      : null;
  /** A short page (fewer rows than the limit) is the last page — there's no next. */
  const atLastPage = (tab.data?.rows.length ?? 0) < tab.pageSize;

  const activeColumn =
    activeCell && tab.data
      ? tab.data.columns.find((c) => c.name === activeCell.column) ?? null
      : null;
  const activeValue =
    activeCell && tab.data
      ? tab.data.rows[activeCell.rowIndex]?.[activeCell.column]
      : undefined;
  const activeRowOrdinal =
    activeCell && tab.data ? tab.data.offset + activeCell.rowIndex + 1 : null;
  const hasPrimaryKey =
    tab.data?.columns.some((c) => c.key === "PRI") ?? false;

  /**
   * Persist an edit made from the expanded panel, then re-select the same cell.
   * updateCell reloads the page (new rows identity), which the effect above
   * uses to clear activeCell — re-selecting on the next frame keeps the panel
   * showing the freshly-saved value instead of going blank.
   */
  const saveActiveCell = async (newValue: string | null) => {
    if (!activeCell) return;
    const cell = activeCell;
    await updateCell(tab.id, cell.rowIndex, cell.column, newValue);
    requestAnimationFrame(() => setActiveCell(cell));
  };

  const peekValue = cellToFilterValue(activeValue);

  /* Broadcast the selected source value so open peek windows launched from this
     table+column live-follow the selection across windows. */
  useEffect(() => {
    if (!activeColumn || peekValue == null) return;
    emit("dbsage://peek-follow", {
      profileId: tab.profileId,
      database: tab.database,
      sourceTable: tab.table,
      sourceColumn: activeColumn.name,
      value: peekValue,
    });
  }, [activeColumn?.name, peekValue, tab.table, tab.profileId, tab.database]);

  const relMatches = useMemo(
    () =>
      activeColumn
        ? relationTargets(relations, tab.table, activeColumn.name)
        : [],
    [relations, tab.table, activeColumn]
  );
  const hasRelation = !!activeCell && peekValue != null && relMatches.length > 0;
  /** Disable peeking into relation targets that have no matching rows. While the
   * check is in flight we stay enabled (optimistic) so the button never lags. */
  const { exists: relExists, pending: relExistPending } = useRelatedExistence(
    tab.profileId,
    tab.database,
    relMatches,
    hasRelation ? peekValue : null
  );
  const nonEmptyMatches = relMatches.filter((m) => relExists[relKey(m)] !== false);
  const canPeek =
    hasRelation && (relExistPending || nonEmptyMatches.length > 0);
  const peekableColumns = useMemo(
    () => peekableColumnsFor(relations, tab.table),
    [relations, tab.table]
  );
  const relatedTitle = !activeCell
    ? "Select a cell to peek into a related table"
    : peekValue == null
    ? "This cell is NULL — nothing to match on"
    : relMatches.length === 0
    ? `No relation defined on ${tab.table}.${activeColumn?.name ?? ""}`
    : !relExistPending && nonEmptyMatches.length === 0
    ? `No related rows in ${relMatches.map((m) => m.table).join(", ")}`
    : `Peek into ${(nonEmptyMatches.length > 0 ? nonEmptyMatches : relMatches)
        .map((m) => m.table)
        .join(", ")}`;
  const relatedBtnLabel = relatedLabel(relMatches);

  /** Launch a peek for a relation in its own OS window, placed just below the
   * active cell (screen px). The window persists until closed manually. */
  const openPeek = (t: RelationTarget) => {
    if (peekValue == null || !activeColumn) return;
    const cell = document
      .querySelector('[data-el="main-pane"] [data-active-cell]')
      ?.getBoundingClientRect();
    const x = window.screenX + (cell ? cell.left : 80);
    const y = window.screenY + (cell ? cell.bottom + 6 : 120);
    const seed: PeekSeed = {
      profileId: tab.profileId,
      profileName: tab.profileName,
      database: tab.database,
      target: { table: t.table, column: t.column, value: peekValue },
      sourceTable: tab.table,
      sourceColumn: activeColumn.name,
    };
    ipc
      .openPeekWindow(seed, x, y, 900, 440)
      .catch((e) => notifyError(`Could not open peek window: ${String(e)}`));
  };

  const onRelatedClick = (e: React.MouseEvent<HTMLButtonElement>) => {
    /** A single relation on this column opens directly. When several are defined
     * (the "x tables" label), always show the picker so the user chooses which —
     * never silently auto-open one. */
    if (relMatches.length === 1) {
      openPeek(relMatches[0]);
      return;
    }
    const rect = e.currentTarget.getBoundingClientRect();
    setPicker({ x: rect.left, y: rect.bottom + 4, matches: relMatches });
  };

  return (
    <div className="flex-1 flex flex-col min-h-0">
      <div
        data-el="rows-toolbar"
        data-toolbar="rows"
        className="dbs-toolbar h-9 pl-1 pr-1 border-b border-zinc-800/60 flex items-center gap-1 text-zinc-400"
      >
        <button
          data-el="edit-table-btn"
          onClick={() =>
            openTableEditor(
              tab.profileId,
              tab.profileName,
              tab.database,
              tab.table
            ).catch((e) =>
              notifyError(
                `Could not open "${tab.table}" for editing: ${String(e)}`
              )
            )
          }
          className="inline-flex items-center gap-1.5 px-2 py-1 rounded text-[11px] font-semibold bg-orange-400 text-orange-950 hover:bg-orange-300 transition-colors"
          title="Edit this table's structure"
        >
          <PencilSimple size={17} />
          Edit Table
        </button>

        <button
          data-el="add-row-btn"
          onClick={() => setInsertOpen(true)}
          className="inline-flex items-center gap-1.5 px-2 py-1 rounded text-[11px] font-semibold bg-emerald-500 text-emerald-950 hover:bg-emerald-400 transition-colors"
          title="Insert a new row"
        >
          <span className="relative -top-px text-[16px] leading-none">+</span> Row
        </button>

        <TableViewPresetMenu
          presets={tab.presets}
          activeName={tab.activePreset}
          onApply={(name) => applyTablePreset(tab.id, name)}
          onSave={(name) => saveTablePreset(tab.id, name)}
          onDelete={(name) => deleteTablePreset(tab.id, name)}
          onClear={() => clearTableView(tab.id)}
        />

        <button
          data-el="related-btn"
          disabled={!canPeek}
          onClick={onRelatedClick}
          className={clsx(
            "inline-flex items-center gap-1.5 px-2 py-1 rounded text-[11px] font-semibold transition-colors",
            canPeek
              ? "bg-violet-500 text-violet-950 hover:bg-violet-400"
              : "bg-zinc-800 text-zinc-600 cursor-not-allowed"
          )}
          title={relatedTitle}
        >
          <ShareNetwork size={17} />
          {relatedBtnLabel}
        </button>

        <button
          data-el="refresh-btn"
          onClick={() => refreshTab(tab.id)}
          disabled={tab.loading}
          title="Refresh the row set"
          aria-label="Refresh"
          className="inline-flex items-center justify-center h-7 w-7 rounded transition-colors bg-zinc-800 text-zinc-300 hover:bg-zinc-700 hover:text-zinc-100 disabled:opacity-40 disabled:hover:bg-zinc-800"
        >
          {tab.loading ? (
            <Loader2 size={15} className="animate-spin" />
          ) : (
            <RefreshCw size={15} />
          )}
        </button>

        <button
          data-el="expanded-toggle-btn"
          onClick={() => setExpanded((v) => !v)}
          className={clsx(
            "ml-auto inline-flex items-center gap-1.5 px-2 py-1 rounded text-[11px] font-semibold transition-colors bg-zinc-800 hover:bg-zinc-700",
            expanded ? "text-emerald-300" : "text-zinc-500 hover:text-zinc-400"
          )}
          title="Toggle the Inspector panel"
        >
          <Binoculars size={17} />
          Inspector
        </button>
      </div>


      {tab.error && (
        <div className="px-3 py-2 bg-rose-950/40 border-b border-rose-900/60 text-rose-300 text-[11px] flex items-start gap-2">
          <AlertCircle size={14} className="mt-0.5 shrink-0" />
          <span className="break-words">{tab.error}</span>
        </div>
      )}

      {tab.loading && !tab.data ? (
        <div className="flex-1 flex items-center justify-center text-zinc-500 text-xs gap-2">
          <Loader2 size={16} className="animate-spin" /> Loading rows…
        </div>
      ) : tab.data ? (
        <DataGrid
          columns={tab.data.columns}
          rows={tab.data.rows}
          offset={tab.data.offset}
          sort={tab.sort}
          filters={tab.filters}
          hiddenColumns={tab.hiddenColumns}
          jsonDisplay={tab.jsonDisplay}
          columnWidths={tab.columnWidths}
          copyTarget={{ database: tab.database, table: tab.table }}
          peekableColumns={peekableColumns}
          activeCell={activeCell}
          clearActiveCellOnRowSelect
          onActiveCellChange={setActiveCell}
          onColumnWidthsChange={(w) => setColumnWidths(tab.id, w)}
          onSortChange={(sort) => setRowsSort(tab.id, sort)}
          onFilterChange={(column, filter) =>
            setRowsFilter(tab.id, column, filter)
          }
          onHiddenColumnsChange={(hidden) => setHiddenColumns(tab.id, hidden)}
          onJsonShow={(column, path) => setJsonDisplay(tab.id, column, path)}
          onCellEdit={(rowIndex, column, value) =>
            updateCell(tab.id, rowIndex, column, value)
          }
          onDeleteRows={hasPrimaryKey ? (indices) => deleteRows(tab.id, indices) : undefined}
        />
      ) : (
        <div className="flex-1" />
      )}

      <div data-el="rows-pager" className="h-8 pl-1 pr-3 border-t border-zinc-800/60 flex items-center gap-1 text-[11px] text-zinc-400 bg-zinc-950">
        <button
          data-el="prev-page-btn"
          className="inline-flex items-center gap-1.5 px-2 py-1 rounded text-[11px] font-semibold transition-colors bg-zinc-800 text-zinc-300 hover:bg-zinc-700 hover:text-zinc-100 disabled:opacity-40 disabled:hover:bg-zinc-800"
          onClick={() => setTabPage(tab.id, tab.page - 1)}
          disabled={tab.page <= 1 || tab.loading}
        >
          <ChevronLeft size={15} /> Prev
        </button>
        <button
          data-el="next-page-btn"
          className="inline-flex items-center gap-1.5 px-2 py-1 rounded text-[11px] font-semibold transition-colors bg-zinc-800 text-zinc-300 hover:bg-zinc-700 hover:text-zinc-100 disabled:opacity-40 disabled:hover:bg-zinc-800"
          onClick={() => setTabPage(tab.id, tab.page + 1)}
          disabled={
            tab.loading ||
            atLastPage ||
            (isExactTotal && totalPages != null && tab.page >= totalPages)
          }
        >
          Next <ChevronRight size={15} />
        </button>

        <div className="ml-2 flex items-center gap-1.5">
          <span>page</span>
          <PageInput
            page={tab.page}
            maxPage={isExactTotal ? totalPages : null}
            disabled={tab.loading}
            onCommit={(p) => setTabPage(tab.id, p)}
          />
          <span>of</span>
          <span className="font-mono text-zinc-300">
            {totalPages == null ? "?" : `${isExactTotal ? "" : "~"}${totalPages}`}
          </span>
        </div>

        <PageSizeDropup
          value={tab.pageSize}
          disabled={tab.loading}
          onChange={(n) => setPageSize(tab.id, n)}
        />

        {tab.data && (
          <span className="ml-auto inline-flex items-center gap-1.5">
            <span>
              <span className="text-zinc-200">{tab.data.rows.length}</span> rows
              {displayTotal != null ? (
                <>
                  {" "}
                  of{" "}
                  <span className="text-zinc-200">
                    {isExactTotal ? "" : "~"}
                    {displayTotal.toLocaleString()}
                  </span>
                </>
              ) : (
                <> of <span className="text-zinc-500">?</span></>
              )}
            </span>
            {!isExactTotal && (
              <ExactCountButton onCount={() => countExactRows(tab.id)} />
            )}
          </span>
        )}

      </div>

      {expanded && (
        <ExpandedPanel
          column={activeColumn}
          value={activeValue}
          rowOrdinal={activeRowOrdinal}
          editable={hasPrimaryKey}
          onSave={activeCell ? saveActiveCell : undefined}
          onClose={() => setExpanded(false)}
        />
      )}

      {insertOpen && (
        <InsertRowDialog
          profileId={tab.profileId}
          database={tab.database}
          table={tab.table}
          onSubmit={async (values) => {
            await insertRow(tab.id, values);
            notifySuccess(`Inserted a row into "${tab.table}"`);
          }}
          onClose={() => setInsertOpen(false)}
        />
      )}

      {picker &&
        createPortal(
          <>
            <div
              className="fixed inset-0 z-40"
              onMouseDown={() => setPicker(null)}
            />
            <div
              data-el="related-picker"
              style={{ top: picker.y, left: picker.x }}
              className="dbs-context-menu fixed z-50 w-max rounded border border-zinc-700 bg-zinc-900/95 backdrop-blur-sm py-1 shadow-xl shadow-black/60 text-zinc-200"
            >
              <div className="px-3 py-1 text-[10px] uppercase tracking-wide text-zinc-500">
                Peek into
              </div>
              {picker.matches.map((m) => (
                <button
                  key={`${m.table}::${m.column}`}
                  onClick={() => {
                    setPicker(null);
                    openPeek(m);
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
    </div>
  );
}

function PageInput({
  page,
  maxPage,
  disabled,
  onCommit,
}: {
  page: number;
  maxPage: number | null;
  disabled: boolean;
  onCommit: (page: number) => void;
}) {
  const [val, setVal] = useState(String(page));
  useEffect(() => setVal(String(page)), [page]);

  const commit = () => {
    const n = parseInt(val, 10);
    if (Number.isNaN(n)) {
      setVal(String(page));
      return;
    }
    let next = Math.max(1, n);
    if (maxPage != null) next = Math.min(next, maxPage);
    if (next === page) setVal(String(page));
    else onCommit(next);
  };

  return (
    <input
      data-el="page-input"
      value={val}
      disabled={disabled}
      onChange={(e) => setVal(e.target.value.replace(/[^0-9]/g, ""))}
      onFocus={(e) => e.currentTarget.select()}
      onKeyDown={(e) => {
        if (e.key === "Enter") {
          e.preventDefault();
          commit();
        }
      }}
      onBlur={commit}
      className="w-12 text-center bg-zinc-900 border border-zinc-800 rounded px-1 py-0.5 font-mono text-zinc-200 focus:border-accent-500 outline-none disabled:opacity-50"
    />
  );
}

function ExactCountButton({ onCount }: { onCount: () => Promise<void> }) {
  const [loading, setLoading] = useState(false);
  return (
    <button
      data-el="exact-count-btn"
      disabled={loading}
      onClick={async () => {
        setLoading(true);
        try {
          await onCount();
        } catch (e) {
          alert(`Count failed: ${String(e)}`);
        } finally {
          setLoading(false);
        }
      }}
      title="Run an exact COUNT(*) — may be slow on very large tables"
      className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-accent-400 hover:bg-zinc-800 hover:text-accent-300 disabled:opacity-50"
    >
      {loading ? <Loader2 size={11} className="animate-spin" /> : null}
      {loading ? "counting…" : "= exact"}
    </button>
  );
}

const PAGE_SIZE_PRESETS = [10, 100, 1000];
const MAX_PAGE_SIZE = 100000;

function PageSizeDropup({
  value,
  disabled,
  onChange,
}: {
  value: number;
  disabled: boolean;
  onChange: (size: number) => void;
}) {
  const [open, setOpen] = useState(false);
  const [custom, setCustom] = useState("");
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    window.addEventListener("mousedown", onDown);
    return () => window.removeEventListener("mousedown", onDown);
  }, [open]);

  const apply = (n: number) => {
    onChange(Math.max(1, Math.min(MAX_PAGE_SIZE, n)));
    setOpen(false);
    setCustom("");
  };

  const applyCustom = () => {
    const n = parseInt(custom, 10);
    if (!Number.isNaN(n)) apply(n);
  };

  return (
    <div ref={ref} className="relative">
      <button
        data-el="page-size-btn"
        disabled={disabled}
        onClick={() => setOpen((o) => !o)}
        className="inline-flex items-center gap-1 px-2 py-0.5 rounded hover:bg-zinc-800 hover:text-zinc-100 disabled:opacity-30"
        title="Rows per page"
      >
        <span className="font-mono text-zinc-300">{value}</span>
        <span className="text-zinc-500">/ page</span>
        {open ? <CaretDown size={11} /> : <CaretUp size={11} />}
      </button>
      {open && (
        <div
          data-el="page-size-menu"
          className="absolute bottom-full left-0 mb-1 w-40 rounded border border-zinc-700 bg-zinc-900/95 backdrop-blur-sm py-1 shadow-xl shadow-black/60"
        >
          {PAGE_SIZE_PRESETS.map((p) => (
            <button
              key={p}
              onClick={() => apply(p)}
              className={clsx(
                "w-full text-left px-3 py-1.5 hover:bg-zinc-800 font-mono",
                p === value ? "text-accent-300" : "text-zinc-200"
              )}
            >
              {p} rows
            </button>
          ))}
          <div className="my-1 border-t border-zinc-800" />
          <div className="px-2 py-1 flex items-center gap-1">
            <input
              data-el="page-size-custom-input"
              value={custom}
              placeholder="Enter a number"
              onChange={(e) => setCustom(e.target.value.replace(/[^0-9]/g, ""))}
              onKeyDown={(e) => {
                if (e.key === "Enter") {
                  e.preventDefault();
                  applyCustom();
                }
              }}
              className="w-full min-w-0 bg-zinc-950 border border-zinc-700 rounded px-1.5 py-0.5 font-mono text-zinc-100 outline-none focus:border-accent-500"
            />
            <button
              onClick={applyCustom}
              disabled={!custom}
              className="px-2 py-0.5 rounded bg-accent-500 text-[#042f2e] font-semibold disabled:opacity-40"
            >
              Set
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

/** "Edit table" glyph: the table icon with a small pencil badge at its corner.
 * Distinguishes an edit-table tab from a new-table tab (plain Table icon). */
function TableEditIcon({
  size = 24,
  className,
}: {
  size?: number;
  className?: string;
}) {
  return (
    <span
      className={clsx("relative inline-flex shrink-0", className)}
      style={{ width: size, height: size }}
    >
      <Table2 size={size} />
      <PencilSimple
        size={Math.round(size * 0.6)}
        weight="fill"
        className="absolute -bottom-0.5 -right-0.5"
      />
    </span>
  );
}

function EmptyState() {
  return (
    <div data-el="tabs-empty-state" className="flex-1 flex items-end justify-end p-6">
      <img
        src={appIconLarge}
        alt=""
        className="w-[120px] h-[120px] object-contain opacity-[0.08] select-none pointer-events-none"
      />
    </div>
  );
}
