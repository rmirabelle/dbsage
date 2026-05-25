import { format } from "sql-formatter";

export type FormatStyle = "standard" | "condensed";

/** Shared sql-formatter config — the single place to tweak Standard behavior. */
const BASE_OPTIONS = {
  language: "mysql",
  keywordCase: "upper",
  dataTypeCase: "upper",
  indentStyle: "standard",
  tabWidth: 2,
  linesBetweenQueries: 1,
} as const;

/** Standard formatting via sql-formatter (familiar: clause keyword per line, body indented). */
export function formatStandard(sql: string): string {
  return format(sql, BASE_OPTIONS);
}

/** Clauses that get a line break before them in Condensed style. Edit freely. */
const CONDENSED_BREAK_CLAUSES = ["FROM", "WHERE", "ORDER BY", "LIMIT"];

/** Matches a string literal, comment, or backtick identifier as a whole token so
 * the break-insertion skips over them (a "from" inside a string is left alone). */
const SKIP_RE =
  /'(?:\\.|[^'])*'|"(?:\\.|[^"])*"|`(?:[^`]|``)*`|\/\*[\s\S]*?\*\/|--[^\n]*|#[^\n]*/g;

const BREAK_RE = new RegExp(
  `\\s*\\b(${CONDENSED_BREAK_CLAUSES.map((k) => k.replace(/\s+/g, "\\s+")).join(
    "|"
  )})\\b`,
  "gi"
);

/** Put each break clause on its own line, consuming the whitespace right before
 * the keyword. Everything else is left exactly as typed (case included). */
function breakClauses(code: string): string {
  return code.replace(BREAK_RE, (_m, keyword) => "\n" + keyword);
}

/**
 * Condensed formatting: just insert a line break before FROM / WHERE / ORDER BY
 * / LIMIT — nothing else is touched. String literals, comments, and backtick
 * identifiers are skipped so those words inside them are never broken on.
 */
export function formatCondensed(sql: string): string {
  let out = "";
  let last = 0;
  let m: RegExpExecArray | null;
  SKIP_RE.lastIndex = 0;
  while ((m = SKIP_RE.exec(sql)) !== null) {
    out += breakClauses(sql.slice(last, m.index)) + m[0];
    last = m.index + m[0].length;
  }
  out += breakClauses(sql.slice(last));
  return out.trim();
}

/** Format `sql` in the requested style. */
export function formatSql(sql: string, style: FormatStyle): string {
  return style === "condensed" ? formatCondensed(sql) : formatStandard(sql);
}
