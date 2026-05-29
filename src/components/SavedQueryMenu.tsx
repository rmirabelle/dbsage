import { useEffect, useMemo, useRef, useState } from "react";
import { CaretDown, Check, FloppyDisk, Plus, X } from "@phosphor-icons/react";
import clsx from "clsx";
import type { SavedQuery } from "../types";

interface Props {
  queries: SavedQuery[];
  activeName: string | null;
  /** Disabled (e.g. no database picked) — the trigger is inert. */
  disabled?: boolean;
  onApply: (name: string) => void;
  onSave: (name: string) => void;
  onDelete: (name: string) => void;
}

export function SavedQueryMenu({
  queries,
  activeName,
  disabled,
  onApply,
  onSave,
  onDelete,
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

  const sorted = useMemo(
    () => [...queries].sort((a, b) => a.name.localeCompare(b.name)),
    [queries]
  );

  const trimmed = name.trim();
  const overwrites = queries.some((q) => q.name === trimmed);

  const submitSave = () => {
    if (!trimmed) return;
    onSave(trimmed);
    setName("");
  };

  return (
    <div ref={ref} className="relative">
      <button
        data-el="saved-queries-btn"
        onClick={() => setOpen((v) => !v)}
        disabled={disabled}
        className="inline-flex items-center gap-1.5 px-2 py-1 rounded text-[11px] font-semibold transition-colors disabled:opacity-40 disabled:cursor-not-allowed bg-zinc-800 text-emerald-300 hover:bg-zinc-700"
        title={activeName ? `Loaded query: ${activeName}` : "Saved queries"}
      >
        <FloppyDisk size={16} weight="fill" className="shrink-0" />
        <span className="max-w-[160px] truncate font-bold">{activeName ?? "Saved"}</span>
        <span className="text-[10px] font-semibold tabular-nums text-zinc-100">
          {queries.length}
        </span>
        <CaretDown size={12} className="-mr-1 opacity-70" />
      </button>

      {open && (
        <div
          data-el="saved-queries-menu"
          style={{ fontSize: "13.5px" }}
          className="dbs-context-menu absolute left-0 top-full mt-1 z-50 w-80 rounded border border-zinc-700 bg-zinc-900/95 backdrop-blur-sm shadow-xl shadow-black/60 py-1 text-zinc-200"
        >
          {sorted.length === 0 ? (
            <div className="px-3 py-1.5 text-[11px] text-zinc-500">
              No saved queries yet.
            </div>
          ) : (
            sorted.map((q) => {
              const active = q.name === activeName;
              return (
                <div
                  key={q.name}
                  className="group flex items-center gap-1 pl-3 pr-1.5 hover:bg-zinc-800"
                >
                  <button
                    onClick={() => {
                      onApply(q.name);
                      setOpen(false);
                    }}
                    className="flex-1 min-w-0 flex items-center gap-2 py-1.5 text-left"
                    title={`Load "${q.name}"`}
                  >
                    <FloppyDisk size={14} weight="fill" className="text-emerald-400 shrink-0" />
                    <span className={clsx("truncate", active && "font-semibold text-zinc-100")}>
                      {q.name}
                    </span>
                  </button>
                  <button
                    onClick={() => {
                      if (confirm(`Delete the saved query "${q.name}"?`)) onDelete(q.name);
                    }}
                    className="shrink-0 p-1 rounded text-zinc-500 hover:text-rose-300 hover:bg-zinc-700 opacity-0 group-hover:opacity-100 transition"
                    title={`Delete "${q.name}"`}
                    aria-label={`Delete ${q.name}`}
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
              Save current query
            </div>
            <div className="flex items-center gap-1.5">
              <input
                data-el="saved-query-name-input"
                value={name}
                onChange={(e) => setName(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") submitSave();
                }}
                placeholder="Query name"
                style={{ fontSize: 12 }}
                className="flex-1 min-w-0 bg-zinc-950 border border-zinc-700 rounded px-2 py-1 text-zinc-100 placeholder:text-zinc-600 outline-none focus:border-accent-500"
              />
              <button
                onClick={submitSave}
                disabled={!trimmed}
                title={overwrites ? "Overwrite existing query" : "Save query"}
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
