import { useState } from "react";
import { CaretRight, Info } from "@phosphor-icons/react";
import clsx from "clsx";
import { TYPE_LADDER, type Rating } from "../lib/queryAnalysis/explainGlossary";
import type { PlanRowInfo } from "../lib/queryAnalysis/types";

const RATING_DOT: Record<Rating, string> = {
  excellent: "bg-emerald-400",
  good: "bg-lime-400",
  ok: "bg-amber-400",
  warn: "bg-orange-400",
  bad: "bg-rose-400",
  neutral: "bg-zinc-500",
};

const RATING_TEXT: Record<Rating, string> = {
  excellent: "text-emerald-300",
  good: "text-lime-300",
  ok: "text-amber-300",
  warn: "text-orange-300",
  bad: "text-rose-300",
  neutral: "text-zinc-300",
};

interface StatRow {
  stat: string;
  value: string;
  rating: Rating;
  help: string;
}

function StatTable({ rows }: { rows: StatRow[] }) {
  return (
    <table className="mt-2 w-full table-fixed border-collapse text-[11.5px]">
      <colgroup>
        <col className="w-[110px]" />
        <col className="w-[160px]" />
        <col />
      </colgroup>
      <thead>
        <tr className="text-[10px] uppercase tracking-wide text-zinc-600">
          <th className="text-left font-semibold pb-1 pr-2">Stat</th>
          <th className="text-left font-semibold pb-1 pr-2">Value</th>
          <th className="text-left font-semibold pb-1">Help</th>
        </tr>
      </thead>
      <tbody>
        {rows.map((r, i) => (
          <tr key={i} className="border-t border-zinc-800 align-top">
            <td className="py-1.5 pr-2 font-mono text-zinc-400 break-words">{r.stat}</td>
            <td className="py-1.5 pr-2">
              <span
                className={clsx(
                  "font-mono font-medium [overflow-wrap:anywhere]",
                  RATING_TEXT[r.rating]
                )}
              >
                {r.value}
              </span>
            </td>
            <td className="py-1.5 text-zinc-400 leading-snug">{r.help}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

function PlanRowCard({ row }: { row: PlanRowInfo }) {
  const rows: StatRow[] = [
    ...row.metrics
      .filter((m) => m.value != null && m.value !== "")
      .map((m) => ({ stat: m.label, value: m.value as string, rating: m.rating, help: m.meaning })),
    ...row.extra.map((e) => ({ stat: "Extra", value: e.flag, rating: e.rating, help: e.meaning })),
  ];

  return (
    <div className="rounded-lg border border-zinc-800 bg-zinc-950 p-3">
      <div className="flex items-center gap-2 flex-wrap">
        <span className="font-mono text-[13px] font-semibold text-zinc-100">
          {row.table}
        </span>
        {row.selectType && row.selectType.toUpperCase() !== "SIMPLE" && (
          <span className="rounded border border-zinc-700 bg-zinc-800 px-1.5 py-px text-[10px] font-semibold uppercase tracking-wide text-zinc-300">
            {row.selectType}
          </span>
        )}
      </div>
      <StatTable rows={rows} />
    </div>
  );
}

export function PlanBreakdown({ plan }: { plan: PlanRowInfo[] }) {
  const [legendOpen, setLegendOpen] = useState(false);

  if (plan.length === 0) {
    return (
      <div className="text-[12px] text-zinc-500 px-1 py-4 text-center">
        No EXPLAIN rows were returned for this statement.
      </div>
    );
  }

  return (
    <div className="space-y-2.5">
      <div className="text-[11px] text-zinc-500 px-0.5">
        Each step the optimizer runs, with its stats decoded and rated.
        <span className="ml-1 text-emerald-300">good</span> ·
        <span className="ml-1 text-amber-300">watch</span> ·
        <span className="ml-1 text-rose-300">problem</span>.
      </div>

      {plan.map((row, i) => (
        <PlanRowCard key={`${row.table}-${i}`} row={row} />
      ))}

      {/* Legend: the access-type ladder, best → worst */}
      <div className="rounded-lg border border-zinc-800 bg-zinc-950">
        <button
          onClick={() => setLegendOpen((o) => !o)}
          className="flex w-full items-center gap-1.5 px-3 py-2 text-[11.5px] font-semibold text-zinc-300 hover:bg-zinc-800/40"
        >
          <Info size={14} className="text-accent-400" />
          The `type` ladder (best → worst)
          <CaretRight
            size={12}
            className={clsx("ml-auto transition-transform", legendOpen && "rotate-90")}
          />
        </button>
        {legendOpen && (
          <div className="space-y-1 border-t border-zinc-800 px-3 py-2">
            {TYPE_LADDER.map((t) => (
              <div key={t.type} className="flex items-start gap-2 text-[11px] leading-snug">
                <span className={clsx("mt-1 h-1.5 w-1.5 shrink-0 rounded-full", RATING_DOT[t.rating])} />
                <span>
                  <span className="font-mono font-semibold text-zinc-200">{t.type}</span>
                  <span className="text-zinc-400"> — {t.note}</span>
                </span>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
