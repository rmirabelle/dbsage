/**
 * Types shared between the backend `analyze_query` bundle and the frontend
 * analysis engine that grades a query from it.
 */

/* ── Input bundle (mirrors the Rust QueryAnalysisInput) ──────────────────── */

export interface AnalyzeIndexInfo {
  name: string;
  nonUnique: boolean;
  /** Columns in key order. */
  columns: string[];
  /** Estimated distinct values; null when unknown. */
  cardinality: number | null;
  indexType: string;
}

export interface AnalyzeColumnDef {
  name: string;
  columnType: string;
  nullable: boolean;
  key: string;
  defaultValue: string | null;
  extra: string;
  comment: string;
}

export interface AnalyzeTableInfo {
  /** The name the plan uses (the alias when the query aliases the table). */
  name: string;
  /** The real base-table name (used for generated DDL). */
  realName: string;
  schema: string;
  /** TABLE_ROWS — an estimate for InnoDB. */
  tableRows: number | null;
  engine: string | null;
  columns: AnalyzeColumnDef[];
  indexes: AnalyzeIndexInfo[];
}

export interface QueryAnalysisInput {
  serverVersion: string;
  readOnly: boolean;
  explainJson: string | null;
  explainColumns: string[];
  explainRows: Record<string, unknown>[];
  warnings: string[];
  analyzeTree: string | null;
  tables: AnalyzeTableInfo[];
}

/* ── Engine output ───────────────────────────────────────────────────────── */

import type { Rating } from "./explainGlossary";

export type Severity = "critical" | "high" | "medium" | "low" | "info";
export type Grade = "A" | "B" | "C" | "D" | "F";

/** One decoded EXPLAIN stat: its value, a quality rating, and what it means. */
export interface PlanMetric {
  key: string;
  label: string;
  value: string | null;
  rating: Rating;
  meaning: string;
}

/** One row of the decoded EXPLAIN plan (one table/step), for the teaching view. */
export interface PlanRowInfo {
  table: string;
  selectType: string | null;
  metrics: PlanMetric[];
  extra: { flag: string; rating: Rating; meaning: string }[];
}

export type FindingCategory =
  | "access"
  | "ordering"
  | "joins"
  | "predicates"
  | "projection"
  | "subquery"
  | "pagination"
  | "stats";

export interface Finding {
  /** Unique per occurrence (ruleId + table). */
  id: string;
  ruleId: string;
  title: string;
  category: FindingCategory;
  severity: Severity;
  /** 0..1 relative impact, used to sort findings most- to least-important. */
  impact: number;
  /** Short magnitude phrase ("~1.2M rows examined", "62% of query cost"). */
  impactLabel?: string;
  /** True when derived from EXPLAIN ANALYZE (measured, not estimated). */
  measured: boolean;
  table?: string;
  /** Plain-English explanation of what is happening and why it's slow. */
  why: string;
  /** What to do about it. */
  fix: string;
  /** Copy/apply-able DDL (CREATE INDEX …). */
  ddl?: string;
  /** Suggested rewritten SQL, when applicable. */
  rewriteSql?: string;
  docUrl?: string;
  docLabel?: string;
}

export interface AnalysisResult {
  grade: Grade;
  /** 0..100. */
  score: number;
  headline: string;
  /** Sorted by impact, descending. */
  findings: Finding[];
  /** Decoded EXPLAIN stats per plan step (the teaching view). */
  plan: PlanRowInfo[];
  meta: {
    serverVersion: string;
    /** True when EXPLAIN ANALYZE timings were available. */
    measured: boolean;
    queryCost: number | null;
    tablesAnalyzed: number;
    /** Set when EXPLAIN produced no usable plan. */
    note?: string;
  };
}
