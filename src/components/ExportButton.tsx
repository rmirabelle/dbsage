import { useEffect, useRef, useState } from "react";
import {
  DownloadSimple,
  CaretDown,
  FileCsv,
  BracketsCurly,
  FileXls,
  type Icon,
} from "@phosphor-icons/react";
import { save } from "@tauri-apps/plugin-dialog";
import type { ColumnInfo, RowRecord } from "../types";
import { ipc } from "../ipc";
import { notifyError, notifySuccess } from "../state/notify";

type ExportFormat = "csv" | "json" | "xlsx";

const OPTIONS: {
  format: ExportFormat;
  label: string;
  filterName: string;
  Icon: Icon;
}[] = [
  { format: "csv", label: "CSV file (.csv)", filterName: "CSV", Icon: FileCsv },
  { format: "json", label: "JSON file (.json)", filterName: "JSON", Icon: BracketsCurly },
  { format: "xlsx", label: "Excel file (.xlsx)", filterName: "Excel Workbook", Icon: FileXls },
];

interface Props {
  /** Used to suggest a filename. */
  database: string;
  columns: ColumnInfo[];
  /** Rows to export — the caller passes the full set or just the selection. */
  rows: RowRecord[];
  disabled: boolean;
}

export function ExportButton({ database, columns, rows, disabled }: Props) {
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

  const exportAs = async (format: ExportFormat, filterName: string) => {
    setOpen(false);
    const date = new Date().toISOString().slice(0, 10);
    const base = (database || "query").replace(/[^\w.-]+/g, "_");
    const path = await save({
      defaultPath: `${base}-export-${date}.${format}`,
      filters: [{ name: filterName, extensions: [format] }],
    });
    if (!path) return;

    const colNames = columns.map((c) => c.name);
    const data = rows.map((row) => colNames.map((n) => row[n] ?? null));
    try {
      await ipc.exportQuery({ path, format, columns: colNames, rows: data });
      const n = rows.length;
      notifySuccess(`Exported ${n} row${n === 1 ? "" : "s"} to ${format.toUpperCase()}`);
    } catch (e) {
      notifyError(`Export failed: ${String(e)}`);
    }
  };

  return (
    <div ref={ref} className="relative">
      <button
        data-el="export-btn"
        onClick={() => setOpen((v) => !v)}
        disabled={disabled}
        title="Export the query results"
        className="inline-flex items-center gap-1.5 px-3 py-1 rounded text-[11px] font-semibold bg-zinc-800 text-zinc-200 hover:bg-zinc-700 transition-colors disabled:opacity-40 disabled:hover:bg-zinc-800"
      >
        <DownloadSimple size={17} />
        Export
        <CaretDown size={12} className="-mr-1 opacity-70" />
      </button>

      {open && !disabled && (
        <div
          data-el="export-menu"
          className="absolute left-0 top-full mt-1 z-50 min-w-[200px] rounded border border-zinc-700 bg-zinc-900/95 backdrop-blur-sm shadow-xl shadow-black/60 py-1 text-[12px] text-zinc-200"
        >
          {OPTIONS.map((opt) => (
            <button
              key={opt.format}
              onClick={() => exportAs(opt.format, opt.filterName)}
              className="flex w-full items-center gap-2.5 px-3 py-1.5 text-left hover:bg-zinc-950 whitespace-nowrap"
            >
              <opt.Icon size={14} className="text-emerald-400 shrink-0" />
              {opt.label}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
