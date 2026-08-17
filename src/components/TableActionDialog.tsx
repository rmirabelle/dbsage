import { useEffect, useState } from "react";
import { useBackdropDismiss } from "../lib/useBackdropDismiss";
import {
  Warning,
  Eraser,
  Trash,
  CircleNotch as Loader2,
  X,
} from "@phosphor-icons/react";
import { ipc } from "../ipc";
import { useStore } from "../state/store";
import { notifyError, notifySuccess } from "../state/notify";
import type { TruncateBlocker } from "../types";

export type TableAction = "truncate" | "delete";

interface Props {
  action: TableAction;
  profileId: string;
  database: string;
  /** One or more tables to act on; >1 truncates/deletes every one. */
  tables: string[];
  onClose: () => void;
}

export function TableActionDialog({
  action,
  profileId,
  database,
  tables,
  onClose,
}: Props) {
  const truncateTable = useStore((s) => s.truncateTable);
  const deleteTable = useStore((s) => s.deleteTable);

  const [rowCount, setRowCount] = useState<number | null>(null);
  const [countError, setCountError] = useState(false);
  const [busy, setBusy] = useState(false);
  /**
   * Truncate only: tables holding a foreign key that points at one of ours.
   * `null` while loading; `"error"` when the check itself failed. Any blocker
   * with rows > 0 means the truncate would leave orphans, so it is refused.
   */
  const [blockers, setBlockers] = useState<TruncateBlocker[] | null | "error">(null);

  const isDelete = action === "delete";
  const verb = isDelete ? "Delete" : "Truncate";
  const Icon = isDelete ? Trash : Eraser;
  const multi = tables.length > 1;
  const subject = multi ? `${tables.length} tables` : `“${tables[0]}”`;

  useEffect(() => {
    let cancelled = false;
    setRowCount(null);
    setCountError(false);
    /* Sum the rows across every selected table so the warning reflects the
       whole job. */
    Promise.all(
      tables.map((table) =>
        ipc.countRows({ profileId, database, table, filters: [] })
      )
    )
      .then((counts) => {
        if (!cancelled) setRowCount(counts.reduce((a, b) => a + b, 0));
      })
      .catch(() => {
        if (!cancelled) setCountError(true);
      });
    return () => {
      cancelled = true;
    };
  }, [profileId, database, tables]);

  useEffect(() => {
    if (isDelete) return;
    let cancelled = false;
    setBlockers(null);
    ipc
      .truncateBlockers(profileId, database, tables)
      .then((b) => {
        if (!cancelled) setBlockers(b);
      })
      .catch(() => {
        if (!cancelled) setBlockers("error");
      });
    return () => {
      cancelled = true;
    };
  }, [isDelete, profileId, database, tables]);

  const orphaning =
    Array.isArray(blockers) ? blockers.filter((b) => b.rows > 0) : [];
  const harmlessRefs =
    Array.isArray(blockers) ? blockers.filter((b) => b.rows === 0) : [];
  /* Truncate waits for the FK check and refuses when it fails or finds orphans. */
  const truncateBlocked =
    !isDelete && (blockers === null || blockers === "error" || orphaning.length > 0);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape" && !busy) onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [busy, onClose]);

  const handleConfirm = async () => {
    setBusy(true);
    try {
      for (const table of tables) {
        if (isDelete) {
          await deleteTable(profileId, database, table);
        } else {
          await truncateTable(profileId, database, table);
        }
      }
      notifySuccess(
        isDelete
          ? `${multi ? `${tables.length} tables` : `Table “${tables[0]}”`} deleted from ${database}.`
          : `${multi ? `${tables.length} tables` : `Table “${tables[0]}”`} truncated — all rows deleted.`
      );
      onClose();
    } catch (e) {
      notifyError(`Could not ${verb.toLowerCase()} ${subject}: ${String(e)}`);
      setBusy(false);
    }
  };

  const rowsText =
    rowCount === null
      ? countError
        ? "an unknown number of"
        : "…"
      : rowCount.toLocaleString();

  const backdrop = useBackdropDismiss(onClose, !busy);

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm"
      {...backdrop}
    >
      <div
        data-el="table-action-dialog"
        role="dialog"
        aria-modal="true"
        onClick={(e) => e.stopPropagation()}
        className="w-[460px] max-w-[90vw] rounded-lg border border-rose-900/60 bg-zinc-900 shadow-2xl shadow-black/60"
      >
        <div className="flex items-center justify-between px-4 py-3 border-b border-zinc-800">
          <div className="flex items-center gap-2">
            <Warning size={18} weight="fill" className="text-rose-400" />
            <h2 className="text-sm font-semibold text-zinc-100">
              {verb} {multi ? `${tables.length} tables` : `table ${subject}`}?
            </h2>
          </div>
          {!busy && (
            <button
              onClick={onClose}
              className="text-zinc-500 hover:text-zinc-200"
              aria-label="Close"
            >
              <X size={18} />
            </button>
          )}
        </div>

        <div className="px-4 py-4 space-y-3 text-[12px] leading-relaxed text-zinc-300">
          <p>
            {isDelete ? (
              <>
                This permanently <span className="font-semibold text-rose-300">drops</span>{" "}
                {multi ? "these tables" : "the table"}
                {multi ? (
                  ""
                ) : (
                  <>
                    {" "}
                    <span className="font-mono text-zinc-100">
                      {database}.{tables[0]}
                    </span>
                  </>
                )}{" "}
                — {multi ? "their" : "its"} structure and all of {multi ? "their" : "its"} data.
              </>
            ) : (
              <>
                This permanently{" "}
                <span className="font-semibold text-rose-300">deletes every row</span>{" "}
                from {multi ? "these tables" : (
                  <span className="font-mono text-zinc-100">
                    {database}.{tables[0]}
                  </span>
                )}
                . The table structure is kept.
              </>
            )}
          </p>

          {multi && (
            <div className="max-h-32 overflow-auto rounded-md border border-zinc-800 bg-zinc-950 px-3 py-2 font-mono text-[11px] text-zinc-300">
              {tables.map((t) => (
                <div key={t} className="truncate">
                  {t}
                </div>
              ))}
            </div>
          )}

          <div className="rounded-md border border-zinc-800 bg-zinc-950 px-3 py-2.5">
            <div className="flex items-center gap-2">
              <Icon size={16} className="text-rose-400 shrink-0" />
              <span>
                <span className="font-semibold text-zinc-100">{rowsText}</span> row
                {rowCount === 1 ? "" : "s"} will be permanently deleted
                {multi ? ` across ${tables.length} tables` : ""}.
              </span>
            </div>
            {countError && (
              <div className="mt-1 text-[11px] text-amber-400">
                Couldn’t read the exact row count — proceed with caution.
              </div>
            )}
          </div>

          {orphaning.length > 0 && (
            <div
              data-el="truncate-orphan-block"
              className="rounded-md border border-amber-700/60 bg-amber-950/30 px-3 py-2.5"
            >
              <div className="font-semibold text-amber-300">
                Truncate blocked — rows in other tables point at{" "}
                {multi ? "these tables" : "this table"} and would be orphaned:
              </div>
              <div className="mt-1.5 max-h-40 overflow-auto font-mono text-[11px] text-zinc-200 space-y-0.5">
                {orphaning.map((b) => (
                  <div key={`${b.childSchema}.${b.childTable}.${b.constraint}`} className="flex gap-2">
                    <span className="truncate">
                      {b.childSchema !== database ? `${b.childSchema}.` : ""}
                      {b.childTable}
                      {multi ? <span className="text-zinc-500"> → {b.table}</span> : null}
                    </span>
                    <span className="ml-auto shrink-0 tabular-nums text-amber-200">
                      {b.rows.toLocaleString()} row{b.rows === 1 ? "" : "s"}
                    </span>
                  </div>
                ))}
              </div>
              <div className="mt-1.5 text-[11px] text-zinc-400">
                Delete or truncate those rows first, then try again.
              </div>
            </div>
          )}

          {orphaning.length === 0 && harmlessRefs.length > 0 && (
            <div className="text-[11px] text-zinc-400">
              Referenced by{" "}
              <span className="font-mono text-zinc-300">
                {Array.from(new Set(harmlessRefs.map((b) => b.childTable))).join(", ")}
              </span>{" "}
              — no rows there point here, so nothing will be orphaned.
            </div>
          )}

          {!isDelete && blockers === "error" && (
            <div className="text-[11px] text-amber-400">
              Couldn’t check foreign keys that point at {multi ? "these tables" : "this table"},
              so the truncate is not allowed.
            </div>
          )}

          <p className="text-[11px] text-rose-300/90">
            This action cannot be undone.
          </p>
        </div>

        <div className="flex justify-end gap-2 border-t border-zinc-800 px-4 py-3">
          <button
            onClick={onClose}
            disabled={busy}
            className="px-3 py-1.5 rounded text-[12px] text-zinc-200 bg-zinc-800 hover:bg-zinc-700 disabled:opacity-50"
          >
            Cancel
          </button>
          <button
            data-el="table-action-confirm-btn"
            onClick={handleConfirm}
            disabled={busy || truncateBlocked}
            title={
              orphaning.length > 0
                ? "Rows in other tables would be orphaned"
                : undefined
            }
            className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded text-[12px] font-semibold bg-rose-500 text-white hover:bg-rose-400 transition-colors disabled:opacity-60 disabled:cursor-not-allowed"
          >
            {busy || (!isDelete && blockers === null) ? (
              <Loader2 size={14} className="animate-spin" />
            ) : (
              <Icon size={14} />
            )}
            {busy
              ? `${verb.replace(/e$/, "")}ing…`
              : `${verb} ${multi ? `${tables.length} tables` : "table"}`}
          </button>
        </div>
      </div>
    </div>
  );
}
