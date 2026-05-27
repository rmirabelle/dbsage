import { useEffect, useMemo, useRef, useState } from "react";
import {
  Trash,
  Plus,
  ShareNetwork,
  X,
  FloppyDisk,
  MagnifyingGlass,
} from "@phosphor-icons/react";
import clsx from "clsx";
import { ipc } from "../ipc";
import { singularize, pluralize } from "../lib/inflector";
import { useStore } from "../state/store";
import { useUi } from "../state/ui";
import { SearchableSelect } from "./SearchableSelect";
import type { Relation, RelationKind, RelationsTab } from "../types";

const EMPTY_RELATIONS: Relation[] = [];

const BLANK = {
  editingId: null as string | null,
  fromTable: "",
  fromColumn: "",
  kind: "has_one" as RelationKind,
  toTable: "",
  toColumn: "",
  name: "",
};

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

  const [form, setForm] = useState(BLANK);
  const [editorOpen, setEditorOpen] = useState(false);
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
    setForm(BLANK);
    setEditorOpen(true);
    setAddFocusSignal((n) => n + 1);
  };
  const closeEditor = () => {
    setForm(BLANK);
    setEditorOpen(false);
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

  /**
   * Suggest/validate the to-column against the target table's real columns.
   * Fills the convention column ("id" or "{fromTable}_id") only when it exists;
   * keeps an already-valid selection; never proposes a non-existent column.
   */
  useEffect(() => {
    setForm((f) => {
      if (!f.toTable || toColumns.length === 0) return f;
      if (f.toColumn && toColumns.includes(f.toColumn)) return f;
      const desired =
        f.kind === "has_one" ? "id" : `${singularize(f.fromTable)}_id`;
      const next = toColumns.includes(desired) ? desired : "";
      return next === f.toColumn ? f : { ...f, toColumn: next };
    });
  }, [toColumns, form.kind, form.fromTable]);

  /** Suggest to-column + relation name for the given to-table (Liquid's heuristics). */
  const withToTable = (f: typeof BLANK, toTable: string): typeof BLANK => ({
    ...f,
    toTable,
    // Cleared here; the effect below fills it from the target table's real
    // columns so we never suggest a column that doesn't exist.
    toColumn: "",
    name: toTable ? (f.kind === "has_one" ? singularize(toTable) : toTable) : "",
  });

  const onFromTableChange = (fromTable: string) => {
    if (fromTable === form.fromTable) return;
    setForm({ ...BLANK, fromTable });
  };

  const onFromColumnChange = (fromColumn: string) => {
    if (fromColumn === form.fromColumn) return;
    const kind: RelationKind = fromColumn === "id" ? "has_many" : "has_one";
    let next = { ...form, fromColumn, kind };
    if (kind === "has_one") {
      const suggested = pluralize(fromColumn.replace(/_id$/, ""));
      next = withToTable(next, tables.includes(suggested) ? suggested : "");
    } else {
      next = withToTable(next, "");
    }
    setForm(next);
  };

  const onKindChange = (kind: RelationKind) =>
    setForm(withToTable({ ...form, kind }, form.toTable));

  const onToTableChange = (toTable: string) => {
    if (toTable === form.toTable) return;
    setForm(withToTable(form, toTable));
  };

  const startEdit = (r: Relation) => {
    setForm({
      editingId: r.id,
      fromTable: r.fromTable,
      fromColumn: r.fromColumn,
      kind: r.kind,
      toTable: r.toTable,
      toColumn: r.toColumn,
      name: r.name,
    });
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
      <div className="dbs-toolbar h-9 shrink-0 pl-1 pr-4 flex items-center gap-1 border-b border-zinc-800/60">
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
          <Plus size={17} /> Relation
        </button>
        <span className="ml-auto text-[11px] text-zinc-500">
          {query
            ? `${visibleRelations.length} of ${relations.length}`
            : `${relations.length} defined`}
        </span>
      </div>

      {error && (
        <div className="shrink-0 mx-4 mt-3 rounded bg-rose-950/40 border border-rose-900/60 px-3 py-2 text-[11px] text-rose-300 break-words">
          {error}
        </div>
      )}

      <div className="flex-1 min-h-0 flex">
        <div className="flex-1 min-h-0 flex flex-col">
          <div className="shrink-0 px-4 pt-4 pb-2 flex items-center gap-2">
            <ShareNetwork size={18} className="text-violet-400" />
            <h2 className="text-[16px] font-semibold text-violet-400">
              Relations{" "}
              <span className="font-normal text-zinc-500">— {database}</span>
            </h2>
          </div>
          <div className="flex-1 min-h-0 overflow-auto px-4 pb-4">
          {relations.length === 0 ? (
            <div className="text-[12px] text-zinc-500 py-2">
              No relations defined for this database yet.
            </div>
          ) : visibleRelations.length === 0 ? (
            <div className="text-[12px] text-zinc-500 py-2">
              No relations match “{search.trim()}”.
            </div>
          ) : (
            <ul className="space-y-0.5">
              {visibleRelations.map((r) => {
                const subject = singularize(r.fromTable);
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
                      "group flex items-center gap-2 rounded pl-4 pr-2 py-1.5 cursor-pointer",
                      form.editingId === r.id
                        ? "bg-accent-500/10"
                        : "hover:bg-zinc-800/60"
                    )}
                  >
                    <ShareNetwork
                      size={16}
                      weight="bold"
                      className="shrink-0 text-violet-400"
                    />
                    <span className="truncate text-[13px] font-semibold text-zinc-100">
                      {subject}
                    </span>
                    <span
                      className={clsx(
                        "shrink-0 rounded px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide",
                        r.kind === "has_many"
                          ? "bg-amber-500/15 text-amber-300"
                          : "bg-accent-500/15 text-accent-300"
                      )}
                    >
                      {r.kind === "has_many" ? "has many" : "has one"}
                    </span>
                    <span className="truncate text-[13px] font-semibold text-zinc-100">
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
          <div className="mb-2 flex items-center justify-between">
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
    </div>
  );
}
