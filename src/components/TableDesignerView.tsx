import { useMemo, useState, useEffect, useRef } from "react";
import {
  FloppyDisk,
  Trash,
  Table as TableIcon,
  Copy,
  Check,
  CaretRight,
  CaretDown,
  ArrowUp,
  ArrowDown,
  Asterisk,
  CircleNotch,
} from "@phosphor-icons/react";
import clsx from "clsx";
import { ipc } from "../ipc";
import { useStore } from "../state/store";
import { useUi } from "../state/ui";
import { notifyError, notifySuccess, notifyInfo } from "../state/notify";
import {
  buildCreateTableSql,
  buildAlterTableSql,
  droppedColumnNames,
} from "../lib/tableSql";
import type { ColumnDraft, CreateTableTab } from "../types";

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

const SUB_TABS = [{ id: "columns", label: "Columns" }] as const;

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
  const finishTableCreation = useStore((s) => s.finishTableCreation);
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
            tab.autoIncrementValue
          )
        : buildCreateTableSql(tab.tableName.trim() || "new_table", tab.columns),
    [
      isEdit,
      tab.originalName,
      tab.originalColumns,
      tab.tableName,
      tab.columns,
      tab.originalAutoIncrementValue,
      tab.autoIncrementValue,
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

  const handleSave = async () => {
    if (saving) return;
    const name = tab.tableName.trim();
    if (!name) {
      setError("Enter a table name.");
      return;
    }
    if (tab.columns.filter((c) => c.name.trim()).length === 0) {
      setError("Add at least one column with a name.");
      return;
    }
    setError(null);
    setSqlExpanded(true);
    if (isEdit) {
      await saveEdit(name);
    } else {
      await saveCreate(name);
    }
  };

  const saveCreate = async (name: string) => {
    const sqlText = buildCreateTableSql(name, tab.columns);
    setSaving(true);
    try {
      const exists = await ipc.tableExists(tab.profileId, tab.database, name);
      if (exists) {
        const ok = window.confirm(
          `A table named "${name}" already exists in "${tab.database}".\n\n` +
            `Saving will DROP the existing table and ALL of its data, then recreate it. ` +
            `This cannot be undone.\n\nContinue?`
        );
        if (!ok) {
          setSaving(false);
          return;
        }
      }
      await ipc.createTable({
        profileId: tab.profileId,
        database: tab.database,
        tableName: name,
        sql: sqlText,
        overwrite: exists,
      });
      notifySuccess(`Table "${name}" ${exists ? "replaced" : "created"} in ${tab.database}.`);
      await finishTableCreation(
        tab.id,
        tab.profileId,
        tab.profileName,
        tab.database,
        name
      );
    } catch (e) {
      notifyError(`Could not save table: ${String(e)}`);
      setSaving(false);
    }
  };

  const saveEdit = async (name: string) => {
    const alterSql = buildAlterTableSql(
      tab.originalName,
      tab.originalColumns,
      name,
      tab.columns,
      tab.originalAutoIncrementValue,
      tab.autoIncrementValue
    );
    if (alterSql.startsWith("--")) {
      notifyInfo("No changes to apply.");
      return;
    }
    const dropped = droppedColumnNames(tab.originalColumns, tab.columns);
    if (dropped.length > 0) {
      const ok = window.confirm(
        `This will permanently DROP ${dropped.length} column${
          dropped.length === 1 ? "" : "s"
        } and all of their data:\n\n${dropped.join(", ")}\n\n` +
          `This cannot be undone. Continue?`
      );
      if (!ok) return;
    }
    setSaving(true);
    try {
      await ipc.runDdl(tab.profileId, tab.database, alterSql);
      notifySuccess(`Table "${tab.originalName}" updated.`);
      await finishTableCreation(
        tab.id,
        tab.profileId,
        tab.profileName,
        tab.database,
        name
      );
    } catch (e) {
      notifyError(`Could not alter table: ${String(e)}`);
      setSaving(false);
    }
  };

  return (
    <div data-el="table-designer" className="flex-1 flex flex-col min-h-0 bg-zinc-950 pt-6">
      <div className="shrink-0 px-4 pb-2 flex items-center gap-2">
        <TableIcon size={18} className="text-emerald-400 shrink-0" />
        <h2 className="text-[16px] font-semibold text-zinc-100">
          {isEdit ? "Edit Table" : "Add New Table"}
        </h2>
      </div>
      <div className="h-11 shrink-0 px-4 flex items-center gap-2">
        <span className="text-[13px] text-zinc-400 shrink-0 mr-2">Name</span>
        <div className="flex items-stretch">
          <span className="flex items-center px-2 text-[13px] text-zinc-300 bg-zinc-900 border border-r-0 border-zinc-700 rounded-l whitespace-nowrap shrink-0">
            {tab.database}.
          </span>
          <input
            data-el="table-name-input"
            autoFocus
            value={tab.tableName}
            onChange={(e) => updateCreateTable(tab.id, { tableName: e.target.value })}
            style={{ fontSize: "16px" }}
            className="w-72 bg-zinc-950 border border-zinc-700 rounded-r px-2 py-1 font-semibold text-zinc-100 outline-none focus:border-accent-500"
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
              "px-4 py-1.5 text-[12px] rounded-t-md border border-b-0 transition-colors",
              activeSubTab === st.id
                ? "bg-zinc-800 border-zinc-700 text-zinc-100"
                : "bg-zinc-900/40 border-transparent text-zinc-400 hover:bg-zinc-800/50 hover:text-zinc-200"
            )}
          >
            {st.label}
          </button>
        ))}
      </div>

      <div className="flex-1 min-h-0 flex flex-col">
        {activeSubTab === "columns" && (
          <ColumnsEditor
            columns={tab.columns}
            error={error}
            saving={saving}
            focusColumnId={focusColumnId}
            onColumnFocused={() => setFocusColumnId(null)}
            onAddColumn={addColumn}
            onPatchColumn={patchColumn}
            onRemoveColumn={removeColumn}
            onMoveColumn={moveColumn}
            onSave={handleSave}
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

function ColumnsEditor({
  columns,
  error,
  saving,
  focusColumnId,
  onColumnFocused,
  onAddColumn,
  onPatchColumn,
  onRemoveColumn,
  onMoveColumn,
  onSave,
}: {
  columns: ColumnDraft[];
  error: string | null;
  saving: boolean;
  focusColumnId: string | null;
  onColumnFocused: () => void;
  onAddColumn: () => void;
  onPatchColumn: (id: string, patch: Partial<ColumnDraft>) => void;
  onRemoveColumn: (id: string) => void;
  onMoveColumn: (id: string, direction: -1 | 1) => void;
  onSave: () => void;
}) {
  const [expandedRows, setExpandedRows] = useState<Set<string>>(new Set());
  const canSave = columns.some((c) => c.name.trim() !== "");
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
      <div
        data-el="columns-toolbar"
        className="dbs-toolbar h-9 shrink-0 pl-1.5 pr-3 flex items-center gap-1 border-b border-zinc-800/60"
      >
        <button
          data-el="columns-add-btn"
          onClick={onAddColumn}
          className="inline-flex items-center gap-1.5 px-3 py-1 rounded text-[11px] font-semibold bg-emerald-500 text-emerald-950 hover:bg-emerald-400 transition-colors"
        >
          <span className="text-[19px] leading-none">+</span> Add Column
        </button>
        <button
          data-el="columns-save-btn"
          onClick={onSave}
          disabled={!canSave || saving}
          className="inline-flex items-center gap-1.5 px-3 py-1 rounded text-[11px] font-semibold bg-accent-500 text-[#042f2e] hover:bg-accent-400 transition-colors disabled:bg-zinc-800 disabled:text-zinc-500 disabled:cursor-not-allowed"
        >
          {saving ? (
            <CircleNotch size={17} className="animate-spin" />
          ) : (
            <FloppyDisk size={17} />
          )}
          {saving ? "Saving…" : "Save"}
        </button>
        <span className="ml-auto text-[11px] text-zinc-500">
          {columns.length} column{columns.length === 1 ? "" : "s"}
        </span>
      </div>

      {error && (
        <div className="shrink-0 mx-3 mt-3 rounded bg-rose-950/40 border border-rose-900/60 px-3 py-2 text-[11px] text-rose-300">
          {error}
        </div>
      )}

      <div ref={scrollRef} className="flex-1 min-h-0 overflow-auto px-3 py-3 bg-[#2c303c]">
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

function AutoGrowTextarea({
  value,
  onChange,
  className,
}: {
  value: string;
  onChange: (value: string) => void;
  className?: string;
}) {
  const ref = useRef<HTMLTextAreaElement>(null);
  const [focused, setFocused] = useState(false);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    if (focused) {
      /* While editing, grow to fit the full comment. */
      el.style.height = "auto";
      const border = el.offsetHeight - el.clientHeight;
      el.style.height = `${el.scrollHeight + border}px`;
    } else {
      /* Collapsed: a single line (the `min-h-8` class height), overflow clipped. */
      el.style.height = "";
    }
  }, [value, focused]);

  return (
    <textarea
      data-el="col-comment"
      ref={ref}
      rows={1}
      value={value}
      onChange={(e) => onChange(e.target.value)}
      onFocus={() => setFocused(true)}
      onBlur={() => setFocused(false)}
      placeholder="comment"
      className={clsx(className, "min-h-8 resize-none overflow-hidden")}
    />
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
