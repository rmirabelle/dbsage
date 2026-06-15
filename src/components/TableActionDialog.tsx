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

export type TableAction = "truncate" | "delete";

interface Props {
  action: TableAction;
  profileId: string;
  database: string;
  table: string;
  onClose: () => void;
}

export function TableActionDialog({
  action,
  profileId,
  database,
  table,
  onClose,
}: Props) {
  const truncateTable = useStore((s) => s.truncateTable);
  const deleteTable = useStore((s) => s.deleteTable);

  const [rowCount, setRowCount] = useState<number | null>(null);
  const [countError, setCountError] = useState(false);
  const [busy, setBusy] = useState(false);

  const isDelete = action === "delete";
  const verb = isDelete ? "Delete" : "Truncate";
  const Icon = isDelete ? Trash : Eraser;

  useEffect(() => {
    let cancelled = false;
    setRowCount(null);
    setCountError(false);
    ipc
      .countRows({ profileId, database, table, filters: [] })
      .then((n) => {
        if (!cancelled) setRowCount(n);
      })
      .catch(() => {
        if (!cancelled) setCountError(true);
      });
    return () => {
      cancelled = true;
    };
  }, [profileId, database, table]);

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
      if (isDelete) {
        await deleteTable(profileId, database, table);
        notifySuccess(`Table "${table}" deleted from ${database}.`);
      } else {
        await truncateTable(profileId, database, table);
        notifySuccess(`Table "${table}" truncated — all rows deleted.`);
      }
      onClose();
    } catch (e) {
      notifyError(`Could not ${verb.toLowerCase()} "${table}": ${String(e)}`);
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
              {verb} table “{table}”?
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
                the table{" "}
                <span className="font-mono text-zinc-100">
                  {database}.{table}
                </span>{" "}
                — its structure and all of its data.
              </>
            ) : (
              <>
                This permanently{" "}
                <span className="font-semibold text-rose-300">deletes every row</span>{" "}
                from{" "}
                <span className="font-mono text-zinc-100">
                  {database}.{table}
                </span>
                . The table structure is kept.
              </>
            )}
          </p>

          <div className="rounded-md border border-zinc-800 bg-zinc-950 px-3 py-2.5">
            <div className="flex items-center gap-2">
              <Icon size={16} className="text-rose-400 shrink-0" />
              <span>
                <span className="font-semibold text-zinc-100">{rowsText}</span> row
                {rowCount === 1 ? "" : "s"} will be permanently deleted.
              </span>
            </div>
            {countError && (
              <div className="mt-1 text-[11px] text-amber-400">
                Couldn’t read the exact row count — proceed with caution.
              </div>
            )}
          </div>

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
            disabled={busy}
            className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded text-[12px] font-semibold bg-rose-500 text-white hover:bg-rose-400 transition-colors disabled:opacity-60 disabled:cursor-not-allowed"
          >
            {busy ? <Loader2 size={14} className="animate-spin" /> : <Icon size={14} />}
            {busy ? `${verb.replace(/e$/, "")}ing…` : `${verb} table`}
          </button>
        </div>
      </div>
    </div>
  );
}
