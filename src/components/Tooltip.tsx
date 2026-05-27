import { useRef, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";

const TIP_MAX_W = 240;

/**
 * Themed hover tooltip. Wraps a trigger and shows a styled popup beneath it on
 * hover, portaled to <body> so it's never clipped by an overflow container and
 * positioned in fixed (viewport) space, clamped to stay on-screen. Replaces the
 * native `title` attribute for a look that matches the app.
 */
export function Tooltip({
  label,
  children,
  className,
}: {
  label: ReactNode;
  /** The trigger element(s). */
  children: ReactNode;
  /** Extra classes for the inline wrapper around the trigger. */
  className?: string;
}) {
  const ref = useRef<HTMLSpanElement>(null);
  const [rect, setRect] = useState<DOMRect | null>(null);

  const show = () => {
    if (ref.current) setRect(ref.current.getBoundingClientRect());
  };
  const hide = () => setRect(null);

  const left = rect
    ? Math.max(8, Math.min(rect.left, window.innerWidth - TIP_MAX_W - 8))
    : 0;

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
            role="tooltip"
            style={{
              position: "fixed",
              left,
              top: rect.bottom + 6,
              maxWidth: TIP_MAX_W,
            }}
            className="z-[80] pointer-events-none rounded-lg border border-zinc-700 bg-zinc-900/95 backdrop-blur-sm px-2.5 py-1.5 text-[11px] leading-snug text-zinc-200 shadow-xl shadow-black/60"
          >
            {label}
          </div>,
          document.body
        )}
    </span>
  );
}
