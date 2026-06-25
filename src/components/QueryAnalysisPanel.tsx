import { useEffect, useState } from "react";
import { X, Gauge, CheckCircle, Lightbulb, TreeStructure } from "@phosphor-icons/react";
import clsx from "clsx";
import { AnalysisFinding } from "./AnalysisFinding";
import { PlanBreakdown } from "./PlanBreakdown";
import { useUi } from "../state/ui";
import type { AnalysisResult, Grade } from "../lib/queryAnalysis/types";

const GRADE_STYLE: Record<Grade, string> = {
  A: "bg-emerald-500 text-emerald-950",
  B: "bg-lime-500 text-lime-950",
  C: "bg-amber-500 text-amber-950",
  D: "bg-orange-500 text-orange-950",
  F: "bg-rose-500 text-rose-950",
};

export function QueryAnalysisPanel({
  analysis,
  profileId,
  database,
  onClose,
  onReExplain,
}: {
  analysis: AnalysisResult;
  profileId: string;
  database: string;
  onClose: () => void;
  onReExplain: () => void;
}) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  const width = useUi((s) => s.analysisPanelWidth);
  const setWidth = useUi((s) => s.setAnalysisPanelWidth);

  /* Drag the left edge to resize. The panel is anchored to the right, so moving
     the pointer left (clientX decreasing) widens it. The width persists. */
  const startResize = (e: React.PointerEvent) => {
    e.preventDefault();
    const startX = e.clientX;
    const startW = width;
    const onMove = (ev: PointerEvent) => setWidth(startW + (startX - ev.clientX));
    const onUp = () => {
      document.removeEventListener("pointermove", onMove);
      document.removeEventListener("pointerup", onUp);
      document.body.style.cursor = "";
      document.body.style.userSelect = "";
    };
    document.body.style.cursor = "col-resize";
    document.body.style.userSelect = "none";
    document.addEventListener("pointermove", onMove);
    document.addEventListener("pointerup", onUp);
  };

  const [view, setView] = useState<"suggestions" | "plan">("suggestions");
  const { grade, score, headline, findings, plan, meta } = analysis;

  return (
    <div
      data-el="query-analysis-panel"
      style={{ width }}
      className="absolute top-0 right-0 z-40 h-full max-w-[92vw] flex flex-col border-l border-zinc-800 bg-zinc-950/95 backdrop-blur-sm shadow-2xl shadow-black/60"
    >
      {/* Left-edge resize grip. */}
      <div
        data-el="analysis-resize-handle"
        onPointerDown={startResize}
        className="absolute left-0 top-0 z-10 h-full w-1.5 cursor-col-resize hover:bg-accent-500/40 transition-colors"
        title="Drag to resize"
      />

      <div className="shrink-0 flex items-center gap-2 px-3 h-10 border-b border-zinc-800 dbs-toolbar">
        <Gauge size={17} className="text-accent-400 shrink-0" />
        <span className="text-[13px] font-semibold text-zinc-100">Query Analysis</span>
        <button
          onClick={onClose}
          className="ml-auto text-zinc-500 hover:text-zinc-200"
          aria-label="Close analysis"
        >
          <X size={17} />
        </button>
      </div>

      <div className="flex-1 overflow-y-auto p-3 space-y-3">
        {/* Grade header */}
        <div className="flex items-center gap-3 rounded-lg border border-zinc-800 bg-zinc-900/60 p-3">
          <div
            className={clsx(
              "flex h-12 w-12 shrink-0 items-center justify-center rounded-lg text-2xl font-black",
              GRADE_STYLE[grade]
            )}
          >
            {grade}
          </div>
          <div className="min-w-0">
            <div className="text-[12px] text-zinc-400">
              Score <span className="text-zinc-200 font-semibold tabular-nums">{score}</span>/100
            </div>
            <div className="text-[12.5px] text-zinc-200 leading-snug mt-0.5">{headline}</div>
          </div>
        </div>

        {/* Meta */}
        <div className="flex flex-wrap gap-x-3 gap-y-1 text-[11px] text-zinc-500 px-0.5">
          <span>MySQL {meta.serverVersion}</span>
          {meta.queryCost != null && (
            <span>· cost <span className="text-zinc-300 tabular-nums">{meta.queryCost.toLocaleString()}</span></span>
          )}
          <span>· {meta.tablesAnalyzed} table{meta.tablesAnalyzed === 1 ? "" : "s"}</span>
          {meta.measured && <span className="text-emerald-400">· measured (ANALYZE)</span>}
        </div>
        {meta.note && (
          <div className="text-[11px] text-amber-400/90 px-0.5">{meta.note}</div>
        )}

        {/* Tabs + their body share the zinc-900 surface (matches the app tabs) */}
        <div>
          <div className="flex items-center gap-1 border-b border-zinc-800">
            {([
              {
                id: "suggestions",
                label: `Suggestions${findings.length ? ` (${findings.length})` : ""}`,
                icon: <Lightbulb size={15} weight="fill" />,
              },
              { id: "plan", label: "Plan", icon: <TreeStructure size={15} weight="bold" /> },
            ] as const).map(({ id, label, icon }) => (
              <button
                key={id}
                onClick={() => setView(id)}
                className={clsx(
                  "inline-flex items-center gap-1.5 px-2.5 py-1.5 text-[12px] font-semibold border-b-2 -mb-px rounded-t transition-colors",
                  view === id
                    ? "border-accent-400 text-accent-200 bg-zinc-900"
                    : "border-transparent text-zinc-500 hover:text-zinc-300"
                )}
              >
                {icon}
                {label}
              </button>
            ))}
          </div>

          <div className="bg-zinc-900 rounded-b-md p-3">
            {view === "plan" ? (
              <PlanBreakdown plan={plan} />
            ) : findings.length === 0 ? (
              <div className="flex flex-col items-center justify-center gap-2 rounded-lg border border-emerald-800/40 bg-emerald-950/20 py-8 text-center">
                <CheckCircle size={28} weight="fill" className="text-emerald-400" />
                <div className="text-[13px] font-semibold text-emerald-200">No issues found</div>
                <div className="text-[11.5px] text-zinc-400 max-w-[280px]">
                  This query is well-indexed for the current data. Nice work. See the
                  Plan tab to learn how each step is executed.
                </div>
              </div>
            ) : (
              <div className="space-y-2.5">
                <div className="text-[11px] font-semibold uppercase tracking-wide text-zinc-500 px-0.5">
                  {findings.length} suggestion{findings.length === 1 ? "" : "s"} · most impactful first
                </div>
                {findings.map((f) => (
                  <AnalysisFinding
                    key={f.id}
                    finding={f}
                    profileId={profileId}
                    database={database}
                    onApplied={onReExplain}
                  />
                ))}
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
