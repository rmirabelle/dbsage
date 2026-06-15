import { useEffect, useState } from "react";
import { useBackdropDismiss } from "../lib/useBackdropDismiss";
import { Warning, Trash, CircleNotch as Loader2, X } from "@phosphor-icons/react";
import { ipc } from "../ipc";
import { useStore } from "../state/store";
import { notifyError } from "../state/notify";

export function DropDatabaseDialog({
  profileId,
  database,
  onClose,
}: {
  profileId: string;
  database: string;
  onClose: () => void;
}) {
  const dropDatabase = useStore((s) => s.dropDatabase);
  const [tableCount, setTableCount] = useState<number | null>(null);
  const [countError, setCountError] = useState(false);
  const [confirmText, setConfirmText] = useState("");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    let cancelled = false;
    setTableCount(null);
    setCountError(false);
    ipc
      .listTables(profileId, database)
      .then((ts) => {
        if (!cancelled) setTableCount(ts.length);
      })
      .catch(() => {
        if (!cancelled) setCountError(true);
      });
    return () => {
      cancelled = true;
    };
  }, [profileId, database]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape" && !busy) onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [busy, onClose]);

  const confirmed = confirmText.trim() === database;

  const handleConfirm = async () => {
    if (!confirmed || busy) return;
    setBusy(true);
    try {
      await dropDatabase(profileId, database);
      onClose();
    } catch (e) {
      notifyError(`Could not drop "${database}": ${String(e)}`);
      setBusy(false);
    }
  };

  const tablesText =
    tableCount === null
      ? countError
        ? "an unknown number of"
        : "…"
      : tableCount.toLocaleString();

  const backdrop = useBackdropDismiss(onClose, !busy);

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm"
      {...backdrop}
    >
      <div
        data-el="drop-database-dialog"
        role="dialog"
        aria-modal="true"
        onClick={(e) => e.stopPropagation()}
        className="w-[480px] max-w-[90vw] rounded-lg border border-rose-900/60 bg-zinc-900 shadow-2xl shadow-black/60"
      >
        <div className="flex items-center justify-between px-4 py-3 border-b border-zinc-800">
          <div className="flex items-center gap-2">
            <Warning size={18} weight="fill" className="text-rose-400" />
            <h2 className="text-sm font-semibold text-zinc-100">
              Drop database “{database}”?
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
            This permanently{" "}
            <span className="font-semibold text-rose-300">drops</span> the
            database{" "}
            <span className="font-mono text-zinc-100">{database}</span> — every
            table, view, and all of its data.
          </p>

          <div className="rounded-md border border-rose-900/50 bg-rose-950/30 px-3 py-2.5">
            <div className="flex items-center gap-2">
              <Trash size={16} className="text-rose-400 shrink-0" />
              <span>
                <span className="font-semibold text-zinc-100">{tablesText}</span>{" "}
                table{tableCount === 1 ? "" : "s"} will be permanently destroyed.
              </span>
            </div>
            {countError && (
              <div className="mt-1 text-[11px] text-amber-400">
                Couldn’t read the table list — proceed with extreme caution.
              </div>
            )}
          </div>

          <p className="text-[11px] font-semibold text-rose-300/90">
            This action cannot be undone.
          </p>

          <div className="space-y-1.5 pt-1">
            <label
              htmlFor="drop-db-confirm"
              className="block text-[11px] text-zinc-400"
            >
              Type <span className="font-mono text-zinc-200">{database}</span> to
              confirm:
            </label>
            <input
              id="drop-db-confirm"
              data-el="drop-database-confirm-input"
              autoFocus
              value={confirmText}
              onChange={(e) => setConfirmText(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter" && confirmed) {
                  e.preventDefault();
                  handleConfirm();
                }
              }}
              disabled={busy}
              placeholder={database}
              className="w-full bg-zinc-950 border border-zinc-700 rounded px-2 py-1.5 text-[13px] font-mono text-zinc-100 outline-none focus:border-rose-500 disabled:opacity-50"
            />
          </div>
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
            data-el="drop-database-confirm-btn"
            onClick={handleConfirm}
            disabled={!confirmed || busy}
            className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded text-[12px] font-semibold bg-rose-500 text-white hover:bg-rose-400 transition-colors disabled:bg-zinc-800 disabled:text-zinc-500 disabled:cursor-not-allowed"
          >
            {busy ? (
              <Loader2 size={14} className="animate-spin" />
            ) : (
              <Trash size={14} />
            )}
            {busy ? "Dropping…" : "Drop database"}
          </button>
        </div>
      </div>
    </div>
  );
}
