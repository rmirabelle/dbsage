/**
 * Client-side SQL script splitting — used only to LABEL the result sets of a
 * compound query (pill tooltips, empty-SELECT vs no-result-set display). The
 * server still executes the script whole, so a splitting mistake here can at
 * worst mislabel a set, never change what runs.
 */

/**
 * Split a SQL script into its individual statements on `;`, respecting
 * single/double-quoted strings, backtick identifiers, `-- ` and `#` line
 * comments, and block comments. Comment-only / whitespace-only trailing
 * segments are dropped; each returned statement keeps its original text
 * (including leading comments) minus the terminating semicolon.
 */
export function splitSqlStatements(sql: string): string[] {
  const out: string[] = [];
  let start = 0;
  let i = 0;
  const n = sql.length;
  const push = (end: number) => {
    const stmt = sql.slice(start, end);
    if (firstKeyword(stmt) !== null) out.push(stmt.trim());
  };
  while (i < n) {
    const c = sql[i];
    if (c === "'" || c === '"') {
      /* String literal: backslash escapes and doubled-quote escapes. */
      const q = c;
      i++;
      while (i < n) {
        if (sql[i] === "\\") i += 2;
        else if (sql[i] === q) {
          i++;
          if (sql[i] === q) i++;
          else break;
        } else i++;
      }
    } else if (c === "`") {
      /* Backtick identifier: no backslash escapes, `` doubles. */
      i++;
      while (i < n) {
        if (sql[i] === "`") {
          i++;
          if (sql[i] === "`") i++;
          else break;
        } else i++;
      }
    } else if (c === "#" || (c === "-" && sql[i + 1] === "-" && (i + 2 >= n || /\s/.test(sql[i + 2])))) {
      while (i < n && sql[i] !== "\n") i++;
    } else if (c === "/" && sql[i + 1] === "*") {
      const close = sql.indexOf("*/", i + 2);
      i = close === -1 ? n : close + 2;
    } else if (c === ";") {
      push(i);
      i++;
      start = i;
    } else {
      i++;
    }
  }
  push(n);
  return out;
}

/**
 * The first meaningful keyword of a statement (lowercased), skipping leading
 * whitespace and comments. Returns "(" for a parenthesized query, null when
 * the text holds no actual statement (comments/whitespace only).
 */
function firstKeyword(stmt: string): string | null {
  let i = 0;
  const n = stmt.length;
  while (i < n) {
    const c = stmt[i];
    if (/\s/.test(c)) i++;
    else if (c === "#" || (c === "-" && stmt[i + 1] === "-" && (i + 2 >= n || /\s/.test(stmt[i + 2])))) {
      while (i < n && stmt[i] !== "\n") i++;
    } else if (c === "/" && stmt[i + 1] === "*") {
      const close = stmt.indexOf("*/", i + 2);
      if (close === -1) return null;
      i = close + 2;
    } else if (c === "(") {
      return "(";
    } else {
      const m = /^[A-Za-z_]+/.exec(stmt.slice(i));
      return m ? m[0].toLowerCase() : c;
    }
  }
  return null;
}

const RESULT_SET_KEYWORDS = new Set([
  "select",
  "show",
  "describe",
  "desc",
  "explain",
  "with",
  "table",
  "values",
  "help",
  "(",
]);

/** True when the statement is a kind that returns a result set — so a run
 * that produced zero rows is an empty result, not "0 rows affected". */
export function returnsResultSet(stmt: string): boolean {
  const kw = firstKeyword(stmt);
  return kw !== null && RESULT_SET_KEYWORDS.has(kw);
}

/** One-line preview of a statement for tooltips: whitespace collapsed and
 * capped at `max` chars. Leading comments are kept — they often label the
 * statement (e.g. "-- 1. Total rows"). */
export function statementPreview(stmt: string, max = 90): string {
  const flat = stmt.replace(/\s+/g, " ").trim();
  return flat.length > max ? `${flat.slice(0, max - 1)}…` : flat;
}
