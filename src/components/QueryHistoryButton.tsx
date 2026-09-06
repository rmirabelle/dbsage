import { useEffect, useState } from "react";
import {
  ClockCounterClockwise,
  Trash,
  X,
} from "@phosphor-icons/react";
import type { QueryHistoryItem } from "../types";
import { ConfirmDialog } from "./ConfirmDialog";

interface Props {
  items: QueryHistoryItem[];
  disabled?: boolean;
  onApply: (sql: string) => void;
  onDelete: (sql: string) => void;
  onClear: () => void;
}

export function QueryHistoryButton({
  items,
  disabled,
  onApply,
  onDelete,
  onClear,
}: Props) {
  const [open, setOpen] = useState(false);

  return (
    <>
      <button
        data-el="query-history-btn"
        onClick={() => setOpen(true)}
        disabled={disabled}
        title={`Query history (${items.length})`}
        className="inline-flex items-center gap-1.5 h-7 px-2 rounded text-[11px] font-semibold transition-colors disabled:opacity-40 disabled:cursor-not-allowed bg-zinc-800 text-zinc-300 hover:bg-zinc-700 hover:text-zinc-100"
      >
        <ClockCounterClockwise size={16} weight="bold" className="shrink-0 text-emerald-400" />
        <span className="font-bold text-emerald-300">History</span>
        {items.length > 0 && (
          <span
            className="rounded-full px-1.5 text-[10px] font-semibold tabular-nums bg-black/30 text-zinc-100"
            aria-label={`${items.length} history items`}
          >
            {items.length}
          </span>
        )}
      </button>
      {open && (
        <QueryHistoryDialog
          items={items}
          onApply={(sql) => {
            onApply(sql);
            setOpen(false);
          }}
          onDelete={onDelete}
          onClear={onClear}
          onClose={() => setOpen(false)}
        />
      )}
    </>
  );
}

function QueryHistoryDialog({
  items,
  onApply,
  onDelete,
  onClear,
  onClose,
}: {
  items: QueryHistoryItem[];
  onApply: (sql: string) => void;
  onDelete: (sql: string) => void;
  onClear: () => void;
  onClose: () => void;
}) {
  const [clearConfirm, setClearConfirm] = useState(false);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  const handleClear = () => {
    if (items.length === 0) return;
    setClearConfirm(true);
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm"
      onClick={onClose}
    >
      <div
        data-el="query-history-dialog"
        role="dialog"
        aria-modal="true"
        onClick={(e) => e.stopPropagation()}
        className="flex flex-col w-[720px] max-w-[92vw] max-h-[80vh] rounded-lg border border-zinc-700 bg-zinc-900 shadow-2xl shadow-black/60"
      >
        <div className="flex items-center justify-between px-4 py-3 border-b border-zinc-800 shrink-0">
          <div className="flex items-center gap-2">
            <ClockCounterClockwise
              size={18}
              weight="bold"
              className="text-accent-400"
            />
            <h2 className="text-sm font-semibold text-zinc-100">
              Query History{" "}
              <span className="font-normal text-zinc-500">
                — {items.length} {items.length === 1 ? "entry" : "entries"}
              </span>
            </h2>
          </div>
          <div className="flex items-center gap-1.5">
            <button
              data-el="query-history-clear-btn"
              onClick={handleClear}
              disabled={items.length === 0}
              title="Clear all history for this database"
              className="inline-flex items-center gap-1.5 px-2 py-1 rounded text-[11px] font-semibold bg-rose-500 text-rose-950 hover:bg-rose-400 disabled:opacity-40 disabled:hover:bg-rose-500 transition-colors"
            >
              <Trash size={14} />
              Clear all
            </button>
            <button
              onClick={onClose}
              className="ml-1 text-zinc-500 hover:text-zinc-200"
              aria-label="Close"
            >
              <X size={18} />
            </button>
          </div>
        </div>

        <div className="flex-1 min-h-0 overflow-auto">
          {items.length === 0 ? (
            <div className="px-4 py-10 text-center text-xs text-zinc-500">
              No history yet. Executed queries will appear here.
            </div>
          ) : (
            <ul className="divide-y divide-zinc-800">
              {items.map((item, i) => (
                <HistoryRow
                  key={`${item.executedAt}-${i}`}
                  item={item}
                  onApply={() => onApply(item.sql)}
                  onDelete={() => onDelete(item.sql)}
                />
              ))}
            </ul>
          )}
        </div>
      </div>
      {clearConfirm && (
        <ConfirmDialog
          title="Clear query history"
          confirmLabel="Clear"
          message={
            <p>
              Clear all{" "}
              <span className="font-semibold text-zinc-100">{items.length}</span>{" "}
              history entries for this database? This cannot be undone.
            </p>
          }
          onConfirm={() => {
            setClearConfirm(false);
            onClear();
          }}
          onCancel={() => setClearConfirm(false)}
        />
      )}
    </div>
  );
}

function HistoryRow({
  item,
  onApply,
  onDelete,
}: {
  item: QueryHistoryItem;
  onApply: () => void;
  onDelete: () => void;
}) {
  return (
    <li className="group flex items-start gap-2 px-3 py-2 hover:bg-zinc-800/60">
      <button
        onClick={onApply}
        className="flex-1 min-w-0 text-left"
        title="Load into editor"
      >
        <pre className="text-[11.5px] font-mono text-zinc-200 whitespace-pre-wrap break-words line-clamp-3">
          {flattenSql(item.sql)}
        </pre>
        <div className="mt-1 text-[10px] text-zinc-500">
          {formatExecutedAt(item.executedAt)}
        </div>
      </button>
      <button
        onClick={onDelete}
        title="Delete this history entry"
        aria-label="Delete history entry"
        className="shrink-0 p-1 rounded text-zinc-500 hover:text-rose-300 hover:bg-zinc-700 opacity-0 group-hover:opacity-100 transition"
      >
        <X size={14} />
      </button>
    </li>
  );
}

/** Collapse newlines + runs of whitespace into single spaces so multi-line SQL
 * shows on one logical line in the history list (display only — the loaded
 * SQL keeps its original formatting). */
function flattenSql(sql: string): string {
  return sql.replace(/\s+/g, " ").trim();
}

function formatExecutedAt(ms: number): string {
  const now = Date.now();
  const diff = now - ms;
  if (diff < 60_000) return "just now";
  if (diff < 3_600_000) {
    const m = Math.floor(diff / 60_000);
    return `${m} minute${m === 1 ? "" : "s"} ago`;
  }
  if (diff < 86_400_000) {
    const h = Math.floor(diff / 3_600_000);
    return `${h} hour${h === 1 ? "" : "s"} ago`;
  }
  if (diff < 7 * 86_400_000) {
    const d = Math.floor(diff / 86_400_000);
    return `${d} day${d === 1 ? "" : "s"} ago`;
  }
  const date = new Date(ms);
  return date.toLocaleString();
}
