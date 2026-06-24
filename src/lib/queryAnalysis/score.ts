import type { Finding, Grade, Severity } from "./types";

const SEVERITY_PENALTY: Record<Severity, number> = {
  critical: 45,
  high: 25,
  medium: 12,
  low: 5,
  info: 0,
};

export const SEVERITY_ORDER: Record<Severity, number> = {
  critical: 4,
  high: 3,
  medium: 2,
  low: 1,
  info: 0,
};

/** Most-impactful first; severity breaks ties. */
export function byImpact(a: Finding, b: Finding): number {
  return (
    b.impact - a.impact || SEVERITY_ORDER[b.severity] - SEVERITY_ORDER[a.severity]
  );
}

export function scoreFindings(findings: Finding[]): { score: number; grade: Grade } {
  let score = 100;
  for (const f of findings) {
    /* Penalty scaled by the finding's relative impact so a critical issue that's
       62% of cost hurts more than one that's 5%. */
    score -= SEVERITY_PENALTY[f.severity] * (0.5 + 0.5 * f.impact);
  }
  score = Math.max(0, Math.min(100, Math.round(score)));
  const grade: Grade =
    score >= 90 ? "A" : score >= 75 ? "B" : score >= 60 ? "C" : score >= 40 ? "D" : "F";
  return { score, grade };
}

export function buildHeadline(findings: Finding[], grade: Grade): string {
  if (findings.length === 0) {
    return "No problems detected — this query is well-indexed for the current data.";
  }
  const top = findings[0];
  const tail =
    findings.length > 1
      ? ` (+${findings.length - 1} more suggestion${findings.length - 1 === 1 ? "" : "s"})`
      : "";
  const mag = top.impactLabel ? ` — ${top.impactLabel}` : "";
  return `${gradeWord(grade)}: ${top.title}${mag}.${tail}`;
}

function gradeWord(grade: Grade): string {
  switch (grade) {
    case "A":
      return "Minor";
    case "B":
      return "Good, with one fix";
    case "C":
      return "Needs work";
    case "D":
      return "Slow";
    case "F":
      return "Critical";
  }
}
