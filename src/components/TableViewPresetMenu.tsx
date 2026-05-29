import { useEffect, useRef, useState } from "react";
import { ArrowCounterClockwise, CaretDown, Check, Plus, X } from "@phosphor-icons/react";
import clsx from "clsx";
import type { TableViewPreset } from "../types";

/** Custom "table views" glyph: an eye framed by scan-corner brackets. Inherits
 * color via currentColor and scales to the given pixel size. */
export function ViewsIcon({ size = 16, className }: { size?: number; className?: string }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={2}
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className}
      aria-hidden="true"
    >
      <path d="M4 8 V6.5 A2.5 2.5 0 0 1 6.5 4 H8" />
      <path d="M16 4 H17.5 A2.5 2.5 0 0 1 20 6.5 V8" />
      <path d="M20 16 V17.5 A2.5 2.5 0 0 1 17.5 20 H16" />
      <path d="M8 20 H6.5 A2.5 2.5 0 0 1 4 17.5 V16" />
      <path d="M5.4 12 C7.6 8.6 16.4 8.6 18.6 12 C16.4 15.4 7.6 15.4 5.4 12 Z" />
      <circle cx="12" cy="12" r="2.1" fill="currentColor" stroke="none" />
    </svg>
  );
}

interface Props {
  presets: TableViewPreset[];
  activeName: string | null;
  onApply: (name: string) => void;
  onSave: (name: string) => void;
  onDelete: (name: string) => void;
  onClear: () => void;
}

export function TableViewPresetMenu({
  presets,
  activeName,
  onApply,
  onSave,
  onDelete,
  onClear,
}: Props) {
  const [open, setOpen] = useState(false);
  const [name, setName] = useState("");
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (!ref.current?.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    window.addEventListener("mousedown", onDown);
    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("mousedown", onDown);
      window.removeEventListener("keydown", onKey);
    };
  }, [open]);

  const trimmed = name.trim();
  const overwrites = presets.some((p) => p.name === trimmed);

  const submitSave = () => {
    if (!trimmed) return;
    onSave(trimmed);
    setName("");
  };

  return (
    <div ref={ref} className="relative">
      <button
        data-el="view-presets-btn"
        onClick={() => setOpen((v) => !v)}
        className={clsx(
          "inline-flex items-center gap-1.5 px-2 py-1 rounded text-[11px] font-semibold transition-colors",
          activeName
            ? "bg-emerald-500 text-emerald-950 hover:bg-emerald-400"
            : "bg-zinc-800 text-emerald-300 hover:bg-zinc-700"
        )}
        title={activeName ? `Active view: ${activeName}` : "Saved table views"}
      >
        <ViewsIcon size={16} className="shrink-0" />
        <span className="max-w-[160px] truncate">{activeName ?? "Views"}</span>
        <span
          className={clsx(
            "text-[10px] font-semibold tabular-nums",
            activeName ? "text-emerald-50" : "text-zinc-100"
          )}
        >
          {presets.length}
        </span>
        <CaretDown size={12} className="-mr-1 opacity-70" />
      </button>

      {open && (
        <div
          data-el="view-presets-menu"
          className="dbs-context-menu absolute left-0 top-full mt-1 z-50 w-80 rounded border border-zinc-700 bg-zinc-900/95 backdrop-blur-sm shadow-xl shadow-black/60 py-1 text-zinc-200"
        >
          <button
            onClick={() => {
              onClear();
              setOpen(false);
            }}
            className="flex w-full items-center gap-2 px-3 py-1.5 text-left hover:bg-zinc-800"
            title="Reset to defaults — remove all hidden columns, widths, sort, filters and show"
          >
            <ArrowCounterClockwise size={14} className="text-zinc-400 shrink-0" />
            Clear View
          </button>

          <div className="my-1 border-t border-zinc-800" />

          {presets.length === 0 ? (
            <div className="px-3 py-1.5 text-[11px] text-zinc-500">
              No saved views yet.
            </div>
          ) : (
            presets.map((p) => {
              const active = p.name === activeName;
              return (
                <div
                  key={p.name}
                  className="group flex items-center gap-1 pl-3 pr-1.5 hover:bg-zinc-800"
                >
                  <button
                    onClick={() => {
                      onApply(p.name);
                      setOpen(false);
                    }}
                    className="flex-1 min-w-0 flex items-center gap-2 py-1.5 text-left"
                    title={`Apply "${p.name}"`}
                  >
                    <ViewsIcon size={14} className="text-emerald-400 shrink-0" />
                    <span className={clsx("truncate", active && "font-semibold text-zinc-100")}>
                      {p.name}
                    </span>
                  </button>
                  <button
                    onClick={() => {
                      if (confirm(`Delete the view "${p.name}"?`)) onDelete(p.name);
                    }}
                    className="shrink-0 p-1 rounded text-zinc-500 hover:text-rose-300 hover:bg-zinc-700 opacity-0 group-hover:opacity-100 transition"
                    title={`Delete "${p.name}"`}
                    aria-label={`Delete ${p.name}`}
                  >
                    <X size={13} />
                  </button>
                </div>
              );
            })
          )}

          <div className="my-1 border-t border-zinc-800" />

          <div className="px-2 pb-1">
            <div className="px-1 pb-1 text-[10px] uppercase tracking-wide text-zinc-500">
              Save current view
            </div>
            <div className="flex items-center gap-1.5">
              <input
                data-el="view-preset-name-input"
                value={name}
                onChange={(e) => setName(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") submitSave();
                }}
                placeholder="View name"
                style={{ fontSize: 12 }}
                className="flex-1 min-w-0 bg-zinc-950 border border-zinc-700 rounded px-2 py-1 text-zinc-100 placeholder:text-zinc-600 outline-none focus:border-accent-500"
              />
              <button
                onClick={submitSave}
                disabled={!trimmed}
                title={overwrites ? "Overwrite existing view" : "Save view"}
                className="shrink-0 inline-flex items-center justify-center h-7 w-7 rounded bg-accent-500 text-[#042f2e] hover:bg-accent-400 disabled:bg-zinc-800 disabled:text-zinc-500 transition-colors"
              >
                {overwrites ? <Check size={15} /> : <Plus size={15} />}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
