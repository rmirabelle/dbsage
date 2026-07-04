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

/**
 * Clause keywords/phrases that start a new line in Condensed style. Ordered
 * longest-first so a multi-word form wins over its prefix in the alternation
 * (LEFT OUTER JOIN before LEFT JOIN before JOIN; UNION ALL before UNION). Edit
 * freely — the break regex is rebuilt from this list.
 */
const CONDENSED_BREAK_CLAUSES = [
  "FROM",
  "WHERE",
  "GROUP BY",
  "HAVING",
  "ORDER BY",
  "LIMIT",
  "OFFSET",
  "UNION ALL",
  "UNION",
  "LEFT OUTER JOIN",
  "RIGHT OUTER JOIN",
  "FULL OUTER JOIN",
  "INNER JOIN",
  "CROSS JOIN",
  "NATURAL JOIN",
  "LEFT JOIN",
  "RIGHT JOIN",
  "FULL JOIN",
  "STRAIGHT_JOIN",
  "JOIN",
];

/** Matches a string literal, comment, or backtick identifier as a whole token so
 * the compaction skips over them (a "from" inside a string is left alone). */
const SKIP_RE =
  /'(?:\\.|[^'])*'|"(?:\\.|[^"])*"|`(?:[^`]|``)*`|\/\*[\s\S]*?\*\/|--[^\n]*|#[^\n]*/g;

const BREAK_RE = new RegExp(
  `\\s*\\b(${CONDENSED_BREAK_CLAUSES.map((k) => k.replace(/\s+/g, "\\s+")).join(
    "|"
  )})\\b`,
  "gi"
);

/**
 * Compact one code (non-skip) segment: collapse every run of whitespace to a
 * single space — folding the keyword-then-indented-body layout that Standard
 * produces back onto one line — then break each clause onto its own line.
 * `afterLineComment` preserves the newline that must terminate a preceding
 * `--`/`#` comment, or the collapsed code would be swallowed into it.
 */
function condenseSegment(code: string, afterLineComment: boolean): string {
  let prefix = "";
  if (afterLineComment) {
    const nl = code.indexOf("\n");
    if (nl !== -1) {
      prefix = "\n";
      code = code.slice(nl + 1);
    }
  }
  const body = code
    .replace(/[ \t\r\n]+/g, " ")
    .replace(BREAK_RE, (_m, keyword) => "\n" + keyword);
  /* A leading break already starts the segment on a fresh line; don't stack the
     comment-terminating newline on top of it. */
  if (prefix && body.startsWith("\n")) prefix = "";
  return prefix + body;
}

/**
 * Keywords that reset the clause context to "other" — the next clause, set
 * operator, or join keyword — ending both a SELECT column list and any
 * condition. Only the first word matters (GROUP/ORDER, not BY; LEFT/INNER, not
 * JOIN).
 */
const CLAUSE_RESET = new Set([
  "FROM", "GROUP", "ORDER", "LIMIT", "OFFSET", "UNION", "INTO", "SET", "VALUES",
  "JOIN", "INNER", "LEFT", "RIGHT", "FULL", "CROSS", "NATURAL", "STRAIGHT_JOIN",
  "USING",
]);

/** Boolean operators that break onto their own line inside a condition context
 * (JOIN ON / WHERE / HAVING). `BETWEEN`'s delimiter `AND` is handled separately
 * and never breaks. */
const CONDITION_BREAK_OPS = new Set(["AND", "OR"]);

type ClauseCtx = "select" | "condition" | "other";

/**
 * Second pass: break the separators the clause pass leaves inline — SELECT
 * columns (top-level commas) and condition predicates (`AND` in a JOIN ON /
 * WHERE / HAVING) — each onto its own line. Tracks paren depth and the clause
 * context at each depth, so commas inside a function call, commas in a
 * GROUP BY / ORDER BY list, and the `AND` that delimits `BETWEEN x AND y` are
 * all left alone. Skip regions (strings/comments/backticks) pass through
 * verbatim, so a comma or `AND` inside a literal never breaks.
 */
function breakColumnsAndConditions(text: string): string {
  const ctx: ClauseCtx[] = ["other"];
  /** Per-depth: is the next `AND` the delimiter of a pending `BETWEEN … AND …`? */
  const between: boolean[] = [false];
  let depth = 0;

  const scanCode = (code: string): string => {
    let res = "";
    let word = "";
    const endWord = () => {
      if (!word) return;
      const u = word.toUpperCase();
      if (ctx[depth] === "condition" && CONDITION_BREAK_OPS.has(u)) {
        if (u === "AND" && between[depth]) {
          between[depth] = false;
        } else {
          if (res.endsWith(" ")) res = res.slice(0, -1);
          res += "\n";
        }
      }
      if (u === "SELECT") ctx[depth] = "select";
      else if (u === "WHERE" || u === "HAVING" || u === "ON") ctx[depth] = "condition";
      else if (CLAUSE_RESET.has(u)) ctx[depth] = "other";
      else if (u === "BETWEEN" && ctx[depth] === "condition") between[depth] = true;
      res += word;
      word = "";
    };
    for (let i = 0; i < code.length; i++) {
      const ch = code[i];
      if (/[A-Za-z0-9_$]/.test(ch)) {
        word += ch;
        continue;
      }
      endWord();
      if (ch === "(") {
        depth++;
        ctx[depth] = "other";
        between[depth] = false;
        res += ch;
      } else if (ch === ")") {
        if (depth > 0) {
          ctx.pop();
          between.pop();
          depth--;
        }
        res += ch;
      } else if (ch === "," && ctx[depth] === "select") {
        res += ",\n";
        /* The following space is now a line-leading one — drop it so the next
           column sits flush-left. */
        if (code[i + 1] === " ") i++;
      } else {
        res += ch;
      }
    }
    endWord();
    return res;
  };

  let out = "";
  let last = 0;
  let m: RegExpExecArray | null;
  SKIP_RE.lastIndex = 0;
  while ((m = SKIP_RE.exec(text)) !== null) {
    out += scanCode(text.slice(last, m.index)) + m[0];
    last = m.index + m[0].length;
  }
  out += scanCode(text.slice(last));
  return out;
}

/**
 * Condensed ("Compact") formatting: one clause per line, each clause keyword
 * kept together with its body, each SELECT column on its own line, and each
 * `AND` predicate in a JOIN ON / WHERE / HAVING on its own line. Collapses all
 * insignificant whitespace, then breaks before FROM / the JOIN family / WHERE /
 * GROUP BY / HAVING / ORDER BY / LIMIT / OFFSET / UNION, after the SELECT list's
 * separating commas, and before condition `AND`s (except BETWEEN's delimiter).
 * String literals, comments, and backtick identifiers pass through verbatim, so
 * their contents are never collapsed or broken on.
 */
export function formatCondensed(sql: string): string {
  let out = "";
  let last = 0;
  let m: RegExpExecArray | null;
  let afterLineComment = false;
  SKIP_RE.lastIndex = 0;
  while ((m = SKIP_RE.exec(sql)) !== null) {
    out += condenseSegment(sql.slice(last, m.index), afterLineComment) + m[0];
    afterLineComment = m[0].startsWith("--") || m[0].startsWith("#");
    last = m.index + m[0].length;
  }
  out += condenseSegment(sql.slice(last), afterLineComment);
  return breakColumnsAndConditions(out).trim();
}

/** Format `sql` in the requested style. */
export function formatSql(sql: string, style: FormatStyle): string {
  return style === "condensed" ? formatCondensed(sql) : formatStandard(sql);
}
