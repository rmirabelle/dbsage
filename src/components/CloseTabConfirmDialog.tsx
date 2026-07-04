import { useEffect, useState } from "react";
import { useStore } from "../state/store";
import { UnsavedChangesModal } from "./UnsavedChangesModal";

/**
 * Confirms unsaved changes before a dirty tab is closed in the main window.
 * Driven by the store's `pendingCloseTabId`, which `requestCloseTab` sets for a
 * dirty table-designer tab (offers Save) or a dirty query tab (discard only —
 * saving a query needs a name, done from the editor's Save menu).
 */
export function CloseTabConfirmDialog() {
  const pendingCloseTabId = useStore((s) => s.pendingCloseTabId);
  const tab = useStore((s) => s.tabs.find((t) => t.id === s.pendingCloseTabId));
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

  if (
    !pendingCloseTabId ||
    !tab ||
    (tab.kind !== "create-table" && tab.kind !== "query")
  ) {
    return null;
  }

  const cancel = () => setPendingCloseTabId(null);
  const discard = () => closeTab(pendingCloseTabId);

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
