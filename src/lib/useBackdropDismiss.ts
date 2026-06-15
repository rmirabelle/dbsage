import { useRef, type MouseEvent } from "react";

/**
 * Backdrop-dismiss handlers for a modal overlay. Dismissal fires only when the
 * press *began* on the backdrop itself.
 *
 * Without this, a drag that starts inside a field (selecting text) and releases
 * over the backdrop dispatches its `click` to the backdrop — the common ancestor
 * of the mousedown and mouseup targets — so an inner `stopPropagation` never sees
 * it and the dialog closes mid-selection.
 *
 * Spread the result onto the backdrop element: `<div {...useBackdropDismiss(onClose)}>`.
 * Pass `enabled = false` (e.g. while a request is in flight) to lock dismissal.
 */
export function useBackdropDismiss(onClose: () => void, enabled = true) {
  const pressedBackdrop = useRef(false);
  return {
    onMouseDown: (e: MouseEvent) => {
      pressedBackdrop.current = e.target === e.currentTarget;
    },
    onClick: (e: MouseEvent) => {
      if (enabled && e.target === e.currentTarget && pressedBackdrop.current) {
        onClose();
      }
    },
  };
}
