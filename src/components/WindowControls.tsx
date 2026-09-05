import { useEffect, useRef, useState } from "react";
import clsx from "clsx";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { ipc } from "../ipc";

type Control = "min" | "max" | "close" | "closeAll";

/**
 * Windows-style minimize / maximize-restore / close buttons, driving the current
 * Tauri window. Shared by every window's titlebar so they look and behave
 * identically. Buttons sit flush in the titlebar; hover is state-driven so it can
 * be force-cleared (see the hover effect).
 *
 * `onCloseAll` (peek windows) appends a fourth button after Close — cascading
 * windows with an X — that closes every open peek at once. It lives here rather
 * than beside the button row so it shares the stuck-hover machinery (it becomes
 * the corner-flush button).
 */
export function WindowControls({ onCloseAll }: { onCloseAll?: () => void }) {
  const [maximized, setMaximized] = useState(false);
  const [hovered, setHovered] = useState<Control | null>(null);

  useEffect(() => {
    const win = getCurrentWindow();
    let unlistenFn: (() => void) | undefined;
    win.isMaximized().then(setMaximized);
    win
      .onResized(() => {
        win.isMaximized().then(setMaximized);
      })
      .then((fn) => {
        unlistenFn = fn;
      });
    return () => {
      if (unlistenFn) unlistenFn();
    };
  }, []);

  /* Hover is state-driven, not CSS `:hover`, so it can be force-cleared: WebView2
     drops the DOM `mouseleave` when the pointer flicks out of the window fast (no
     exit sample lands inside the page), which would leave the close button stuck
     red. onMouseEnter/onMouseLeave handle the in-window cases instantly; while
     (and only while) a button is hovered, a poll asks the OS where the cursor
     REALLY is and clears the hover once it's outside the window's client rect.
     Unlike DOM events, GetCursorPos can't miss — the next tick sees the cursor
     wherever it ended up.

     One persistent interval gated by a ref (not torn down per hover change, so
     rapid moves across the buttons can't race a teardown), and the window rect is
     fetched fresh each tick alongside the cursor (both in physical px), so a
     moved/resized window never leaves stale bounds.

     Each hover carries a generation number, and a tick may only clear the
     generation that was current when the tick STARTED. Otherwise a tick that
     sampled the cursor just before the pointer re-entered would land its stale
     "outside" verdict ~30ms later and kill the brand-new hover — which then
     stays dead, because the pointer never leaves the button again to re-fire
     mouseenter. */
  const hoveredRef = useRef<Control | null>(null);
  hoveredRef.current = hovered;
  const hoverGen = useRef(0);
  const enter = (c: Control) => {
    hoverGen.current++;
    setHovered(c);
  };
  useEffect(() => {
    const clear = () => setHovered(null);
    window.addEventListener("blur", clear);
    let checking = false;
    const id = window.setInterval(async () => {
      if (!hoveredRef.current || checking) return;
      checking = true;
      const gen = hoverGen.current;
      try {
        const win = getCurrentWindow();
        const [pos, size, [cx, cy]] = await Promise.all([
          win.innerPosition(),
          win.innerSize(),
          ipc.cursorPosition(),
        ]);
        if (
          gen === hoverGen.current &&
          (cx < pos.x ||
            cy < pos.y ||
            cx >= pos.x + size.width ||
            cy >= pos.y + size.height)
        ) {
          clear();
        }
      } catch {
        /* ignore — a failed poll just defers the check to the next tick */
      } finally {
        checking = false;
      }
    }, 100);
    return () => {
      window.clearInterval(id);
      window.removeEventListener("blur", clear);
    };
  }, []);

  const win = getCurrentWindow();
  const base =
    "h-full w-11 inline-flex items-center justify-center transition";

  return (
    <div className="flex items-stretch self-stretch">
      {/* onMouseMove alongside onMouseEnter: after a dropped mouseleave (fast
          flick out of the window) the DOM still thinks the pointer is on the
          button, so re-entering it fires NO mouseenter. mousemove doesn't care
          about that bookkeeping — it fires for any motion over the element, so
          the first pixel of movement restores the hover. */}
      <button
        aria-label="Minimize"
        onClick={() => win.minimize()}
        onMouseEnter={() => enter("min")}
        onMouseMove={() => enter("min")}
        onMouseLeave={() => setHovered(null)}
        className={clsx(
          base,
          hovered === "min" ? "bg-zinc-800/80 text-zinc-100" : "text-zinc-400"
        )}
      >
        <MinimizeIcon />
      </button>
      <button
        aria-label={maximized ? "Restore" : "Maximize"}
        onClick={() => win.toggleMaximize()}
        onMouseEnter={() => enter("max")}
        onMouseMove={() => enter("max")}
        onMouseLeave={() => setHovered(null)}
        className={clsx(
          base,
          hovered === "max" ? "bg-zinc-800/80 text-zinc-100" : "text-zinc-400"
        )}
      >
        {maximized ? <RestoreIcon /> : <MaximizeIcon />}
      </button>
      <button
        aria-label="Close"
        onClick={() => win.close()}
        onMouseEnter={() => enter("close")}
        onMouseMove={() => enter("close")}
        onMouseLeave={() => setHovered(null)}
        className={clsx(
          base,
          hovered === "close" ? "bg-red-600 text-white" : "text-zinc-400"
        )}
      >
        <CloseIcon />
      </button>
      {onCloseAll && (
        <button
          aria-label="Close all peek windows"
          title="Close all peek windows"
          onClick={onCloseAll}
          onMouseEnter={() => enter("closeAll")}
          onMouseMove={() => enter("closeAll")}
          onMouseLeave={() => setHovered(null)}
          className={clsx(
            base,
            hovered === "closeAll" ? "bg-red-600 text-white" : "text-red-300"
          )}
        >
          <CloseAllIcon />
        </button>
      )}
    </div>
  );
}

const glyphProps = {
  width: 10,
  height: 10,
  viewBox: "0 0 10 10",
  fill: "none",
  stroke: "currentColor",
  strokeWidth: 1,
  shapeRendering: "geometricPrecision" as const,
};

function MinimizeIcon() {
  return (
    <svg {...glyphProps}>
      <path d="M0.5 5h9" />
    </svg>
  );
}

function MaximizeIcon() {
  return (
    <svg {...glyphProps}>
      <rect x="0.5" y="0.5" width="9" height="9" />
    </svg>
  );
}

/** Two overlapping squares — the Windows "restore down" glyph shown when maximized. */
function RestoreIcon() {
  return (
    <svg {...glyphProps}>
      <rect x="0.5" y="2.5" width="7" height="7" />
      <path d="M2.5 2.5v-2h7v7h-2" />
    </svg>
  );
}

function CloseIcon() {
  return (
    <svg {...glyphProps}>
      <path d="M0.5 0.5l9 9M9.5 0.5l-9 9" />
    </svg>
  );
}

/** Two cascading windows, the front one bearing an X — "close all windows".
 * Rendered larger than the single-window glyphs: its detail is denser, so at
 * their 10px it reads as a smudge. */
function CloseAllIcon() {
  return (
    <svg {...glyphProps} width={14} height={14}>
      <rect x="0.5" y="2.5" width="7" height="7" />
      <path d="M2.5 2.5v-2h7v7h-2" />
      <path d="M2.5 4.5l3 3M5.5 4.5l-3 3" />
    </svg>
  );
}
