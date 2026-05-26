import { useMemo, useState, useEffect, useRef } from "react";
import {
  FloppyDisk,
  Trash,
  Table as TableIcon,
  Columns as ColumnsIcon,
  Key,
  Copy,
  Check,
  CaretRight,
  CaretDown,
  ArrowUp,
  ArrowDown,
  Asterisk,
  CircleNotch,
  X,
} from "@phosphor-icons/react";
import clsx from "clsx";
import { AutoGrowTextarea } from "./AutoGrowTextarea";
import { useStore, isDesignerTabDirty } from "../state/store";
import { useUi } from "../state/ui";
import { buildCreateTableSql, buildAlterTableSql } from "../lib/tableSql";
import type {
  ColumnDraft,
  CreateTableTab,
  IndexColumnRef,
  IndexDraft,
  IndexMethod,
  IndexType,
} from "../types";

const COLUMN_TYPES = [
  "INT",
  "BIGINT",
  "SMALLINT",
  "TINYINT",
  "MEDIUMINT",
  "DECIMAL",
  "FLOAT",
  "DOUBLE",
  "VARCHAR",
  "CHAR",
  "TEXT",
  "TINYTEXT",
  "MEDIUMTEXT",
  "LONGTEXT",
  "DATE",
  "DATETIME",
  "TIMESTAMP",
  "TIME",
  "YEAR",
  "BOOLEAN",
  "JSON",
  "BLOB",
  "ENUM",
  "SET",
  "BINARY",
  "VARBINARY",
];

const SUB_TABS = [
  { id: "columns", label: "Columns", Icon: ColumnsIcon },
  { id: "indexes", label: "Indexes", Icon: Key },
] as const;

const INDEX_TYPES: IndexType[] = ["NORMAL", "UNIQUE", "FULLTEXT", "SPATIAL"];
const INDEX_METHODS: IndexMethod[] = ["BTREE", "HASH"];

const blankIndex = (): IndexDraft => ({
  id: crypto.randomUUID(),
  name: "",
  columns: [],
  indexType: "NORMAL",
  method: "BTREE",
  comment: "",
});

const blankColumn = (): ColumnDraft => ({
  id: crypto.randomUUID(),
  name: "",
  type: "INT",
  length: "",
  decimals: "",
  notNull: false,
  key: false,
  comment: "",
  autoIncrement: false,
  defaultValue: "",
  unsigned: false,
  zerofill: false,
});

export function TableDesignerView({ tab }: { tab: CreateTableTab }) {
  const updateCreateTable = useStore((s) => s.updateCreateTable);
  const saveDesignerTab = useStore((s) => s.saveDesignerTab);
  const [activeSubTab, setActiveSubTab] = useState<string>("columns");
  const [error, setError] = useState<string | null>(null);
  const [sqlExpanded, setSqlExpanded] = useState(true);
  const [saving, setSaving] = useState(false);
  const [focusColumnId, setFocusColumnId] = useState<string | null>(null);

  const isEdit = tab.mode === "edit";
  const sql = useMemo(
    () =>
      isEdit
        ? buildAlterTableSql(
            tab.originalName,
            tab.originalColumns,
            tab.tableName,
            tab.columns,
            tab.originalAutoIncrementValue,
            tab.autoIncrementValue,
            tab.originalIndexes,
            tab.indexes,
            tab.originalTableComment,
            tab.tableComment
          )
        : buildCreateTableSql(
            tab.tableName.trim() || "new_table",
            tab.columns,
            tab.indexes,
            tab.tableComment
          ),
    [
      isEdit,
      tab.originalName,
      tab.originalColumns,
      tab.tableName,
      tab.columns,
      tab.originalAutoIncrementValue,
      tab.autoIncrementValue,
      tab.originalIndexes,
      tab.indexes,
      tab.originalTableComment,
      tab.tableComment,
    ]
  );

  const setColumns = (columns: ColumnDraft[]) =>
    updateCreateTable(tab.id, { columns });

  const addColumn = () => {
    const col = blankColumn();
    setColumns([...tab.columns, col]);
    setFocusColumnId(col.id);
  };

  const patchColumn = (id: string, patch: Partial<ColumnDraft>) =>
    setColumns(tab.columns.map((c) => (c.id === id ? { ...c, ...patch } : c)));

  const removeColumn = (id: string) =>
    setColumns(tab.columns.filter((c) => c.id !== id));

  const moveColumn = (id: string, direction: -1 | 1) => {
    const idx = tab.columns.findIndex((c) => c.id === id);
    const target = idx + direction;
    if (idx < 0 || target < 0 || target >= tab.columns.length) return;
    const next = tab.columns.slice();
    [next[idx], next[target]] = [next[target], next[idx]];
    setColumns(next);
  };

  const setIndexes = (indexes: IndexDraft[]) =>
    updateCreateTable(tab.id, { indexes });

  const addIndex = () => setIndexes([...tab.indexes, blankIndex()]);

  const patchIndex = (id: string, patch: Partial<IndexDraft>) =>
    setIndexes(tab.indexes.map((i) => (i.id === id ? { ...i, ...patch } : i)));

  const removeIndex = (id: string) =>
    setIndexes(tab.indexes.filter((i) => i.id !== id));

  const moveIndex = (id: string, direction: -1 | 1) => {
    const idx = tab.indexes.findIndex((i) => i.id === id);
    const target = idx + direction;
    if (idx < 0 || target < 0 || target >= tab.indexes.length) return;
    const next = tab.indexes.slice();
    [next[idx], next[target]] = [next[target], next[idx]];
    setIndexes(next);
  };

  /** Column names available to index (the live, named draft columns). */
  const availableColumns = tab.columns
    .map((c) => c.name.trim())
    .filter((n) => n !== "");

  const canSave = tab.columns.some((c) => c.name.trim() !== "");
  const dirty = isDesignerTabDirty(tab);

  const handleSave = async () => {
    if (saving) return;
    setSqlExpanded(true);
    setError(null);
    setSaving(true);
    const res = await saveDesignerTab(tab.id);
    if (!res.ok && res.error) setError(res.error);
    setSaving(false);
  };

  return (
    <div data-el="table-designer" className="flex-1 flex flex-col min-h-0 bg-zinc-950 pt-2">
      <div className="shrink-0 px-4 pb-2 flex items-center gap-2">
        <TableIcon size={18} className="text-orange-400 shrink-0" />
        <h2 className="text-[16px] font-semibold text-zinc-100">
          {isEdit ? "Edit Table" : "Add New Table"}
        </h2>
        {dirty && (
          <button
            data-el="designer-save-btn"
            onClick={handleSave}
            disabled={!canSave || saving}
            className="ml-auto inline-flex items-center gap-1.5 px-3 py-1 rounded text-[11px] font-semibold bg-accent-500 text-[#042f2e] hover:bg-accent-400 transition-colors disabled:bg-zinc-800 disabled:text-zinc-500 disabled:cursor-not-allowed"
            title="Save all table changes (columns and indexes)"
          >
            {saving ? (
              <CircleNotch size={17} className="animate-spin" />
            ) : (
              <FloppyDisk size={17} />
            )}
            {saving ? "Saving…" : "Save"}
          </button>
        )}
      </div>
      <div className="h-11 shrink-0 px-4 flex items-center gap-2">
        <span className="text-[13px] text-zinc-400 shrink-0 w-20">Name</span>
        <div className="flex items-stretch">
          <span className="flex items-center px-2 text-[13px] text-zinc-300 bg-zinc-900 border border-r-0 border-zinc-700 rounded-l whitespace-nowrap shrink-0">
            {tab.database}.
          </span>
          <input
            data-el="table-name-input"
            autoFocus
            value={tab.tableName}
            onChange={(e) => updateCreateTable(tab.id, { tableName: e.target.value })}
            className="w-72 bg-zinc-950 border border-zinc-700 rounded-r px-2 py-1 text-zinc-100 outline-none focus:border-accent-500"
          />
        </div>
        <Asterisk size={14} weight="bold" className="text-red-500 shrink-0" />

        {isEdit && tab.originalAutoIncrementValue !== "" && (
          <div className="flex items-center gap-2 ml-5">
            <span className="text-[13px] text-zinc-400 shrink-0">Auto-increment</span>
            <input
              data-el="table-autoincrement-input"
              inputMode="numeric"
              value={tab.autoIncrementValue}
              onChange={(e) =>
                updateCreateTable(tab.id, {
                  autoIncrementValue: e.target.value.replace(/[^0-9]/g, ""),
                })
              }
              className="w-28 bg-zinc-950 border border-zinc-700 rounded px-2 py-1 font-mono text-zinc-100 outline-none focus:border-accent-500"
            />
          </div>
        )}
      </div>
      <div className="shrink-0 px-4 pb-2 flex items-start gap-2">
        <span className="text-[13px] text-zinc-400 shrink-0 w-20 mt-1.5">
          Comment
        </span>
        <AutoGrowTextarea
          dataEl="table-comment-input"
          value={tab.tableComment}
          onChange={(v) => updateCreateTable(tab.id, { tableComment: v })}
          placeholder="table comment"
          className="flex-1 max-w-2xl bg-zinc-950 border border-zinc-700 rounded px-2 py-[7px] text-[13px] text-zinc-100 outline-none focus:border-accent-500"
        />
      </div>

      <div
        data-el="designer-subtabs"
        className="shrink-0 flex items-end gap-1 border-b border-zinc-800/60 bg-zinc-950 px-2 pt-2"
      >
        {SUB_TABS.map((st) => (
          <button
            key={st.id}
            data-el={`designer-subtab-${st.id}`}
            onClick={() => setActiveSubTab(st.id)}
            className={clsx(
              "inline-flex items-center gap-1.5 px-4 py-1.5 text-[12px] font-semibold rounded-t-md border border-b-0 transition-colors",
              activeSubTab === st.id
                ? "bg-[#2c303c] border-zinc-700 text-zinc-100"
                : "bg-zinc-900/40 border-transparent text-zinc-400 hover:bg-zinc-800/50 hover:text-zinc-200"
            )}
          >
            <st.Icon size={14} />
            {st.label}
          </button>
        ))}
      </div>

      <div className="flex-1 min-h-0 flex flex-col">
        {activeSubTab === "columns" && (
          <ColumnsEditor
            columns={tab.columns}
            error={error}
            focusColumnId={focusColumnId}
            onColumnFocused={() => setFocusColumnId(null)}
            onAddColumn={addColumn}
            onPatchColumn={patchColumn}
            onRemoveColumn={removeColumn}
            onMoveColumn={moveColumn}
          />
        )}
        {activeSubTab === "indexes" && (
          <IndexesEditor
            indexes={tab.indexes}
            availableColumns={availableColumns}
            error={error}
            onAddIndex={addIndex}
            onPatchIndex={patchIndex}
            onRemoveIndex={removeIndex}
            onMoveIndex={moveIndex}
          />
        )}
      </div>

      <SqlPane
        sql={sql}
        expanded={sqlExpanded}
        onToggle={() => setSqlExpanded((v) => !v)}
      />
    </div>
  );
}

const HEADER_GRID =
  "grid grid-cols-[24px_minmax(120px,1.4fr)_140px_72px_84px_72px_52px_minmax(140px,1.6fr)_84px] gap-2 items-center";

/** A column should show its advanced panel by default when it uses
 * auto-increment or sets any of the other advanced-panel fields (unsigned,
 * zerofill, or a default value). */
function columnHasAdvanced(col: ColumnDraft): boolean {
  return (
    col.autoIncrement ||
    col.unsigned ||
    col.zerofill ||
    col.defaultValue.trim() !== ""
  );
}

function ColumnsEditor({
  columns,
  error,
  focusColumnId,
  onColumnFocused,
  onAddColumn,
  onPatchColumn,
  onRemoveColumn,
  onMoveColumn,
}: {
  columns: ColumnDraft[];
  error: string | null;
  focusColumnId: string | null;
  onColumnFocused: () => void;
  onAddColumn: () => void;
  onPatchColumn: (id: string, patch: Partial<ColumnDraft>) => void;
  onRemoveColumn: (id: string) => void;
  onMoveColumn: (id: string, direction: -1 | 1) => void;
}) {
  const [expandedRows, setExpandedRows] = useState<Set<string>>(
    () => new Set(columns.filter(columnHasAdvanced).map((c) => c.id))
  );
  const scrollRef = useRef<HTMLDivElement>(null);

  /** Focus + select the freshly-added column's name input. */
  useEffect(() => {
    if (!focusColumnId) return;
    const el = scrollRef.current?.querySelector<HTMLInputElement>(
      `input[data-el="col-name"][data-col-id="${focusColumnId}"]`
    );
    if (el) {
      el.focus();
      el.select();
    }
    onColumnFocused();
  }, [focusColumnId, onColumnFocused]);

  const toggleRow = (id: string) =>
    setExpandedRows((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  const inputClass =
    "w-full h-8 bg-zinc-950 border border-zinc-700 rounded px-2 py-1 text-[12px] text-zinc-200 outline-none focus:border-accent-500";
  /* Same look as inputClass but no fixed height and centered vertical padding:
     py-[7px] puts a single line dead-center in the 32px (min-h-8) box, matching
     how the single-line inputs render. AutoGrowTextarea adds the grow + floor. */
  const commentClass =
    "w-full bg-zinc-950 border border-zinc-700 rounded px-2 py-[7px] text-[12px] text-zinc-200 outline-none focus:border-accent-500";

  return (
    <div className="flex-1 min-h-0 flex flex-col">
      {error && (
        <div className="shrink-0 mx-3 mt-3 rounded bg-rose-950/40 border border-rose-900/60 px-3 py-2 text-[11px] text-rose-300">
          {error}
        </div>
      )}

      <div ref={scrollRef} className="flex-1 min-h-0 overflow-auto px-3 py-3 bg-[#2c303c]">
        <div className="flex items-center gap-1 px-1 pb-3">
          <button
            data-el="columns-add-btn"
            onClick={onAddColumn}
            className="inline-flex items-center gap-1.5 px-3 py-1 rounded text-[11px] font-semibold bg-emerald-500 text-emerald-950 hover:bg-emerald-400 transition-colors"
          >
            <span className="relative -top-px text-[19px] leading-none">+</span> Add Column
          </button>
          <span className="ml-auto text-[11px] text-zinc-500">
            {columns.length} column{columns.length === 1 ? "" : "s"}
          </span>
        </div>
        <div
          className={clsx(
            HEADER_GRID,
            "px-1 pb-2 text-[10px] font-semibold uppercase tracking-[0.1em] text-zinc-500"
          )}
        >
          <span />
          <span>Name</span>
          <span>Type</span>
          <span>Length</span>
          <span>Decimals</span>
          <span className="text-center">Not null</span>
          <span className="text-center">Key</span>
          <span>Comment</span>
          <span />
        </div>

        {columns.length === 0 ? (
          <div className="px-1 py-6 text-[12px] text-zinc-500">
            No columns yet — click <span className="text-emerald-300">Add column</span> to start.
          </div>
        ) : (
          <div className="space-y-0.5">
            {columns.map((col, index) => {
              const open = expandedRows.has(col.id);
              return (
                <div key={col.id}>
                  <div data-el="column-row" className={clsx(HEADER_GRID, "px-1")}>
                    <button
                      data-el="col-expand"
                      onClick={() => toggleRow(col.id)}
                      className="flex items-center justify-center h-7 w-6 rounded text-zinc-500 hover:text-zinc-200 hover:bg-zinc-800"
                      title={open ? "Hide advanced options" : "Show advanced options"}
                    >
                      {open ? <CaretDown size={13} /> : <CaretRight size={13} />}
                    </button>
                    <input
                      data-el="col-name"
                      data-col-id={col.id}
                      value={col.name}
                      onChange={(e) => onPatchColumn(col.id, { name: e.target.value })}
                      placeholder="Column Name"
                      className={inputClass}
                    />
                    <select
                      data-el="col-type"
                      value={col.type}
                      onChange={(e) => onPatchColumn(col.id, { type: e.target.value })}
                      className={inputClass}
                    >
                      {(COLUMN_TYPES.includes(col.type)
                        ? COLUMN_TYPES
                        : [col.type, ...COLUMN_TYPES]
                      ).map((t) => (
                        <option key={t} value={t}>
                          {t}
                        </option>
                      ))}
                    </select>
                    <input
                      data-el="col-length"
                      inputMode="numeric"
                      value={col.length}
                      onChange={(e) =>
                        onPatchColumn(col.id, {
                          length: e.target.value.replace(/[^0-9]/g, ""),
                        })
                      }
                      className={clsx(inputClass, "text-right font-mono")}
                    />
                    <input
                      data-el="col-decimals"
                      inputMode="numeric"
                      value={col.decimals}
                      onChange={(e) =>
                        onPatchColumn(col.id, {
                          decimals: e.target.value.replace(/[^0-9]/g, ""),
                        })
                      }
                      className={clsx(inputClass, "text-right font-mono")}
                    />
                    <div className="flex items-center justify-center">
                      <input
                        data-el="col-notnull"
                        type="checkbox"
                        checked={col.notNull}
                        onChange={(e) => onPatchColumn(col.id, { notNull: e.target.checked })}
                        className="dbs-check focus:ring-2 focus:ring-accent-400 focus:ring-offset-1 focus:ring-offset-zinc-950"
                      />
                    </div>
                    <div className="flex items-center justify-center">
                      <input
                        data-el="col-key"
                        type="checkbox"
                        checked={col.key}
                        onChange={(e) => onPatchColumn(col.id, { key: e.target.checked })}
                        className="dbs-check focus:ring-2 focus:ring-accent-400 focus:ring-offset-1 focus:ring-offset-zinc-950"
                      />
                    </div>
                    <AutoGrowTextarea
                      value={col.comment}
                      onChange={(v) => onPatchColumn(col.id, { comment: v })}
                      className={commentClass}
                      dataEl="col-comment"
                      placeholder="comment"
                    />
                    <div className="flex items-center justify-end gap-0.5">
                      <button
                        data-el="col-move-up"
                        onClick={() => onMoveColumn(col.id, -1)}
                        disabled={index === 0}
                        className="flex items-center justify-center h-7 w-6 rounded text-zinc-500 hover:text-zinc-200 hover:bg-zinc-800 disabled:opacity-30 disabled:hover:bg-transparent disabled:hover:text-zinc-500"
                        aria-label="Move column up"
                        title="Move up"
                      >
                        <ArrowUp size={13} />
                      </button>
                      <button
                        data-el="col-move-down"
                        onClick={() => onMoveColumn(col.id, 1)}
                        disabled={index === columns.length - 1}
                        className="flex items-center justify-center h-7 w-6 rounded text-zinc-500 hover:text-zinc-200 hover:bg-zinc-800 disabled:opacity-30 disabled:hover:bg-transparent disabled:hover:text-zinc-500"
                        aria-label="Move column down"
                        title="Move down"
                      >
                        <ArrowDown size={13} />
                      </button>
                      <button
                        data-el="col-delete"
                        onClick={() => onRemoveColumn(col.id)}
                        className="flex items-center justify-center h-7 w-6 rounded text-zinc-500 hover:text-rose-300 hover:bg-zinc-800"
                        aria-label="Remove column"
                        title="Remove column"
                      >
                        <Trash size={13} />
                      </button>
                    </div>
                  </div>

                  {open && (
                    <AdvancedPanel column={col} onPatch={(p) => onPatchColumn(col.id, p)} />
                  )}
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}

const INDEX_GRID =
  "grid grid-cols-[minmax(120px,1.2fr)_minmax(240px,2fr)_130px_110px_minmax(140px,1.4fr)_72px] gap-2 items-start";

function IndexesEditor({
  indexes,
  availableColumns,
  error,
  onAddIndex,
  onPatchIndex,
  onRemoveIndex,
  onMoveIndex,
}: {
  indexes: IndexDraft[];
  availableColumns: string[];
  error: string | null;
  onAddIndex: () => void;
  onPatchIndex: (id: string, patch: Partial<IndexDraft>) => void;
  onRemoveIndex: (id: string) => void;
  onMoveIndex: (id: string, direction: -1 | 1) => void;
}) {
  const inputClass =
    "w-full h-8 bg-zinc-950 border border-zinc-700 rounded px-2 py-1 text-[12px] text-zinc-200 outline-none focus:border-accent-500";

  return (
    <div className="flex-1 min-h-0 flex flex-col">
      {error && (
        <div className="shrink-0 mx-3 mt-3 rounded bg-rose-950/40 border border-rose-900/60 px-3 py-2 text-[11px] text-rose-300">
          {error}
        </div>
      )}

      <div className="flex-1 min-h-0 overflow-auto px-3 py-3 bg-[#2c303c]">
        <div className="flex items-center gap-1 px-1 pb-3">
          <button
            data-el="indexes-add-btn"
            onClick={onAddIndex}
            className="inline-flex items-center gap-1.5 px-3 py-1 rounded text-[11px] font-semibold bg-emerald-500 text-emerald-950 hover:bg-emerald-400 transition-colors"
          >
            <span className="relative -top-px text-[19px] leading-none">+</span> Add Index
          </button>
          <span className="ml-auto text-[11px] text-zinc-500">
            {indexes.length} index{indexes.length === 1 ? "" : "es"}
          </span>
        </div>
        <div
          className={clsx(
            INDEX_GRID,
            "px-1 pb-2 text-[10px] font-semibold uppercase tracking-[0.1em] text-zinc-500"
          )}
        >
          <span>Name</span>
          <span>Columns</span>
          <span>Index Type</span>
          <span>Method</span>
          <span>Comment</span>
          <span />
        </div>

        {indexes.length === 0 ? (
          <div className="px-1 py-6 text-[12px] text-zinc-500">
            No indexes yet — click{" "}
            <span className="text-emerald-300">Add Index</span> to start.
          </div>
        ) : (
          <div className="space-y-1.5">
            {indexes.map((idx, index) => {
              const directional =
                idx.indexType === "NORMAL" || idx.indexType === "UNIQUE";
              return (
                <div
                  key={idx.id}
                  data-el="index-row"
                  className={clsx(INDEX_GRID, "px-1")}
                >
                  <input
                    data-el="index-name"
                    value={idx.name}
                    onChange={(e) =>
                      onPatchIndex(idx.id, { name: e.target.value })
                    }
                    placeholder="Index Name"
                    className={inputClass}
                  />
                  <ColumnPicker
                    value={idx.columns}
                    available={availableColumns}
                    directional={directional}
                    onChange={(columns) => onPatchIndex(idx.id, { columns })}
                  />
                  <select
                    data-el="index-type"
                    value={idx.indexType}
                    onChange={(e) =>
                      onPatchIndex(idx.id, {
                        indexType: e.target.value as IndexType,
                      })
                    }
                    className={inputClass}
                  >
                    {INDEX_TYPES.map((t) => (
                      <option key={t} value={t}>
                        {t}
                      </option>
                    ))}
                  </select>
                  <select
                    data-el="index-method"
                    value={idx.method}
                    disabled={!directional}
                    onChange={(e) =>
                      onPatchIndex(idx.id, {
                        method: e.target.value as IndexMethod,
                      })
                    }
                    title={
                      directional
                        ? undefined
                        : "Method applies to NORMAL/UNIQUE indexes only"
                    }
                    className={clsx(
                      inputClass,
                      !directional && "opacity-40 cursor-not-allowed"
                    )}
                  >
                    {INDEX_METHODS.map((m) => (
                      <option key={m} value={m}>
                        {m}
                      </option>
                    ))}
                  </select>
                  <input
                    data-el="index-comment"
                    value={idx.comment}
                    onChange={(e) =>
                      onPatchIndex(idx.id, { comment: e.target.value })
                    }
                    placeholder="comment"
                    className={inputClass}
                  />
                  <div className="flex items-center justify-end gap-0.5">
                    <button
                      data-el="index-move-up"
                      onClick={() => onMoveIndex(idx.id, -1)}
                      disabled={index === 0}
                      className="flex items-center justify-center h-7 w-6 rounded text-zinc-500 hover:text-zinc-200 hover:bg-zinc-800 disabled:opacity-30 disabled:hover:bg-transparent disabled:hover:text-zinc-500"
                      aria-label="Move index up"
                      title="Move up"
                    >
                      <ArrowUp size={13} />
                    </button>
                    <button
                      data-el="index-move-down"
                      onClick={() => onMoveIndex(idx.id, 1)}
                      disabled={index === indexes.length - 1}
                      className="flex items-center justify-center h-7 w-6 rounded text-zinc-500 hover:text-zinc-200 hover:bg-zinc-800 disabled:opacity-30 disabled:hover:bg-transparent disabled:hover:text-zinc-500"
                      aria-label="Move index down"
                      title="Move down"
                    >
                      <ArrowDown size={13} />
                    </button>
                    <button
                      data-el="index-delete"
                      onClick={() => onRemoveIndex(idx.id)}
                      className="flex items-center justify-center h-7 w-6 rounded text-zinc-500 hover:text-rose-300 hover:bg-zinc-800"
                      aria-label="Remove index"
                      title="Remove index"
                    >
                      <Trash size={13} />
                    </button>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}

/** Multi-column picker for one index: ordered chips, each with an ASC/DESC
 * toggle and reorder/remove controls, plus a dropdown to append columns. */
function ColumnPicker({
  value,
  available,
  directional,
  onChange,
}: {
  value: IndexColumnRef[];
  available: string[];
  directional: boolean;
  onChange: (columns: IndexColumnRef[]) => void;
}) {
  const selected = new Set(value.map((v) => v.column));
  const addable = available.filter((c) => !selected.has(c));

  const add = (column: string) => {
    if (!column) return;
    onChange([...value, { column, direction: "ASC" }]);
  };
  const remove = (column: string) =>
    onChange(value.filter((v) => v.column !== column));
  const toggleDir = (column: string) =>
    onChange(
      value.map((v) =>
        v.column === column
          ? { ...v, direction: v.direction === "ASC" ? "DESC" : "ASC" }
          : v
      )
    );
  const move = (index: number, dir: -1 | 1) => {
    const target = index + dir;
    if (target < 0 || target >= value.length) return;
    const next = value.slice();
    [next[index], next[target]] = [next[target], next[index]];
    onChange(next);
  };

  const chipBtn =
    "flex items-center justify-center h-5 w-5 rounded text-zinc-400 hover:text-zinc-100 hover:bg-zinc-700 disabled:opacity-30 disabled:hover:bg-transparent disabled:hover:text-zinc-400";

  return (
    <div
      data-el="index-columns"
      className="min-h-8 rounded border border-zinc-700 bg-zinc-950 p-1 space-y-1"
    >
      {value.map((ref, i) => (
        <div
          key={ref.column}
          data-el="index-column-chip"
          className="flex items-center gap-1 rounded bg-zinc-800/70 pl-2 pr-1 py-0.5"
        >
          <span
            className="flex-1 truncate text-[12px] text-zinc-200"
            title={ref.column}
          >
            {ref.column}
          </span>
          {directional && (
            <button
              type="button"
              onClick={() => toggleDir(ref.column)}
              className="px-1.5 py-0.5 rounded text-[10px] font-semibold tabular-nums bg-zinc-700 text-zinc-200 hover:bg-zinc-600"
              title="Toggle sort direction"
            >
              {ref.direction}
            </button>
          )}
          <button
            type="button"
            onClick={() => move(i, -1)}
            disabled={i === 0}
            className={chipBtn}
            aria-label="Move column up"
          >
            <ArrowUp size={12} />
          </button>
          <button
            type="button"
            onClick={() => move(i, 1)}
            disabled={i === value.length - 1}
            className={chipBtn}
            aria-label="Move column down"
          >
            <ArrowDown size={12} />
          </button>
          <button
            type="button"
            onClick={() => remove(ref.column)}
            className="flex items-center justify-center h-5 w-5 rounded text-zinc-400 hover:text-rose-300 hover:bg-zinc-700"
            aria-label="Remove column"
          >
            <X size={12} />
          </button>
        </div>
      ))}
      {addable.length > 0 ? (
        <select
          data-el="index-add-column"
          value=""
          onChange={(e) => add(e.target.value)}
          className="w-full h-7 bg-zinc-950 border border-zinc-700 rounded px-2 text-[11px] text-zinc-300 outline-none focus:border-accent-500"
        >
          <option value="">+ Add column…</option>
          {addable.map((c) => (
            <option key={c} value={c}>
              {c}
            </option>
          ))}
        </select>
      ) : value.length === 0 ? (
        <div className="px-1 py-1 text-[11px] text-zinc-500">
          Add named columns first.
        </div>
      ) : null}
    </div>
  );
}

function AdvancedPanel({
  column,
  onPatch,
}: {
  column: ColumnDraft;
  onPatch: (patch: Partial<ColumnDraft>) => void;
}) {
  const checkboxLabel =
    "flex items-center gap-1.5 text-zinc-300 cursor-pointer select-none";
  return (
    <div
      data-el="column-advanced"
      className="ml-9 mt-1 mb-0.5 rounded-md border border-zinc-800 bg-zinc-900/40 px-3 py-2.5 flex flex-wrap items-center gap-x-6 gap-y-2.5"
    >
      <label className={checkboxLabel}>
        <input
          data-el="col-auto-increment"
          type="checkbox"
          checked={column.autoIncrement}
          onChange={(e) => onPatch({ autoIncrement: e.target.checked })}
          className="dbs-check focus:ring-2 focus:ring-accent-400 focus:ring-offset-1 focus:ring-offset-zinc-950"
        />
        Auto-increment
      </label>
      <label className={checkboxLabel}>
        <input
          data-el="col-unsigned"
          type="checkbox"
          checked={column.unsigned}
          onChange={(e) => onPatch({ unsigned: e.target.checked })}
          className="dbs-check focus:ring-2 focus:ring-accent-400 focus:ring-offset-1 focus:ring-offset-zinc-950"
        />
        Unsigned
      </label>
      <label className={checkboxLabel}>
        <input
          data-el="col-zerofill"
          type="checkbox"
          checked={column.zerofill}
          onChange={(e) => onPatch({ zerofill: e.target.checked })}
          className="dbs-check focus:ring-2 focus:ring-accent-400 focus:ring-offset-1 focus:ring-offset-zinc-950"
        />
        Zerofill
      </label>
      <label className="flex items-center gap-2 text-zinc-400">
        Default
        <input
          data-el="col-default"
          value={column.defaultValue}
          onChange={(e) => onPatch({ defaultValue: e.target.value })}
          placeholder="NULL, 0, 'text', CURRENT_TIMESTAMP…"
          className="w-72 bg-zinc-950 border border-zinc-700 rounded px-2 py-1 text-zinc-200 outline-none focus:border-accent-500"
        />
      </label>
    </div>
  );
}

function SqlPane({
  sql,
  expanded,
  onToggle,
}: {
  sql: string;
  expanded: boolean;
  onToggle: () => void;
}) {
  const [copied, setCopied] = useState(false);
  const height = useUi((s) => s.sqlPaneHeight);
  const setHeight = useUi((s) => s.setSqlPaneHeight);

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(sql);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      /* clipboard unavailable */
    }
  };

  /** Drag the top edge to resize: dragging upward grows the pane. */
  const startResize = (e: React.PointerEvent) => {
    e.preventDefault();
    const startY = e.clientY;
    const startH = useUi.getState().sqlPaneHeight;
    const onMove = (ev: PointerEvent) => setHeight(startH + (startY - ev.clientY));
    const onUp = () => {
      document.removeEventListener("pointermove", onMove);
      document.removeEventListener("pointerup", onUp);
      document.body.style.cursor = "";
      document.body.style.userSelect = "";
    };
    document.body.style.cursor = "row-resize";
    document.body.style.userSelect = "none";
    document.addEventListener("pointermove", onMove);
    document.addEventListener("pointerup", onUp);
  };

  return (
    <div data-el="sql-pane" className="shrink-0 border-t border-zinc-800/80 bg-zinc-950">
      {expanded && (
        <div
          role="separator"
          aria-orientation="horizontal"
          onPointerDown={startResize}
          onDoubleClick={() => setHeight(200)}
          className="h-1 cursor-row-resize bg-zinc-800/60 hover:bg-accent-500/40 transition-colors"
          title="Drag to resize · double-click to reset"
        />
      )}
      <div className="h-8 px-3 flex items-center gap-2">
        <button
          data-el="sql-pane-toggle"
          onClick={onToggle}
          className="inline-flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-[0.1em] text-zinc-400 hover:text-zinc-200"
        >
          {expanded ? <CaretDown size={12} /> : <CaretRight size={12} />}
          SQL
        </button>
        {expanded && (
          <button
            data-el="sql-copy-btn"
            onClick={copy}
            className="ml-auto inline-flex items-center gap-1.5 px-2 py-0.5 rounded text-[11px] text-zinc-300 hover:bg-zinc-800"
          >
            {copied ? <Check size={13} className="text-emerald-400" /> : <Copy size={13} />}
            {copied ? "Copied" : "Copy"}
          </button>
        )}
      </div>
      {expanded && (
        <pre
          data-el="sql-text"
          style={{ height }}
          className="overflow-auto border-t border-zinc-800/60 bg-[#1d2029] px-4 py-3 text-[12px] font-mono leading-relaxed text-zinc-200 whitespace-pre"
        >
          {sql}
        </pre>
      )}
    </div>
  );
}
