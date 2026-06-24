/**
 * Turns the traditional EXPLAIN grid into decoded, rated plan rows — the
 * "what does each stat mean / is it good" teaching view.
 */
import type { QueryAnalysisInput, PlanRowInfo, PlanMetric } from "./types";
import {
  rateType,
  rateRows,
  rateFiltered,
  rateKey,
  explainExtra,
  METRIC_MEANINGS,
} from "./explainGlossary";

export function buildPlanBreakdown(input: QueryAnalysisInput): PlanRowInfo[] {
  return input.explainRows.map((row) => {
    /* EXPLAIN columns vary in case ("Extra" vs the rest); match case-insensitively. */
    const lower = new Map(
      Object.entries(row).map(([k, v]) => [k.toLowerCase(), v])
    );
    const get = (name: string): string | null => {
      const v = lower.get(name.toLowerCase());
      return v == null ? null : String(v);
    };
    const numOf = (name: string): number | null => {
      const s = get(name);
      if (s == null) return null;
      const n = Number(s);
      return Number.isFinite(n) ? n : null;
    };

    const type = get("type");
    const rows = numOf("rows");
    const filtered = numOf("filtered");
    const key = get("key");
    const possibleKeys = get("possible_keys");
    const ref = get("ref");

    const metrics: PlanMetric[] = [
      { key: "type", label: "type", value: type, ...rateType(type) },
      {
        key: "rows",
        label: "rows",
        value: rows != null ? rows.toLocaleString() : get("rows"),
        ...rateRows(rows),
      },
      {
        key: "filtered",
        label: "filtered",
        value: filtered != null ? `${filtered}%` : null,
        ...rateFiltered(filtered),
      },
      { key: "key", label: "key", value: key, ...rateKey(key, possibleKeys) },
      {
        key: "ref",
        label: "ref",
        value: ref,
        rating: ref === "func" ? "warn" : "neutral",
        meaning:
          ref === "func"
            ? `${METRIC_MEANINGS.ref} Here it's \`func\` — an expression or implicit conversion is applied, which can prevent a clean index lookup.`
            : METRIC_MEANINGS.ref,
      },
      {
        key: "key_len",
        label: "key_len",
        value: get("key_len"),
        rating: "neutral",
        meaning: METRIC_MEANINGS.key_len,
      },
      {
        key: "possible_keys",
        label: "possible_keys",
        value: possibleKeys,
        rating: "neutral",
        meaning: METRIC_MEANINGS.possible_keys,
      },
    ];

    return {
      table: get("table") ?? "—",
      selectType: get("select_type"),
      metrics,
      extra: explainExtra(get("Extra")),
    };
  });
}
