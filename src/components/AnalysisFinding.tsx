import { useState } from "react";
import {
  Warning,
  Lightbulb,
  Copy,
  Check,
  ArrowSquareOut,
  Lightning,
  CircleNotch as Loader2,
} from "@phosphor-icons/react";
import { openUrl } from "@tauri-apps/plugin-opener";
import clsx from "clsx";
import { ipc } from "../ipc";
import { notifyError, notifySuccess } from "../state/notify";
import type { Finding, Severity } from "../lib/queryAnalysis/types";

const SEVERITY_STYLE: Record<Severity, { chip: string; label: string }> = {
  critical: { chip: "bg-rose-500/20 text-rose-300 border-rose-500/40", label: "Critical" },
  high: { chip: "bg-orange-500/20 text-orange-300 border-orange-500/40", label: "High" },
  medium: { chip: "bg-amber-500/20 text-amber-300 border-amber-500/40", label: "Medium" },
  low: { chip: "bg-sky-500/20 text-sky-300 border-sky-500/40", label: "Low" },
  info: { chip: "bg-zinc-500/20 text-zinc-300 border-zinc-500/40", label: "Info" },
};

function CodeBlock({
  code,
  onApply,
  applying,
}: {
  code: string;
  onApply?: () => void;
  applying?: boolean;
}) {
  const [copied, setCopied] = useState(false);
  const copy = () => {
    navigator.clipboard.writeText(code).then(
      () => {
        setCopied(true);
        window.setTimeout(() => setCopied(false), 1200);
      },
      () => notifyError("Could not copy to clipboard.")
    );
  };
  return (
    <div className="mt-2 rounded-md border border-zinc-800 bg-zinc-950">
      <pre className="px-3 py-2 overflow-x-auto text-[11.5px] leading-relaxed font-mono text-emerald-200 whitespace-pre-wrap break-words">
        {code}
      </pre>
      <div className="flex items-center gap-1.5 border-t border-zinc-800 px-2 py-1.5">
        <button
          onClick={copy}
          className="inline-flex items-center gap-1 px-2 py-0.5 rounded text-[11px] font-semibold bg-zinc-800 text-zinc-200 hover:bg-zinc-700 transition-colors"
        >
          {copied ? <Check size={13} className="text-emerald-400" /> : <Copy size={13} />}
          {copied ? "Copied" : "Copy"}
        </button>
        {onApply && (
          <button
            onClick={onApply}
            disabled={applying}
            className="inline-flex items-center gap-1 px-2 py-0.5 rounded text-[11px] font-semibold bg-emerald-500 text-emerald-950 hover:bg-emerald-400 disabled:opacity-60 transition-colors"
          >
            {applying ? <Loader2 size={13} className="animate-spin" /> : <Lightning size={13} weight="fill" />}
            {applying ? "Applying…" : "Apply"}
          </button>
        )}
      </div>
    </div>
  );
}

export function AnalysisFinding({
  finding,
  profileId,
  database,
  onApplied,
}: {
  finding: Finding;
  profileId: string;
  database: string;
  onApplied?: () => void;
}) {
  const [applying, setApplying] = useState(false);
  const sev = SEVERITY_STYLE[finding.severity];

  const apply = async () => {
    if (!finding.ddl) return;
    setApplying(true);
    try {
      await ipc.runDdl(profileId, database, finding.ddl);
      notifySuccess("Applied. Re-run Explain to see the new grade.");
      onApplied?.();
    } catch (e) {
      notifyError(`Could not apply: ${String(e)}`);
    } finally {
      setApplying(false);
    }
  };

  return (
    <div
      data-el="analysis-finding"
      className="rounded-lg border border-zinc-800 bg-zinc-950 p-3"
    >
      <div className="flex items-start gap-2">
        <Warning size={16} weight="fill" className="mt-0.5 shrink-0 text-amber-400" />
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2 flex-wrap">
            <span
              className={clsx(
                "inline-flex items-center rounded border px-1.5 py-px text-[10px] font-bold uppercase tracking-wide",
                sev.chip
              )}
            >
              {sev.label}
            </span>
            <h4 className="text-[13px] font-semibold text-zinc-100">{finding.title}</h4>
          </div>
          {finding.impactLabel && (
            <div className="mt-0.5 text-[11px] text-zinc-400 tabular-nums">
              {finding.measured ? "measured: " : ""}
              {finding.impactLabel}
            </div>
          )}
        </div>
      </div>

      <p className="mt-2 text-[12px] leading-relaxed text-zinc-300">{finding.why}</p>

      <div className="my-4 flex items-start gap-1.5 text-[12px] leading-relaxed text-emerald-200/90">
        <Lightbulb size={14} weight="fill" className="mt-0.5 shrink-0 text-emerald-400" />
        <span>{finding.fix}</span>
      </div>

      {finding.ddl && (
        <CodeBlock code={finding.ddl} onApply={apply} applying={applying} />
      )}
      {finding.rewriteSql && <CodeBlock code={finding.rewriteSql} />}

      {finding.docUrl && (
        <button
          onClick={() => void openUrl(finding.docUrl!)}
          className="mt-2 inline-flex items-center gap-1 text-[11px] text-accent-400 hover:text-accent-300"
        >
          <ArrowSquareOut size={13} />
          {finding.docLabel ?? "Learn more"}
        </button>
      )}
    </div>
  );
}
