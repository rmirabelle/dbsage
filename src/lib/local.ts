/**
 * Helpers for gating the local-server Admin feature. The admin panel only makes
 * sense when the connection points at this machine AND we're on Windows (the
 * only platform the OS-level commands support in v1).
 */

/** Sentinel the backend returns when the user dismisses a UAC prompt; the UI
 * matches this to stay silent instead of showing a failure toast. Must match
 * `UAC_CANCELLED` in `src-tauri/src/commands/admin.rs`. */
export const UAC_CANCELLED = "uac_cancelled";

const LOCAL_HOSTS = new Set(["localhost", "127.0.0.1", "::1", ""]);

/** True when a connection host refers to the local machine. */
export function isLocalHost(host: string): boolean {
  return LOCAL_HOSTS.has(host.trim().toLowerCase());
}

/** True when running on Windows (WebView2 reports "Windows NT" in the UA). */
export const isWindows = navigator.userAgent.includes("Windows");

/** Whether the Admin entry point should be offered for a given host. */
export function canAdminister(host: string): boolean {
  return isWindows && isLocalHost(host);
}
