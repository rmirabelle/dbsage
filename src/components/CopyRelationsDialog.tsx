import { useEffect, useState } from "react";
import { useBackdropDismiss } from "../lib/useBackdropDismiss";
import {
  CheckCircle,
  CircleNotch as Loader2,
  Copy,
  Database,
  PlugsConnected,
  WarningCircle,
  X,
} from "@phosphor-icons/react";
import { ipc } from "../ipc";
import { useStore } from "../state/store";
import { singularize, pluralize } from "../lib/inflector";
import { notifySuccess } from "../state/notify";
import { SearchableSelect } from "./SearchableSelect";
import type { Relation } from "../types";

type SkipReason = "invalid" | "exists";
type Skipped = { relation: Relation; reason: SkipReason };
type CopyResult = { copied: number; targetDatabase: string; skipped: Skipped[] };

interface Props {
  open: boolean;
  sourceProfileId: string;
  sourceDatabase: string;
  /** All relations defined on the source database. */
  relations: Relation[];
  onClose: () => void;
}

/** Subject/object labels matching the way relations render in the list. */
const relLabel = (r: Relation) => ({
  subject: singularize(r.fromTable),
  object:
    r.name.trim() ||
    (r.kind === "has_many"
      ? pluralize(singularize(r.toTable))
      : singularize(r.toTable)),
});

/** Two relations are "the same" by their tables + columns (ignoring name). */
const sameRelation = (a: Relation, b: Relation) =>
  a.fromTable === b.fromTable &&
  a.fromColumn === b.fromColumn &&
  a.toTable === b.toTable &&
  a.toColumn === b.toColumn;

export function CopyRelationsDialog({
  open,
  sourceProfileId,
  sourceDatabase,
  relations,
  onClose,
}: Props) {
  const profiles = useStore((s) => s.profiles);
  const connectProfile = useStore((s) => s.connectProfile);
  const loadRelations = useStore((s) => s.loadRelations);

  const [targetProfileId, setTargetProfileId] = useState(sourceProfileId);
  const [targetDatabase, setTargetDatabase] = useState(sourceDatabase);
  const [databases, setDatabases] = useState<string[]>([]);
  const [loadingDbs, setLoadingDbs] = useState(false);
  const [copying, setCopying] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<CopyResult | null>(null);

  /** Default both selects to the current connection + db each time we open. */
  useEffect(() => {
    if (!open) return;
    setTargetProfileId(sourceProfileId);
    setTargetDatabase(sourceDatabase);
    setError(null);
    setResult(null);
  }, [open, sourceProfileId, sourceDatabase]);

  /** Load the databases for whichever connection is targeted. */
  useEffect(() => {
    if (!open || !targetProfileId) return;
    let cancelled = false;
    setLoadingDbs(true);
    setError(null);
    (async () => {
      try {
        const conn = useStore.getState().connections[targetProfileId];
        if (!conn?.connected) await connectProfile(targetProfileId);
        const dbs = await ipc.listDatabases(targetProfileId);
        if (!cancelled) setDatabases(dbs);
      } catch (e) {
        if (!cancelled) {
          setDatabases([]);
          setError(String(e));
        }
      } finally {
        if (!cancelled) setLoadingDbs(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [open, targetProfileId, connectProfile]);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape" && !copying) onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, copying, onClose]);

  /** Selecting a new connection clears the chosen database. */
  const onConnectionChange = (pid: string) => {
    if (pid === targetProfileId) return;
    setTargetProfileId(pid);
    setTargetDatabase("");
  };

  const isSameAsSource =
    targetProfileId === sourceProfileId && targetDatabase === sourceDatabase;
  const canCopy =
    !!targetDatabase && !isSameAsSource && !copying && relations.length > 0;

  const doCopy = async () => {
    if (!canCopy) return;
    setCopying(true);
    setError(null);
    try {
      const conn = useStore.getState().connections[targetProfileId];
      if (!conn?.connected) await connectProfile(targetProfileId);

      const destTables = new Set(
        (await ipc.listTables(targetProfileId, targetDatabase)).map((t) => t.name)
      );
      const destExisting = await ipc.listRelations(targetProfileId, targetDatabase);

      /** Cache of destination column names per table (null = table absent). */
      const colCache = new Map<string, Set<string> | null>();
      const colsOf = async (table: string): Promise<Set<string> | null> => {
        if (!destTables.has(table)) return null;
        if (!colCache.has(table)) {
          const cols = await ipc.listColumns(targetProfileId, targetDatabase, table);
          colCache.set(table, new Set(cols.map((c) => c.name)));
        }
        return colCache.get(table) ?? null;
      };

      const skipped: Skipped[] = [];
      const toCopy: Relation[] = [];

      for (const r of relations) {
        const fromCols = await colsOf(r.fromTable);
        const toCols = await colsOf(r.toTable);
        const valid =
          !!fromCols &&
          !!toCols &&
          fromCols.has(r.fromColumn) &&
          toCols.has(r.toColumn);
        if (!valid) {
          skipped.push({ relation: r, reason: "invalid" });
          continue;
        }
        const duplicate =
          destExisting.some((e) => sameRelation(e, r)) ||
          toCopy.some((e) => sameRelation(e, r));
        if (duplicate) {
          skipped.push({ relation: r, reason: "exists" });
          continue;
        }
        toCopy.push(r);
      }

      for (const r of toCopy) {
        await ipc.saveRelation({
          profileId: targetProfileId,
          database: targetDatabase,
          id: null,
          fromTable: r.fromTable,
          fromColumn: r.fromColumn,
          toTable: r.toTable,
          toColumn: r.toColumn,
          kind: r.kind,
          name: r.name,
        });
      }

      await loadRelations(targetProfileId, targetDatabase);
      notifySuccess(
        `Copied ${toCopy.length} relation${toCopy.length === 1 ? "" : "s"} to ${targetDatabase}.`
      );
      setResult({ copied: toCopy.length, targetDatabase, skipped });
    } catch (e) {
      setError(String(e));
    } finally {
      setCopying(false);
    }
  };

  const backdrop = useBackdropDismiss(onClose, !copying);

  if (!open) return null;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm"
      {...backdrop}
    >
      <div
        data-el="copy-relations-dialog"
        role="dialog"
        aria-modal="true"
        onClick={(e) => e.stopPropagation()}
        className="w-[480px] max-w-[92vw] rounded-lg border border-zinc-700 bg-zinc-900 shadow-2xl shadow-black/60"
      >
        <div className="flex items-center justify-between px-4 py-3 border-b border-zinc-800">
          <div className="flex items-center gap-2">
            <Copy size={17} weight="bold" className="text-violet-400" />
            <h2 className="text-sm font-semibold text-zinc-100">Copy Relations</h2>
          </div>
          {!copying && (
            <button
              onClick={onClose}
              className="text-zinc-500 hover:text-zinc-200"
              aria-label="Close"
            >
              <X size={18} />
            </button>
          )}
        </div>

        {result ? (
          <>
            <div className="px-4 py-4">
              <div className="flex items-center gap-2 text-[13px] text-zinc-100">
                <CheckCircle size={18} weight="fill" className="text-emerald-400 shrink-0" />
                <span>
                  Copied {result.copied} relation{result.copied === 1 ? "" : "s"} to{" "}
                  <span className="font-semibold">{result.targetDatabase}</span>.
                </span>
              </div>
              {result.skipped.length > 0 && (
                <div className="mt-4">
                  <div className="mb-1.5 text-[11px] font-semibold uppercase tracking-wide text-zinc-500">
                    Not copied ({result.skipped.length})
                  </div>
                  <ul className="max-h-56 overflow-auto rounded border border-zinc-800 divide-y divide-zinc-800/60">
                    {result.skipped.map(({ relation, reason }) => {
                      const { subject, object } = relLabel(relation);
                      return (
                        <li
                          key={relation.id}
                          className="flex items-center gap-2 px-2.5 py-1.5 text-[12px]"
                        >
                          <WarningCircle
                            size={14}
                            className={
                              reason === "invalid"
                                ? "shrink-0 text-rose-400"
                                : "shrink-0 text-amber-400"
                            }
                          />
                          <span className="truncate text-zinc-400">
                            <span className="text-zinc-100">{subject}</span>{" "}
                            {relation.kind === "has_many" ? "has many" : "has one"}{" "}
                            <span className="text-violet-400">{object}</span>
                          </span>
                          <span className="ml-auto shrink-0 text-[10px] text-zinc-500">
                            {reason === "invalid"
                              ? "missing table/column"
                              : "already exists"}
                          </span>
                        </li>
                      );
                    })}
                  </ul>
                </div>
              )}
            </div>
            <div className="flex items-center justify-end border-t border-zinc-800 px-4 py-3">
              <button
                data-el="copy-rel-done"
                onClick={onClose}
                className="px-3 py-1.5 rounded text-[12px] font-semibold bg-accent-500 text-[#042f2e] hover:bg-accent-400"
              >
                Done
              </button>
            </div>
          </>
        ) : (
          <>
            <div className="px-4 py-4 space-y-3">
              <p className="text-[12px] text-zinc-400">
                Copy the {relations.length} relation
                {relations.length === 1 ? "" : "s"} defined on{" "}
                <span className="font-medium text-zinc-200">{sourceDatabase}</span>{" "}
                to another database.
              </p>
              <div className="grid grid-cols-[auto_1fr] items-center gap-x-3 gap-y-2 text-[12px] text-zinc-400">
                <span className="text-right">Connection</span>
                <div className="flex items-center gap-2">
                  <PlugsConnected
                    size={16}
                    weight="fill"
                    className="shrink-0 text-lime-400"
                  />
                  <select
                    data-el="copy-rel-connection"
                    value={targetProfileId}
                    onChange={(e) => onConnectionChange(e.target.value)}
                    disabled={copying}
                    className="flex-1 bg-zinc-950 border border-zinc-700 rounded px-2 py-1 text-[12px] text-zinc-200 outline-none focus:border-accent-500 disabled:opacity-50"
                  >
                    {profiles.map((p) => (
                      <option key={p.id} value={p.id}>
                        {p.name}
                      </option>
                    ))}
                  </select>
                </div>

                <span className="text-right">Database</span>
                <div className="flex items-center gap-2">
                  <Database size={16} className="shrink-0 text-blue-400" />
                  <SearchableSelect
                    dataEl="copy-rel-database"
                    value={targetDatabase}
                    options={databases}
                    placeholder={loadingDbs ? "loading…" : "database…"}
                    disabled={loadingDbs || copying}
                    onChange={setTargetDatabase}
                    className="flex-1"
                  />
                  {loadingDbs && (
                    <Loader2 size={14} className="shrink-0 animate-spin text-zinc-500" />
                  )}
                </div>
              </div>
              {isSameAsSource && (
                <p className="text-[11px] text-zinc-500">
                  Pick a different database (or connection) to copy into.
                </p>
              )}
              {error && (
                <div className="rounded bg-rose-950/40 border border-rose-900/60 px-3 py-2 text-[11px] text-rose-300 break-words">
                  {error}
                </div>
              )}
            </div>
            <div className="flex items-center justify-end gap-2 border-t border-zinc-800 px-4 py-3">
              <button
                onClick={onClose}
                disabled={copying}
                className="px-3 py-1.5 rounded text-[12px] text-zinc-200 bg-zinc-800 hover:bg-zinc-700 disabled:opacity-50"
              >
                Cancel
              </button>
              <button
                data-el="copy-rel-confirm"
                onClick={doCopy}
                disabled={!canCopy}
                className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded text-[12px] font-semibold bg-accent-500 text-[#042f2e] hover:bg-accent-400 disabled:bg-zinc-800 disabled:text-zinc-500 disabled:cursor-not-allowed"
              >
                {copying ? (
                  <Loader2 size={14} className="animate-spin" />
                ) : (
                  <Copy size={14} />
                )}
                {copying ? "Copying…" : "Copy"}
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
