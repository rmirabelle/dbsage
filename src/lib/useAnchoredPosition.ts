import { useLayoutEffect, useRef, useState, type RefObject } from "react";

/**
 * Keep a `fixed`-positioned popup (context menu, picker) anchored at a click
 * point `(x, y)` but fully inside the viewport. When the popup would spill past
 * the bottom or right edge it flips to open upward / leftward from the anchor;
 * if it still doesn't fit it's clamped against the edge. Measured after layout
 * so there's no visible flash.
 *
 * Attach the returned `ref` to the popup element and spread `style` onto it
 * (replacing a hand-written `style={{ top: y, left: x }}`):
 *
 *   const { ref, style } = useAnchoredPosition(x, y);
 *   return <div ref={ref} style={style} … />
 *
 * Pass `externalRef` when the popup already has a ref (e.g. for outside-click
 * detection) so the measurement reuses it instead of needing a second ref.
 */
export function useAnchoredPosition<T extends HTMLElement = HTMLDivElement>(
  x: number,
  y: number,
  margin = 8,
  externalRef?: RefObject<T | null>
) {
  const internalRef = useRef<T>(null);
  const ref = externalRef ?? internalRef;
  const [pos, setPos] = useState<{ top: number; left: number }>({
    top: y,
    left: x,
  });

  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const { width, height } = el.getBoundingClientRect();
    const vw = window.innerWidth;
    const vh = window.innerHeight;

    /* Flip above / left of the anchor when overflowing, then clamp so the
       popup never sits off-screen even if it's taller/wider than the gap. */
    let left = x;
    if (left + width > vw - margin) left = x - width;
    left = Math.max(margin, Math.min(left, vw - margin - width));

    let top = y;
    if (top + height > vh - margin) top = y - height;
    top = Math.max(margin, Math.min(top, vh - margin - height));

    setPos({ top, left });
  }, [x, y, margin]);

  return { ref, style: pos };
}
