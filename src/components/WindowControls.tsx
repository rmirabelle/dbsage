import { useEffect, useState } from "react";
import { getCurrentWindow } from "@tauri-apps/api/window";

/**
 * Windows-style minimize / maximize-restore / close buttons, driving the current
 * Tauri window. Shared by the main titlebar and the monitor window's titlebar so
 * their controls look and behave identically.
 */
export function WindowControls() {
  const [maximized, setMaximized] = useState(false);

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

  const win = getCurrentWindow();
  const btn =
    "h-9 w-11 inline-flex items-center justify-center text-zinc-400 hover:bg-zinc-800/80 hover:text-zinc-100 transition";

  return (
    <div className="flex items-center">
      <button aria-label="Minimize" onClick={() => win.minimize()} className={btn}>
        <MinimizeIcon />
      </button>
      <button
        aria-label={maximized ? "Restore" : "Maximize"}
        onClick={() => win.toggleMaximize()}
        className={btn}
      >
        {maximized ? <RestoreIcon /> : <MaximizeIcon />}
      </button>
      <button
        aria-label="Close"
        onClick={() => win.close()}
        className="h-9 w-11 inline-flex items-center justify-center text-zinc-400 hover:bg-red-600 hover:text-white transition"
      >
        <CloseIcon />
      </button>
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
