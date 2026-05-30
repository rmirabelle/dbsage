import { CircleNotch } from "@phosphor-icons/react";
import { useStore } from "../state/store";

/**
 * Modal progress overlay shown while table(s) are being copied to another
 * database (driven by the store's `copyProgress` state). Cross-connection copies
 * report row counts so the bar fills; same-connection copies finish server-side
 * with no per-row reporting, so the bar stays indeterminate.
 */
export function CopyProgress() {
  const copyProgress = useStore((s) => s.copyProgress);
  const cancelTableCopy = useStore((s) => s.cancelTableCopy);
  if (!copyProgress) return null;

  const { current, count, table, done, total, cancelling } = copyProgress;
  const pct = total > 0 ? Math.min(100, Math.round((done / total) * 100)) : null;

  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/60 backdrop-blur-sm">
      <div
        data-el="copy-progress"
        className="w-[360px] rounded-lg border border-zinc-800 bg-zinc-900 p-5 shadow-2xl shadow-black/60"
      >
        <div className="flex items-center gap-2 text-[13px] text-zinc-100">
          <CircleNotch size={16} className="animate-spin text-accent-400 shrink-0" />
          <span className="truncate">
            Copying <span className="font-semibold">{table}</span>
            {count > 1 && (
              <span className="text-zinc-500">
                {" "}
                ({current} of {count})
              </span>
            )}
          </span>
        </div>
        <div className="mt-3 h-1.5 w-full overflow-hidden rounded bg-zinc-800">
          <div
            className={
              pct !== null
                ? "h-full bg-accent-500 transition-[width] duration-150"
                : "h-full w-1/3 bg-accent-500 animate-pulse"
            }
            style={pct !== null ? { width: `${pct}%` } : undefined}
          />
        </div>
        <div className="mt-2 flex items-center justify-between gap-3">
          <span className="text-[11px] tabular-nums text-zinc-500">
            {cancelling
              ? "Cancelling…"
              : total > 0
              ? `${done.toLocaleString()} / ${total.toLocaleString()} rows${
                  pct !== null ? ` (${pct}%)` : ""
                }`
              : "Copying…"}
          </span>
          <button
            data-el="copy-cancel-btn"
            onClick={cancelTableCopy}
            disabled={cancelling}
            className="shrink-0 rounded bg-zinc-800 px-2.5 py-1 text-[11px] font-semibold text-zinc-200 hover:bg-zinc-700 disabled:opacity-40 disabled:hover:bg-zinc-800 transition-colors"
          >
            Cancel
          </button>
        </div>
      </div>
    </div>
  );
}
