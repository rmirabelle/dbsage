import { CircleNotch } from "@phosphor-icons/react";
import { useStore } from "../state/store";

/** Modal progress bar shown while a table's data is being serialized to a .sql
 * script (driven by the store's `sqlExport` state). */
export function SqlExportProgress() {
  const sqlExport = useStore((s) => s.sqlExport);
  const cancelSqlExport = useStore((s) => s.cancelSqlExport);
  if (!sqlExport) return null;

  const { table, done, total, cancelling } = sqlExport;
  const pct = total > 0 ? Math.min(100, Math.round((done / total) * 100)) : null;

  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/60 backdrop-blur-sm">
      <div
        data-el="sql-export-progress"
        className="w-[360px] rounded-lg border border-zinc-800 bg-zinc-900 p-5 shadow-2xl shadow-black/60"
      >
        <div className="flex items-center gap-2 text-[13px] text-zinc-100">
          <CircleNotch size={16} className="animate-spin text-accent-400 shrink-0" />
          <span className="truncate">
            Saving SQL for <span className="font-semibold">{table}</span>
          </span>
        </div>
        <div className="mt-3 h-1.5 w-full overflow-hidden rounded bg-zinc-800">
          <div
            className="h-full bg-accent-500 transition-[width] duration-150"
            style={{ width: pct !== null ? `${pct}%` : "10%" }}
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
              : "Preparing…"}
          </span>
          <button
            data-el="sql-export-cancel-btn"
            onClick={cancelSqlExport}
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
