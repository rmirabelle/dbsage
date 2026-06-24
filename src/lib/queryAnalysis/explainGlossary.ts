/**
 * Decodes the columns of a traditional `EXPLAIN` row into plain-English meaning
 * plus a quality rating and the ideal range. This is the teaching layer: it
 * turns the cryptic plan stats (`type`, `rows`, `filtered`, `Extra`, …) into
 * "what it means, what's good, what's a red flag."
 *
 * Sourced from the MySQL manual's EXPLAIN Output Format and Join Types pages.
 */

export type Rating = "excellent" | "good" | "ok" | "warn" | "bad" | "neutral";

export interface MetricInfo {
  rating: Rating;
  meaning: string;
}

export interface ExtraFlagInfo {
  flag: string;
  rating: Rating;
  meaning: string;
}

/* ── access type (the join "type" column) ────────────────────────────────── */

/** Best → worst ladder, for the legend. */
export const TYPE_LADDER: { type: string; rating: Rating; note: string }[] = [
  { type: "system", rating: "excellent", note: "table has one row (or none)" },
  { type: "const", rating: "excellent", note: "≤1 row matched via PRIMARY/UNIQUE on a constant" },
  { type: "eq_ref", rating: "excellent", note: "exactly one row read per row from the prior table (PK/UNIQUE join)" },
  { type: "ref", rating: "good", note: "indexed lookup returning several equal-keyed rows" },
  { type: "range", rating: "good", note: "index range scan (BETWEEN, <, >, IN, LIKE 'x%')" },
  { type: "index_merge", rating: "ok", note: "two indexes combined — often a sign one composite index would be better" },
  { type: "index", rating: "warn", note: "the entire index is scanned end to end" },
  { type: "ALL", rating: "bad", note: "full table scan — every row is read" },
];

export function rateType(type: string | null): MetricInfo {
  const t = (type ?? "").toLowerCase();
  switch (t) {
    case "system":
      return { rating: "excellent", meaning: "Single-row table — essentially free." };
    case "const":
      return {
        rating: "excellent",
        meaning: "At most one row, located through a PRIMARY/UNIQUE key on a constant. The best possible access.",
      };
    case "eq_ref":
      return {
        rating: "excellent",
        meaning: "One row read per row of the driving table via a PRIMARY/UNIQUE key — ideal for joins.",
      };
    case "ref":
    case "ref_or_null":
      return {
        rating: "good",
        meaning: "An index returns the rows matching an equality. Good, as long as it doesn't match too many rows.",
      };
    case "fulltext":
      return { rating: "good", meaning: "A FULLTEXT index serves the search." };
    case "range":
      return {
        rating: "good",
        meaning: "An index range is scanned (BETWEEN, <, >, IN, prefix LIKE). Good when the range is narrow.",
      };
    case "index_merge":
      return {
        rating: "ok",
        meaning: "Several indexes are merged. Works, but a single composite index usually beats it.",
      };
    case "unique_subquery":
    case "index_subquery":
      return { rating: "ok", meaning: "A subquery resolved through an index." };
    case "index":
      return {
        rating: "warn",
        meaning: "The whole index is scanned (not a slice). Cheaper than a table scan if covering, but still O(rows).",
      };
    case "all":
      return {
        rating: "bad",
        meaning: "Full table scan — every row is read and tested. Fine on tiny tables, costly on large ones. Add an index.",
      };
    default:
      return { rating: "neutral", meaning: "Access method for this step." };
  }
}

/* ── filtered (% of examined rows kept) ──────────────────────────────────── */

export function rateFiltered(pct: number | null): MetricInfo {
  if (pct == null)
    return {
      rating: "neutral",
      meaning:
        "Estimated % of the rows read here that PASS the condition (the keepers, not the ones removed).",
    };
  /* Note: `filtered` counts rows RETAINED, not removed — 100 is the max and the
     best, meaning no wasted reads. The name misleads many people. */
  const base = `“filtered” is the estimated % of the rows read here that PASS this step’s condition — the keepers, not the discards. Higher is better; 100% means every row the access read is actually used. Here it’s ~${pct}%.`;
  if (pct >= 80) return { rating: "good", meaning: `${base} Little to no wasted reads.` };
  if (pct >= 30) return { rating: "ok", meaning: base };
  if (pct >= 10)
    return {
      rating: "warn",
      meaning: `${base} Many read rows are discarded — the access isn’t selective enough.`,
    };
  return {
    rating: "bad",
    meaning: `${base} Almost all read rows are thrown away — add/extend an index so the seek does more of the filtering.`,
  };
}

/* ── rows (estimated rows examined per scan) ─────────────────────────────── */

export function rateRows(rows: number | null): MetricInfo {
  if (rows == null) return { rating: "neutral", meaning: "Estimated rows examined at this step." };
  const base = `MySQL estimates ~${rows.toLocaleString()} rows examined per scan here. Lower is better; what's acceptable depends on table size, but this is multiplied across joins.`;
  if (rows < 100) return { rating: "good", meaning: base };
  if (rows < 10_000) return { rating: "ok", meaning: base };
  if (rows < 100_000) return { rating: "warn", meaning: `${base} Watch this in a join.` };
  return { rating: "bad", meaning: `${base} Large — a more selective index would cut this sharply.` };
}

/* ── key / possible_keys / key_len / ref ─────────────────────────────────── */

export function rateKey(key: string | null, possibleKeys: string | null): MetricInfo {
  if (key && key.length > 0) {
    return { rating: "good", meaning: `The optimizer is using the \`${key}\` index for this access.` };
  }
  if (possibleKeys && possibleKeys.length > 0) {
    return {
      rating: "warn",
      meaning: `No index is used, even though one could apply (${possibleKeys}). Usually stale statistics or a non-selective predicate — try ANALYZE TABLE.`,
    };
  }
  return { rating: "bad", meaning: "No index is used and none applies — this access can't seek, only scan." };
}

export const METRIC_MEANINGS: Record<string, string> = {
  possible_keys: "Indexes the optimizer considered for this table. NULL means no index can apply to the WHERE/JOIN — a schema gap.",
  key_len: "How many bytes of the chosen index are actually used. A longer length means more key columns are engaged — useful to confirm a composite index is fully used.",
  ref: "What is compared against the index column: a constant, a column from another table, or `func` (an expression/implicit conversion — which can blunt the index).",
  select_type: "The role of this SELECT: SIMPLE, PRIMARY, SUBQUERY, DERIVED, UNION, MATERIALIZED, DEPENDENT SUBQUERY (correlated — runs per outer row, often slow).",
  id: "Execution step number. Same id = joined together; higher id = an inner subquery evaluated first.",
  partitions: "Which table partitions are read. Fewer is better — it means partition pruning is working.",
};

/* ── Extra flags ─────────────────────────────────────────────────────────── */

const EXTRA_RULES: { match: RegExp; rating: Rating; meaning: string }[] = [
  { match: /using index condition/i, rating: "good", meaning: "Index Condition Pushdown — part of the WHERE is checked inside the index before touching the row. Good." },
  { match: /using index for group-by/i, rating: "good", meaning: "GROUP BY is satisfied straight from an index — no temp table. Excellent." },
  { match: /using index/i, rating: "excellent", meaning: "Covering index — every needed column is in the index, so the table itself is never read. The best case." },
  { match: /using filesort/i, rating: "bad", meaning: "Rows are sorted after reading (in memory or on disk). No index serves the ORDER BY — often the biggest cost on large results." },
  { match: /using temporary/i, rating: "bad", meaning: "A temporary table is built (GROUP BY / DISTINCT / UNION). Extra memory, and disk if large." },
  { match: /using join buffer/i, rating: "warn", meaning: "The join key isn't indexed, so rows are buffered and matched in bulk (Block Nested Loop / hash join) instead of per-row seeks." },
  { match: /range checked for each record/i, rating: "warn", meaning: "No good index, so the optimizer re-checks for a usable range on every row of the prior table." },
  { match: /full scan on null key/i, rating: "warn", meaning: "A subquery falls back to a full scan when the comparison value is NULL." },
  { match: /using where/i, rating: "neutral", meaning: "Rows are filtered by the WHERE after being read. Normal — but combined with a full scan it means lots of rows are read then thrown away." },
  { match: /using mrr/i, rating: "ok", meaning: "Multi-Range Read — reads index matches in disk order to reduce random I/O." },
  { match: /select tables optimized away/i, rating: "good", meaning: "The result is computed from index metadata (e.g. MIN/MAX) without reading rows." },
  { match: /impossible where/i, rating: "neutral", meaning: "The WHERE can never be true, so no rows are read." },
  { match: /no tables used/i, rating: "neutral", meaning: "The query references no table." },
  { match: /distinct/i, rating: "neutral", meaning: "Stops scanning a table once a distinct match is found." },
];

export function explainExtra(extra: string | null): ExtraFlagInfo[] {
  if (!extra) return [];
  return extra
    .split(";")
    .map((s) => s.trim())
    .filter(Boolean)
    .map((flag) => {
      const rule = EXTRA_RULES.find((r) => r.match.test(flag));
      return {
        flag,
        rating: rule?.rating ?? "neutral",
        meaning: rule?.meaning ?? "Additional plan detail.",
      };
    });
}
