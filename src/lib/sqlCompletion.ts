/**
 * Parser-free SQL completion context detection. Given the editor text and caret
 * offset, decide what to suggest (table / column / keyword) and the partial word
 * being typed. Column suggestions are scoped via a lightweight FROM/JOIN scan so
 * we never suggest columns from tables that aren't in the query.
 */

export interface CompletionSource {
  /** Table names available in the current database. */
  tables: string[];
  /** Cache of columns by lowercased table name. */
  columnsByTable: Record<string, string[]>;
  /** SQL keywords for Ctrl+Space completion. */
  keywords: string[];
}

export type CompletionKind = "table" | "column" | "keyword";

export interface CompletionQuery {
  kind: CompletionKind;
  /** The partial word under the caret (may be ""). */
  prefix: string;
  /** Index where the replacement begins (start of `prefix`). */
  from: number;
  /** For column kind: the identifier before the dot (alias or table). */
  qualifier?: string;
  /** Whether this context should pop automatically (vs Ctrl+Space only). */
  auto: boolean;
}

const IDENT = /[A-Za-z0-9_$]/;

/** Keywords that, when they are the nearest clause keyword, mean "suggest tables". */
const TABLE_CONTEXT = new Set(["FROM", "JOIN", "INTO", "UPDATE", "TABLE"]);

/** Clause keywords used to find the governing clause by scanning backward. */
const CLAUSE_KEYWORDS = new Set([
  "SELECT", "FROM", "WHERE", "JOIN", "INNER", "LEFT", "RIGHT", "FULL", "CROSS",
  "ON", "USING", "GROUP", "ORDER", "BY", "HAVING", "LIMIT", "INTO", "VALUES",
  "UPDATE", "SET", "DELETE", "TABLE", "AND", "OR",
]);

/** Tokens that follow a table ref but are NOT an alias. */
const NOT_AN_ALIAS = new Set([
  "ON", "USING", "WHERE", "JOIN", "INNER", "LEFT", "RIGHT", "FULL", "CROSS",
  "GROUP", "ORDER", "HAVING", "LIMIT", "SET", "VALUES", "AS",
]);

const SKIP_RE =
  /'(?:\\.|[^'])*'|"(?:\\.|[^"])*"|`(?:[^`]|``)*`|\/\*[\s\S]*?\*\/|--[^\n]*|#[^\n]*/g;

/** True when the caret sits inside a (closed) string/comment, or after an
 * unterminated line comment on the current line. */
function inSkipRegion(text: string, caret: number): boolean {
  SKIP_RE.lastIndex = 0;
  let m: RegExpExecArray | null;
  while ((m = SKIP_RE.exec(text)) !== null) {
    if (caret > m.index && caret < m.index + m[0].length) return true;
  }
  const lineStart = text.lastIndexOf("\n", caret - 1) + 1;
  const line = text.slice(lineStart, caret);
  return /(^|\s)(--\s|#)/.test(line) || line.includes("--");
}

/** Most recent clause keyword before `before` (nearest wins), with the offset
 * just past it so callers can inspect what's been typed since. */
function governingClause(
  before: string
): { keyword: string; end: number } | null {
  const re = /[A-Za-z_][A-Za-z0-9_$]*/g;
  let m: RegExpExecArray | null;
  let last: { keyword: string; end: number } | null = null;
  while ((m = re.exec(before)) !== null) {
    const w = m[0].toUpperCase();
    if (CLAUSE_KEYWORDS.has(w)) last = { keyword: w, end: m.index + m[0].length };
  }
  return last;
}

export function analyzeCompletion(
  text: string,
  caret: number
): CompletionQuery | null {
  if (inSkipRegion(text, caret)) return null;

  let start = caret;
  while (start > 0 && IDENT.test(text[start - 1])) start--;
  const prefix = text.slice(start, caret);

  /* Dotted: `qualifier.prefix` → that table's columns. */
  if (start > 0 && text[start - 1] === ".") {
    let qStart = start - 1;
    while (qStart > 0 && IDENT.test(text[qStart - 1])) qStart--;
    const qualifier = text.slice(qStart, start - 1);
    if (qualifier) {
      return { kind: "column", prefix, from: start, qualifier, auto: true };
    }
  }

  const before = text.slice(0, start);
  const gov = governingClause(before);
  if (gov && TABLE_CONTEXT.has(gov.keyword)) {
    /* Only a table-name position: right after the clause keyword, or after a
       comma in a multi-table list. Once a table name has been typed, the caret
       is at an alias / next-clause position, so stop suggesting tables. */
    const sinceClause = before.slice(gov.end).trimEnd();
    if (sinceClause === "" || sinceClause.endsWith(",")) {
      return { kind: "table", prefix, from: start, auto: true };
    }
  }

  return { kind: "keyword", prefix, from: start, auto: false };
}

/** Tables referenced by FROM/JOIN, with optional aliases. */
export function scanFromTables(
  text: string
): { table: string; alias: string | null }[] {
  const out: { table: string; alias: string | null }[] = [];
  const re =
    /\b(?:FROM|JOIN)\s+([A-Za-z0-9_$.`]+)(?:\s+(?:AS\s+)?([A-Za-z0-9_$]+))?/gi;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text)) !== null) {
    const raw = m[1].replace(/`/g, "");
    const table = raw.includes(".") ? raw.split(".").pop()! : raw;
    let alias: string | null = m[2] ?? null;
    if (alias && NOT_AN_ALIAS.has(alias.toUpperCase())) alias = null;
    if (table) out.push({ table, alias });
  }
  return out;
}

/** Resolve a dotted qualifier (alias or table name) to a real table name. */
export function resolveQualifierTable(
  text: string,
  qualifier: string,
  tables: string[]
): string | null {
  const q = qualifier.toLowerCase();
  const refs = scanFromTables(text);
  for (const r of refs) {
    if (r.alias && r.alias.toLowerCase() === q) return r.table;
  }
  const direct = tables.find((t) => t.toLowerCase() === q);
  if (direct) return direct;
  for (const r of refs) {
    if (r.table.toLowerCase() === q) return r.table;
  }
  return null;
}

/** Case-insensitive filter: prefix matches first, then substring matches. */
export function filterByPrefix(
  items: string[],
  prefix: string,
  limit = 50
): string[] {
  const p = prefix.toLowerCase();
  const seen = new Set<string>();
  const starts: string[] = [];
  const contains: string[] = [];
  for (const it of items) {
    if (seen.has(it)) continue;
    seen.add(it);
    const l = it.toLowerCase();
    if (p === "" || l.startsWith(p)) starts.push(it);
    else if (l.includes(p)) contains.push(it);
  }
  /* When the only match is an exact, complete match, there's nothing to add. */
  if (starts.length === 1 && starts[0].toLowerCase() === p && contains.length === 0) {
    return [];
  }
  return [...starts, ...contains].slice(0, limit);
}
