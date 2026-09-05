import { useEffect, useMemo, useRef, useState } from "react";
import {
  Play,
  Stop,
  MagicWand,
  FloppyDisk,
  CaretDown,
  Binoculars,
  BracketsCurly,
  Funnel,
  Gauge,
  Database,
  PlugsConnected,
  CircleNotch as Loader2,
  WarningCircle as AlertCircle,
} from "@phosphor-icons/react";
import clsx from "clsx";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { useStore } from "../state/store";
import { notifyError } from "../state/notify";
import { ipc } from "../ipc";
import { DataGrid } from "./DataGrid";
import { StyledSelect } from "./StyledSelect";
import { ExpandedPanel } from "./ExpandedPanel";
import { ExportButton } from "./ExportButton";
import { SqlEditor, type SqlEditorHandle } from "./SqlEditor";
import { QueryAnalysisPanel } from "./QueryAnalysisPanel";
import { SavedQueryMenu } from "./SavedQueryMenu";
import { QueryHistoryButton } from "./QueryHistoryButton";
import { AsJsonDialog, type JsonSnippetMode } from "./AsJsonDialog";
import { compactDisplay, extractJsonCandidates } from "../lib/jsonPath";
import { formatSql, type FormatStyle } from "../lib/formatSql";
import {
  splitSqlStatements,
  returnsResultSet,
  statementPreview,
} from "../lib/splitSql";
import { scanFromTables } from "../lib/sqlCompletion";
import { SQL_KEYWORDS } from "../lib/sqlHighlight";
import { SQL_SNIPPETS } from "../lib/sqlSnippets";
import type {
  ColumnFilter,
  QueryTab,
  Relation,
  RowRecord,
  SortSpec,
  StatementResult,
} from "../types";

/** Stable empty fallback so the selector never returns a fresh array (which, in
 * a window whose store has no tree loaded, would loop useSyncExternalStore). */
const NO_DATABASES: string[] = [];
const NO_RELATIONS: Relation[] = [];
const NO_SETS: StatementResult[] = [];
const NO_STMTS: string[] = [];

export function QueryView({ tab }: { tab: QueryTab }) {
  const profiles = useStore((s) => s.profiles);
  const databases = useStore(
    (s) => s.trees[tab.profileId]?.databases ?? NO_DATABASES
  );
  const setQuerySql = useStore((s) => s.setQuerySql);
  const setQueryConnection = useStore((s) => s.setQueryConnection);
  const setQueryDatabase = useStore((s) => s.setQueryDatabase);
  const setQueryMaxRows = useStore((s) => s.setQueryMaxRows);
  const executeQuery = useStore((s) => s.executeQuery);
  const explainQuery = useStore((s) => s.explainQuery);
  const stopQuery = useStore((s) => s.stopQuery);
  const saveQuery = useStore((s) => s.saveQuery);
  const applySavedQuery = useStore((s) => s.applySavedQuery);
  const deleteSavedQuery = useStore((s) => s.deleteSavedQuery);
  const applyQueryHistory = useStore((s) => s.applyQueryHistory);
  const deleteQueryHistory = useStore((s) => s.deleteQueryHistory);
  const clearQueryHistory = useStore((s) => s.clearQueryHistory);

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
  const editorRef = useRef<SqlEditorHandle>(null);
  useEffect(() => {
    editorRef.current?.focus();
  }, [tab.id]);

  /* Insert-menu (DSL macros): a dropdown of SQL-generating helpers. AS_JSON
     opens a dialog; its output is injected at the editor caret. */
  const [insertMenuOpen, setInsertMenuOpen] = useState(false);
  const [jsonSnippet, setJsonSnippet] = useState<JsonSnippetMode | null>(null);
  const insertMenuRef = useRef<HTMLDivElement>(null);

  /* Relations power AS_JSON_ARRAY's foreign-key auto-detection; load them so
     they're ready when the dialog opens. */
  const relations = useStore(
    (s) => s.relations[`${tab.profileId}::${tab.database}`] ?? NO_RELATIONS
  );
  const loadRelations = useStore((s) => s.loadRelations);
  useEffect(() => {
    loadRelations(tab.profileId, tab.database).catch(() => {});
  }, [tab.profileId, tab.database, loadRelations]);
  useEffect(() => {
    if (!insertMenuOpen) return;
    const onDown = (e: MouseEvent) => {
      if (
        insertMenuRef.current &&
        !insertMenuRef.current.contains(e.target as Node)
      ) {
        setInsertMenuOpen(false);
      }
    };
    window.addEventListener("mousedown", onDown);
    return () => window.removeEventListener("mousedown", onDown);
  }, [insertMenuOpen]);

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

  /* Split Execute button menu (Execute / Explain) + the analysis drawer. */
  const [execMenuOpen, setExecMenuOpen] = useState(false);
  const execMenuRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!execMenuOpen) return;
    const onDown = (e: MouseEvent) => {
      if (execMenuRef.current && !execMenuRef.current.contains(e.target as Node)) {
        setExecMenuOpen(false);
      }
    };
    window.addEventListener("mousedown", onDown);
    return () => window.removeEventListener("mousedown", onDown);
  }, [execMenuOpen]);

  const [showAnalysis, setShowAnalysis] = useState(false);
  /* Open the drawer whenever a fresh analysis lands. */
  useEffect(() => {
    if (tab.analysis) setShowAnalysis(true);
  }, [tab.analysis]);

  /* Draggable splitter between the editor and the results. */
  const containerRef = useRef<HTMLDivElement>(null);
  const [editorHeight, setEditorHeight] = useState(180);

  /* Expanded-value panel (read-only) for the active result cell. Visibility
     lives on the tab (not component state) so tearing the tab into its own
     window — or docking it back — keeps whatever state it had. Tabs predating
     the field fall back to open-in-main, closed elsewhere. */
  const setTabInspectorOpen = useStore((s) => s.setTabInspectorOpen);
  const expanded = tab.inspectorOpen ?? getCurrentWindow().label === "main";
  const setExpanded = (open: boolean) => setTabInspectorOpen(tab.id, open);
  useEffect(() => {
    if (!expanded) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setExpanded(false);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [expanded]);

  /* Re-render ~10×/s while a query runs so the round-trip timer ticks live. */
  const [, setClock] = useState(0);
  useEffect(() => {
    if (!tab.loading || tab.runStartedAt == null) return;
    const id = setInterval(() => setClock((c) => c + 1), 100);
    return () => clearInterval(id);
  }, [tab.loading, tab.runStartedAt]);

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
  const sets = result?.results ?? NO_SETS;

  /* A compound script yields one result set per statement; the grid shows one
     at a time, picked via the numbered buttons in the results toolbar. */
  const [activeSetIndex, setActiveSetIndex] = useState(0);
  useEffect(() => setActiveSetIndex(0), [result]);
  const clampedSetIndex = Math.min(activeSetIndex, sets.length - 1);
  const activeSet = sets.length > 0 ? sets[clampedSetIndex] : null;

  /* The executed script's statements, split client-side for labeling only:
     pill tooltips, and telling an empty SELECT result ("0 rows") apart from a
     statement with no result set ("N rows affected"). When the split doesn't
     line up with the server's statement count, labeling degrades gracefully. */
  const stmts = useMemo(
    () => (tab.resultSql ? splitSqlStatements(tab.resultSql) : NO_STMTS),
    [tab.resultSql]
  );
  const stmtFor = (i: number): string | null =>
    stmts.length === sets.length ? stmts[i] ?? null : null;
  const emptyResultSet = (s: StatementResult, i: number): boolean => {
    if (s.rowsAffected == null) return false;
    const stmt = stmtFor(i);
    return stmt != null && returnsResultSet(stmt);
  };
  const activeIsEmptyResult =
    activeSet != null && emptyResultSet(activeSet, clampedSetIndex);

  /* Switching sets also resets the per-set view state — sort/filter/hidden
     columns target the outgoing set's columns. */
  const selectSet = (i: number) => {
    setActiveSetIndex(i);
    setSort(null);
    setFilters([]);
    setHiddenColumns([]);
    setJsonDisplay({});
    setActiveCell(null);
    setSelectedRows([]);
  };

  const viewRows = useMemo(
    () => (activeSet ? applyView(activeSet.rows, filters, sort) : []),
    [activeSet, filters, sort]
  );

  const hasResultSet = activeSet != null && activeSet.rowsAffected == null;
  const activeColumn =
    activeCell && activeSet
      ? activeSet.columns.find((c) => c.name === activeCell.column) ?? null
      : null;
  const activeValue =
    activeCell && activeSet
      ? viewRows[activeCell.rowIndex]?.[activeCell.column]
      : undefined;
  const activeRowOrdinal = activeCell ? activeCell.rowIndex + 1 : null;

  const canRun = tab.sql.trim().length > 0 && !tab.loading;

  /* When a saved query is loaded and its SQL has been edited, offer a one-click
     overwrite-save of that named query. */
  const activeSaved = tab.savedQueries.find((q) => q.name === tab.activeSavedQuery);
  const savedQueryDirty = activeSaved != null && activeSaved.sql !== tab.sql;

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
    <div ref={containerRef} className="relative flex-1 flex flex-col min-h-0">
      {/* Context bar: the connection + database everything below depends on.
          Tinted like the active tab (bg-zinc-900) so it reads as the document's
          target rather than another row of actions. */}
      <div
        data-el="query-context-bar"
        className="h-9 pl-1 pr-1 border-b border-zinc-800/60 bg-zinc-900 flex items-center gap-1 text-zinc-400"
      >
        <StyledSelect
          dataEl="query-connection-select"
          icon={<PlugsConnected size={16} weight="fill" className="shrink-0" />}
          value={tab.profileId}
          onChange={(v) => setQueryConnection(tab.id, v)}
          title="Connection"
          className="font-bold text-lime-300"
          menuClassName="text-[13.5px]"
          options={profiles.map((p) => ({
            value: p.id,
            label: p.name,
            icon: (
              <PlugsConnected
                size={15}
                weight="fill"
                className="shrink-0 text-lime-400"
              />
            ),
          }))}
        />

        <StyledSelect
          dataEl="query-database-select"
          icon={<Database size={16} weight="fill" className="shrink-0" />}
          value={tab.database}
          onChange={(v) => setQueryDatabase(tab.id, v)}
          title="Database"
          className="font-bold text-accent-300"
          menuClassName="text-[13.5px]"
          options={
            dbOptions.length === 0
              ? [{ value: "", label: "(no database)" }]
              : dbOptions.map((d) => ({
                  value: d,
                  label: d,
                  icon: (
                    <Database
                      size={15}
                      weight="fill"
                      className="shrink-0 text-accent-400"
                    />
                  ),
                }))
          }
        />
      </div>

      <div
        data-el="query-toolbar"
        data-toolbar="query"
        className="dbs-toolbar h-9 pl-1 pr-1 border-b border-zinc-800/60 flex items-center gap-1 text-zinc-400"
      >
        {tab.loading ? (
          <button
            data-el="query-stop-btn"
            onClick={() => stopQuery(tab.id)}
            disabled={tab.stopping}
            title="Stop the running query"
            className="inline-flex items-center gap-1.5 px-2 py-1 rounded font-semibold bg-rose-500 text-rose-950 hover:bg-rose-400 disabled:opacity-60 disabled:hover:bg-rose-500 transition-colors"
          >
            {tab.stopping ? (
              <Loader2 size={16} className="animate-spin" />
            ) : (
              <Stop size={16} weight="fill" />
            )}
            {tab.stopping ? "Stopping…" : "Stop"}
          </button>
        ) : (
          <div ref={execMenuRef} className="relative inline-flex">
            <button
              data-el="query-execute-btn"
              onClick={() => executeQuery(tab.id)}
              disabled={!canRun}
              title="Execute (Ctrl+Enter)"
              className="inline-flex items-center gap-1.5 pl-2 pr-2 py-1 rounded-l font-semibold bg-emerald-500 text-emerald-950 hover:bg-emerald-400 disabled:opacity-40 disabled:hover:bg-emerald-500 transition-colors"
            >
              <Play size={16} weight="fill" />
              Execute
            </button>
            <button
              data-el="query-execute-menu-btn"
              onClick={() => setExecMenuOpen((o) => !o)}
              disabled={!canRun}
              title="More run options"
              className="inline-flex items-center px-1 py-1 rounded-r border-l border-emerald-700/50 bg-emerald-500 text-emerald-950 hover:bg-emerald-400 disabled:opacity-40 disabled:hover:bg-emerald-500 transition-colors"
            >
              <CaretDown size={13} />
            </button>
            {execMenuOpen && (
              <div
                data-el="query-execute-menu"
                className="absolute top-full left-0 mt-1 z-50 w-56 rounded border border-zinc-700 bg-zinc-900/95 backdrop-blur-sm py-1 shadow-xl shadow-black/60 text-[12px]"
              >
                <button
                  onClick={() => {
                    setExecMenuOpen(false);
                    executeQuery(tab.id);
                  }}
                  className="w-full text-left px-3 py-1.5 hover:bg-zinc-800 flex items-center gap-2 text-zinc-200"
                >
                  <Play size={14} weight="fill" className="text-emerald-400 shrink-0" />
                  <span className="flex-1">Execute</span>
                  <span className="text-[10px] text-zinc-500">Ctrl+Enter</span>
                </button>
                <button
                  data-el="query-explain-btn"
                  onClick={() => {
                    setExecMenuOpen(false);
                    explainQuery(tab.id);
                  }}
                  className="w-full text-left px-3 py-1.5 hover:bg-zinc-800 flex items-center gap-2 text-zinc-200"
                >
                  <Gauge size={14} className="text-accent-400 shrink-0" />
                  <span className="flex-1">Explain</span>
                  <span className="text-[10px] text-zinc-500">analyze</span>
                </button>
              </div>
            )}
          </div>
        )}

        <SavedQueryMenu
          queries={tab.savedQueries}
          activeName={tab.activeSavedQuery}
          disabled={!tab.database}
          autoOpenKey={tab.id}
          onApply={(name) => applySavedQuery(tab.id, name)}
          onSave={(name) => saveQuery(tab.id, name)}
          onDelete={(name) => deleteSavedQuery(tab.id, name)}
        />

        <QueryHistoryButton
          items={tab.queryHistory}
          disabled={!tab.database}
          onApply={(sql) => applyQueryHistory(tab.id, sql)}
          onDelete={(sql) => deleteQueryHistory(tab.id, sql)}
          onClear={() => clearQueryHistory(tab.id)}
        />

        {savedQueryDirty && (
          <button
            data-el="saved-query-overwrite-btn"
            onClick={() => saveQuery(tab.id, tab.activeSavedQuery!)}
            title={`Overwrite "${tab.activeSavedQuery}" with the current query`}
            className="inline-flex items-center justify-center p-1 rounded text-emerald-400 hover:text-emerald-300 hover:bg-zinc-800 transition-colors"
          >
            <FloppyDisk size={16} weight="fill" />
          </button>
        )}

        {tab.analysis && (
          <button
            data-el="analysis-toggle-btn"
            onClick={() => setShowAnalysis((v) => !v)}
            title="Toggle the query analysis"
            className="inline-flex items-center gap-1.5 px-2 py-1 rounded text-[11px] font-semibold transition-colors bg-zinc-800 text-emerald-300 hover:bg-zinc-700"
          >
            <Gauge size={16} weight="fill" className="shrink-0" />
            Analysis
            <span className="rounded bg-zinc-950/60 px-1 text-[10px] font-bold tabular-nums text-zinc-100">
              {tab.analysis.grade}
            </span>
          </button>
        )}

        {tab.loading && !tab.stopping && (
          <span className="ml-2 inline-flex items-center gap-1.5">
            <Loader2 size={13} className="animate-spin" />
            Running…
          </span>
        )}

        <div ref={insertMenuRef} className="relative inline-flex ml-auto">
          <button
            data-el="query-insert-btn"
            onClick={() => setInsertMenuOpen((o) => !o)}
            title="Insert a generated SQL snippet"
            className="inline-flex items-center gap-1.5 px-2 py-1 rounded font-semibold bg-zinc-800 text-zinc-200 hover:bg-zinc-700 transition-colors"
          >
            <BracketsCurly size={16} className="text-sky-400" />
            Insert
            <CaretDown size={13} />
          </button>
          {insertMenuOpen && (
            <div
              data-el="query-insert-menu"
              className="absolute top-full left-0 mt-1 z-50 w-72 rounded border border-zinc-700 bg-zinc-900/95 backdrop-blur-sm py-1 shadow-xl shadow-black/60 text-[12px]"
            >
              {SQL_SNIPPETS.map((s) => (
                <button
                  key={s.id}
                  onClick={() => {
                    setInsertMenuOpen(false);
                    if (s.id === "as_json") setJsonSnippet("object");
                    else if (s.id === "as_json_array") setJsonSnippet("array");
                  }}
                  className="w-full text-left px-3 py-1.5 hover:bg-zinc-950 flex flex-col gap-0.5"
                >
                  <span className="font-mono text-sky-300">{s.label}</span>
                  <span className="text-[10px] text-zinc-500">
                    {s.description}
                  </span>
                </button>
              ))}
            </div>
          )}
        </div>

        <div ref={formatMenuRef} className="relative inline-flex">
          <button
            data-el="query-format-btn"
            onClick={() => runFormat(formatStyle)}
            disabled={!tab.sql.trim()}
            title={`Format (${formatStyle})`}
            className="inline-flex items-center gap-1.5 pl-2 pr-2 py-1 rounded-l font-semibold bg-zinc-800 text-zinc-200 hover:bg-zinc-700 disabled:opacity-40 disabled:hover:bg-zinc-800 transition-colors"
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
                    "w-full text-left px-3 py-1.5 hover:bg-zinc-950 flex items-center justify-between gap-2",
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
      </div>

      <div data-el="query-editor" className="shrink-0" style={{ height: editorHeight }}>
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
        className="dbs-toolbar h-9 pl-1 pr-1 border-b border-zinc-800/60 flex items-center gap-1 text-zinc-400"
      >
        <StyledSelect
          dataEl="query-maxrows-select"
          value={tab.maxRows == null ? "" : String(tab.maxRows)}
          onChange={(v) => setQueryMaxRows(tab.id, v === "" ? null : Number(v))}
          title="Maximum rows to fetch — a safety cap against huge result sets"
          options={[
            { value: "100", label: "100 rows" },
            { value: "1000", label: "1,000 rows" },
            { value: "10000", label: "10,000 rows" },
            { value: "", label: "No limit" },
          ]}
        />

        {sets.length > 1 && (
          <div
            data-el="query-result-set-tabs"
            className="flex items-center gap-1 ml-2"
          >
            <span className="text-[11px] text-zinc-500 font-semibold mr-0.5">
              Result
            </span>
            {sets.map((s, i) => {
              const summary = emptyResultSet(s, i)
                ? "0 rows"
                : s.rowsAffected != null
                ? `${s.rowsAffected} row${s.rowsAffected === 1 ? "" : "s"} affected`
                : `${s.rows.length} row${s.rows.length === 1 ? "" : "s"}`;
              const stmt = stmtFor(i);
              return (
                <button
                  key={i}
                  data-el="query-result-set-btn"
                  onClick={() => selectSet(i)}
                  title={
                    stmt
                      ? `${summary} — ${statementPreview(stmt)}`
                      : `Statement ${i + 1}: ${summary}`
                  }
                  className={clsx(
                    "min-w-6 px-1.5 py-0.5 rounded text-[11px] font-semibold tabular-nums transition-colors",
                    i === clampedSetIndex
                      ? "bg-accent-500 text-[#042f2e]"
                      : "bg-zinc-800 text-zinc-400 hover:bg-zinc-700 hover:text-zinc-300"
                  )}
                >
                  {i + 1}
                </button>
              );
            })}
          </div>
        )}

        {(filters.length > 0 || hiddenColumns.length > 0) && (
          <button
            data-el="clear-filters-btn"
            onClick={() => {
              setFilters([]);
              setHiddenColumns([]);
            }}
            title="Remove every filter and show all columns"
            className="inline-flex items-center gap-1.5 px-2 py-1 rounded text-[11px] font-semibold bg-amber-400 text-black hover:bg-amber-300 transition-colors"
          >
            <Funnel size={15} weight="fill" />
            Clear Filters
          </button>
        )}

        <div className="ml-auto">
          <ExportButton
            database={tab.database}
            columns={activeSet?.columns ?? []}
            rows={
              selectedRows.length > 0
                ? selectedRows.map((i) => viewRows[i]).filter((r): r is RowRecord => r != null)
                : viewRows
            }
            selectedCount={selectedRows.length}
            disabled={!hasResultSet}
          />
        </div>

        <button
          data-el="expanded-toggle-btn"
          onClick={() => setExpanded(!expanded)}
          disabled={!hasResultSet}
          title="Toggle the Inspector panel"
          className={clsx(
            "inline-flex items-center gap-1.5 px-2 py-1 rounded text-[11px] font-semibold transition-colors disabled:opacity-40 disabled:hover:bg-zinc-800 bg-zinc-800 hover:bg-zinc-700",
            expanded ? "text-emerald-300" : "text-zinc-500 hover:text-zinc-400"
          )}
        >
          <Binoculars size={17} />
          Inspector
        </button>
      </div>

      {tab.error && (
        <div className="px-3 py-2 bg-rose-950/40 border-b border-rose-900/60 text-rose-300 text-[11px] flex items-start gap-2">
          <AlertCircle size={14} className="mt-0.5 shrink-0" />
          <span className="break-words font-mono">{tab.error}</span>
        </div>
      )}

      {result == null || activeSet == null ? (
        <div
          data-el="query-empty"
          className="flex-1 flex items-center justify-center text-zinc-600 text-xs"
        >
          Write a query above and press Execute to see results.
        </div>
      ) : activeIsEmptyResult ? (
        <div
          data-el="query-empty-result"
          className="flex-1 flex items-center justify-center text-zinc-500 text-sm"
        >
          Query returned no rows.
        </div>
      ) : activeSet.rowsAffected != null ? (
        <div
          data-el="query-affected"
          className="flex-1 flex items-center justify-center text-zinc-400 text-sm"
        >
          <span className="text-emerald-400 font-semibold">
            {activeSet.rowsAffected}
          </span>
          <span className="ml-1.5">
            row{activeSet.rowsAffected === 1 ? "" : "s"} affected
          </span>
        </div>
      ) : (
        <DataGrid
          columns={activeSet.columns}
          rows={viewRows}
          suggestRows={activeSet.rows}
          offset={0}
          sort={sort}
          filters={filters}
          hiddenColumns={hiddenColumns}
          jsonDisplay={jsonDisplay}
          activeCell={activeCell}
          clearActiveCellOnRowSelect
          resultCopy
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

      <div
        data-el="query-footer"
        className="h-7 px-3 border-t border-zinc-800/60 flex items-center gap-3 text-[11px] text-zinc-400 bg-zinc-950"
      >
        {tab.loading ? (
          <span className="inline-flex items-center gap-1.5">
            <Loader2 size={12} className="animate-spin" />
            {tab.stopping ? "Stopping…" : "Running…"}
          </span>
        ) : result == null || activeSet == null ? (
          <span className="text-zinc-600">Not run yet</span>
        ) : activeIsEmptyResult ? (
          <span>
            <span className="text-zinc-200">0</span> rows
          </span>
        ) : activeSet.rowsAffected != null ? (
          <span>
            <span className="text-zinc-200">
              {activeSet.rowsAffected.toLocaleString()}
            </span>{" "}
            row{activeSet.rowsAffected === 1 ? "" : "s"} affected
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
                    {activeSet.rows.length.toLocaleString()}
                  </span>
                </>
              )}{" "}
              {viewRows.length === 1 && filters.length === 0 ? "row" : "rows"}
            </span>
            <span className="text-zinc-700">·</span>
            <span>
              <span className="text-zinc-200">{activeSet.columns.length}</span>{" "}
              {activeSet.columns.length === 1 ? "col" : "cols"}
            </span>
            {activeSet.truncated && (
              <>
                <span className="text-zinc-700">·</span>
                <span
                  className="text-amber-400 font-semibold"
                  title={`Capped at ${activeSet.rows.length.toLocaleString()} rows — the query matched more. Raise "Max rows" (or pick "No limit") to fetch more.`}
                >
                  capped
                </span>
              </>
            )}
          </>
        )}
        {(tab.loading || result != null) && (
          <span className="ml-auto inline-flex items-center gap-3 tabular-nums">
            <span title="Server-side execution time (statement run only)">
              <span className="text-zinc-500">Server</span>{" "}
              <span className="text-zinc-300">
                {formatMs(tab.loading ? tab.liveServerMs : result?.elapsedMs ?? 0)}
              </span>
            </span>
            <span title="Round-trip time (request, server, and transfer back)">
              <span className="text-zinc-500">Round trip</span>{" "}
              <span className="text-zinc-300">
                {formatMs(
                  tab.loading
                    ? tab.runStartedAt != null
                      ? Date.now() - tab.runStartedAt
                      : 0
                    : tab.roundTripMs ?? 0
                )}
              </span>
            </span>
          </span>
        )}
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

      {tab.analysis && showAnalysis && (
        <QueryAnalysisPanel
          analysis={tab.analysis}
          profileId={tab.profileId}
          database={tab.database}
          onClose={() => setShowAnalysis(false)}
          onReExplain={() => explainQuery(tab.id)}
        />
      )}

      {jsonSnippet && (
        <AsJsonDialog
          mode={jsonSnippet}
          profileId={tab.profileId}
          database={tab.database}
          tables={tableNames}
          relations={relations}
          sql={tab.sql}
          onInsert={(text) => editorRef.current?.insertText(text)}
          onClose={() => setJsonSnippet(null)}
        />
      )}
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
  /* The null-aware ops decide purely on presence; every other op treats a null
     cell as a non-match (mirrors SQL, where comparisons with NULL are unknown). */
  if (f.op === "isnull") return value == null;
  if (f.op === "notnull") return value != null;
  if (value == null) return false;
  const s = typeof value === "string" ? value : String(value);
  const likeNeedle = () => f.value.replace(/[%_]/g, "").toLowerCase();
  switch (f.op) {
    case "equals":
      return s === f.value;
    case "like":
      /* substring match, ignoring SQL wildcards (client-side approximation). */
      return s.toLowerCase().includes(likeNeedle());
    case "notlike":
      return !s.toLowerCase().includes(likeNeedle());
    case "ne":
      return cmp(s, f.value) !== 0;
    case "gt":
      return cmp(s, f.value) > 0;
    case "gte":
      return cmp(s, f.value) >= 0;
    case "lt":
      return cmp(s, f.value) < 0;
    case "lte":
      return cmp(s, f.value) <= 0;
    default:
      return true;
  }
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
