import { useEffect, useState } from "react";
import {
  X,
  CircleNotch as Loader2,
  ArrowsClockwise as RefreshCw,
  CaretLeft as ChevronLeft,
  CaretRight as ChevronRight,
  Table as Table2,
  Database,
  ArrowsOutSimple,
  WarningCircle as AlertCircle,
} from "@phosphor-icons/react";
import clsx from "clsx";
import { useStore } from "../state/store";
import { DataGrid } from "./DataGrid";
import { DatabaseView } from "./DatabaseView";
import { ExpandedPanel } from "./ExpandedPanel";
import { ZoomControls } from "./ZoomControls";
import type { RowsTab, Tab } from "../types";

export function TableTabs() {
  const tabs = useStore((s) => s.tabs);
  const activeTabId = useStore((s) => s.activeTabId);
  const setActiveTab = useStore((s) => s.setActiveTab);
  const closeTab = useStore((s) => s.closeTab);

  const active = tabs.find((t) => t.id === activeTabId) ?? null;

  return (
    <div className="w-full h-full flex flex-col bg-zinc-950 min-w-0">
      <div className="flex items-stretch border-b border-zinc-800/80 bg-zinc-950 overflow-hidden">
        <div className="flex-1 flex items-stretch overflow-x-auto">
        {tabs.length === 0 ? (
          <div className="flex items-center px-4 text-zinc-600 text-xs">
            Double-click a table to open it.
          </div>
        ) : (
          tabs.map((tab) => {
            const isDb = tab.kind === "database";
            const primary = isDb ? tab.database : (tab as RowsTab).table;
            const secondary = isDb
              ? tab.profileName
              : `${tab.profileName} / ${tab.database}`;
            const Icon = isDb ? Database : Table2;
            return (
              <div
                key={tab.id}
                onClick={() => setActiveTab(tab.id)}
                className={clsx(
                  "group flex items-center gap-2 pl-3 pr-1.5 border-r border-zinc-800/60 cursor-pointer min-w-0 max-w-[260px] shrink-0",
                  tab.id === activeTabId
                    ? "bg-zinc-900 text-zinc-100"
                    : "text-zinc-400 hover:bg-zinc-900/50"
                )}
              >
                <Icon
                  size={11}
                  className={clsx(
                    tab.id === activeTabId ? "text-accent-400" : "text-zinc-600"
                  )}
                />
                <div className="min-w-0 flex flex-col leading-tight py-2.5">
                  <span className="text-[12px] truncate">{primary}</span>
                  <span className="text-[10px] text-zinc-500 truncate">
                    {secondary}
                  </span>
                </div>
                <button
                  onClick={(e) => {
                    e.stopPropagation();
                    closeTab(tab.id);
                  }}
                  className="ml-1 p-0.5 rounded text-zinc-500 hover:text-zinc-100 hover:bg-zinc-800 opacity-0 group-hover:opacity-100 transition"
                  aria-label="Close tab"
                >
                  <X size={12} />
                </button>
              </div>
            );
          })
        )}
        </div>
        <div className="flex items-center px-2 border-l border-zinc-800/60 shrink-0">
          <ZoomControls pane="tabs" />
        </div>
      </div>

      <div className="flex-1 min-h-0 flex flex-col">
        {active ? <TabBody tab={active} /> : <EmptyState />}
      </div>
    </div>
  );
}

function TabBody({ tab }: { tab: Tab }) {
  if (tab.kind === "database") {
    return <DatabaseView tab={tab} />;
  }
  return <RowsTabBody tab={tab} />;
}

function RowsTabBody({ tab }: { tab: RowsTab }) {
  const setTabPage = useStore((s) => s.setTabPage);
  const refreshTab = useStore((s) => s.refreshTab);
  const setRowsSort = useStore((s) => s.setRowsSort);
  const setRowsFilter = useStore((s) => s.setRowsFilter);
  const setHiddenColumns = useStore((s) => s.setHiddenColumns);
  const updateCell = useStore((s) => s.updateCell);

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

  const total = tab.data?.total ?? null;
  const totalPages =
    total != null ? Math.max(1, Math.ceil(total / tab.pageSize)) : null;

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

  return (
    <div className="flex-1 flex flex-col min-h-0">
      <div
        data-toolbar="rows"
        className="h-8 px-3 border-b border-zinc-800/60 flex items-center gap-2 text-[11px] text-zinc-400"
      >
        <button
          onClick={() => setExpanded((v) => !v)}
          className={clsx(
            "inline-flex items-center gap-1.5 px-2 py-1 rounded transition-colors",
            expanded
              ? "bg-accent-500/20 text-accent-200"
              : "hover:bg-zinc-800 text-zinc-300"
          )}
          title="Toggle the expanded-value panel"
        >
          <ArrowsOutSimple size={11} />
          Expanded
        </button>
      </div>


      {tab.error && (
        <div className="px-3 py-2 bg-rose-950/40 border-b border-rose-900/60 text-rose-300 text-[11px] flex items-start gap-2">
          <AlertCircle size={12} className="mt-0.5 shrink-0" />
          <span className="break-words">{tab.error}</span>
        </div>
      )}

      {tab.loading && !tab.data ? (
        <div className="flex-1 flex items-center justify-center text-zinc-500 text-xs gap-2">
          <Loader2 size={14} className="animate-spin" /> Loading rows…
        </div>
      ) : tab.data ? (
        <DataGrid
          columns={tab.data.columns}
          rows={tab.data.rows}
          offset={tab.data.offset}
          sort={tab.sort}
          filters={tab.filters}
          hiddenColumns={tab.hiddenColumns}
          activeCell={activeCell}
          onActiveCellChange={setActiveCell}
          onSortChange={(sort) => setRowsSort(tab.id, sort)}
          onFilterChange={(column, filter) =>
            setRowsFilter(tab.id, column, filter)
          }
          onHiddenColumnsChange={(hidden) => setHiddenColumns(tab.id, hidden)}
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
          onClose={() => setExpanded(false)}
        />
      )}

      <div className="h-8 px-3 border-t border-zinc-800/60 flex items-center gap-3 text-[11px] text-zinc-400 bg-zinc-950">
        <button
          onClick={() => refreshTab(tab.id)}
          disabled={tab.loading}
          className="inline-flex items-center gap-1.5 px-2 py-0.5 rounded hover:bg-zinc-800 disabled:opacity-30"
        >
          {tab.loading ? (
            <Loader2 size={11} className="animate-spin" />
          ) : (
            <RefreshCw size={11} />
          )}
          Refresh
        </button>

        <div className="ml-auto flex items-center gap-2">
          <span className="text-zinc-500 font-mono">LIMIT {tab.pageSize}</span>
          <span className="text-zinc-600">·</span>
          <button
            className="px-1.5 py-0.5 rounded hover:bg-zinc-800 disabled:opacity-30 inline-flex items-center"
            onClick={() => setTabPage(tab.id, tab.page - 1)}
            disabled={tab.page <= 1 || tab.loading}
            aria-label="Previous page"
          >
            <ChevronLeft size={13} />
          </button>
          <span className="font-mono text-zinc-300">
            page {tab.page}
            {totalPages != null && (
              <span className="text-zinc-500"> / {totalPages}</span>
            )}
          </span>
          <button
            className="px-1.5 py-0.5 rounded hover:bg-zinc-800 disabled:opacity-30 inline-flex items-center"
            onClick={() => setTabPage(tab.id, tab.page + 1)}
            disabled={
              (totalPages != null && tab.page >= totalPages) || tab.loading
            }
            aria-label="Next page"
          >
            <ChevronRight size={13} />
          </button>
        </div>

        {tab.data && (
          <span className="pl-3 border-l border-zinc-800/60">
            <span className="text-zinc-200">{tab.data.rows.length}</span> rows
            {total != null && (
              <>
                {" "}
                of <span className="text-zinc-200">{total.toLocaleString()}</span>
              </>
            )}
          </span>
        )}
      </div>
    </div>
  );
}

function EmptyState() {
  return (
    <div className="flex-1 flex items-center justify-center">
      <div className="text-center text-zinc-600">
        <Database size={40} className="mx-auto mb-3 opacity-30" />
        <p className="text-sm">Click a database to browse its tables.</p>
        <p className="text-[11px] mt-1 text-zinc-700">
          Double-click a table to view its rows.
        </p>
      </div>
    </div>
  );
}
