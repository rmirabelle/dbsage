import { useEffect } from "react";
import { getCurrentWindow } from "@tauri-apps/api/window";

/**
 * Peek panels are independent always-on-top OS windows, so a DOM z-index in
 * the table window cannot rise above them. While its Relations menu is open,
 * temporarily put the owning main/torn-off window in the same native topmost
 * layer. Peek windows already live there and only need to be brought forward.
 */
export function useRelationsMenuLayer(open: boolean) {
  useEffect(() => {
    if (!open) return;

    const owner = getCurrentWindow();
    if (owner.label.startsWith("peek-")) {
      void owner.setFocus();
      return;
    }

    void owner.setAlwaysOnTop(true);
    return () => {
      void owner.setAlwaysOnTop(false);
    };
  }, [open]);
}
