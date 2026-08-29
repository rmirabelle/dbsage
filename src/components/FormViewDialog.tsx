import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import {
  Article,
  CaretLeft,
  CaretRight,
  X,
} from "@phosphor-icons/react";
import clsx from "clsx";
import type { ColumnInfo, RowRecord } from "../types";
import { useBackdropDismiss } from "../lib/useBackdropDismiss";

interface Props {
  table: string;
  columns: ColumnInfo[];
  rows: RowRecord[];
  initialRowIndex: number;
  offset: number;
  onClose: () => void;
}

/** Read-only, one-record-at-a-time representation of a Table View row.
 * Navigation intentionally stays within the currently loaded page for this
 * baseline, preserving the exact filtered/sorted Table View underneath. */
export function FormViewDialog({
  table,
  columns,
  rows,
  initialRowIndex,
  offset,
  onClose,
}: Props) {
  const [rowIndex, setRowIndex] = useState(() =>
    clampRowIndex(initialRowIndex, rows.length)
  );
  const row = rows[rowIndex];
  const canPrevious = rowIndex > 0;
  const canNext = rowIndex < rows.length - 1;

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        onClose();
      } else if (event.key === "ArrowLeft" && canPrevious) {
        event.preventDefault();
        setRowIndex((current) => current - 1);
      } else if (event.key === "ArrowRight" && canNext) {
        event.preventDefault();
        setRowIndex((current) => current + 1);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [canNext, canPrevious, onClose]);

  const backdrop = useBackdropDismiss(onClose);
  if (!row) return null;

  return createPortal(
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/65 p-6 backdrop-blur-sm"
      {...backdrop}
    >
      <div
        data-el="form-view-dialog"
        role="dialog"
        aria-modal="true"
        aria-label={`Form View for ${table}`}
        onClick={(event) => event.stopPropagation()}
        className="flex h-[82vh] w-[920px] max-h-[900px] max-w-[94vw] flex-col overflow-hidden rounded-lg border border-zinc-700 bg-zinc-900 shadow-2xl shadow-black/70"
      >
        <div className="flex h-12 shrink-0 items-center gap-3 border-b border-zinc-800 px-4">
          <Article size={19} weight="fill" className="shrink-0 text-emerald-400" />
          <div className="min-w-0 flex-1">
            <h2 className="truncate text-sm font-semibold text-zinc-100">
              Form View
            </h2>
            <div className="truncate text-[10px] text-zinc-500">{table}</div>
          </div>

          <div className="flex items-center gap-1">
            <button
              data-el="form-view-previous"
              onClick={() => setRowIndex((current) => current - 1)}
              disabled={!canPrevious}
              aria-label="Previous record"
              title="Previous record (Left arrow)"
              className="inline-flex h-7 w-7 items-center justify-center rounded bg-zinc-800 text-zinc-300 transition-colors hover:bg-zinc-700 hover:text-white disabled:cursor-not-allowed disabled:opacity-30"
            >
              <CaretLeft size={15} weight="bold" />
            </button>
            <span className="min-w-36 px-2 text-center text-[11px] tabular-nums text-zinc-400">
              Record {(offset + rowIndex + 1).toLocaleString()}
              <span className="text-zinc-600"> · </span>
              {rowIndex + 1} of {rows.length} on page
            </span>
            <button
              data-el="form-view-next"
              onClick={() => setRowIndex((current) => current + 1)}
              disabled={!canNext}
              aria-label="Next record"
              title="Next record (Right arrow)"
              className="inline-flex h-7 w-7 items-center justify-center rounded bg-zinc-800 text-zinc-300 transition-colors hover:bg-zinc-700 hover:text-white disabled:cursor-not-allowed disabled:opacity-30"
            >
              <CaretRight size={15} weight="bold" />
            </button>
          </div>

          <div className="mx-1 h-5 border-l border-zinc-700" />
          <button
            onClick={onClose}
            aria-label="Close Form View"
            title="Close (Escape)"
            className="inline-flex h-7 w-7 items-center justify-center rounded text-zinc-500 transition-colors hover:bg-zinc-800 hover:text-zinc-100"
          >
            <X size={18} />
          </button>
        </div>

        <div className="flex-1 overflow-auto bg-zinc-950/70 px-5 py-4">
          <div className="mx-auto max-w-[820px] overflow-hidden rounded border border-zinc-800 bg-zinc-900/60">
            {columns.map((column) => {
              const value = formValue(row[column.name]);
              return (
                <div
                  key={column.name}
                  data-el="form-view-field"
                  className="grid min-h-10 grid-cols-[minmax(140px,32%)_minmax(0,1fr)] border-b border-zinc-800/80 last:border-b-0"
                >
                  <div className="flex items-start justify-end border-r border-zinc-800/80 bg-zinc-950/35 px-4 py-2.5 text-right text-[11px] font-semibold text-zinc-400">
                    {column.name}
                  </div>
                  <div
                    className={clsx(
                      "min-w-0 whitespace-pre-wrap break-words bg-zinc-900/60 px-4 py-2.5 font-mono text-[11.5px] leading-5",
                      value.isNull
                        ? "italic text-zinc-600"
                        : "select-text text-zinc-100"
                    )}
                  >
                    {value.text}
                  </div>
                </div>
              );
            })}
          </div>
        </div>

        <div className="flex h-10 shrink-0 items-center justify-between border-t border-zinc-800 px-4 text-[10px] text-zinc-500">
          <span>
            {columns.length} field{columns.length === 1 ? "" : "s"}
          </span>
          <span>Left/Right navigates · Escape closes</span>
        </div>
      </div>
    </div>,
    document.body
  );
}

function clampRowIndex(index: number, rowCount: number): number {
  if (rowCount <= 0) return 0;
  return Math.max(0, Math.min(index, rowCount - 1));
}

function formValue(value: unknown): { text: string; isNull: boolean } {
  if (value === null || value === undefined) {
    return { text: "NULL", isNull: true };
  }
  if (typeof value === "string") return { text: value, isNull: false };
  if (typeof value === "number" || typeof value === "boolean") {
    return { text: String(value), isNull: false };
  }
  return { text: JSON.stringify(value), isNull: false };
}
