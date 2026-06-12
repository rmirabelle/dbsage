/**
 * Global horizontal mouse-wheel handler.
 *
 * WebView2's native horizontal (deltaX) wheel scrolling is unreliable, and the
 * old per-container `useEffect` listeners kept silently "regressing" because
 * they were tied to React's lifecycle — StrictMode double-invoke, Fast-Refresh,
 * and CSS-`zoom` panes would all leave a container without a working binding.
 *
 * The fix: ONE listener attached to `window` (capture phase, non-passive so
 * `preventDefault` works), installed once at module load — OUTSIDE React — and
 * never removed. A `window` flag guards against HMR re-evaluating this module
 * and adding a second listener. On each wheel we walk up from the cursor's
 * target to the nearest horizontally-scrollable element and drive its
 * `scrollLeft` ourselves. This covers every current and future scroll area with
 * zero per-component code and cannot detach on a component edit.
 *
 * NOTE: because the binding is intentionally install-once, editing THIS file in
 * dev won't take effect until a full page reload (the old closure stays bound).
 *
 * Rules (the behavior we always wanted):
 *   - deltaX (horizontal tilt / MX Master thumb wheel) → scroll horizontally.
 *   - Shift+wheel → scroll horizontally.
 *   - plain vertical wheel over a container with horizontal but no vertical
 *     overflow → scroll horizontally.
 *   - otherwise leave the event alone (native vertical scrolling).
 */
function isHorizontallyScrollable(el: HTMLElement): boolean {
  if (el.scrollWidth <= el.clientWidth) return false;
  const ox = getComputedStyle(el).overflowX;
  return ox === "auto" || ox === "scroll";
}

function onWheel(e: WheelEvent) {
  /* Ctrl/Cmd+wheel is the ZOOM gesture (useZoomShortcuts), never a scroll —
     without this bail, a Ctrl+wheel over a wide grid would horizontal-scroll
     and swallow the zoom. */
  if (e.ctrlKey || e.metaKey) return;
  let node: Element | null = e.target as Element | null;
  while (
    node &&
    node !== document.body &&
    node !== document.documentElement
  ) {
    if (node instanceof HTMLElement && isHorizontallyScrollable(node)) {
      if (e.deltaX !== 0) {
        node.scrollLeft += e.deltaX;
        e.preventDefault();
        return;
      }
      if (e.deltaY !== 0) {
        const hasVerticalOverflow = node.scrollHeight > node.clientHeight;
        if (e.shiftKey || !hasVerticalOverflow) {
          node.scrollLeft += e.deltaY;
          e.preventDefault();
          return;
        }
      }
      /**
       * Horizontally scrollable but the gesture is plain vertical and this
       * container can also scroll vertically — let the browser handle it and
       * don't climb to a horizontally-scrollable parent.
       */
      return;
    }
    node = node.parentElement;
  }
}

const INSTALL_FLAG = "__dbsageHorizontalWheelInstalled";

/**
 * Install the single global wheel listener exactly once for the life of the
 * page. Idempotent: guarded by a `window` flag so HMR/StrictMode can never add
 * a second listener or leave us with none.
 */
export function installHorizontalWheel(): void {
  const w = window as unknown as Record<string, boolean | undefined>;
  if (w[INSTALL_FLAG]) return;
  w[INSTALL_FLAG] = true;
  window.addEventListener("wheel", onWheel, { passive: false, capture: true });
}

/* Self-install on import — the listener lives for the life of the document. */
installHorizontalWheel();
