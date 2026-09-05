import { useEffect, useState } from "react";
import { Warning, X } from "@phosphor-icons/react";
import { useStore } from "../state/store";
import { ipc } from "../ipc";
import { useBackdropDismiss } from "../lib/useBackdropDismiss";
import { UnsavedChangesModal } from "./UnsavedChangesModal";

/**
 * Confirms unsaved changes before a dirty tab is closed in the main window.
 * Driven by the store's `pendingCloseTabId`, which `requestCloseTab` sets for a
 * dirty table-designer tab (offers Save) or a dirty query tab (discard only —
 * saving a query needs a name, done from the editor's Save menu).
 */
export function CloseTabConfirmDialog() {
  const pendingCloseTabId = useStore((s) => s.pendingCloseTabId);
  const pendingClosePeekLabels = useStore((s) => s.pendingClosePeekLabels);
  const tab = useStore((s) => s.tabs.find((t) => t.id === s.pendingCloseTabId));
  const setPendingCloseTabId = useStore((s) => s.setPendingCloseTabId);
  const closeTab = useStore((s) => s.closeTab);
  const saveDesignerTab = useStore((s) => s.saveDesignerTab);
  const peekBackdrop = useBackdropDismiss(
    () => setPendingCloseTabId(null),
    !!pendingCloseTabId && tab?.kind === "rows"
  );

  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  /* Reset transient state each time a new tab enters the pending-close state. */
  useEffect(() => {
    setSaving(false);
    setError(null);
  }, [pendingCloseTabId]);

  if (
    !pendingCloseTabId ||
    !tab ||
    (tab.kind !== "create-table" && tab.kind !== "query" && tab.kind !== "rows")
  ) {
    return null;
  }

  const cancel = () => setPendingCloseTabId(null);
  const discard = () => closeTab(pendingCloseTabId);

  /* A rows tab closing while peek windows launched from it are open. */
  if (tab.kind === "rows") {
    const count = pendingClosePeekLabels.length;
    const closeWithPeeks = () => {
      ipc.closePeeks(pendingClosePeekLabels).catch(() => {});
      closeTab(pendingCloseTabId);
    };
    return (
      <div
        className="fixed inset-0 z-[80] flex items-center justify-center bg-black/60 backdrop-blur-sm"
        {...peekBackdrop}
      >
        <div
          data-el="close-tab-peeks-dialog"
          role="dialog"
          aria-modal="true"
          onClick={(e) => e.stopPropagation()}
          className="w-[420px] max-w-[90vw] rounded-lg border border-zinc-700 bg-zinc-900 shadow-2xl shadow-black/60"
        >
          <div className="flex items-center justify-between px-4 py-3 border-b border-zinc-800">
            <div className="flex items-center gap-2">
              <Warning size={18} weight="fill" className="text-amber-400" />
              <h2 className="text-sm font-semibold text-zinc-100">
                Close peek windows too?
              </h2>
            </div>
            <button
              onClick={cancel}
              className="text-zinc-500 hover:text-zinc-200"
              aria-label="Close"
            >
              <X size={18} />
            </button>
          </div>
          <div className="px-4 py-4 text-[12px] leading-relaxed text-zinc-300">
            <span className="font-semibold text-zinc-100">
              {count} peek window{count === 1 ? "" : "s"}
            </span>{" "}
            {count === 1 ? "was" : "were"} opened from{" "}
            <span className="font-mono text-zinc-100">{tab.table}</span>. Close{" "}
            {count === 1 ? "it" : "them"} along with the tab, or keep{" "}
            {count === 1 ? "it" : "them"} open?
          </div>
          <div className="flex justify-end gap-2 border-t border-zinc-800 px-4 py-3">
            <button
              onClick={cancel}
              className="mr-auto px-3 py-1.5 rounded text-[12px] text-zinc-200 bg-zinc-800 hover:bg-zinc-700"
            >
              Cancel
            </button>
            <button
              data-el="close-tab-keep-peeks-btn"
              onClick={discard}
              className="px-3 py-1.5 rounded text-[12px] font-semibold bg-zinc-700 text-zinc-100 hover:bg-zinc-600 transition-colors"
            >
              Keep Peeks
            </button>
            <button
              data-el="close-tab-with-peeks-btn"
              onClick={closeWithPeeks}
              className="px-3 py-1.5 rounded text-[12px] font-semibold bg-rose-500 text-white hover:bg-rose-400 transition-colors"
            >
              Close Peeks
            </button>
          </div>
        </div>
      </div>
    );
  }

  const saveDesigner = async () => {
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

  if (tab.kind === "query") {
    return (
      <UnsavedChangesModal
        message={
          <p>
            This query has unsaved changes. Close the tab without saving them?
          </p>
        }
        discardLabel="Close Without Saving"
        onCancel={cancel}
        onDiscard={discard}
      />
    );
  }

  const name =
    tab.mode === "edit"
      ? tab.originalName
      : tab.tableName.trim() || "this new table";

  return (
    <UnsavedChangesModal
      message={
        <p>
          You have unsaved changes to{" "}
          <span className="font-mono text-zinc-100">{name}</span>. Do you want to
          save them before closing?
        </p>
      }
      onCancel={cancel}
      onDiscard={discard}
      save={{ saving, error, onSave: saveDesigner }}
    />
  );
}
