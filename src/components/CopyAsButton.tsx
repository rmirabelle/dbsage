import { useEffect, useRef, useState } from "react";
import { Copy, CaretDown } from "@phosphor-icons/react";
import clsx from "clsx";
import type { ColumnInfo, RowRecord } from "../types";
import { buildCopyText, COPY_AS_OPTIONS, type CopyAsFormat } from "../lib/copyAs";
import { notifyError, notifySuccess } from "../state/notify";

interface Props {
  database: string;
  table: string;
  columns: ColumnInfo[];
  rows: RowRecord[];
}

export function CopyAsButton({ database, table, columns, rows }: Props) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onMouseDown = (e: MouseEvent) => {
      if (!ref.current?.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    window.addEventListener("mousedown", onMouseDown);
    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("mousedown", onMouseDown);
      window.removeEventListener("keydown", onKey);
    };
  }, [open]);

  const copy = async (format: CopyAsFormat, label: string) => {
    setOpen(false);
    try {
      const text = buildCopyText(format, database, table, columns, rows);
      await navigator.clipboard.writeText(text);
      const n = rows.length;
      notifySuccess(`Copied ${n} row${n === 1 ? "" : "s"} as ${label}`);
    } catch {
      notifyError("Could not copy to the clipboard");
    }
  };

  return (
    <div ref={ref} className="relative">
      <button
        data-el="copy-as-btn"
        onClick={() => setOpen((v) => !v)}
        className="inline-flex items-center gap-1.5 px-3 py-1 rounded text-[11px] font-semibold bg-zinc-800 text-zinc-200 hover:bg-zinc-700 transition-colors"
        title="Copy the selected rows in a chosen format"
      >
        <Copy size={17} />
        Copy As
        <CaretDown size={12} className="-mr-1 opacity-70" />
      </button>

      {open && (
        <div
          data-el="copy-as-menu"
          className="absolute left-0 top-full mt-1 z-50 min-w-[240px] rounded border border-zinc-700 bg-zinc-900/95 backdrop-blur-sm shadow-xl shadow-black/60 py-1 text-[12px] text-zinc-200"
        >
          {COPY_AS_OPTIONS.map((opt) => (
            <button
              key={opt.format}
              onClick={() => copy(opt.format, opt.label)}
              className={clsx(
                "w-full text-left px-3 py-1.5 hover:bg-zinc-800 whitespace-nowrap"
              )}
            >
              {opt.label}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
