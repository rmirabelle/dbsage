/**
 * Lightweight, conservative SQL-text heuristics — NOT a parser. These spot
 * common anti-patterns the plan alone doesn't name (over-projection, leading
 * wildcards, non-sargable expressions, deep pagination). Findings derived from
 * these are flagged as heuristic so the UI can hedge appropriately.
 */

export interface SqlSmells {
  selectStar: boolean;
  leadingWildcardLike: boolean;
  /** Example of a function wrapping a column in a predicate, or null. */
  functionOnColumn: string | null;
  notInSubquery: boolean;
  /** OFFSET value when it's large enough to matter; else null. */
  deepOffset: number | null;
  hasGroupBy: boolean;
  hasDistinct: boolean;
  hasUnion: boolean;
}

/** Strip line/block comments and string/identifier literals so keyword scans
 * don't trip on data. Replaces literals with a single space. */
function scrub(sql: string): string {
  return sql
    .replace(/--[^\n]*/g, " ")
    .replace(/\/\*[\s\S]*?\*\//g, " ")
    .replace(/'(?:[^'\\]|\\.)*'/g, " '' ")
    .replace(/"(?:[^"\\]|\\.)*"/g, ' "" ')
    .replace(/`[^`]*`/g, " id ");
}

const FUNC_ON_COL =
  /\b(?:date|year|month|day|hour|upper|lower|substr|substring|concat|cast|convert|coalesce|left|right|trim|ifnull|round|floor|ceil|abs)\s*\(\s*[A-Za-z_][\w]*(?:\.[A-Za-z_][\w]*)?\s*[),]/i;

export function inspectSql(rawSql: string): SqlSmells {
  const sql = scrub(rawSql);
  const whereIdx = sql.search(/\bwhere\b/i);
  const whereClause = whereIdx >= 0 ? sql.slice(whereIdx) : "";

  /* SELECT * / alias.* — but a bare COUNT(*) is fine. */
  const selectStar = /\bselect\s+(?:[A-Za-z_]\w*\.)?\*/i.test(sql);

  const leadingWildcardLike = /\blike\s+(?:'%|"")/i.test(sql) || /\blike\s+'%/i.test(rawSql);

  const fnMatch = whereClause.match(FUNC_ON_COL);
  const functionOnColumn = fnMatch ? fnMatch[0].replace(/[,)]\s*$/, "") : null;

  const notInSubquery = /\bnot\s+in\s*\(\s*select\b/i.test(sql);

  let deepOffset: number | null = null;
  const limitComma = sql.match(/\blimit\s+(\d+)\s*,\s*\d+/i);
  const limitOffset = sql.match(/\blimit\s+\d+\s+offset\s+(\d+)/i);
  const off = limitComma
    ? Number(limitComma[1])
    : limitOffset
    ? Number(limitOffset[1])
    : null;
  if (off != null && off >= 1000) deepOffset = off;

  return {
    selectStar,
    leadingWildcardLike,
    functionOnColumn,
    notInSubquery,
    deepOffset,
    hasGroupBy: /\bgroup\s+by\b/i.test(sql),
    hasDistinct: /\bselect\s+distinct\b/i.test(sql),
    hasUnion: /\bunion\b/i.test(sql),
  };
}
