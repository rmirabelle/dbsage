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

    /* Ctrl+Scroll is THE zoom gesture. High-resolution wheels (MX Master
       free-spin) fire many small-delta events per notch, so accumulate and
       convert to one zoom step per fixed amount of travel instead of stepping
       on every event. */
    let acc = 0;
    const WHEEL_PER_STEP = 50;
    const onWheel = (e: WheelEvent) => {
      if (!(e.ctrlKey || e.metaKey)) return;
      e.preventDefault();
      acc += e.deltaY;
      const steps = Math.trunc(acc / WHEEL_PER_STEP);
      if (steps === 0) return;
      acc -= steps * WHEEL_PER_STEP;
      /* Scale the pane under the cursor (falling back to the focused one —
         secondary windows have no panes and fall through to "tabs"). */
      const target = e.target as HTMLElement;
      const pane: PaneId = target.closest('[data-el="sidebar-pane"]')
        ? "tree"
        : target.closest('[data-el="main-pane"]')
        ? "tabs"
        : useUi.getState().focusedPane;
      /* Scroll up (negative deltaY) zooms in. */
      useUi.getState().bumpZoom(pane, -steps * ZOOM_BOUNDS.STEP);
    };

    window.addEventListener("keydown", onKey);
    window.addEventListener("wheel", onWheel, { passive: false });
    return () => {
      window.removeEventListener("keydown", onKey);
      window.removeEventListener("wheel", onWheel);
    };
  }, []);
}
