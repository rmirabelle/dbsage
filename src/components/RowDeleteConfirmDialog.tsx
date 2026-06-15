import { useEffect, useState } from "react";
import { useBackdropDismiss } from "../lib/useBackdropDismiss";
import { Warning, Trash, CircleNotch as Loader2, X } from "@phosphor-icons/react";
import { notifyError } from "../state/notify";

interface Props {
  count: number;
  /** Performs the delete; may throw (surfaced as an error toast). */
  onConfirm: () => Promise<void>;
  onClose: () => void;
}

/** Confirms a destructive row delete. Replaces the native `confirm()`, which is
 * unreliable inside WebView2 and visually out of place against the app chrome. */
export function RowDeleteConfirmDialog({ count, onConfirm, onClose }: Props) {
  const [busy, setBusy] = useState(false);

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
      await onConfirm();
      onClose();
    } catch (e) {
      notifyError(`Delete failed: ${String(e)}`);
      setBusy(false);
    }
  };

  const backdrop = useBackdropDismiss(onClose, !busy);

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm"
      {...backdrop}
    >
      <div
        data-el="row-delete-dialog"
        role="dialog"
        aria-modal="true"
        onClick={(e) => e.stopPropagation()}
        className="w-[420px] max-w-[90vw] rounded-lg border border-rose-900/60 bg-zinc-900 shadow-2xl shadow-black/60"
      >
        <div className="flex items-center justify-between px-4 py-3 border-b border-zinc-800">
          <div className="flex items-center gap-2">
            <Warning size={18} weight="fill" className="text-rose-400" />
            <h2 className="text-sm font-semibold text-zinc-100">
              Delete {count} row{count === 1 ? "" : "s"}?
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

        <div className="px-4 py-4 text-[12px] leading-relaxed text-zinc-300">
          <p>
            {count === 1
              ? "This row will be permanently deleted."
              : `These ${count} rows will be permanently deleted.`}{" "}
            <span className="font-semibold text-zinc-100">
              This cannot be undone.
            </span>
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
            data-el="row-delete-confirm-btn"
            onClick={handleConfirm}
            disabled={busy}
            className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded text-[12px] font-semibold bg-rose-500 text-white hover:bg-rose-400 transition-colors disabled:opacity-60 disabled:cursor-not-allowed"
          >
            {busy ? <Loader2 size={14} className="animate-spin" /> : <Trash size={14} />}
            {busy ? "Deleting…" : `Delete ${count === 1 ? "row" : "rows"}`}
          </button>
        </div>
      </div>
    </div>
  );
}
