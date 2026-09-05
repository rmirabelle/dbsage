import { useEffect } from "react";
import { getCurrentWindow } from "@tauri-apps/api/window";

const topmostLeases = new Map<string, number>();

/**
 * Peek panels are independent OS windows owned by the main window, so they
 * always sit above it and a DOM z-index in the table window cannot rise above
 * them. While a context menu is open, temporarily lift its owning main/torn-off
 * window into the native topmost layer (released the moment the menu closes).
 * Peek windows only need to be brought forward.
 */
export function useNativeMenuLayer(open: boolean) {
  useEffect(() => {
    if (!open) return;

    const owner = getCurrentWindow();
    if (owner.label.startsWith("peek-")) {
      void owner.setFocus();
      return;
    }

    const leases = topmostLeases.get(owner.label) ?? 0;
    topmostLeases.set(owner.label, leases + 1);
    if (leases === 0) void owner.setAlwaysOnTop(true);
    return () => {
      const remaining = Math.max(
        0,
        (topmostLeases.get(owner.label) ?? 1) - 1
      );
      if (remaining === 0) {
        topmostLeases.delete(owner.label);
        void owner.setAlwaysOnTop(false);
      } else {
        topmostLeases.set(owner.label, remaining);
      }
    };
  }, [open]);
}
