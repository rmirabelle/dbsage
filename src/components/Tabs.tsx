import { useEffect, useRef, useState } from "react";
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
  ArrowsOutSimple,
  PencilSimple,
  WarningCircle as AlertCircle,
} from "@phosphor-icons/react";
import clsx from "clsx";
import { useStore, isDesignerTabDirty } from "../state/store";
import { notifyError } from "../state/notify";
import { CloseTabConfirmDialog } from "./CloseTabConfirmDialog";
import { DataGrid } from "./DataGrid";
import { DatabaseView } from "./DatabaseView";
import { RelationsView } from "./RelationsView";
import { TableDesignerView } from "./TableDesignerView";
import { ExpandedPanel } from "./ExpandedPanel";
import type { RowsTab, Tab } from "../types";

export function Tabs() {
  const tabs = useStore((s) => s.tabs);
  const activeTabId = useStore((s) => s.activeTabId);
  const setActiveTab = useStore((s) => s.setActiveTab);
  const requestCloseTab = useStore((s) => s.requestCloseTab);

  const active = tabs.find((t) => t.id === activeTabId) ?? null;

  return (
    <div className="w-full h-full flex flex-col bg-zinc-950 min-w-0">
      {tabs.length > 0 && (
      <div data-el="tab-bar" className="flex items-stretch border-b border-zinc-800/80 bg-zinc-950 overflow-hidden">
        <div className="flex-1 flex items-stretch overflow-x-auto">
        {tabs.map((tab) => {
            let primary: string;
            let secondary: string;
            let Icon: typeof Database;
            let iconColor: string;
            let dirty = false;
            if (tab.kind === "database") {
              primary = tab.database;
              secondary = tab.profileName;
              Icon = Database;
              iconColor = "text-accent-400";
            } else if (tab.kind === "relations") {
              primary = "Relationships";
              secondary = `${tab.profileName} / ${tab.database}`;
              Icon = ShareNetwork;
              iconColor = "text-violet-400";
            } else if (tab.kind === "create-table") {
              primary = tab.tableName.trim() || "New table";
              secondary = `${tab.profileName} / ${tab.database}`;
              Icon = Table2;
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
                <button
                  data-el="tab-close-btn"
                  onClick={(e) => {
                    e.stopPropagation();
                    requestCloseTab(tab.id);
                  }}
                  className="ml-1 p-0.5 rounded text-zinc-500 hover:text-zinc-100 hover:bg-zinc-800 opacity-0 group-hover:opacity-100 transition"
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

      <CloseTabConfirmDialog />
    </div>
  );
}

function TabBody({ tab }: { tab: Tab }) {
  if (tab.kind === "database") {
    return <DatabaseView tab={tab} />;
  }
  if (tab.kind === "relations") {
    return <RelationsView tab={tab} />;
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
  const updateCell = useStore((s) => s.updateCell);
  const openTableEditor = useStore((s) => s.openTableEditor);

  const [activeCell, setActiveCell] = useState<{
    rowIndex: number;
    column: string;
  } | null>(null);
  const [expanded, setExpanded] = useState(false);

  /** Drop the active cell whenever the rows array identity changes (page / refresh / sort). */
  useEffect(() => {
    setActiveCell(null);
  }, [tab.data?.rows]);

  useEffect(() => {
    if (!expanded) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setExpanded(false);
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

  return (
    <div className="flex-1 flex flex-col min-h-0">
      <div
        data-el="rows-toolbar"
        data-toolbar="rows"
        className="dbs-toolbar h-9 pl-1 pr-3 border-b border-zinc-800/60 flex items-center gap-1 text-zinc-400"
      >
        <button
          data-el="expanded-toggle-btn"
          onClick={() => setExpanded((v) => !v)}
          className={clsx(
            "inline-flex items-center gap-1.5 px-3 py-1 rounded text-[11px] font-semibold transition-colors",
            expanded
              ? "bg-accent-500 text-[#042f2e] hover:bg-accent-400"
              : "bg-zinc-800 text-zinc-200 hover:bg-zinc-700"
          )}
          title="Toggle the expanded-value panel"
        >
          <ArrowsOutSimple size={17} />
          Expanded
        </button>

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
          className="inline-flex items-center gap-1.5 px-3 py-1 rounded text-[11px] font-semibold bg-orange-400 text-orange-950 hover:bg-orange-300 transition-colors"
          title="Edit this table's structure"
        >
          <PencilSimple size={17} />
          Edit Table
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
          activeCell={activeCell}
          onActiveCellChange={setActiveCell}
          onSortChange={(sort) => setRowsSort(tab.id, sort)}
          onFilterChange={(column, filter) =>
            setRowsFilter(tab.id, column, filter)
          }
          onHiddenColumnsChange={(hidden) => setHiddenColumns(tab.id, hidden)}
          onJsonShow={(column, path) => setJsonDisplay(tab.id, column, path)}
          onCellEdit={(rowIndex, column, value) =>
            updateCell(tab.id, rowIndex, column, value)
          }
        />
      ) : (
        <div className="flex-1" />
      )}

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

      <div data-el="rows-pager" className="h-8 px-3 border-t border-zinc-800/60 flex items-center gap-2 text-[11px] text-zinc-400 bg-zinc-950">
        <button
          data-el="prev-page-btn"
          className="inline-flex items-center gap-1 px-2 py-0.5 rounded hover:bg-zinc-800 hover:text-zinc-100 disabled:opacity-30 disabled:hover:bg-transparent"
          onClick={() => setTabPage(tab.id, tab.page - 1)}
          disabled={tab.page <= 1 || tab.loading}
        >
          <ChevronLeft size={13} /> Prev
        </button>
        <button
          data-el="next-page-btn"
          className="inline-flex items-center gap-1 px-2 py-0.5 rounded hover:bg-zinc-800 hover:text-zinc-100 disabled:opacity-30 disabled:hover:bg-transparent"
          onClick={() => setTabPage(tab.id, tab.page + 1)}
          disabled={
            tab.loading ||
            atLastPage ||
            (isExactTotal && totalPages != null && tab.page >= totalPages)
          }
        >
          Next <ChevronRight size={13} />
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

        <button
          data-el="refresh-btn"
          onClick={() => refreshTab(tab.id)}
          disabled={tab.loading}
          className={clsx(
            "inline-flex items-center gap-1.5 py-0.5 pl-3 pr-1 rounded hover:text-zinc-100 disabled:opacity-30 border-l border-zinc-800/60",
            tab.data ? "ml-3" : "ml-auto"
          )}
        >
          {tab.loading ? (
            <Loader2 size={13} className="animate-spin" />
          ) : (
            <RefreshCw size={13} />
          )}
          Refresh
        </button>
      </div>
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

function EmptyState() {
  return (
    <div data-el="tabs-empty-state" className="flex-1 flex items-center justify-center">
      <div className="text-center text-zinc-600">
        <Database size={46} className="mx-auto mb-3 opacity-30" />
        <p className="text-sm">Click a database to browse its tables.</p>
        <p className="text-[11px] mt-1 text-zinc-700">
          Double-click a table to view its rows.
        </p>
      </div>
    </div>
  );
}
