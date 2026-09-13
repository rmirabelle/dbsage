import { scanFromTables } from "./sqlCompletion";
import { blankPlaceholders } from "./queryParams";

/**
 * A select-list star: `*` or `alias.*` right after SELECT or after a comma in
 * the select list. Multiplication and stars inside strings or comments never
 * count.
 */
export interface SelectStar {
  /** Offset of the first character to replace (`alias.*` includes the alias). */
  start: number;
  /** Offset just past the `*`. */
  end: number;
  /** The qualifier before the dot, if any. */
  alias: string | null;
  /** The table the star most likely refers to, from the statement's FROM/JOIN. */
  table: string | null;
}

const SKIP_RE =
  /'(?:\\.|[^'])*'|"(?:\\.|[^"])*"|`(?:[^`]|``)*`|\/\*[\s\S]*?\*\/|--[^\n]*|#[^\n]*/g;

/** The text with strings, comments and placeholders blanked, same length. */
function blanked(sql: string): string {
  return blankPlaceholders(sql).replace(SKIP_RE, (m) => " ".repeat(m.length));
}

/** The statement boundaries (by `;`) that contain `offset`. */
function statementRange(clean: string, offset: number): [number, number] {
  const from = clean.lastIndexOf(";", offset - 1) + 1;
  const toIdx = clean.indexOf(";", offset);
  return [from, toIdx < 0 ? clean.length : toIdx];
}

/** Every select-list star in `sql`, in order. */
export function findSelectStars(sql: string): SelectStar[] {
  const clean = blanked(sql);
  const out: SelectStar[] = [];
  const re = /\*/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(clean)) !== null) {
    const at = m.index;
    /* Optional `alias.` before the star. */
    let start = at;
    let alias: string | null = null;
    if (clean[at - 1] === ".") {
      let q = at - 1;
      while (q > 0 && /[A-Za-z0-9_$]/.test(clean[q - 1])) q--;
      if (q < at - 1) {
        alias = clean.slice(q, at - 1);
        start = q;
      }
    }
    /* What comes before must be SELECT (with optional modifiers) or a comma. */
    const before = clean.slice(0, start).trimEnd();
    const isSelectList =
      /,$/.test(before) ||
      /\bSELECT(\s+(ALL|DISTINCT|DISTINCTROW|SQL_CALC_FOUND_ROWS|HIGH_PRIORITY|STRAIGHT_JOIN))*$/i.test(before);
    if (!isSelectList) continue;
    /* A star followed by an operand is multiplication (`SELECT 2 * 3` is caught
       here only if `2` precedes it, which the rule above already rejects). */
    const [sFrom, sTo] = statementRange(clean, at);
    const refs = scanFromTables(clean.slice(sFrom, sTo));
    let table: string | null = null;
    if (alias) {
      const a = alias.toLowerCase();
      table = refs.find((r) => (r.alias ?? r.table).toLowerCase() === a)?.table ?? null;
    } else {
      table = refs[0]?.table ?? null;
    }
    out.push({ start, end: at + 1, alias, table });
  }
  return out;
}

/** The star nearest the caret, or the first when the caret is far from all. */
export function nearestStar(stars: SelectStar[], caret: number): SelectStar | null {
  if (stars.length === 0) return null;
  let best = stars[0];
  let bestDist = Infinity;
  for (const s of stars) {
    const dist = caret < s.start ? s.start - caret : caret > s.end ? caret - s.end : 0;
    if (dist < bestDist) {
      best = s;
      bestDist = dist;
    }
  }
  return best;
}

/** Replace a star with a column list, prefixed by the star's alias when it had one. */
export function expandStar(sql: string, star: SelectStar, columns: string[]): string {
  const prefix = star.alias ? `${star.alias}.` : "";
  const list = columns.map((c) => prefix + c).join(", ");
  return sql.slice(0, star.start) + list + sql.slice(star.end);
}
