/**
 * Normalize `EXPLAIN FORMAT=JSON` output into a flat, typed shape the rules can
 * read without knowing MySQL's nested plan structure. A generic recursive walk
 * is used deliberately — the JSON nests differently across query shapes
 * (nested_loop, ordering_operation, grouping_operation, materialized subqueries,
 * unions), and a table node is reliably identified by having both `table_name`
 * and `access_type`.
 */

export interface PlanTable {
  tableName: string;
  /** "ALL" | "index" | "range" | "ref" | "eq_ref" | "const" | "system" | … */
  accessType: string;
  possibleKeys: string[];
  key: string | null;
  usedKeyParts: string[];
  rowsExamined: number | null;
  rowsProduced: number | null;
  /** Percent of examined rows kept (0..100). */
  filtered: number | null;
  usingIndex: boolean;
  /** e.g. "hash join", "Block Nested Loop"; null when not buffered. */
  usingJoinBuffer: string | null;
  attachedCondition: string | null;
  readCost: number | null;
  evalCost: number | null;
  prefixCost: number | null;
  usingFilesort: boolean;
}

export interface NormalizedPlan {
  queryCost: number | null;
  tables: PlanTable[];
  /** `using_filesort` seen anywhere in the plan. */
  usingFilesort: boolean;
  /** `using_temporary_table` seen anywhere in the plan. */
  usingTemporary: boolean;
}

function num(v: unknown): number | null {
  if (v == null) return null;
  const n = typeof v === "number" ? v : parseFloat(String(v));
  return Number.isFinite(n) ? n : null;
}

function strArray(v: unknown): string[] {
  return Array.isArray(v) ? v.filter((x): x is string => typeof x === "string") : [];
}

function isTableNode(o: Record<string, unknown>): boolean {
  return typeof o.table_name === "string" && typeof o.access_type === "string";
}

function toPlanTable(o: Record<string, unknown>): PlanTable {
  const cost = (o.cost_info ?? {}) as Record<string, unknown>;
  return {
    tableName: String(o.table_name),
    accessType: String(o.access_type),
    possibleKeys: strArray(o.possible_keys),
    key: typeof o.key === "string" ? o.key : null,
    usedKeyParts: strArray(o.used_key_parts),
    rowsExamined: num(o.rows_examined_per_scan),
    rowsProduced: num(o.rows_produced_per_join),
    filtered: num(o.filtered),
    usingIndex: o.using_index === true,
    usingJoinBuffer:
      typeof o.using_join_buffer === "string" ? o.using_join_buffer : null,
    attachedCondition:
      typeof o.attached_condition === "string" ? o.attached_condition : null,
    readCost: num(cost.read_cost),
    evalCost: num(cost.eval_cost),
    prefixCost: num(cost.prefix_cost),
    usingFilesort: o.using_filesort === true,
  };
}

export function parsePlan(explainJson: string | null): NormalizedPlan | null {
  if (!explainJson) return null;
  let root: unknown;
  try {
    root = JSON.parse(explainJson);
  } catch {
    return null;
  }

  const plan: NormalizedPlan = {
    queryCost: null,
    tables: [],
    usingFilesort: false,
    usingTemporary: false,
  };

  const walk = (v: unknown) => {
    if (Array.isArray(v)) {
      v.forEach(walk);
      return;
    }
    if (v == null || typeof v !== "object") return;
    const o = v as Record<string, unknown>;

    /* First (outermost) query_cost is the whole-query cost. */
    if (plan.queryCost == null && o.cost_info && typeof o.cost_info === "object") {
      const qc = num((o.cost_info as Record<string, unknown>).query_cost);
      if (qc != null) plan.queryCost = qc;
    }
    if (o.using_filesort === true) plan.usingFilesort = true;
    if (o.using_temporary_table === true) plan.usingTemporary = true;

    if (isTableNode(o)) plan.tables.push(toPlanTable(o));

    for (const val of Object.values(o)) walk(val);
  };

  walk(root);
  return plan;
}
