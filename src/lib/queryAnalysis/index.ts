/**
 * Orchestrates the query analysis: normalize the plan, run the SQL-text smell
 * checks and the rule catalog, sort findings by impact, and grade. Pure and
 * synchronous — given the backend bundle it returns a UI-ready AnalysisResult.
 */
import type { AnalysisResult, QueryAnalysisInput } from "./types";
import { parsePlan, type NormalizedPlan } from "./parsePlan";
import { inspectSql } from "./sqlInspect";
import { orderByColumns, orderByRefs } from "./format";
import { RULES, type RuleContext } from "./rules";
import { byImpact, scoreFindings, buildHeadline } from "./score";
import { buildPlanBreakdown } from "./planBreakdown";

const EMPTY_PLAN: NormalizedPlan = {
  queryCost: null,
  tables: [],
  usingFilesort: false,
  usingTemporary: false,
};

export function analyzeQueryBundle(
  input: QueryAnalysisInput,
  sql: string
): AnalysisResult {
  const plan = parsePlan(input.explainJson) ?? EMPTY_PLAN;
  const measured = !!input.analyzeTree;
  const ctx: RuleContext = {
    plan,
    tablesByName: new Map(input.tables.map((t) => [t.name, t])),
    sql,
    smells: inspectSql(sql),
    orderByCols: orderByColumns(sql),
    orderByRefs: orderByRefs(sql),
    measured,
  };

  let findings = RULES.flatMap((rule) => rule(ctx)).sort(byImpact);
  /* When a query-shape rewrite is the root cause, the filesort/temp-table
     findings are just its symptoms — drop them so the advice isn't
     contradictory (they'd point at indexes that won't help). */
  if (findings.some((f) => f.ruleId === "left-join-where-filter")) {
    findings = findings.filter(
      (f) => f.ruleId !== "filesort" && f.ruleId !== "temporary"
    );
  }
  const { score, grade } = scoreFindings(findings);

  return {
    grade,
    score,
    headline: buildHeadline(findings, grade),
    findings,
    plan: buildPlanBreakdown(input),
    meta: {
      serverVersion: input.serverVersion,
      measured,
      queryCost: plan.queryCost,
      tablesAnalyzed: input.tables.length,
      note: input.explainJson
        ? undefined
        : "No JSON execution plan was available; analysis is limited to SQL-level checks.",
    },
  };
}

export type { AnalysisResult } from "./types";
