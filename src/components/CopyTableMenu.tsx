import { useEffect } from "react";
import { createPortal } from "react-dom";
import { Table as Table2, Database } from "@phosphor-icons/react";

/**
 * Menu shown after dropping table(s) onto a different database, offering a
 * structure-only or structure-and-data copy. Driven by the global `useUi`
 * copy-prompt state so it can be triggered from any drag source.
 */
export function CopyTableMenu({
  x,
  y,
  tables,
  targetDb,
  targetConnectionName,
  onCopy,
  onClose,
}: {
  x: number;
  y: number;
  tables: string[];
  targetDb: string;
  targetConnectionName?: string;
  onCopy: (includeData: boolean) => void;
  onClose: () => void;
}) {
  useEffect(() => {
    const close = () => onClose();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("click", close);
    window.addEventListener("contextmenu", close);
    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("click", close);
      window.removeEventListener("contextmenu", close);
      window.removeEventListener("keydown", onKey);
    };
  }, [onClose]);

  const n = tables.length;
  const label = n === 1 ? `"${tables[0]}"` : `${n} tables`;
  const noun = n === 1 ? "table" : "tables";
  const destination = targetConnectionName
    ? `${targetConnectionName} / ${targetDb}`
    : targetDb;

  return createPortal(
    <div
      data-el="copy-table-menu"
      style={{ top: y, left: x }}
      onClick={(e) => e.stopPropagation()}
      className="dbs-context-menu fixed z-50 min-w-[260px] rounded border border-zinc-700 bg-zinc-900/95 backdrop-blur-sm py-1 shadow-xl shadow-black/60"
    >
      <div className="px-3 py-1 text-[10px] uppercase tracking-[0.12em] text-zinc-500 truncate">
        Copy {label} to {destination}
      </div>
      <button
        data-el="ctx-copy-structure"
        className="flex w-full items-center gap-2.5 text-left px-3 py-1.5 hover:bg-zinc-800 text-zinc-200"
        onClick={() => onCopy(false)}
      >
        <Table2 size={14} className="text-accent-400 shrink-0" />
        Copy {noun} here (structure only)
      </button>
      <button
        data-el="ctx-copy-data"
        className="flex w-full items-center gap-2.5 text-left px-3 py-1.5 hover:bg-zinc-800 text-zinc-200"
        onClick={() => onCopy(true)}
      >
        <Database size={14} className="text-accent-400 shrink-0" />
        Copy {noun} here (structure and data)
      </button>
    </div>,
    document.body
  );
}
