import { useEffect, useMemo, useRef, useState } from "react";
import {
  Trash,
  Plus,
  Copy,
  ArrowsClockwise,
  ShareNetwork,
  Warning,
  CircleNotch as Loader2,
  X,
  FloppyDisk,
  MagnifyingGlass,
} from "@phosphor-icons/react";
import clsx from "clsx";
import { ipc } from "../ipc";
import { singularize, pluralize } from "../lib/inflector";
import {
  BLANK_RELATION,
  formFromRelation,
  withFromColumn,
  withSuggestedToColumn,
  withToTable,
} from "../lib/relationForm";
import { useStore } from "../state/store";
import { useUi } from "../state/ui";
import { SearchableSelect } from "./SearchableSelect";
import { CopyRelationsDialog } from "./CopyRelationsDialog";
import { notifySuccess, notifyInfo } from "../state/notify";
import type { Relation, RelationKind, RelationsTab } from "../types";

const EMPTY_RELATIONS: Relation[] = [];

export function RelationsView({ tab }: { tab: RelationsTab }) {
  const { profileId, database } = tab;
  const editorWidth = useUi((s) => s.relationsEditorWidth);
  const setEditorWidth = useUi((s) => s.setRelationsEditorWidth);

  const [tables, setTables] = useState<string[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const relations =
    useStore((s) => s.relations[`${profileId}::${database}`]) ??
    EMPTY_RELATIONS;
  const loadRelations = useStore((s) => s.loadRelations);
  const saveRelationDef = useStore((s) => s.saveRelation);
  const deleteRelationDef = useStore((s) => s.deleteRelation);

  const [form, setForm] = useState(BLANK_RELATION);
  const [editorOpen, setEditorOpen] = useState(false);
  const [copyOpen, setCopyOpen] = useState(false);
  const [clearOpen, setClearOpen] = useState(false);
  const [clearing, setClearing] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [addFocusSignal, setAddFocusSignal] = useState(0);
  const [search, setSearch] = useState("");
  const searchRef = useRef<HTMLInputElement>(null);

  /** Focus search on mount — covers both opening and re-focusing the tab, since
   * switching to this tab remounts the view. */
  useEffect(() => {
    searchRef.current?.focus();
  }, []);
  const [fromColumns, setFromColumns] = useState<string[]>([]);
  const [toColumns, setToColumns] = useState<string[]>([]);

  const openAdd = () => {
    setForm(BLANK_RELATION);
    setEditorOpen(true);
    setAddFocusSignal((n) => n + 1);
  };
  const closeEditor = () => {
    setForm(BLANK_RELATION);
    setEditorOpen(false);
  };

  /** Delete every relation defined on this database, then refresh. */
  const onClearAll = async () => {
    if (clearing) return;
    setClearing(true);
    setError(null);
    try {
      const count = relations.length;
      for (const r of relations) {
        await ipc.deleteRelation(profileId, database, r.id);
      }
      await loadRelations(profileId, database);
      setClearOpen(false);
      notifySuccess(
        `Cleared ${count} relation${count === 1 ? "" : "s"} from ${database}.`
      );
    } catch (e) {
      setError(String(e));
    } finally {
      setClearing(false);
    }
  };

  /**
   * Re-fetch the schema and run a validation pass: any defined relation whose
   * tables/columns no longer exist is removed automatically. Notifies with the
   * number pruned, or confirms all relations are valid.
   */
  const onRefresh = async () => {
    if (refreshing) return;
    setRefreshing(true);
    setError(null);
    try {
      const ts = await ipc.listTables(profileId, database);
      const tableNames = ts.map((t) => t.name);
      setTables(tableNames);
      const tableSet = new Set(tableNames);
      const current = await ipc.listRelations(profileId, database);

      /** Cache of column names per table (null = table absent). */
      const colCache = new Map<string, Set<string> | null>();
      const colsOf = async (table: string): Promise<Set<string> | null> => {
        if (!tableSet.has(table)) return null;
        if (!colCache.has(table)) {
          const cols = await ipc.listColumns(profileId, database, table);
          colCache.set(table, new Set(cols.map((c) => c.name)));
        }
        return colCache.get(table) ?? null;
      };

      const invalid: Relation[] = [];
      for (const r of current) {
        const fromCols = await colsOf(r.fromTable);
        const toCols = await colsOf(r.toTable);
        const valid =
          !!fromCols &&
          !!toCols &&
          fromCols.has(r.fromColumn) &&
          toCols.has(r.toColumn);
        if (!valid) invalid.push(r);
      }

      for (const r of invalid) {
        await ipc.deleteRelation(profileId, database, r.id);
      }

      await loadRelations(profileId, database);

      if (invalid.length > 0) {
        notifyInfo(
          `Removed ${invalid.length} invalid relation${
            invalid.length === 1 ? "" : "s"
          } (missing table or column).`
        );
      } else {
        notifySuccess(
          current.length === 0
            ? "No relations to validate."
            : `All ${current.length} relation${
                current.length === 1 ? "" : "s"
              } are valid.`
        );
      }
    } catch (e) {
      setError(String(e));
    } finally {
      setRefreshing(false);
    }
  };

  const sortedTables = useMemo(() => [...tables].sort(), [tables]);

  const sortedRelations = useMemo(
    () =>
      [...relations].sort((a, b) => {
        const byFrom = a.fromTable.localeCompare(b.fromTable, undefined, {
          sensitivity: "base",
        });
        if (byFrom !== 0) return byFrom;
        return a.toTable.localeCompare(b.toTable, undefined, {
          sensitivity: "base",
        });
      }),
    [relations]
  );

  const query = search.trim().toLowerCase();
  /** Filter by from/to table names only (not columns or accessor name). */
  const visibleRelations = useMemo(
    () =>
      query
        ? sortedRelations.filter(
            (r) =>
              r.fromTable.toLowerCase().includes(query) ||
              r.toTable.toLowerCase().includes(query)
          )
        : sortedRelations,
    [sortedRelations, query]
  );

  /**
   * Group the visible relations by their source table (table1) so each table
   * renders as a single card. Relies on visibleRelations already being sorted
   * by fromTable, so Map insertion order yields alphabetical groups.
   */
  const groupedRelations = useMemo(() => {
    const groups = new Map<string, Relation[]>();
    for (const r of visibleRelations) {
      const arr = groups.get(r.fromTable);
      if (arr) arr.push(r);
      else groups.set(r.fromTable, [r]);
    }
    return [...groups.entries()];
  }, [visibleRelations]);

  useEffect(() => {
    ipc
      .listTables(profileId, database)
      .then((ts) => setTables(ts.map((t) => t.name)))
      .catch((e) => setError(String(e)));
    loadRelations(profileId, database).catch((e) => setError(String(e)));
  }, [profileId, database, loadRelations]);

  useEffect(() => {
    if (!form.fromTable) {
      setFromColumns([]);
      return;
    }
    ipc
      .listColumns(profileId, database, form.fromTable)
      .then((cols) => setFromColumns(cols.map((c) => c.name)))
      .catch(() => setFromColumns([]));
  }, [form.fromTable, profileId, database]);

  useEffect(() => {
    if (!form.toTable) {
      setToColumns([]);
      return;
    }
    ipc
      .listColumns(profileId, database, form.toTable)
      .then((cols) => setToColumns(cols.map((c) => c.name)))
      .catch(() => setToColumns([]));
  }, [form.toTable, profileId, database]);

  /** Suggest/validate the to-column once the target table's columns land. */
  useEffect(() => {
    setForm((f) => withSuggestedToColumn(f, toColumns));
  }, [toColumns, form.kind, form.fromTable]);

  const onFromTableChange = (fromTable: string) => {
    if (fromTable === form.fromTable) return;
    setForm({ ...BLANK_RELATION, fromTable });
  };

  const onFromColumnChange = (fromColumn: string) => {
    if (fromColumn === form.fromColumn) return;
    setForm(withFromColumn(form, fromColumn, tables));
  };

  const onKindChange = (kind: RelationKind) =>
    setForm(withToTable({ ...form, kind }, form.toTable));

  const onToTableChange = (toTable: string) => {
    if (toTable === form.toTable) return;
    setForm(withToTable(form, toTable));
  };

  const startEdit = (r: Relation) => {
    setForm(formFromRelation(r));
    setEditorOpen(true);
  };

  const canSave =
    form.fromTable && form.fromColumn && form.toTable && form.toColumn;

  /** When editing, the loaded relation; used to gate Save on an actual change. */
  const editingOriginal = form.editingId
    ? relations.find((r) => r.id === form.editingId) ?? null
    : null;
  const isDirty =
    !editingOriginal ||
    form.fromTable !== editingOriginal.fromTable ||
    form.fromColumn !== editingOriginal.fromColumn ||
    form.kind !== editingOriginal.kind ||
    form.toTable !== editingOriginal.toTable ||
    form.toColumn !== editingOriginal.toColumn ||
    form.name.trim() !== editingOriginal.name.trim();

  const onSave = async () => {
    if (!canSave || saving) return;
    setSaving(true);
    setError(null);
    try {
      await saveRelationDef({
        profileId,
        database,
        id: form.editingId,
        fromTable: form.fromTable,
        fromColumn: form.fromColumn,
        toTable: form.toTable,
        toColumn: form.toColumn,
        kind: form.kind,
        name: form.name.trim(),
      });
      closeEditor();
    } catch (e) {
      setError(String(e));
    } finally {
      setSaving(false);
    }
  };

  const onDelete = async (id: string) => {
    try {
      await deleteRelationDef(profileId, database, id);
      if (form.editingId === id) closeEditor();
    } catch (e) {
      setError(String(e));
    }
  };

  const startResize = (e: React.PointerEvent) => {
    e.preventDefault();
    const startX = e.clientX;
    const startW = editorWidth;
    const onMove = (ev: PointerEvent) =>
      setEditorWidth(startW + (startX - ev.clientX));
    const onUp = () => {
      document.removeEventListener("pointermove", onMove);
      document.removeEventListener("pointerup", onUp);
      document.body.style.cursor = "";
      document.body.style.userSelect = "";
    };
    document.body.style.cursor = "col-resize";
    document.body.style.userSelect = "none";
    document.addEventListener("pointermove", onMove);
    document.addEventListener("pointerup", onUp);
  };

  const selectClass =
    "bg-zinc-950 border border-zinc-700 rounded px-2 py-1 text-[12px] text-zinc-200 outline-none focus:border-accent-500 disabled:opacity-50";

  return (
    <div
      data-el="relations-view"
      className="flex-1 flex flex-col min-h-0 bg-zinc-950"
    >
      <div className="dbs-toolbar h-9 shrink-0 pl-1 pr-2 flex items-center gap-1 border-b border-zinc-800/60">
        <div className="relative">
          <MagnifyingGlass
            size={13}
            className="absolute left-2 top-1/2 -translate-y-1/2 text-zinc-500 pointer-events-none"
          />
          <input
            ref={searchRef}
            data-el="relation-search"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search by table…"
            className="w-56 bg-zinc-950 border border-zinc-700 rounded pl-7 pr-2 py-1 text-zinc-200 outline-none focus:border-accent-500"
          />
        </div>
        <button
          data-el="add-relationship-btn"
          onClick={openAdd}
          className="inline-flex items-center gap-1.5 px-2 py-1 rounded font-semibold bg-violet-500 text-violet-950 hover:bg-violet-400 transition-colors"
          title="Add a relation"
        >
          <span className="relative -top-px text-[19px] leading-none">+</span> Relation
        </button>
        <span className="ml-1 text-[11px] text-zinc-500">
          {query
            ? `${visibleRelations.length} of ${relations.length}`
            : `${relations.length} defined`}
        </span>
        <button
          data-el="copy-relations-btn"
          onClick={() => setCopyOpen(true)}
          disabled={relations.length === 0}
          className="ml-auto inline-flex items-center gap-1.5 px-2 py-1 rounded font-semibold bg-zinc-800 text-zinc-200 hover:bg-zinc-700 transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
          title="Copy these relations to another database"
        >
          <Copy size={14} /> Copy All
        </button>
        <button
          data-el="clear-relations-btn"
          onClick={() => setClearOpen(true)}
          disabled={relations.length === 0}
          className="inline-flex items-center gap-1.5 px-2 py-1 rounded font-semibold bg-zinc-800 text-zinc-200 hover:bg-zinc-700 transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
          title="Delete all relations for this database"
        >
          <Trash size={14} /> Clear All
        </button>
        <button
          data-el="refresh-relations-btn"
          onClick={onRefresh}
          disabled={refreshing}
          className="inline-flex items-center justify-center p-1.5 rounded bg-zinc-800 text-zinc-200 hover:bg-zinc-700 transition-colors disabled:opacity-50"
          title="Refresh relations"
          aria-label="Refresh relations"
        >
          <ArrowsClockwise size={15} className={refreshing ? "animate-spin" : undefined} />
        </button>
      </div>

      {error && (
        <div className="shrink-0 mx-4 mt-3 rounded bg-rose-950/40 border border-rose-900/60 px-3 py-2 text-[11px] text-rose-300 break-words">
          {error}
        </div>
      )}

      <div data-el="relations-body" className="flex-1 min-h-0 flex bg-[#1d2029]">
        <div className="flex-1 min-h-0 flex flex-col">
          <div className="flex-1 min-h-0 overflow-auto px-4 pt-4 pb-4">
          {relations.length === 0 ? (
            <div className="text-[12px] text-zinc-500 py-2">
              No relations defined for this database yet.
            </div>
          ) : visibleRelations.length === 0 ? (
            <div className="text-[12px] text-zinc-500 py-2">
              No relations match “{search.trim()}”.
            </div>
          ) : (
            <div className="space-y-1.5">
              {groupedRelations.map(([fromTable, rels]) => (
                <div
                  key={fromTable}
                  data-el="relation-group"
                  className="flex rounded-lg border border-zinc-800 bg-zinc-900/40 overflow-hidden"
                >
                  <div className="flex w-44 shrink-0 items-center gap-2 px-3 py-2 border-r border-zinc-800 bg-zinc-900/60">
                    <ShareNetwork
                      size={15}
                      weight="bold"
                      className="shrink-0 text-violet-400"
                    />
                    <span className="truncate text-[13px] font-semibold text-zinc-100">
                      {fromTable}
                    </span>
                  </div>
                  <ul className="flex-1 min-w-0 divide-y divide-zinc-800/50">
                    {rels.map((r) => {
                      const object =
                        r.name.trim() ||
                        (r.kind === "has_many"
                          ? pluralize(singularize(r.toTable))
                          : singularize(r.toTable));
                      return (
                        <li
                          key={r.id}
                          data-el="relation-row"
                          onClick={() => startEdit(r)}
                          className={clsx(
                            "group flex items-center gap-2 px-3 py-1.5 cursor-pointer",
                            form.editingId === r.id
                              ? "bg-accent-500/10"
                              : "hover:bg-zinc-800/60"
                          )}
                        >
                          <span
                            className={clsx(
                              "shrink-0 rounded px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide",
                              r.kind === "has_many"
                                ? "bg-accent-500/15 text-accent-300"
                                : "bg-amber-500/15 text-amber-300"
                            )}
                          >
                            {r.kind === "has_many" ? "has many" : "has one"}
                          </span>
                          <span className="truncate text-[13px] font-semibold text-violet-400">
                            {object}
                          </span>
                          <span className="shrink-0 text-[12px] text-zinc-500 truncate">
                            {r.fromColumn} &rarr; {r.toColumn}
                          </span>
                          <button
                            data-el="relation-delete-btn"
                            onClick={(e) => {
                              e.stopPropagation();
                              onDelete(r.id);
                            }}
                            className="ml-auto shrink-0 p-1 rounded text-zinc-500 hover:text-rose-300 hover:bg-zinc-700 opacity-0 group-hover:opacity-100"
                            aria-label="Delete relation"
                          >
                            <Trash size={13} />
                          </button>
                        </li>
                      );
                    })}
                  </ul>
                </div>
              ))}
            </div>
          )}
          </div>
        </div>

        {editorOpen && (
          <>
        <div
          role="separator"
          aria-orientation="vertical"
          onPointerDown={startResize}
          className="w-1 shrink-0 cursor-col-resize bg-zinc-800/60 hover:bg-accent-500/40 transition-colors"
        />

        <div
          data-el="relations-editor"
          style={{ width: editorWidth }}
          className="shrink-0 overflow-auto px-4 py-4 bg-[#2c303c]"
        >
          <div className="mb-5 flex items-center justify-between">
            <span className="text-[10px] font-semibold uppercase tracking-[0.12em] text-zinc-500">
              {form.editingId ? "Edit relation" : "Add relation"}
            </span>
            <button
              data-el="rel-editor-close"
              onClick={closeEditor}
              className="text-zinc-500 hover:text-zinc-200"
              aria-label="Close"
            >
              <X size={15} />
            </button>
          </div>
          <div className="grid grid-cols-[auto_1fr] items-center gap-x-3 gap-y-2 text-[12px] text-zinc-400">
              <span className="text-right">From</span>
              <div className="flex items-center gap-2">
                <SearchableSelect
                  dataEl="rel-from-table"
                  value={form.fromTable}
                  options={sortedTables}
                  placeholder="table…"
                  onChange={onFromTableChange}
                  className="flex-1"
                  focusSignal={addFocusSignal}
                />
                <SearchableSelect
                  dataEl="rel-from-column"
                  value={form.fromColumn}
                  options={fromColumns}
                  placeholder="column…"
                  disabled={!form.fromTable}
                  onChange={onFromColumnChange}
                  className="flex-1"
                />
              </div>

              <span className="text-right">Type</span>
              <select
                data-el="rel-kind"
                value={form.kind}
                onChange={(e) => onKindChange(e.target.value as RelationKind)}
                className={clsx(selectClass, "w-40")}
              >
                <option value="has_one">has one</option>
                <option value="has_many">has many</option>
              </select>

              <span className="text-right">To</span>
              <div className="flex items-center gap-2">
                <SearchableSelect
                  dataEl="rel-to-table"
                  value={form.toTable}
                  options={sortedTables}
                  placeholder="table…"
                  onChange={onToTableChange}
                  className="flex-1"
                />
                <SearchableSelect
                  dataEl="rel-to-column"
                  value={form.toColumn}
                  options={toColumns}
                  placeholder="column…"
                  disabled={!form.toTable}
                  onChange={(v) => setForm({ ...form, toColumn: v })}
                  className="flex-1"
                />
              </div>

              <span className="text-right">Name</span>
              <input
                data-el="rel-name"
                value={form.name}
                onChange={(e) => setForm({ ...form, name: e.target.value })}
                placeholder="optional accessor name"
                className={clsx(selectClass, "w-full")}
              />
            </div>

            <div className="mt-3 flex items-center justify-end gap-2">
              {form.editingId && (
                <button
                  onClick={closeEditor}
                  className="px-2 py-1 rounded text-[11px] text-zinc-300 hover:bg-zinc-800"
                >
                  Cancel edit
                </button>
              )}
              <button
                data-el="rel-save-btn"
                onClick={onSave}
                disabled={!canSave || saving || !isDirty}
                className="inline-flex items-center gap-1.5 px-2 py-1 rounded text-[11px] font-semibold bg-accent-500 text-[#042f2e] hover:bg-accent-400 transition-colors disabled:bg-zinc-800 disabled:text-zinc-500 disabled:cursor-not-allowed"
              >
                {form.editingId ? <FloppyDisk size={13} /> : <Plus size={13} />}
                {form.editingId ? "Save Relation" : "Add relation"}
              </button>
            </div>
        </div>
          </>
        )}
      </div>

      <CopyRelationsDialog
        open={copyOpen}
        sourceProfileId={profileId}
        sourceDatabase={database}
        relations={relations}
        onClose={() => setCopyOpen(false)}
      />

      {clearOpen && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm"
          onClick={() => !clearing && setClearOpen(false)}
        >
          <div
            data-el="clear-relations-dialog"
            role="dialog"
            aria-modal="true"
            onClick={(e) => e.stopPropagation()}
            className="w-[440px] max-w-[90vw] rounded-lg border border-zinc-700 bg-zinc-900 shadow-2xl shadow-black/60"
          >
            <div className="flex items-center justify-between px-4 py-3 border-b border-zinc-800">
              <div className="flex items-center gap-2">
                <Warning size={18} weight="fill" className="text-amber-400" />
                <h2 className="text-sm font-semibold text-zinc-100">
                  Clear all relations
                </h2>
              </div>
              {!clearing && (
                <button
                  onClick={() => setClearOpen(false)}
                  className="text-zinc-500 hover:text-zinc-200"
                  aria-label="Close"
                >
                  <X size={18} />
                </button>
              )}
            </div>

            <div className="px-4 py-4 text-[12px] leading-relaxed text-zinc-300">
              <p>
                Delete all{" "}
                <span className="font-semibold text-zinc-100">
                  {relations.length}
                </span>{" "}
                relation{relations.length === 1 ? "" : "s"} defined on{" "}
                <span className="font-mono text-zinc-100">{database}</span>? This
                cannot be undone.
              </p>
            </div>

            <div className="flex items-center justify-end gap-2 border-t border-zinc-800 px-4 py-3">
              <button
                onClick={() => setClearOpen(false)}
                disabled={clearing}
                className="px-3 py-1.5 rounded text-[12px] text-zinc-200 bg-zinc-800 hover:bg-zinc-700 disabled:opacity-50"
              >
                Cancel
              </button>
              <button
                data-el="clear-relations-confirm"
                onClick={onClearAll}
                disabled={clearing}
                className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded text-[12px] font-semibold bg-rose-900 text-rose-100 hover:bg-rose-800 transition-colors disabled:opacity-60 disabled:cursor-not-allowed"
              >
                {clearing ? (
                  <Loader2 size={14} className="animate-spin" />
                ) : (
                  <Trash size={14} />
                )}
                {clearing ? "Clearing…" : "Clear All"}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
