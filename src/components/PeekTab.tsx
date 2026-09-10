import { helpHandlers } from "../state/help";
import { useEffect, useState } from "react";
import { listen } from "@tauri-apps/api/event";
import clsx from "clsx";
import { ipc } from "../ipc";
import { TABLE_CHANGED_EVENT, type TableChanged } from "../lib/relatedExistence";
import type { PeekSeed } from "../types";

type HostedPeek = NonNullable<PeekSeed["hostedPeeks"]>[number];

/** Count the relation's rows independently of each panel's extra filters. */
export function PeekTab({ peek, active, onSelect, idPrefix = "", accentColor }: {
  peek: HostedPeek; active: boolean; onSelect: () => void; idPrefix?: string;
  accentColor?: string;
}) {
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
      "group relative flex shrink-0 items-center border-r border-r-zinc-800/60 border-b",
      active ? "bg-[var(--peek-tint,#2d2a3b)] text-zinc-100 border-b-transparent" : "text-zinc-400 hover:bg-zinc-900/50 border-b-zinc-800/80"
    )}>
      {active && accentColor && <span aria-hidden="true" className="absolute inset-x-0 top-0 h-[3px] pointer-events-none" style={{ backgroundColor: accentColor }} />}
      <button role="tab" id={`${idPrefix}tab-${peek.id}`} aria-controls={`${idPrefix}panel-${peek.id}`} aria-selected={active}
        onClick={onSelect} className="flex min-h-14 min-w-0 flex-col items-center justify-center gap-1 px-8 py-1.5 text-center text-[13px] font-bold leading-tight"
        {...helpHandlers(`${peek.title}: ${peek.sourceTable}.${peek.sourceColumn} → ${peek.target.table}.${peek.target.column}${empty ? " — no related records" : ""}`)}>
        <span className={clsx(
          "shrink-0 rounded px-1 py-px text-[8px] font-semibold uppercase tracking-wide",
          peek.kind === "has_many" ? "bg-accent-500/15 text-accent-300" : "bg-amber-500/15 text-amber-300",
          empty && "opacity-40"
        )}>
          {peek.kind === "has_many" ? "has many" : "has one"}
        </span>
        <span className="flex min-w-0 items-center justify-center gap-2">
        <span className={clsx("max-w-64 truncate", empty && "opacity-40")}>{peek.title}</span>
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
