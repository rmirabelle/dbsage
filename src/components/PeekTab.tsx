import { helpHandlers } from "../state/help";
import { useEffect, useRef, useState } from "react";
import { listen } from "@tauri-apps/api/event";
import clsx from "clsx";
import { ipc } from "../ipc";
import { TABLE_CHANGED_EVENT, type TableChanged } from "../lib/relatedExistence";
import type { PeekSeed } from "../types";

type HostedPeek = NonNullable<PeekSeed["hostedPeeks"]>[number];

/** Count the relation's rows independently of each panel's extra filters. */
export function PeekTab({ peek, active, onSelect, onContextMenu, idPrefix = "", accentColor, parentTitle, renaming = false, onRename }: {
  peek: HostedPeek; active: boolean; onSelect: () => void; idPrefix?: string;
  /** Right-click on the tab (the host shows its close menu). */
  onContextMenu?: (x: number, y: number) => void;
  /** The tab shows an input in place of its name; Enter commits (an empty
   * value restores the relation name), Escape or blur commits as well. */
  renaming?: boolean;
  onRename?: (label: string | null) => void;
  accentColor?: string;
  /** The hosting peek's relation name when this peek is nested under another
   * peek. Nested tabs are shorter, single-line tabs with the has-one /
   * has-many badge inline, and the help text names the parent relation. */
  parentTitle?: string;
}) {
  const nested = parentTitle != null;
  const name = peek.customTitle ?? peek.title;
  const [draft, setDraft] = useState(name);
  const inputRef = useRef<HTMLInputElement>(null);
  useEffect(() => {
    if (!renaming) return;
    setDraft(peek.customTitle ?? "");
    inputRef.current?.focus();
    inputRef.current?.select();
  }, [renaming, peek.customTitle]);
  const commitRename = () => onRename?.(draft.trim() || null);
  const [rowCount, setRowCount] = useState<number | null>(null);
  const empty = rowCount === 0;
  const [revision, setRevision] = useState(0);
  useEffect(() => {
    const un = listen<TableChanged>(TABLE_CHANGED_EVENT, ({ payload: m }) => {
      if (m.profileId === peek.profileId && m.database === peek.database && m.table === peek.target.table) {
        setRevision((r) => r + 1);
      }
    });
    return () => { void un.then((f) => f()); };
  }, [peek.profileId, peek.database, peek.target.table]);
  useEffect(() => {
    let cancelled = false;
    setRowCount(null);
    if (peek.target.value == null) { setRowCount(0); return; }
    void ipc.countRows({
      profileId: peek.profileId, database: peek.database, table: peek.target.table,
      filters: [{ column: peek.target.column, op: "equals", value: peek.target.value }],
    }).then((n) => { if (!cancelled) setRowCount(n); })
      .catch(() => { if (!cancelled) setRowCount(null); });
    return () => { cancelled = true; };
  }, [peek.profileId, peek.database, peek.target.table, peek.target.column, peek.target.value, revision]);
  return (
    <div className={clsx(
      "group relative flex shrink-0 items-center border-r border-r-zinc-700 border-b",
      active ? "bg-[var(--peek-tint,#2d2a3b)] text-zinc-100 border-b-transparent" : "border-t border-t-zinc-700 text-zinc-400 hover:bg-zinc-900/50 border-b-zinc-700"
    )}>
      {active && accentColor && <span aria-hidden="true" className="absolute inset-x-0 top-0 h-[3px] pointer-events-none" style={{ backgroundColor: accentColor }} />}
      <button role="tab" id={`${idPrefix}tab-${peek.id}`} aria-controls={`${idPrefix}panel-${peek.id}`} aria-selected={active}
        onClick={onSelect}
        onContextMenu={(e) => { if (!onContextMenu) return; e.preventDefault(); e.stopPropagation(); onContextMenu(e.clientX, e.clientY); }}
        className={clsx(
          "flex min-w-0 items-center justify-center gap-1 py-1.5 text-center text-[13px] font-bold leading-tight",
          nested ? "min-h-9 flex-row gap-2 px-4" : "min-h-14 flex-col px-8"
        )}
        {...helpHandlers(nested
          ? `${parentTitle} › ${name}${empty ? " — no related records" : ""}`
          : `${name}: ${peek.sourceTable}.${peek.sourceColumn} → ${peek.target.table}.${peek.target.column}${empty ? " — no related records" : ""}`)}>
        {!nested && <span className={clsx(
          "shrink-0 rounded px-1 py-px text-[8px] font-semibold uppercase tracking-wide",
          peek.kind === "has_many" ? "bg-accent-500/15 text-accent-300" : "bg-amber-500/15 text-amber-300",
          empty && "opacity-40"
        )}>
          {peek.kind === "has_many" ? "has many" : "has one"}
        </span>}
        <span className="flex min-w-0 items-center justify-center gap-2">
        {renaming ? (
          <input
            ref={inputRef}
            data-el="peek-tab-rename"
            aria-label="Peek tab name"
            value={draft}
            placeholder={peek.title}
            onChange={(e) => setDraft(e.target.value)}
            onClick={(e) => e.stopPropagation()}
            onBlur={commitRename}
            onKeyDown={(e) => {
              if (e.key === "Enter") { e.preventDefault(); commitRename(); }
              if (e.key === "Escape") { e.preventDefault(); e.stopPropagation(); commitRename(); }
            }}
            className="w-40 rounded border border-accent-500 bg-zinc-950 px-1.5 py-px text-center font-bold text-zinc-100 outline-none"
          />
        ) : (
          <span className={clsx("max-w-64 truncate", empty && "opacity-40")}>
            {name}
          </span>
        )}
        {peek.kind === "has_many" && rowCount != null && rowCount > 0 && (
          <span className="shrink-0 rounded-full bg-violet-500/20 px-1.5 py-0.5 text-[10px] font-semibold tabular-nums text-violet-200"
            aria-label={`${rowCount.toLocaleString()} related rows`}>
            {rowCount.toLocaleString()}
          </span>
        )}
        </span>
      </button>
    </div>
  );
}
