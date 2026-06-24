/** Compact row/number formatting for impact labels ("1.2M", "12K"). */
export function fmtCount(n: number | null | undefined): string {
  if (n == null) return "?";
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(n >= 10_000_000 ? 0 : 1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(n >= 10_000 ? 0 : 1)}K`;
  return String(Math.round(n));
}

export interface OrderRef {
  /** The table/alias qualifier (`pcrs` in `pcrs.date_created`), or null. */
  qualifier: string | null;
  column: string;
}

/** Parse ORDER BY into column refs with their table qualifier (best-effort;
 * ignores expressions). */
export function orderByRefs(sql: string): OrderRef[] {
  const m = sql.match(/\border\s+by\s+([\s\S]+?)(?:\blimit\b|\bfor\b|\binto\b|;|$)/i);
  if (!m) return [];
  return m[1]
    .split(",")
    .map((part): OrderRef | null => {
      const cleaned = part
        .trim()
        .replace(/\s+(asc|desc)\s*$/i, "")
        .replace(/`/g, "")
        .trim();
      const dotted = cleaned.match(/^(\w+)\.(\w+)$/);
      if (dotted) return { qualifier: dotted[1], column: dotted[2] };
      return /^[A-Za-z_]\w*$/.test(cleaned) ? { qualifier: null, column: cleaned } : null;
    })
    .filter((r): r is OrderRef => r !== null);
}

/** Extract bare ORDER BY column names (qualifier dropped). */
export function orderByColumns(sql: string): string[] {
  return orderByRefs(sql).map((r) => r.column);
}
