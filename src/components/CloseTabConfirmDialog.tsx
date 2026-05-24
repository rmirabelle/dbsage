import { useEffect, useState } from "react";
import {
  Warning,
  FloppyDisk,
  CircleNotch as Loader2,
  X,
} from "@phosphor-icons/react";
import { useStore } from "../state/store";

/**
 * Confirms unsaved changes before a dirty table-designer tab is closed.
 * Driven by the store's `pendingCloseTabId`, which `requestCloseTab` sets only
 * for dirty designer tabs.
 */
export function CloseTabConfirmDialog() {
  const pendingCloseTabId = useStore((s) => s.pendingCloseTabId);
  const tab = useStore((s) =>
    s.tabs.find((t) => t.id === s.pendingCloseTabId)
  );
  const setPendingCloseTabId = useStore((s) => s.setPendingCloseTabId);
  const closeTab = useStore((s) => s.closeTab);
  const saveDesignerTab = useStore((s) => s.saveDesignerTab);

  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  /* Reset transient state each time a new tab enters the pending-close state. */
  useEffect(() => {
    setSaving(false);
    setError(null);
  }, [pendingCloseTabId]);

  const cancel = () => setPendingCloseTabId(null);

  useEffect(() => {
    if (!pendingCloseTabId) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape" && !saving) cancel();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [pendingCloseTabId, saving]);

  if (!pendingCloseTabId || !tab || tab.kind !== "create-table") return null;

  const name =
    tab.mode === "edit"
      ? tab.originalName
      : tab.tableName.trim() || "this new table";

  const discard = () => closeTab(pendingCloseTabId);

  const save = async () => {
    if (saving) return;
    setError(null);
    setSaving(true);
    const res = await saveDesignerTab(pendingCloseTabId);
    if (res.ok) {
      /* A successful save closes the tab (clearing pendingCloseTabId); the
         "no changes" path leaves it open, so dismiss the dialog ourselves. */
      setPendingCloseTabId(null);
    } else {
      if (res.error) setError(res.error);
      setSaving(false);
    }
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm"
      onClick={() => !saving && cancel()}
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
            <h2 className="text-sm font-semibold text-zinc-100">
              Unsaved changes
            </h2>
          </div>
          {!saving && (
            <button
              onClick={cancel}
              className="text-zinc-500 hover:text-zinc-200"
              aria-label="Close"
            >
              <X size={18} />
            </button>
          )}
        </div>

        <div className="px-4 py-4 text-[12px] leading-relaxed text-zinc-300">
          <p>
            You have unsaved changes to{" "}
            <span className="font-mono text-zinc-100">{name}</span>. Do you want
            to save them before closing?
          </p>
          {error && (
            <div className="mt-3 rounded bg-rose-950/40 border border-rose-900/60 px-3 py-2 text-[11px] text-rose-300">
              {error}
            </div>
          )}
        </div>

        <div className="flex items-center justify-between border-t border-zinc-800 px-4 py-3">
          <button
            data-el="close-confirm-cancel"
            onClick={cancel}
            disabled={saving}
            className="px-3 py-1.5 rounded text-[12px] text-zinc-200 bg-zinc-800 hover:bg-zinc-700 disabled:opacity-50"
          >
            Cancel
          </button>
          <div className="flex gap-2">
            <button
              data-el="close-confirm-discard"
              onClick={discard}
              disabled={saving}
              className="px-3 py-1.5 rounded text-[12px] font-semibold bg-rose-900 text-rose-100 hover:bg-rose-800 transition-colors disabled:opacity-50"
            >
              Discard Changes
            </button>
            <button
              data-el="close-confirm-save"
              onClick={save}
              disabled={saving}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded text-[12px] font-semibold bg-accent-500 text-[#042f2e] hover:bg-accent-400 transition-colors disabled:opacity-60 disabled:cursor-not-allowed"
            >
              {saving ? (
                <Loader2 size={14} className="animate-spin" />
              ) : (
                <FloppyDisk size={14} />
              )}
              {saving ? "Saving…" : "Save"}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
