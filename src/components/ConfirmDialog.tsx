import { useEffect, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { Warning, X } from "@phosphor-icons/react";
import clsx from "clsx";
import { useBackdropDismiss } from "../lib/useBackdropDismiss";

/**
 * A small themed yes/no confirmation. Replaces the native `confirm()`, which
 * is unreliable inside WebView2 and out of place against the app chrome.
 * Escape and a click on the backdrop cancel; Enter confirms.
 */
export function ConfirmDialog({
  title,
  message,
  confirmLabel = "Delete",
  danger = true,
  onConfirm,
  onCancel,
}: {
  title: string;
  message: ReactNode;
  confirmLabel?: string;
  /** Rose confirm button for destructive actions (default); accent otherwise. */
  danger?: boolean;
  onConfirm: () => void;
  onCancel: () => void;
}) {
  const backdrop = useBackdropDismiss(onCancel);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        /* Also stop the host dialog's own window-level Escape handler. */
        e.stopImmediatePropagation();
        onCancel();
      } else if (e.key === "Enter") {
        e.preventDefault();
        onConfirm();
      }
    };
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, [onCancel, onConfirm]);

  return createPortal(
    <div
      className="fixed inset-0 z-[90] flex items-center justify-center bg-black/60 backdrop-blur-sm"
      {...backdrop}
    >
      <div
        data-el="confirm-dialog"
        role="dialog"
        aria-modal="true"
        onClick={(e) => e.stopPropagation()}
        className="w-[400px] max-w-[90vw] rounded-lg border border-zinc-700 bg-zinc-900 shadow-2xl shadow-black/60"
      >
        <div className="flex items-center justify-between px-4 py-3 border-b border-zinc-800">
          <div className="flex items-center gap-2">
            <Warning size={18} weight="fill" className="text-amber-400" />
            <h2 className="text-sm font-semibold text-zinc-100">{title}</h2>
          </div>
          <button
            onClick={onCancel}
            className="text-zinc-500 hover:text-zinc-200"
            aria-label="Close"
          >
            <X size={18} />
          </button>
        </div>
        <div className="px-4 py-4 text-[12px] leading-relaxed text-zinc-300">
          {message}
        </div>
        <div className="flex justify-end gap-2 border-t border-zinc-800 px-4 py-3">
          <button
            onClick={onCancel}
            className="px-3 py-1.5 rounded text-[12px] text-zinc-200 bg-zinc-800 hover:bg-zinc-700"
          >
            Cancel
          </button>
          <button
            data-el="confirm-dialog-confirm"
            autoFocus
            onClick={onConfirm}
            className={clsx(
              "px-3 py-1.5 rounded text-[12px] font-semibold transition-colors",
              danger
                ? "bg-rose-500 text-white hover:bg-rose-400"
                : "bg-accent-500 text-[#042f2e] hover:bg-accent-400"
            )}
          >
            {confirmLabel}
          </button>
        </div>
      </div>
    </div>,
    document.body
  );
}
