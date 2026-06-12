import { getCurrentWindow } from "@tauri-apps/api/window";

/**
 * Reveal a secondary window once React has painted a frame, so the user never
 * sees the webview's white default background flash before our dark UI loads.
 * The windows are created with `visible: false` (see `commands/windows.rs`);
 * this shows them after a committed frame.
 */
export async function revealWindow() {
  await new Promise((r) =>
    requestAnimationFrame(() => requestAnimationFrame(() => r(null)))
  );
  const w = getCurrentWindow();
  await w.show().catch(() => {});
  await w.setFocus().catch(() => {});
}
