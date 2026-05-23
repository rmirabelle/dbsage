import { useEffect } from "react";
import { useUi, ZOOM_BOUNDS, type PaneId } from "../state/ui";

/**
 * Global Ctrl+= / Ctrl+- / Ctrl+0 listener. Targets whichever pane currently
 * has focus per the UI store. Prevents the WebView's default page zoom so the
 * window chrome (titlebar/splitter) stays at a fixed scale.
 */
export function useZoomShortcuts() {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (!(e.ctrlKey || e.metaKey)) return;

      const pane = useUi.getState().focusedPane;
      const { bumpZoom, resetZoom } = useUi.getState();

      if (e.key === "=" || e.key === "+") {
        e.preventDefault();
        bumpZoom(pane, ZOOM_BOUNDS.STEP);
      } else if (e.key === "-" || e.key === "_") {
        e.preventDefault();
        bumpZoom(pane, -ZOOM_BOUNDS.STEP);
      } else if (e.key === "0") {
        e.preventDefault();
        resetZoom(pane);
      }
    };

    const onWheel = (e: WheelEvent) => {
      if (!(e.ctrlKey || e.metaKey)) return;
      e.preventDefault();
      /* Scale the pane under the cursor (falling back to the focused one). */
      const target = e.target as HTMLElement;
      const pane: PaneId = target.closest('[data-el="sidebar-pane"]')
        ? "tree"
        : target.closest('[data-el="main-pane"]')
        ? "tabs"
        : useUi.getState().focusedPane;
      const direction = e.deltaY > 0 ? -1 : 1;
      useUi.getState().bumpZoom(pane, direction * ZOOM_BOUNDS.STEP);
    };

    window.addEventListener("keydown", onKey);
    window.addEventListener("wheel", onWheel, { passive: false });
    return () => {
      window.removeEventListener("keydown", onKey);
      window.removeEventListener("wheel", onWheel);
    };
  }, []);
}
