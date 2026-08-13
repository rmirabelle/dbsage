import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { useBackdropDismiss } from "../lib/useBackdropDismiss";
import { Warning, Trash, CircleNotch as Loader2, X } from "@phosphor-icons/react";
import { notifyError } from "../state/notify";
import type { CascadeTarget } from "../types";

interface Props {
  count: number;
  /** Fetches the related-row cascade preview (targets with count > 0 only).
   * Absent = the host has no relations to cascade into; no section shows. */
  cascadePreview?: () => Promise<CascadeTarget[]>;
  /** Performs the delete; may throw (surfaced as an error toast). Receives the
   * cascade targets to also delete, or null when cascade is off/unavailable. */
  onConfirm: (cascade: CascadeTarget[] | null) => Promise<void>;
  onClose: () => void;
}

/** Confirms a destructive row delete. Replaces the native `confirm()`, which is
 * unreliable inside WebView2 and visually out of place against the app chrome.
 * When the host supplies a cascade preview and related rows exist, the dialog
 * also offers to delete those related rows in the same operation. */
export function RowDeleteConfirmDialog({
  count,
  cascadePreview,
  onConfirm,
  onClose,
}: Props) {
  const [busy, setBusy] = useState(false);
  /** null while the preview is loading; [] = nothing to cascade. */
  const [targets, setTargets] = useState<CascadeTarget[] | null>(
    cascadePreview ? null : []
  );
  const [cascade, setCascade] = useState(false);

  useEffect(() => {
    if (!cascadePreview) return;
    let cancelled = false;
    cascadePreview()
      .then((t) => {
        if (!cancelled) setTargets(t);
      })
      .catch(() => {
        /* A failed preview must not block the plain delete. */
        if (!cancelled) setTargets([]);
      });
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

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
      await onConfirm(cascade && targets && targets.length > 0 ? targets : null);
      onClose();
    } catch (e) {
      notifyError(`Delete failed: ${String(e)}`);
      setBusy(false);
    }
  };

  const backdrop = useBackdropDismiss(onClose, !busy);
  const relatedTotal = (targets ?? []).reduce((a, t) => a + t.count, 0);

  /* Portaled to <body>: the DataGrid scroller uses `contain: strict`, which
     turns it into the containing block for fixed-position descendants and
     paint-clips them — rendered in place, this overlay ends up positioned and
     clipped inside the scrolling grid content instead of covering the window. */
  return createPortal(
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

          {targets === null && (
            <div className="mt-3 flex items-center gap-2 text-zinc-500">
              <Loader2 size={13} className="animate-spin" /> Checking related
              rows…
            </div>
          )}

          {targets && targets.length > 0 && (
            <div
              data-el="cascade-section"
              className="mt-3 rounded border border-zinc-800 bg-zinc-950/60 px-3 py-2"
            >
              <label className="flex items-center gap-2 cursor-pointer select-none">
                <input
                  type="checkbox"
                  checked={cascade}
                  disabled={busy}
                  onChange={(e) => setCascade(e.target.checked)}
                  className="accent-rose-500"
                />
                <span className="font-semibold text-zinc-100">
                  Cascade: also delete related rows
                </span>
              </label>
              <ul className="mt-1.5 space-y-0.5">
                {targets.map((t) => (
                  <li
                    key={`${t.table}::${t.column}`}
                    className="flex items-baseline gap-1.5 pl-6"
                  >
                    <span className="font-medium text-zinc-200">{t.table}</span>
                    <span className="font-mono text-zinc-500">.{t.column}</span>
                    <span className="ml-auto text-zinc-400">
                      {t.count} row{t.count === 1 ? "" : "s"}
                    </span>
                  </li>
                ))}
              </ul>
            </div>
          )}
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
            {busy
              ? "Deleting…"
              : cascade && relatedTotal > 0
                ? `Delete ${count === 1 ? "row" : "rows"} + ${relatedTotal} related`
                : `Delete ${count === 1 ? "row" : "rows"}`}
          </button>
        </div>
      </div>
    </div>,
    document.body
  );
}
