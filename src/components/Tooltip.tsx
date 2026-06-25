import { useLayoutEffect, useRef, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";

const TIP_MAX_W = 260;

/**
 * Themed hover tooltip. Wraps a trigger and shows a styled popup near it on
 * hover, portaled to <body> so it's never clipped by an overflow container and
 * positioned in fixed (viewport) space. Measured after render so it flips above
 * the trigger when it would overflow the bottom edge, and clamps horizontally —
 * staying fully on-screen. Replaces the native `title` attribute for a look
 * that matches the app.
 */
export function Tooltip({
  label,
  children,
  className,
  maxWidth = TIP_MAX_W,
}: {
  label: ReactNode;
  /** The trigger element(s). */
  children: ReactNode;
  /** Extra classes for the inline wrapper around the trigger. */
  className?: string;
  /** Max width of the tip in px (default 260). */
  maxWidth?: number;
}) {
  const ref = useRef<HTMLSpanElement>(null);
  const tipRef = useRef<HTMLDivElement>(null);
  const [rect, setRect] = useState<DOMRect | null>(null);
  const [pos, setPos] = useState<{ left: number; top: number } | null>(null);

  const show = () => {
    if (ref.current) setRect(ref.current.getBoundingClientRect());
  };
  const hide = () => {
    setRect(null);
    setPos(null);
  };

  useLayoutEffect(() => {
    if (!rect) return;
    const tip = tipRef.current;
    const h = tip?.offsetHeight ?? 0;
    const w = tip?.offsetWidth ?? maxWidth;
    const left = Math.max(8, Math.min(rect.left, window.innerWidth - w - 8));
    let top = rect.bottom + 6;
    if (top + h > window.innerHeight - 8) {
      top = Math.max(8, rect.top - h - 6); // flip above the trigger
    }
    setPos({ left, top });
  }, [rect]);

  return (
    <span
      ref={ref}
      onMouseEnter={show}
      onMouseLeave={hide}
      className={className ?? "inline-flex"}
    >
      {children}
      {rect &&
        createPortal(
          <div
            ref={tipRef}
            role="tooltip"
            style={{
              position: "fixed",
              left: pos?.left ?? rect.left,
              top: pos?.top ?? rect.bottom + 6,
              maxWidth,
              visibility: pos ? "visible" : "hidden",
            }}
            className="z-[80] pointer-events-none rounded-lg border border-zinc-700 bg-zinc-900/95 backdrop-blur-sm px-3 py-2 text-[12.5px] leading-relaxed text-zinc-200 shadow-xl shadow-black/60"
          >
            {label}
          </div>,
          document.body
        )}
    </span>
  );
}
