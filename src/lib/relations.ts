import type { CellValue, Relation } from "../types";

/** A resolved relation endpoint: the other table/column a column relates to. */
export interface RelationTarget {
  table: string;
  column: string;
}

/** Resolve which tables/columns the given column relates to. Matching is
 * FORWARD ONLY: a relation `from → to` lets you peek from `fromTable.fromColumn`
 * into `toTable.toColumn`, never the reverse. To peek the other way, author a
 * separate relation for that direction. */
export function relationTargets(
  relations: Relation[],
  table: string,
  column: string
): RelationTarget[] {
  const out: RelationTarget[] = [];
  const seen = new Set<string>();
  for (const r of relations) {
    if (r.fromTable !== table || r.fromColumn !== column) continue;
    const t: RelationTarget = { table: r.toTable, column: r.toColumn };
    const key = `${t.table}::${t.column}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(t);
  }
  return out;
}

/** Columns of `table` that a peek can be launched from — i.e. the `fromColumn`
 * of any relation whose `fromTable` is this table (forward direction only). */
export function peekableColumnsFor(
  relations: Relation[],
  table: string
): Set<string> {
  const s = new Set<string>();
  for (const r of relations) {
    if (r.fromTable === table) s.add(r.fromColumn);
  }
  return s;
}

/** The "Related" button label for the current column's matches. */
export function relatedLabel(matches: RelationTarget[]): string {
  if (matches.length === 1) return `Related: ${matches[0].table}`;
  if (matches.length > 1) return `Related: ${matches.length} tables`;
  return "Related";
}

/** A cell value as an equality-filter string; null/undefined can't be matched. */
export function cellToFilterValue(v: CellValue | undefined): string | null {
  if (v === null || v === undefined) return null;
  return typeof v === "string" ? v : String(v);
}
