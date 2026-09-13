import { useEffect, useState } from "react";
import { Asterisk, CircleNotch, X } from "@phosphor-icons/react";
import { ipc } from "../ipc";
import { SearchableSelect } from "./SearchableSelect";
import type { SelectStar } from "../lib/selectStar";

interface Props {
  profileId: string;
  database: string;
  tables: string[];
  star: SelectStar;
  /** How many select-list stars the SQL holds; named in the dialog when > 1. */
  starCount: number;
  onSubmit: (columns: string[]) => void;
  onClose: () => void;
}

/** Picks a table and its columns to replace a select-list `*`. */
export function ExpandStarDialog({ profileId, database, tables, star, starCount, onSubmit, onClose }: Props) {
  const [table, setTable] = useState(star.table ?? "");
  const [columns, setColumns] = useState<string[] | null>(null);
  const [checked, setChecked] = useState<Set<string>>(new Set());
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  useEffect(() => {
    if (!table) { setColumns(null); return; }
    let cancelled = false;
    setColumns(null);
    setError(null);
    ipc.listColumns(profileId, database, table)
      .then((cols) => {
        if (cancelled) return;
        const names = cols.map((c) => c.name);
        setColumns(names);
        setChecked(new Set(names));
      })
      .catch((e) => { if (!cancelled) { setColumns([]); setError(String(e)); } });
    return () => { cancelled = true; };
  }, [profileId, database, table]);

  const toggle = (name: string, on: boolean) =>
    setChecked((prev) => {
      const next = new Set(prev);
      if (on) next.add(name); else next.delete(name);
      return next;
    });
  const ordered = (columns ?? []).filter((c) => checked.has(c));
  const target = star.alias ? `${star.alias}.*` : "*";

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm">
      <div
        data-el="expand-star-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby="expand-star-title"
        className="flex max-h-[85vh] w-[440px] max-w-[95vw] flex-col rounded-lg border border-zinc-700 bg-zinc-900 text-zinc-200 shadow-2xl shadow-black/60"
      >
        <div className="flex items-center justify-between border-b border-zinc-800 px-4 py-3">
          <h2 id="expand-star-title" className="flex items-center gap-2 text-sm font-semibold">
            <Asterisk size={16} weight="bold" className="text-accent-400" />
            Replace <span className="font-mono text-accent-400">{target}</span> with columns
          </h2>
          <button type="button" onClick={onClose} aria-label="Close" className="p-1 text-zinc-400 hover:text-white">
            <X size={16} />
          </button>
        </div>

        <div className="min-h-0 flex-1 space-y-3 overflow-y-auto p-4 text-[12px]">
          {starCount > 1 && (
            <p className="text-[11px] text-zinc-400">
              The SQL has {starCount} stars. This replaces the one nearest the cursor
              {star.table ? <>, which reads from <span className="font-mono text-zinc-200">{star.table}</span></> : null}.
            </p>
          )}
          <label className="block text-[11px] text-zinc-400">
            Table
            <SearchableSelect
              dataEl="expand-star-table"
              value={table}
              options={tables}
              placeholder="Choose a table…"
              onChange={setTable}
              className="mt-1"
            />
          </label>

          {table && (
            <div>
              <div className="mb-1 flex items-center justify-between text-[11px] text-zinc-400">
                <span>Columns{columns ? ` (${ordered.length} of ${columns.length})` : ""}</span>
                {columns && columns.length > 0 && (
                  <span className="flex gap-2">
                    <button type="button" onClick={() => setChecked(new Set(columns))} className="text-accent-400 hover:underline">All</button>
                    <button type="button" onClick={() => setChecked(new Set())} className="text-accent-400 hover:underline">None</button>
                  </span>
                )}
              </div>
              <div className="max-h-[40vh] overflow-auto rounded border border-zinc-800 bg-[#1d2029]">
                {columns === null ? (
                  <div className="flex items-center gap-2 px-3 py-2 text-zinc-500">
                    <CircleNotch size={14} className="animate-spin" /> Loading columns…
                  </div>
                ) : columns.length === 0 ? (
                  <div className="px-3 py-2 text-zinc-500">{error ?? "No columns found."}</div>
                ) : (
                  columns.map((name) => (
                    <label key={name} className="flex cursor-pointer items-center gap-2 px-3 py-1 font-mono text-zinc-200 hover:bg-zinc-800/40">
                      <input
                        type="checkbox"
                        className="dbs-check"
                        checked={checked.has(name)}
                        onChange={(e) => toggle(name, e.target.checked)}
                      />
                      <span className="truncate">{name}</span>
                    </label>
                  ))
                )}
              </div>
            </div>
          )}
        </div>

        <div className="flex items-center justify-end gap-2 border-t border-zinc-800 p-3 text-[12px]">
          <button type="button" onClick={onClose} className="rounded px-3 py-1.5 text-zinc-400 hover:bg-zinc-800">
            Cancel
          </button>
          <button
            type="button"
            data-el="expand-star-submit"
            disabled={ordered.length === 0}
            onClick={() => onSubmit(ordered)}
            className="rounded bg-accent-500 px-3 py-1.5 font-semibold text-zinc-950 hover:bg-accent-400 disabled:opacity-40"
          >
            OK
          </button>
        </div>
      </div>
    </div>
  );
}
