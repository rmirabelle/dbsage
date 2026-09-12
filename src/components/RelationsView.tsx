import { helpHandlers } from "../state/help";
import { useEffect, useMemo, useRef, useState } from "react";
import {
  Trash,
  Copy,
  DownloadSimple,
  UploadSimple,
  ArrowsClockwise,
  ShareNetwork,
  Warning,
  CircleNotch as Loader2,
  X,
  MagnifyingGlass,
} from "@phosphor-icons/react";
import { open, save } from "@tauri-apps/plugin-dialog";
import clsx from "clsx";
import { ipc } from "../ipc";
import { singularize, pluralize } from "../lib/inflector";
import { useStore } from "../state/store";
import { CopyRelationsDialog } from "./CopyRelationsDialog";
import { RelationEditDialog } from "./RelationEditDialog";
import { notifySuccess, notifyInfo } from "../state/notify";
import type {
  Relation,
  RelationsImportPreview,
  RelationsTab,
} from "../types";

const EMPTY_RELATIONS: Relation[] = [];
const RELATIONS_FILE_FILTER = [
  { name: "DB Sage Relations", extensions: ["json"] },
];

export function RelationsView({ tab }: { tab: RelationsTab }) {
  const { profileId, database } = tab;

  const [error, setError] = useState<string | null>(null);

  const relations =
    useStore((s) => s.relations[`${profileId}::${database}`]) ??
    EMPTY_RELATIONS;
  const loadRelations = useStore((s) => s.loadRelations);
  const deleteRelationDef = useStore((s) => s.deleteRelation);

  const [relationDialog, setRelationDialog] = useState<
    Relation | "new" | null
  >(null);
  const [copyOpen, setCopyOpen] = useState(false);
  const [clearOpen, setClearOpen] = useState(false);
  const [clearing, setClearing] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [exporting, setExporting] = useState(false);
  const [importing, setImporting] = useState(false);
  const [pendingImport, setPendingImport] = useState<{
    path: string;
    preview: RelationsImportPreview;
  } | null>(null);
  const [search, setSearch] = useState("");
  const searchRef = useRef<HTMLInputElement>(null);
  /** Table shown in the middle column; null until the user picks one. */
  const [target, setTarget] = useState<string | null>(null);

  /** Focus search on mount — covers both opening and re-focusing the tab, since
   * switching to this tab remounts the view. */
  useEffect(() => {
    searchRef.current?.focus();
  }, []);
  const openAdd = () => setRelationDialog("new");

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

  const onExport = async () => {
    if (exporting || importing) return;
    const path = await save({
      defaultPath: `${database}-relations.json`,
      filters: RELATIONS_FILE_FILTER,
    });
    if (!path) return;

    setExporting(true);
    setError(null);
    try {
      const count = await ipc.exportRelationsFile(profileId, database, path);
      notifySuccess(
        `Exported ${count} relation${count === 1 ? "" : "s"} from ${database}.`
      );
    } catch (e) {
      setError(String(e));
    } finally {
      setExporting(false);
    }
  };

  const onChooseImport = async () => {
    if (exporting || importing) return;
    const picked = await open({
      multiple: false,
      filters: RELATIONS_FILE_FILTER,
    });
    if (typeof picked !== "string") return;

    setError(null);
    try {
      const preview = await ipc.previewRelationsImport(picked);
      setPendingImport({ path: picked, preview });
    } catch (e) {
      setError(String(e));
    }
  };

  const onConfirmImport = async () => {
    if (!pendingImport || importing) return;
    setImporting(true);
    setError(null);
    try {
      const count = await ipc.importRelationsFile(
        profileId,
        database,
        pendingImport.path
      );
      await loadRelations(profileId, database);
      setRelationDialog(null);
      setPendingImport(null);
      notifySuccess(
        `Imported ${count} relation${count === 1 ? "" : "s"} into ${database}.`
      );
    } catch (e) {
      setPendingImport(null);
      setError(String(e));
    } finally {
      setImporting(false);
    }
  };

  const byName = (a: string, b: string) =>
    a.localeCompare(b, undefined, { sensitivity: "base" });

  /** Every table that takes part in at least one relation, with in/out counts. */
  const graphTables = useMemo(() => {
    const map = new Map<string, { name: string; incoming: number; outgoing: number }>();
    const get = (name: string) => {
      let t = map.get(name);
      if (!t) {
        t = { name, incoming: 0, outgoing: 0 };
        map.set(name, t);
      }
      return t;
    };
    for (const r of relations) {
      get(r.fromTable).outgoing++;
      get(r.toTable).incoming++;
    }
    return [...map.values()].sort((a, b) => byName(a.name, b.name));
  }, [relations]);

  const query = search.trim().toLowerCase();
  const visibleTables = useMemo(
    () =>
      query
        ? graphTables.filter((t) => t.name.toLowerCase().includes(query))
        : graphTables,
    [graphTables, query]
  );

  /** The table shown in the middle column; falls back to the first table. */
  const selected = useMemo(() => {
    if (target && graphTables.some((t) => t.name === target)) return target;
    return graphTables[0]?.name ?? null;
  }, [target, graphTables]);

  const relationLabel = (r: Relation) =>
    r.name.trim() ||
    (r.kind === "has_many"
      ? pluralize(singularize(r.toTable))
      : singularize(r.toTable));

  /** Relations whose target is the selected table (left column). */
  const incoming = useMemo(
    () =>
      relations
        .filter((r) => r.toTable === selected)
        .sort((a, b) => byName(a.fromTable, b.fromTable) || byName(relationLabel(a), relationLabel(b))),
    [relations, selected]
  );

  /** Relations whose source is the selected table (right column). */
  const outgoing = useMemo(
    () =>
      relations
        .filter((r) => r.fromTable === selected)
        .sort((a, b) => byName(a.toTable, b.toTable) || byName(relationLabel(a), relationLabel(b))),
    [relations, selected]
  );

  const selectTable = (name: string) => setTarget(name);

  /**
   * Follow a relation to a neighbouring table. Clears the search so the
   * new target is guaranteed to be in the middle list.
   */
  const followTo = (name: string) => {
    setSearch("");
    setTarget(name);
  };

  /** Keep the selected table visible in the middle list. */
  const tablesRef = useRef<HTMLUListElement>(null);
  useEffect(() => {
    if (!selected) return;
    tablesRef.current
      ?.querySelector<HTMLElement>(`[data-table="${CSS.escape(selected)}"]`)
      ?.scrollIntoView({ block: "nearest" });
  }, [selected, visibleTables]);

  useEffect(() => {
    loadRelations(profileId, database).catch((e) => setError(String(e)));
  }, [profileId, database, loadRelations]);

  const onDelete = async (id: string) => {
    try {
      await deleteRelationDef(profileId, database, id);
    } catch (e) {
      setError(String(e));
    }
  };

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
          className="inline-flex items-center gap-1.5 px-2 py-1 rounded font-semibold bg-violet-500 text-white hover:bg-violet-400 transition-colors"
          {...helpHandlers("Add a relation")}
        >
          <span className="relative -top-px text-[19px] leading-none">+</span> Relation
        </button>
        <span className="ml-1 text-[11px] text-zinc-500">
          {query
            ? `${visibleTables.length} of ${graphTables.length} tables`
            : `${relations.length} defined`}
        </span>
        <button
          data-el="copy-relations-btn"
          onClick={() => setCopyOpen(true)}
          disabled={relations.length === 0}
          className="ml-auto inline-flex items-center gap-1.5 px-2 py-1 rounded font-semibold bg-zinc-800 text-zinc-200 hover:bg-zinc-700 transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
          {...helpHandlers("Copy these relations to another database")}
        >
          <Copy size={14} /> Copy All
        </button>
        <button
          data-el="clear-relations-btn"
          onClick={() => setClearOpen(true)}
          disabled={relations.length === 0}
          className="inline-flex items-center gap-1.5 px-2 py-1 rounded font-semibold bg-zinc-800 text-zinc-200 hover:bg-zinc-700 transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
          {...helpHandlers("Delete all relations for this database")}
        >
          <Trash size={14} /> Clear All
        </button>
        <button
          data-el="refresh-relations-btn"
          onClick={onRefresh}
          disabled={refreshing}
          className="inline-flex items-center justify-center p-1.5 rounded bg-zinc-800 text-zinc-200 hover:bg-zinc-700 transition-colors disabled:opacity-50"
          {...helpHandlers("Refresh relations")}
          aria-label="Refresh relations"
        >
          <ArrowsClockwise size={15} className={refreshing ? "animate-spin" : undefined} />
        </button>
        <button
          data-el="export-relations-btn"
          onClick={onExport}
          disabled={exporting || importing}
          className="inline-flex items-center gap-1.5 px-2 py-1 rounded font-semibold bg-zinc-800 text-zinc-200 hover:bg-zinc-700 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
          {...helpHandlers("Export relations to a file")}
        >
          {exporting ? (
            <Loader2 size={14} className="animate-spin" />
          ) : (
            <DownloadSimple size={14} />
          )}
          Export
        </button>
        <button
          data-el="import-relations-btn"
          onClick={onChooseImport}
          disabled={exporting || importing}
          className="inline-flex items-center gap-1.5 px-2 py-1 rounded font-semibold bg-zinc-800 text-zinc-200 hover:bg-zinc-700 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
          {...helpHandlers("Import relations from a file")}
        >
          <UploadSimple size={14} /> Import
        </button>
      </div>

      {error && (
        <div className="shrink-0 mx-4 mt-3 rounded bg-rose-950/40 border border-rose-900/60 px-3 py-2 text-[11px] text-rose-300 break-words">
          {error}
        </div>
      )}

      <div data-el="relations-body" className="relations-explorer flex-1 min-h-0 flex flex-col bg-[#1d2029]">
        {relations.length === 0 ? (
          <div className="text-[12px] text-zinc-500 px-4 py-4">
            No relations defined for this database yet.
          </div>
        ) : (
          <>
            <div className="explorer-columns">
              <section className="explorer-col" data-el="relations-incoming">
                <header>
                  <span>Incoming</span>
                  <span className="count">{incoming.length}</span>
                </header>
                <ul>
                  {incoming.length === 0 && (
                    <li className="empty">No relations point to {selected}.</li>
                  )}
                  {incoming.map((r) => (
                    <RelationRow
                      key={r.id}
                      relation={r}
                      neighbour={r.fromTable}
                      side="incoming"
                      label={relationLabel(r)}
                      onFollow={() => followTo(r.fromTable)}
                      onEdit={() => setRelationDialog(r)}
                      onDelete={() => onDelete(r.id)}
                    />
                  ))}
                </ul>
              </section>

              <section className="explorer-col is-middle" data-el="relations-tables">
                <header>
                  <span>Tables</span>
                  <span className="count">{visibleTables.length}</span>
                </header>
                <ul ref={tablesRef}>
                  {visibleTables.length === 0 && (
                    <li className="empty">No tables match "{search.trim()}".</li>
                  )}
                  {visibleTables.map((t) => (
                    <li
                      key={t.name}
                      data-el="relation-table-row"
                      data-table={t.name}
                      className={clsx("table-row", t.name === selected && "is-selected")}
                      onClick={() => selectTable(t.name)}
                    >
                      <ShareNetwork size={14} weight="bold" className="shrink-0 text-violet-400" />
                      <span className="name">{t.name}</span>
                      <span className="counts" title="incoming / outgoing">
                        {t.incoming} / {t.outgoing}
                      </span>
                    </li>
                  ))}
                </ul>
              </section>

              <section className="explorer-col" data-el="relations-outgoing">
                <header>
                  <span>Outgoing</span>
                  <span className="count">{outgoing.length}</span>
                </header>
                <ul>
                  {outgoing.length === 0 && (
                    <li className="empty">{selected} has no relations.</li>
                  )}
                  {outgoing.map((r) => (
                    <RelationRow
                      key={r.id}
                      relation={r}
                      neighbour={r.toTable}
                      side="outgoing"
                      label={relationLabel(r)}
                      onFollow={() => followTo(r.toTable)}
                      onEdit={() => setRelationDialog(r)}
                      onDelete={() => onDelete(r.id)}
                    />
                  ))}
                </ul>
              </section>
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

      {relationDialog && (
        <RelationEditDialog
          key={relationDialog === "new" ? "new" : relationDialog.id}
          profileId={profileId}
          database={database}
          relation={relationDialog === "new" ? null : relationDialog}
          onClose={() => setRelationDialog(null)}
          onSaved={() => setRelationDialog(null)}
          onDeleted={() => setRelationDialog(null)}
        />
      )}

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

      {pendingImport && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm"
          onClick={() => !importing && setPendingImport(null)}
        >
          <div
            data-el="import-relations-dialog"
            role="dialog"
            aria-modal="true"
            onClick={(e) => e.stopPropagation()}
            className="w-[460px] max-w-[90vw] rounded-lg border border-zinc-700 bg-zinc-900 shadow-2xl shadow-black/60"
          >
            <div className="flex items-center justify-between px-4 py-3 border-b border-zinc-800">
              <div className="flex items-center gap-2">
                <Warning size={18} weight="fill" className="text-amber-400" />
                <h2 className="text-sm font-semibold text-zinc-100">
                  Overwrite existing relations?
                </h2>
              </div>
              {!importing && (
                <button
                  onClick={() => setPendingImport(null)}
                  className="text-zinc-500 hover:text-zinc-200"
                  aria-label="Close"
                >
                  <X size={18} />
                </button>
              )}
            </div>

            <div className="px-4 py-4 space-y-3 text-[12px] leading-relaxed text-zinc-300">
              <p>
                Import{" "}{pendingImport.preview.count}{" "}
                relation{pendingImport.preview.count === 1 ? "" : "s"} from{" "}
                <span className="font-mono text-zinc-100">
                  {pendingImport.preview.database}
                </span>{" "}
                into{" "}
                <span className="font-mono text-zinc-100">{database}</span>?
              </p>
              <p className="text-amber-300">
                This will overwrite all {relations.length} existing relation
                {relations.length === 1 ? "" : "s"} in {database}. This cannot
                be undone.
              </p>
              <p className="break-all text-[11px] text-zinc-500">
                {pendingImport.path}
              </p>
            </div>

            <div className="flex items-center justify-end gap-2 border-t border-zinc-800 px-4 py-3">
              <button
                onClick={() => setPendingImport(null)}
                disabled={importing}
                className="px-3 py-1.5 rounded text-[12px] text-zinc-200 bg-zinc-800 hover:bg-zinc-700 disabled:opacity-50"
              >
                Cancel
              </button>
              <button
                data-el="import-relations-confirm"
                onClick={onConfirmImport}
                disabled={importing}
                className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded text-[12px] font-semibold bg-amber-500 text-amber-950 hover:bg-amber-400 transition-colors disabled:opacity-60 disabled:cursor-not-allowed"
              >
                {importing ? (
                  <Loader2 size={14} className="animate-spin" />
                ) : (
                  <UploadSimple size={14} />
                )}
                {importing ? "Importing…" : "Overwrite & Import"}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

/**
 * One relation in the Incoming or Outgoing column. Clicking the row edits the
 * relation; clicking the neighbouring table name follows it in the graph.
 */
function RelationRow({
  relation,
  neighbour,
  side,
  label,
  onFollow,
  onEdit,
  onDelete,
}: {
  relation: Relation;
  neighbour: string;
  side: "incoming" | "outgoing";
  label: string;
  onFollow: () => void;
  onEdit: () => void;
  onDelete: () => void;
}) {
  const kind = (
    <span className={clsx("kind", relation.kind === "has_many" ? "is-many" : "is-one")}>
      {relation.kind === "has_many" ? "has many" : "has one"}
    </span>
  );
  const table = (
    <button
      className="neighbour"
      title={`Go to ${neighbour}`}
      onClick={(e) => {
        e.stopPropagation();
        onFollow();
      }}
    >
      {neighbour}
    </button>
  );
  return (
    <li data-el="relation-row" className="relation-row" onClick={onEdit} title="Edit relation">
      {side === "incoming" ? (
        <>
          {table}
          {kind}
          <span className="label">{label}</span>
        </>
      ) : (
        <>
          {kind}
          <span className="label">{label}</span>
          {table}
        </>
      )}
      <button
        data-el="relation-delete-btn"
        onClick={(e) => {
          e.stopPropagation();
          onDelete();
        }}
        className="delete"
        aria-label="Delete relation"
      >
        <Trash size={13} />
      </button>
    </li>
  );
}
