import { useEffect, useMemo, useRef, useState } from "react";
import {
  Play,
  Stop,
  MagicWand,
  CaretDown,
  ArrowsOutSimple,
  CircleNotch as Loader2,
  WarningCircle as AlertCircle,
} from "@phosphor-icons/react";
import clsx from "clsx";
import { useStore } from "../state/store";
import { notifyError } from "../state/notify";
import { ipc } from "../ipc";
import { DataGrid } from "./DataGrid";
import { ExpandedPanel } from "./ExpandedPanel";
import { ExportButton } from "./ExportButton";
import { SqlEditor } from "./SqlEditor";
import { compactDisplay, extractJsonCandidates } from "../lib/jsonPath";
import { formatSql, type FormatStyle } from "../lib/formatSql";
import { scanFromTables } from "../lib/sqlCompletion";
import { SQL_KEYWORDS } from "../lib/sqlHighlight";
import type { ColumnFilter, QueryTab, RowRecord, SortSpec } from "../types";

export function QueryView({ tab }: { tab: QueryTab }) {
  const profiles = useStore((s) => s.profiles);
  const databases = useStore((s) => s.trees[tab.profileId]?.databases ?? []);
  const setQuerySql = useStore((s) => s.setQuerySql);
  const setQueryConnection = useStore((s) => s.setQueryConnection);
  const setQueryDatabase = useStore((s) => s.setQueryDatabase);
  const setQueryMaxRows = useStore((s) => s.setQueryMaxRows);
  const executeQuery = useStore((s) => s.executeQuery);
  const stopQuery = useStore((s) => s.stopQuery);

  /* Client-side view state for the read-only results grid (sort/filter/hide
     don't re-run the query — they just reshape the already-fetched rows). */
  const [sort, setSort] = useState<SortSpec | null>(null);
  const [filters, setFilters] = useState<ColumnFilter[]>([]);
  const [hiddenColumns, setHiddenColumns] = useState<string[]>([]);
  const [jsonDisplay, setJsonDisplay] = useState<Record<string, string>>({});
  const [activeCell, setActiveCell] = useState<{
    rowIndex: number;
    column: string;
  } | null>(null);
  const [selectedRows, setSelectedRows] = useState<number[]>([]);

  /* Focus the editor when this query pane becomes active (new tab, or switching
     to it) so the user can start typing immediately. */
  const editorRef = useRef<HTMLTextAreaElement>(null);
  useEffect(() => {
    editorRef.current?.focus();
  }, [tab.id]);

  /* Split Format button: remembers the chosen style across sessions. */
  const [formatStyle, setFormatStyle] = useState<FormatStyle>(() =>
    localStorage.getItem("dbsage.queryFormatStyle") === "condensed"
      ? "condensed"
      : "standard"
  );
  const [formatMenuOpen, setFormatMenuOpen] = useState(false);
  const formatMenuRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!formatMenuOpen) return;
    const onDown = (e: MouseEvent) => {
      if (
        formatMenuRef.current &&
        !formatMenuRef.current.contains(e.target as Node)
      ) {
        setFormatMenuOpen(false);
      }
    };
    window.addEventListener("mousedown", onDown);
    return () => window.removeEventListener("mousedown", onDown);
  }, [formatMenuOpen]);

  /* Draggable splitter between the editor and the results. */
  const containerRef = useRef<HTMLDivElement>(null);
  const [editorHeight, setEditorHeight] = useState(180);

  /* Expanded-value panel (read-only) for the active result cell. */
  const [expanded, setExpanded] = useState(false);
  useEffect(() => {
    if (!expanded) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setExpanded(false);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [expanded]);

  const dbOptions = useMemo(() => {
    const opts = new Set(databases);
    if (tab.database) opts.add(tab.database);
    return Array.from(opts);
  }, [databases, tab.database]);

  /* Autocompletion data: the db's table list + a lazily-filled column cache for
     tables referenced in the query's FROM/JOIN. */
  const [tableNames, setTableNames] = useState<string[]>([]);
  const [columnsByTable, setColumnsByTable] = useState<Record<string, string[]>>(
    {}
  );

  useEffect(() => {
    let cancelled = false;
    setTableNames([]);
    setColumnsByTable({});
    if (!tab.database) return;
    ipc
      .listTables(tab.profileId, tab.database)
      .then((ts) => {
        if (!cancelled) setTableNames(ts.map((t) => t.name));
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [tab.profileId, tab.database]);

  useEffect(() => {
    const handle = window.setTimeout(() => {
      const need = Array.from(
        new Set(scanFromTables(tab.sql).map((r) => r.table))
      ).filter((t) => !(t.toLowerCase() in columnsByTable));
      for (const t of need) {
        ipc
          .listColumns(tab.profileId, tab.database, t)
          .then((cols) =>
            setColumnsByTable((prev) => ({
              ...prev,
              [t.toLowerCase()]: cols.map((c) => c.name),
            }))
          )
          .catch(() =>
            setColumnsByTable((prev) => ({ ...prev, [t.toLowerCase()]: [] }))
          );
      }
    }, 250);
    return () => window.clearTimeout(handle);
  }, [tab.sql, tab.profileId, tab.database, columnsByTable]);

  const completion = useMemo(
    () => ({ tables: tableNames, columnsByTable, keywords: SQL_KEYWORDS }),
    [tableNames, columnsByTable]
  );

  const result = tab.result;
  const viewRows = useMemo(
    () => (result ? applyView(result.rows, filters, sort) : []),
    [result, filters, sort]
  );

  const hasResultSet = result != null && result.rowsAffected == null;
  const activeColumn =
    activeCell && result
      ? result.columns.find((c) => c.name === activeCell.column) ?? null
      : null;
  const activeValue =
    activeCell && result
      ? viewRows[activeCell.rowIndex]?.[activeCell.column]
      : undefined;
  const activeRowOrdinal = activeCell ? activeCell.rowIndex + 1 : null;

  const canRun = tab.sql.trim().length > 0 && !tab.loading;

  const runFormat = (style: FormatStyle) => {
    if (!tab.sql.trim()) return;
    try {
      setQuerySql(tab.id, formatSql(tab.sql, style));
    } catch (e) {
      notifyError(`Could not format SQL: ${String(e)}`);
    }
  };

  const chooseFormat = (style: FormatStyle) => {
    setFormatStyle(style);
    localStorage.setItem("dbsage.queryFormatStyle", style);
    setFormatMenuOpen(false);
    runFormat(style);
  };

  const startEditorResize = (e: React.PointerEvent) => {
    e.preventDefault();
    const startY = e.clientY;
    const startH = editorHeight;
    /* Leave room for the results pane + footer so they can't be dragged away. */
    const maxH = Math.max(120, (containerRef.current?.clientHeight ?? 600) - 140);
    const prevCursor = document.body.style.cursor;
    const prevSelect = document.body.style.userSelect;
    document.body.style.cursor = "row-resize";
    document.body.style.userSelect = "none";
    const onMove = (ev: PointerEvent) => {
      setEditorHeight(Math.min(maxH, Math.max(80, startH + (ev.clientY - startY))));
    };
    const cleanup = () => {
      document.body.style.cursor = prevCursor;
      document.body.style.userSelect = prevSelect;
      document.removeEventListener("pointermove", onMove);
      document.removeEventListener("pointerup", cleanup);
    };
    document.addEventListener("pointermove", onMove);
    document.addEventListener("pointerup", cleanup);
  };

  return (
    <div ref={containerRef} className="flex-1 flex flex-col min-h-0">
      <div
        data-el="query-toolbar"
        data-toolbar="query"
        className="dbs-toolbar h-9 pl-1 pr-3 border-b border-zinc-800/60 flex items-center gap-1 text-[11px] text-zinc-400"
      >
        <select
          data-el="query-connection-select"
          value={tab.profileId}
          onChange={(e) => setQueryConnection(tab.id, e.target.value)}
          title="Connection"
          className="bg-zinc-900 border border-zinc-800 rounded pl-2 py-1 text-zinc-200 max-w-44 focus:border-accent-500"
        >
          {profiles.map((p) => (
            <option key={p.id} value={p.id}>
              {p.name}
            </option>
          ))}
        </select>

        <select
          data-el="query-database-select"
          value={tab.database}
          onChange={(e) => setQueryDatabase(tab.id, e.target.value)}
          title="Database"
          className="bg-zinc-900 border border-zinc-800 rounded pl-2 py-1 text-zinc-200 max-w-44 focus:border-accent-500"
        >
          {dbOptions.length === 0 && <option value="">(no database)</option>}
          {dbOptions.map((d) => (
            <option key={d} value={d}>
              {d}
            </option>
          ))}
        </select>

        <select
          data-el="query-maxrows-select"
          value={tab.maxRows == null ? "" : String(tab.maxRows)}
          onChange={(e) =>
            setQueryMaxRows(
              tab.id,
              e.target.value === "" ? null : Number(e.target.value)
            )
          }
          title="Maximum rows to fetch — a safety cap against huge result sets"
          className="bg-zinc-900 border border-zinc-800 rounded pl-2 py-1 text-zinc-200 focus:border-accent-500"
        >
          <option value="100">100 rows</option>
          <option value="1000">1,000 rows</option>
          <option value="10000">10,000 rows</option>
          <option value="">No limit</option>
        </select>

        <button
          data-el="query-execute-btn"
          onClick={() => executeQuery(tab.id)}
          disabled={!canRun}
          title="Execute (Ctrl+Enter)"
          className="inline-flex items-center gap-1.5 px-3 py-1 rounded font-semibold bg-emerald-500 text-emerald-950 hover:bg-emerald-400 disabled:opacity-40 disabled:hover:bg-emerald-500 transition-colors"
        >
          {tab.loading ? (
            <Loader2 size={16} className="animate-spin" />
          ) : (
            <Play size={16} weight="fill" />
          )}
          Execute
        </button>

        <button
          data-el="query-stop-btn"
          onClick={() => stopQuery(tab.id)}
          disabled={!tab.loading || tab.stopping}
          title="Stop the running query"
          className="inline-flex items-center gap-1.5 px-3 py-1 rounded font-semibold bg-rose-500 text-rose-950 hover:bg-rose-400 disabled:opacity-30 disabled:hover:bg-rose-500 transition-colors"
        >
          <Stop size={16} weight="fill" />
          Stop
        </button>

        <div ref={formatMenuRef} className="relative inline-flex">
          <button
            data-el="query-format-btn"
            onClick={() => runFormat(formatStyle)}
            disabled={!tab.sql.trim()}
            title={`Format (${formatStyle})`}
            className="inline-flex items-center gap-1.5 pl-3 pr-2 py-1 rounded-l font-semibold bg-zinc-800 text-zinc-200 hover:bg-zinc-700 disabled:opacity-40 disabled:hover:bg-zinc-800 transition-colors"
          >
            <MagicWand size={16} />
            Format
          </button>
          <button
            data-el="query-format-menu-btn"
            onClick={() => setFormatMenuOpen((o) => !o)}
            disabled={!tab.sql.trim()}
            title="Choose formatting style"
            className="inline-flex items-center px-1 py-1 rounded-r border-l border-zinc-900/50 bg-zinc-800 text-zinc-200 hover:bg-zinc-700 disabled:opacity-40 disabled:hover:bg-zinc-800 transition-colors"
          >
            <CaretDown size={13} />
          </button>
          {formatMenuOpen && (
            <div
              data-el="query-format-menu"
              className="absolute top-full left-0 mt-1 z-50 w-44 rounded border border-zinc-700 bg-zinc-900/95 backdrop-blur-sm py-1 shadow-xl shadow-black/60 text-[12px]"
            >
              {(["standard", "condensed"] as const).map((style) => (
                <button
                  key={style}
                  onClick={() => chooseFormat(style)}
                  className={clsx(
                    "w-full text-left px-3 py-1.5 hover:bg-zinc-800 flex items-center justify-between gap-2",
                    style === formatStyle ? "text-accent-300" : "text-zinc-200"
                  )}
                >
                  <span className="capitalize">{style}</span>
                  <span className="text-[10px] text-zinc-500">
                    {style === "standard" ? "library" : "compact"}
                  </span>
                </button>
              ))}
            </div>
          )}
        </div>

        {tab.loading && (
          <span className="ml-auto inline-flex items-center gap-1.5">
            <Loader2 size={13} className="animate-spin" />
            {tab.stopping ? "Stopping…" : "Running…"}
          </span>
        )}
      </div>

      <div className="shrink-0" style={{ height: editorHeight }}>
        <SqlEditor
          ref={editorRef}
          value={tab.sql}
          onChange={(v) => setQuerySql(tab.id, v)}
          onSubmit={() => executeQuery(tab.id)}
          completion={completion}
          placeholder="Type SQL here…  (Ctrl+Enter to run)"
        />
      </div>

      <div
        data-el="query-splitter"
        onPointerDown={startEditorResize}
        title="Drag to resize the editor"
        className="group shrink-0 h-1.5 cursor-row-resize bg-zinc-800/60 hover:bg-accent-500/50 transition-colors"
      />

      <div
        data-el="query-results-toolbar"
        data-toolbar="query-results"
        className="dbs-toolbar h-9 pl-1 pr-3 border-b border-zinc-800/60 flex items-center gap-1 text-[11px] text-zinc-400"
      >
        <button
          data-el="expanded-toggle-btn"
          onClick={() => setExpanded((v) => !v)}
          disabled={!hasResultSet}
          title="Toggle the expanded-value panel"
          className={clsx(
            "inline-flex items-center gap-1.5 px-3 py-1 rounded text-[11px] font-semibold transition-colors disabled:opacity-40 disabled:hover:bg-zinc-800",
            expanded
              ? "bg-accent-500 text-[#042f2e] hover:bg-accent-400"
              : "bg-zinc-800 text-zinc-200 hover:bg-zinc-700"
          )}
        >
          <ArrowsOutSimple size={17} />
          Expanded
        </button>

        <ExportButton
          database={tab.database}
          columns={result?.columns ?? []}
          rows={
            selectedRows.length > 0
              ? selectedRows.map((i) => viewRows[i]).filter((r): r is RowRecord => r != null)
              : viewRows
          }
          disabled={!hasResultSet}
        />
      </div>

      {tab.error && (
        <div className="px-3 py-2 bg-rose-950/40 border-b border-rose-900/60 text-rose-300 text-[11px] flex items-start gap-2">
          <AlertCircle size={14} className="mt-0.5 shrink-0" />
          <span className="break-words font-mono">{tab.error}</span>
        </div>
      )}

      {result == null ? (
        <div
          data-el="query-empty"
          className="flex-1 flex items-center justify-center text-zinc-600 text-xs"
        >
          Write a query above and press Execute to see results.
        </div>
      ) : result.rowsAffected != null ? (
        <div
          data-el="query-affected"
          className="flex-1 flex items-center justify-center text-zinc-400 text-sm"
        >
          <span className="text-emerald-400 font-semibold">
            {result.rowsAffected}
          </span>
          <span className="ml-1.5">
            row{result.rowsAffected === 1 ? "" : "s"} affected
          </span>
        </div>
      ) : (
        <DataGrid
          columns={result.columns}
          rows={viewRows}
          offset={0}
          sort={sort}
          filters={filters}
          hiddenColumns={hiddenColumns}
          jsonDisplay={jsonDisplay}
          activeCell={activeCell}
          clearActiveCellOnRowSelect
          onActiveCellChange={setActiveCell}
          onSelectionChange={setSelectedRows}
          onSortChange={setSort}
          onFilterChange={(column, filter) =>
            setFilters((prev) => {
              const without = prev.filter((f) => f.column !== column);
              return filter ? [...without, filter] : without;
            })
          }
          onHiddenColumnsChange={setHiddenColumns}
          onJsonShow={(column, path) =>
            setJsonDisplay((prev) => {
              const next = { ...prev };
              if (path && path.trim()) next[column] = path.trim();
              else delete next[column];
              return next;
            })
          }
          onCellEdit={async () => {
            /* Query results are read-only (no primary-key context to update by). */
          }}
        />
      )}

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

      <div
        data-el="query-footer"
        className="h-7 px-3 border-t border-zinc-800/60 flex items-center gap-3 text-[11px] text-zinc-400 bg-zinc-950"
      >
        {tab.loading ? (
          <span className="inline-flex items-center gap-1.5">
            <Loader2 size={12} className="animate-spin" />
            {tab.stopping ? "Stopping…" : "Running…"}
          </span>
        ) : result == null ? (
          <span className="text-zinc-600">Not run yet</span>
        ) : result.rowsAffected != null ? (
          <span>
            <span className="text-zinc-200">
              {result.rowsAffected.toLocaleString()}
            </span>{" "}
            row{result.rowsAffected === 1 ? "" : "s"} affected
          </span>
        ) : (
          <>
            <span>
              <span className="text-zinc-200">
                {viewRows.length.toLocaleString()}
              </span>
              {filters.length > 0 && (
                <>
                  {" "}
                  of{" "}
                  <span className="text-zinc-200">
                    {result.rows.length.toLocaleString()}
                  </span>
                </>
              )}{" "}
              {viewRows.length === 1 && filters.length === 0 ? "row" : "rows"}
            </span>
            <span className="text-zinc-700">·</span>
            <span>
              <span className="text-zinc-200">{result.columns.length}</span>{" "}
              {result.columns.length === 1 ? "col" : "cols"}
            </span>
            {result.truncated && (
              <>
                <span className="text-zinc-700">·</span>
                <span
                  className="text-amber-400 font-semibold"
                  title={`Capped at ${result.rows.length.toLocaleString()} rows — the query matched more. Raise "Max rows" (or pick "No limit") to fetch more.`}
                >
                  capped
                </span>
              </>
            )}
          </>
        )}
        {result != null && !tab.loading && (
          <span
            className="ml-auto tabular-nums text-zinc-300"
            title="Server-side execution time (statement run only)"
          >
            {formatMs(result.elapsedMs)}
          </span>
        )}
      </div>
    </div>
  );
}

function formatMs(ms: number): string {
  if (ms < 1000) return `${ms} ms`;
  return `${(ms / 1000).toFixed(2)} s`;
}

/** Loose comparison: numeric when both sides parse as numbers, else string;
 * nulls sort first. */
function cmp(a: unknown, b: unknown): number {
  if (a == null && b == null) return 0;
  if (a == null) return -1;
  if (b == null) return 1;
  if (typeof a === "number" && typeof b === "number") return a - b;
  const na = Number(a);
  const nb = Number(b);
  if (!Number.isNaN(na) && !Number.isNaN(nb)) return na - nb;
  return String(a).localeCompare(String(b));
}

function matchFilter(value: unknown, f: ColumnFilter): boolean {
  const jsonPath = f.jsonPath?.trim();
  if (jsonPath) {
    /* JSON-path filter: extract the value(s) at the path and match any of them.
       Mirrors the grid's "Show" walker (dotted paths, array mapping, [k=v]
       selectors). Client-side approximation of the server's
       JSON_CONTAINS/JSON_SEARCH — comparison is on the stringified value. */
    const candidates = extractJsonCandidates(value, jsonPath).map(compactDisplay);
    if (f.op === "equals") return candidates.some((c) => c === f.value);
    const needle = f.value.replace(/[%_]/g, "").toLowerCase();
    return candidates.some((c) => c.toLowerCase().includes(needle));
  }
  const s = value == null ? "" : typeof value === "string" ? value : String(value);
  if (f.op === "equals") return s === f.value;
  /* "like": substring match, ignoring SQL wildcards (client-side approximation). */
  const needle = f.value.replace(/[%_]/g, "").toLowerCase();
  return s.toLowerCase().includes(needle);
}

function applyView(
  rows: RowRecord[],
  filters: ColumnFilter[],
  sort: SortSpec | null
): RowRecord[] {
  let out = rows;
  if (filters.length > 0) {
    out = out.filter((r) => filters.every((f) => matchFilter(r[f.column], f)));
  }
  if (sort) {
    const dir = sort.direction === "asc" ? 1 : -1;
    out = [...out].sort((a, b) => cmp(a[sort.column], b[sort.column]) * dir);
  }
  return out;
}
