import { useEffect, type ReactNode } from "react";
import {
  Warning,
  FloppyDisk,
  CircleNotch as Loader2,
  X,
} from "@phosphor-icons/react";

/** Optional Save action (used by the table designer; queries omit it). */
interface SaveAction {
  label?: string;
  saving: boolean;
  error?: string | null;
  onSave: () => void;
}

interface Props {
  title?: string;
  message: ReactNode;
  onCancel: () => void;
  onDiscard: () => void;
  discardLabel?: string;
  save?: SaveAction;
}

/**
 * Presentational "unsaved changes" confirmation modal. Callers wire the
 * behavior: {@link CloseTabConfirmDialog} for in-app tab closes, and the
 * torn-off window for its own OS close. Cancel is disabled while a save runs.
 */
export function UnsavedChangesModal({
  title = "Unsaved changes",
  message,
  onCancel,
  onDiscard,
  discardLabel = "Discard Changes",
  save,
}: Props) {
  const busy = save?.saving ?? false;

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape" && !busy) onCancel();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [busy, onCancel]);

  return (
    <div
      className="fixed inset-0 z-[80] flex items-center justify-center bg-black/60 backdrop-blur-sm"
      onClick={() => !busy && onCancel()}
    >
      <div
        data-el="close-confirm-dialog"
        role="dialog"
        aria-modal="true"
        onClick={(e) => e.stopPropagation()}
        className="w-[440px] max-w-[90vw] rounded-lg border border-zinc-700 bg-zinc-900 shadow-2xl shadow-black/60"
      >
        <div className="flex items-center justify-between px-4 py-3 border-b border-zinc-800">
          <div className="flex items-center gap-2">
            <Warning size={18} weight="fill" className="text-amber-400" />
            <h2 className="text-sm font-semibold text-zinc-100">{title}</h2>
          </div>
          {!busy && (
            <button
              onClick={onCancel}
              className="text-zinc-500 hover:text-zinc-200"
              aria-label="Close"
            >
              <X size={18} />
            </button>
          )}
        </div>

        <div className="px-4 py-4 text-[12px] leading-relaxed text-zinc-300">
          {message}
          {save?.error && (
            <div className="mt-3 rounded bg-rose-950/40 border border-rose-900/60 px-3 py-2 text-[11px] text-rose-300">
              {save.error}
            </div>
          )}
        </div>

        <div className="flex items-center justify-between border-t border-zinc-800 px-4 py-3">
          <button
            data-el="close-confirm-cancel"
            onClick={onCancel}
            disabled={busy}
            className="px-3 py-1.5 rounded text-[12px] text-zinc-200 bg-zinc-800 hover:bg-zinc-700 disabled:opacity-50"
          >
            Cancel
          </button>
          <div className="flex gap-2">
            <button
              data-el="close-confirm-discard"
              onClick={onDiscard}
              disabled={busy}
              className="px-3 py-1.5 rounded text-[12px] font-semibold bg-rose-900 text-rose-100 hover:bg-rose-800 transition-colors disabled:opacity-50"
            >
              {discardLabel}
            </button>
            {save && (
              <button
                data-el="close-confirm-save"
                onClick={save.onSave}
                disabled={busy}
                className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded text-[12px] font-semibold bg-accent-500 text-[#042f2e] hover:bg-accent-400 transition-colors disabled:opacity-60 disabled:cursor-not-allowed"
              >
                {save.saving ? (
                  <Loader2 size={14} className="animate-spin" />
                ) : (
                  <FloppyDisk size={14} />
                )}
                {save.saving ? "Saving…" : save.label ?? "Save"}
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
