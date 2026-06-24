/**
 * The rule catalog — the curated MySQL-performance intelligence. Each rule
 * inspects the normalized plan (+ schema facts + SQL smells) and emits zero or
 * more Findings with a plain-English explanation, a concrete fix (often
 * apply-able DDL), an impact estimate, and a documentation citation.
 *
 * Knowledge sourced from the MySQL manual and well-known references; the URLs
 * on each finding let the panel teach, not just flag.
 */
import type { Finding, AnalyzeTableInfo } from "./types";
import type { NormalizedPlan, PlanTable } from "./parsePlan";
import type { SqlSmells } from "./sqlInspect";
import { buildIndexSuggestion } from "./indexAdvisor";
import { fmtCount, type OrderRef } from "./format";
import { detectLeftJoinWhereFilter, buildLeftJoinRewrite } from "./rewrites";

const DOCS = {
  explain: "https://dev.mysql.com/doc/refman/8.0/en/explain-output.html",
  fullScan: "https://dev.mysql.com/doc/refman/8.0/en/table-scan-avoidance.html",
  indexes: "https://dev.mysql.com/doc/refman/8.0/en/mysql-indexes.html",
  orderBy: "https://dev.mysql.com/doc/refman/8.0/en/order-by-optimization.html",
  groupBy: "https://dev.mysql.com/doc/refman/8.0/en/group-by-optimization.html",
  joins: "https://dev.mysql.com/doc/refman/8.0/en/nested-loop-joins.html",
  sargable: "https://use-the-index-luke.com/sql/where-clause/obfuscation",
  pagination: "https://use-the-index-luke.com/no-offset",
  subquery: "https://dev.mysql.com/doc/refman/8.0/en/subquery-optimization.html",
  analyzeTable: "https://dev.mysql.com/doc/refman/8.0/en/analyze-table.html",
};

export interface RuleContext {
  plan: NormalizedPlan;
  tablesByName: Map<string, AnalyzeTableInfo>;
  sql: string;
  smells: SqlSmells;
  orderByCols: string[];
  orderByRefs: OrderRef[];
  measured: boolean;
}

/** Which plan table owns the (first) ORDER BY column — by qualifier if given,
 * else by finding the table whose schema has that column. */
function orderByTable(ctx: RuleContext): string | null {
  const ref = ctx.orderByRefs[0];
  if (!ref) return null;
  if (ref.qualifier) return ref.qualifier;
  for (const t of ctx.plan.tables) {
    const info = ctx.tablesByName.get(t.tableName);
    if (info?.columns.some((c) => c.name === ref.column)) return t.tableName;
  }
  return null;
}

/** True when the plan has a join with no usable index on the join key. */
function hasUnindexedJoin(ctx: RuleContext): boolean {
  return ctx.plan.tables.some(
    (t) => t.usingJoinBuffer != null || (t.accessType === "ALL" && ctx.plan.tables.length > 1)
  );
}

export interface JoinKeyIndex {
  table: string;
  column: string;
  ddl: string;
}

/**
 * To let MySQL drive the query from `driveTable` (the table we ORDER BY) instead
 * of sorting after the join, the partner table's join column must be indexed.
 * Parse the join equalities from the SQL, find the column on the *other* table
 * that joins to `driveTable`, and suggest indexing it — unless it already is.
 */
function joinKeyIndexForDriving(
  ctx: RuleContext,
  driveTable: string
): JoinKeyIndex | null {
  const sql = ctx.sql.replace(/`/g, "");
  const eqs = sql.matchAll(/(\w+)\.(\w+)\s*=\s*(\w+)\.(\w+)/g);
  for (const m of eqs) {
    const [, t1, c1, t2, c2] = m;
    let partner: string | null = null;
    let col: string | null = null;
    if (t1 === driveTable) {
      partner = t2;
      col = c2;
    } else if (t2 === driveTable) {
      partner = t1;
      col = c1;
    }
    if (!partner || !col) continue;
    const info = ctx.tablesByName.get(partner);
    if (!info || !info.columns.some((c) => c.name === col)) continue;
    const alreadyIndexed = info.indexes.some(
      (idx) => idx.columns[0]?.toLowerCase() === col!.toLowerCase()
    );
    if (alreadyIndexed) return null;
    const idxName = `idx_${info.realName}_${col}`.slice(0, 64);
    return {
      table: partner,
      column: col,
      ddl: `CREATE INDEX \`${idxName}\` ON \`${info.realName}\` (\`${col}\`);`,
    };
  }
  return null;
}

/** A table's share of total query cost (0..1), or a rows-examined fallback. */
function costShare(t: PlanTable, plan: NormalizedPlan): number | null {
  if (plan.queryCost && plan.queryCost > 0 && t.readCost != null) {
    return Math.min(1, t.readCost / plan.queryCost);
  }
  const total = plan.tables.reduce((s, x) => s + (x.rowsExamined ?? 0), 0);
  if (total > 0 && t.rowsExamined != null) return t.rowsExamined / total;
  return null;
}

function shareLabel(share: number | null): string | undefined {
  return share != null ? `${Math.round(share * 100)}% of query cost` : undefined;
}

type Rule = (ctx: RuleContext) => Finding[];

/* ── Access path ─────────────────────────────────────────────────────────── */

const fullTableScan: Rule = (ctx) =>
  ctx.plan.tables.flatMap((t) => {
    if (t.accessType !== "ALL") return [];
    const info = ctx.tablesByName.get(t.tableName);
    const rows = t.rowsExamined ?? info?.tableRows ?? null;
    /* A full scan of a tiny table is fine — don't cry wolf. */
    if ((rows ?? 0) < 200) return [];
    const share = costShare(t, ctx.plan);
    const idx = buildIndexSuggestion(t, info, ctx.orderByCols, "filter");
    const big = (rows ?? 0) >= 100_000;
    return [
      {
        id: `full-scan:${t.tableName}`,
        ruleId: "full-scan",
        title: `Full table scan on \`${t.tableName}\``,
        category: "access",
        severity: big ? "critical" : "high",
        impact: Math.max(share ?? 0.5, big ? 0.8 : 0.5),
        impactLabel: `~${fmtCount(rows)} rows examined${
          share != null ? `, ${shareLabel(share)}` : ""
        }`,
        measured: false,
        table: t.tableName,
        why:
          `No index serves this access, so MySQL reads every row of \`${t.tableName}\`` +
          (rows != null ? ` (~${fmtCount(rows)} rows)` : "") +
          ` and discards the non-matching ones (${t.filtered ?? "?"}% kept). Cost grows linearly with the table.`,
        fix: idx
          ? `Add an index so the filter can seek instead of scan. ${idx.note}`
          : `Add an index on the column(s) used in the WHERE/JOIN against this table.`,
        ddl: idx?.ddl,
        docUrl: DOCS.fullScan,
        docLabel: "MySQL: Avoiding Full Table Scans",
      },
    ];
  });

const fullIndexScan: Rule = (ctx) =>
  ctx.plan.tables.flatMap((t) => {
    if (t.accessType !== "index") return [];
    const rows = t.rowsExamined ?? null;
    if ((rows ?? 0) < 1000) return [];
    const share = costShare(t, ctx.plan);
    return [
      {
        id: `full-index-scan:${t.tableName}`,
        ruleId: "full-index-scan",
        title: `Full index scan on \`${t.tableName}\``,
        category: "access",
        severity: "medium",
        impact: Math.max(share ?? 0.4, 0.4),
        impactLabel: `~${fmtCount(rows)} index entries read`,
        measured: false,
        table: t.tableName,
        why: `The whole index \`${t.key ?? "?"}\` is walked rather than a slice. Better than a table scan (it's covering or ordered), but still O(rows).`,
        fix: `Add a more selective leading predicate, or an index whose leading column matches the filter so a range/ref seek is possible.`,
        docUrl: DOCS.indexes,
        docLabel: "MySQL: How MySQL Uses Indexes",
      },
    ];
  });

const indexNotChosen: Rule = (ctx) =>
  ctx.plan.tables.flatMap((t) => {
    if (t.key !== null || t.possibleKeys.length === 0) return [];
    if (t.accessType === "const" || t.accessType === "system") return [];
    return [
      {
        id: `index-not-chosen:${t.tableName}`,
        ruleId: "index-not-chosen",
        title: `Usable index ignored on \`${t.tableName}\``,
        category: "access",
        severity: "medium",
        impact: 0.45,
        impactLabel: `candidate keys: ${t.possibleKeys.join(", ")}`,
        measured: false,
        table: t.tableName,
        why: `An index could apply (${t.possibleKeys.join(", ")}) but the optimizer chose not to use it — usually because it estimates the predicate isn't selective enough, or the statistics are stale.`,
        fix: `Run \`ANALYZE TABLE \`${t.tableName}\`;\` to refresh statistics. If it's genuinely selective, a more specific composite index (or a FORCE INDEX hint) may help.`,
        ddl: `ANALYZE TABLE \`${t.tableName}\`;`,
        docUrl: DOCS.indexes,
        docLabel: "MySQL: How MySQL Uses Indexes",
      },
    ];
  });

const lowSelectivity: Rule = (ctx) =>
  ctx.plan.tables.flatMap((t) => {
    if (t.accessType === "ALL" || t.accessType === "index") return []; // covered above
    const examined = t.rowsExamined ?? 0;
    const filtered = t.filtered ?? 100;
    if (examined < 1000 || filtered >= 25) return [];
    const kept = Math.round((examined * filtered) / 100);
    return [
      {
        id: `low-selectivity:${t.tableName}`,
        ruleId: "low-selectivity",
        title: `Low selectivity on \`${t.tableName}\``,
        category: "access",
        severity: "medium",
        impact: 0.4,
        impactLabel: `${fmtCount(examined)} examined → ~${fmtCount(kept)} kept (${filtered}%)`,
        measured: false,
        table: t.tableName,
        why: `The index narrows to ~${fmtCount(examined)} rows but only ${filtered}% survive the remaining conditions — the rest are read and thrown away.`,
        fix: `Extend the index to include the post-filter column(s) so more of the WHERE is satisfied by the seek, or add a more selective leading predicate.`,
        docUrl: DOCS.explain,
        docLabel: "MySQL: EXPLAIN Output (filtered)",
      },
    ];
  });

/* ── Ordering / grouping ─────────────────────────────────────────────────── */

const filesort: Rule = (ctx) => {
  if (!ctx.plan.usingFilesort) return [];
  const driver = ctx.plan.tables[0];
  const orderTable = orderByTable(ctx);
  const orderCols = ctx.orderByCols.join(", ");
  const driverOwnsOrder = !!driver && !!orderTable && driver.tableName === orderTable;

  /* Case 1: the ORDER BY column is on a table that ISN'T driving the query — it's
     driven by a filter on another table. No index on the sort column can help;
     MySQL joins first, then sorts the combined rows. The lever is the join. */
  if (orderTable && driver && !driverOwnsOrder) {
    const jk = joinKeyIndexForDriving(ctx, orderTable);
    return [
      {
        id: "filesort",
        ruleId: "filesort",
        title: "Sorting after a join (filesort)",
        category: "ordering",
        severity: "high",
        impact: 0.6,
        impactLabel: orderCols ? `ORDER BY ${orderTable}.${orderCols}` : undefined,
        measured: false,
        why: `Results are ordered by \`${orderTable}.${orderCols}\`, but the query is driven by \`${driver.tableName}\` (the filter lives there), so MySQL joins first and sorts the combined rows afterward. An index on \`${orderCols}\` alone can't avoid this — the sort column isn't on the driving table.`,
        fix: jk
          ? `Index the join key \`${jk.table}.${jk.column}\` (it isn't indexed). That lets MySQL drive from \`${orderTable}\` in \`${orderCols}\` order — reading rows already sorted, and with LIMIT stopping after the first matches — which typically removes this sort *and* the temporary table.`
          : `The join keys are already indexed, so the optimizer is choosing to sort after the join rather than drive from \`${orderTable}\`. If the result set is large, consider a covering index on \`${orderCols}\` for \`${orderTable}\`, or restructure so the ordered table drives.`,
        ddl: jk?.ddl,
        docUrl: DOCS.orderBy,
        docLabel: "MySQL: ORDER BY Optimization",
      },
    ];
  }

  /* Case 2: the driver owns the ORDER BY → one composite index of the equality
     filter column(s) followed by the sort column(s) serves both. */
  const info = driver ? ctx.tablesByName.get(driver.tableName) : undefined;
  const idx = driver
    ? buildIndexSuggestion(driver, info, ctx.orderByCols, "ordering")
    : null;
  return [
    {
      id: "filesort",
      ruleId: "filesort",
      title: "Sorting rows in memory/disk (filesort)",
      category: "ordering",
      severity: "high",
      impact: 0.6,
      impactLabel: orderCols ? `ORDER BY ${orderCols}` : undefined,
      measured: false,
      why:
        `No single index provides the ORDER BY order, so MySQL reads the matching rows and sorts them afterward (a "filesort"). On large result sets this spills to disk and dominates runtime.` +
        (idx && idx.columns.length > 1
          ? ` An index on \`${idx.columns[idx.columns.length - 1]}\` by itself isn't used here, because the WHERE equality on \`${idx.columns[0]}\` needs the index's leading position — one composite index has to cover both.`
          : ""),
      fix: idx
        ? `Create one composite index that lists the WHERE-equality column(s) first and the ORDER BY column(s) next — then a single index satisfies the filter and the sort. ${idx.note}`
        : `Create a composite index listing the WHERE-equality column(s) first, then the ORDER BY column(s) — e.g. \`(status, ${ctx.orderByCols[0] ?? "created_at"})\`.`,
      ddl: idx?.ddl,
      docUrl: DOCS.orderBy,
      docLabel: "MySQL: ORDER BY Optimization",
    },
  ];
};

const temporaryTable: Rule = (ctx) => {
  if (!ctx.plan.usingTemporary) return [];
  const { hasGroupBy, hasDistinct, hasUnion } = ctx.smells;
  const grouping = hasGroupBy || hasDistinct || hasUnion;

  /* When the query actually groups/dedups, the temp table is for that. */
  if (grouping) {
    const what = hasGroupBy ? "GROUP BY" : hasDistinct ? "DISTINCT" : "UNION";
    return [
      {
        id: "temporary",
        ruleId: "temporary",
        title: "Materializing a temporary table",
        category: "ordering",
        severity: "high",
        impact: 0.55,
        measured: false,
        why: `Your ${what} can't be resolved from an index, so MySQL builds a temporary table to deduplicate/aggregate — extra memory, and disk if it's large.`,
        fix: `Provide an index whose leading columns match the ${what} columns so the grouping is satisfied by an ordered index scan instead of a temp table.`,
        docUrl: DOCS.groupBy,
        docLabel: "MySQL: GROUP BY Optimization",
      },
    ];
  }

  /* No GROUP BY/DISTINCT/UNION — the temp table is a by-product of ordering over
     a join (rows can't be produced in final order, so they're buffered). */
  const join = hasUnindexedJoin(ctx);
  return [
    {
      id: "temporary",
      ruleId: "temporary",
      title: "Buffering rows in a temporary table",
      category: "ordering",
      severity: "medium",
      impact: 0.45,
      measured: false,
      why: `MySQL is buffering rows into a temporary table even though there's no GROUP BY or DISTINCT. With a join plus an ORDER BY, this happens when the rows can't be produced in the final order directly, so they're collected first and then sorted.`,
      fix: join
        ? `This is a side-effect of the join + sort, not a grouping problem. Indexing the join key (so MySQL can drive from the ORDER BY table and read rows in order) typically removes both this temporary table and the filesort — see the join-index suggestion.`
        : `This usually clears up once the ORDER BY can be served by an index on the driving table; see the sort suggestion.`,
      docUrl: DOCS.orderBy,
      docLabel: "MySQL: ORDER BY Optimization",
    },
  ];
};

/* ── Joins ───────────────────────────────────────────────────────────────── */

/**
 * A filter on the right (optional) table of a LEFT JOIN, placed in WHERE,
 * silently turns the join into an inner join and lets the optimizer drive from
 * that table — defeating an ORDER BY on the left table. The fix is a rewrite:
 * move the predicate into the ON clause.
 */
const leftJoinWhereFilter: Rule = (ctx) => {
  const jf = detectLeftJoinWhereFilter(ctx.sql);
  if (!jf) return [];
  const rewrite = buildLeftJoinRewrite(ctx.sql, jf);
  const keep = orderByTable(ctx);
  const keepTxt = keep ? `\`${keep}\`` : "the left table";
  return [
    {
      id: `left-join-where:${jf.ref}`,
      ruleId: "left-join-where-filter",
      title: `WHERE filters the LEFT JOIN'd table \`${jf.ref}\``,
      category: "joins",
      severity: "high",
      impact: 0.72,
      impactLabel: jf.predicate,
      measured: false,
      why: `\`${jf.predicate}\` is in the WHERE clause, but \`${jf.ref}\` is the optional (right) side of a LEFT JOIN. Filtering the optional table in WHERE drops the unmatched, NULL-extended rows — so the LEFT JOIN quietly behaves like an INNER JOIN, and the optimizer is free to drive the query from \`${jf.ref}\`. That's the root cause of the sort-after-join here: the ORDER BY is on ${keepTxt}, which is no longer the driving table.`,
      fix: `If you mean to keep every ${keepTxt} row (a true LEFT JOIN), move the condition into the JOIN's ON clause. MySQL then keeps ${keepTxt} as the driver, reads it in ORDER BY order via its index, and stops at LIMIT — the filesort and temporary table both disappear. Note: this changes the result — ${keepTxt} rows with no match are kept (with NULL \`${jf.ref}\` columns). If you actually want only matching rows, write an explicit INNER JOIN to make that intent clear (the result is identical to what you have now, just clearer).`,
      rewriteSql: rewrite ?? undefined,
      docUrl: "https://dev.mysql.com/doc/refman/8.0/en/outer-join-optimization.html",
      docLabel: "MySQL: Outer Join Optimization",
    },
  ];
};

const joinBuffer: Rule = (ctx) =>
  ctx.plan.tables.flatMap((t) => {
    if (!t.usingJoinBuffer) return [];
    const info = ctx.tablesByName.get(t.tableName);
    const idx = buildIndexSuggestion(t, info, ctx.orderByCols, "filter");
    return [
      {
        id: `join-buffer:${t.tableName}`,
        ruleId: "join-buffer",
        title: `Unindexed join into \`${t.tableName}\` (${t.usingJoinBuffer})`,
        category: "joins",
        severity: "high",
        impact: 0.65,
        impactLabel: t.usingJoinBuffer,
        measured: false,
        table: t.tableName,
        why: `The join column on \`${t.tableName}\` isn't indexed, so MySQL buffers rows and matches them with a ${t.usingJoinBuffer} instead of a fast per-row index lookup. Cost approaches rows(left) × rows(right).`,
        fix: idx
          ? `Index the join key on \`${t.tableName}\`. ${idx.note}`
          : `Add an index on the column of \`${t.tableName}\` used in the JOIN … ON condition.`,
        ddl: idx?.ddl,
        docUrl: DOCS.joins,
        docLabel: "MySQL: Nested-Loop Join Algorithms",
      },
    ];
  });

/* ── Predicates / sargability ────────────────────────────────────────────── */

const functionOnColumn: Rule = (ctx) => {
  if (!ctx.smells.functionOnColumn) return [];
  return [
    {
      id: "non-sargable-fn",
      ruleId: "non-sargable-fn",
      title: "Function wraps an indexed column",
      category: "predicates",
      severity: "medium",
      impact: 0.5,
      impactLabel: ctx.smells.functionOnColumn,
      measured: false,
      why: `A predicate like \`${ctx.smells.functionOnColumn}…\` applies a function to the column, so any index on that column can't be used — the function must be evaluated for every row first.`,
      fix: `Rewrite to compare the bare column to a computed bound (e.g. \`created >= '2024-01-01' AND created < '2024-02-01'\` instead of \`YEAR(created)=2024\`), or add a functional index (MySQL 8.0.13+).`,
      docUrl: DOCS.sargable,
      docLabel: "Use-The-Index-Luke: Obfuscation",
    },
  ];
};

const leadingWildcard: Rule = (ctx) => {
  if (!ctx.smells.leadingWildcardLike) return [];
  return [
    {
      id: "leading-wildcard",
      ruleId: "leading-wildcard",
      title: "Leading-wildcard LIKE defeats the index",
      category: "predicates",
      severity: "medium",
      impact: 0.45,
      measured: false,
      why: `A pattern like \`LIKE '%term%'\` can't use a B-tree index — the leading \`%\` means the index has no prefix to seek on, forcing a scan.`,
      fix: `Anchor the pattern (\`'term%'\`) to use the index, switch to a FULLTEXT index with \`MATCH … AGAINST\` for substring/word search, or maintain a reversed/trigram column.`,
      docUrl: DOCS.indexes,
      docLabel: "MySQL: How MySQL Uses Indexes",
    },
  ];
};

/* ── Projection ──────────────────────────────────────────────────────────── */

const selectStar: Rule = (ctx) => {
  if (!ctx.smells.selectStar) return [];
  return [
    {
      id: "select-star",
      ruleId: "select-star",
      title: "SELECT * fetches every column",
      category: "projection",
      severity: "low",
      impact: 0.2,
      measured: false,
      why: `Selecting all columns prevents covering-index optimizations and transfers wide/TEXT/BLOB columns you may not need, increasing I/O and network cost.`,
      fix: `List only the columns you use. A query whose SELECT and WHERE columns all live in one index can be answered from the index alone ("Using index").`,
      docUrl: DOCS.indexes,
      docLabel: "MySQL: How MySQL Uses Indexes",
    },
  ];
};

/* ── Subqueries ──────────────────────────────────────────────────────────── */

const notInSubquery: Rule = (ctx) => {
  if (!ctx.smells.notInSubquery) return [];
  return [
    {
      id: "not-in-subquery",
      ruleId: "not-in-subquery",
      title: "NOT IN (subquery) — correctness & performance trap",
      category: "subquery",
      severity: "medium",
      impact: 0.4,
      measured: false,
      why: `\`NOT IN (SELECT …)\` is both a performance and a correctness hazard: if the subquery yields any NULL, the whole predicate becomes UNKNOWN and the outer query returns no rows. It also often can't be optimized into a semi-join.`,
      fix: `Rewrite as \`NOT EXISTS (SELECT 1 … WHERE …)\` or a \`LEFT JOIN … WHERE right.key IS NULL\` (anti-join), which is NULL-safe and usually index-friendly.`,
      docUrl: DOCS.subquery,
      docLabel: "MySQL: Optimizing Subqueries",
    },
  ];
};

/* ── Pagination ──────────────────────────────────────────────────────────── */

const deepPagination: Rule = (ctx) => {
  if (ctx.smells.deepOffset == null) return [];
  const off = ctx.smells.deepOffset;
  return [
    {
      id: "deep-offset",
      ruleId: "deep-offset",
      title: `Deep pagination (OFFSET ${fmtCount(off)})`,
      category: "pagination",
      severity: "medium",
      impact: 0.45,
      impactLabel: `${fmtCount(off)} rows skipped each page`,
      measured: false,
      why: `\`LIMIT ${fmtCount(off)}, N\` still reads and discards the first ${fmtCount(off)} rows every time — the deeper the page, the slower it gets.`,
      fix: `Use keyset ("seek") pagination: remember the last row's sort key and use \`WHERE sort_col > :last ORDER BY sort_col LIMIT N\` instead of a growing OFFSET.`,
      docUrl: DOCS.pagination,
      docLabel: "Use-The-Index-Luke: No Offset",
    },
  ];
};

export const RULES: Rule[] = [
  fullTableScan,
  fullIndexScan,
  indexNotChosen,
  lowSelectivity,
  filesort,
  temporaryTable,
  leftJoinWhereFilter,
  joinBuffer,
  functionOnColumn,
  leadingWildcard,
  selectStar,
  notInSubquery,
  deepPagination,
];
