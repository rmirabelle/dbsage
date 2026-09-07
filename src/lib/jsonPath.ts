/**
 * JSON property-path extraction shared by the data grid's "Show" display and the
 * query view's client-side result filtering. Walks a dotted path through a JSON
 * value, supporting array mapping, indices, exact selectors, and quoted LIKE
 * patterns (e.g. `answers[q LIKE 'eArrest.%'][0].lbl`).
 */

type LikeToken = { kind: "literal"; value: string } | { kind: "one" | "many" };
interface PathPredicate {
  k: string;
  v: string;
  like?: LikeToken[];
  negateLike?: boolean;
}

interface PathSeg {
  key: string;
  /** An exact or LIKE selector applied to array elements. */
  pred?: PathPredicate;
}

/** Only LIKE introduces quoting inside a selector; legacy '=' values stay literal. */
function startsLikeQuote(text: string, index: number): boolean {
  return /\[[^\[\]=]+?\s+LIKE\s*$/i.test(text.slice(0, index));
}

function parseLikePattern(pattern: string): LikeToken[] {
  const quote = pattern[0];
  if (quote !== "'" && quote !== '"') throw new Error("Quote the LIKE pattern, for example name LIKE 'eTimes%'.");
  const tokens: LikeToken[] = [];
  for (let i = 1; i < pattern.length; i++) {
    const ch = pattern[i];
    if (ch === quote) {
      if (i !== pattern.length - 1) throw new Error("Unexpected text after the LIKE pattern.");
      return tokens;
    }
    if (ch === "\\") {
      if (++i >= pattern.length) break;
      const escaped = pattern[i];
      tokens.push({ kind: "literal", value: ({ n: "\n", r: "\r", t: "\t" } as Record<string, string>)[escaped] ?? escaped });
    } else if (ch === "%") {
      if (tokens.at(-1)?.kind !== "many") tokens.push({ kind: "many" });
    } else if (ch === "_") tokens.push({ kind: "one" });
    else {
      const char = String.fromCodePoint(pattern.codePointAt(i)!);
      tokens.push({ kind: "literal", value: char });
      i += char.length - 1;
    }
  }
  throw new Error("Close the quoted LIKE pattern.");
}

/** Full-value, case-sensitive wildcard matching without executing regex syntax. */
function matchesLike(value: string, pattern: LikeToken[]): boolean {
  const chars = Array.from(value);
  let i = 0;
  let p = 0;
  let star = -1;
  let retry = 0;
  while (i < chars.length) {
    const token = pattern[p];
    if (token?.kind === "one" || (token?.kind === "literal" && token.value === chars[i])) { i++; p++; }
    else if (token?.kind === "many") { star = p++; retry = i; }
    else if (star >= 0) { p = star + 1; i = ++retry; }
    else return false;
  }
  while (pattern[p]?.kind === "many") p++;
  return p === pattern.length;
}

/**
 * Parse a property path into segments. Splits on `.` but not inside `[…]` (so
 * selector values may contain dots). Chained brackets become sequential steps:
 * `answers[q=eArrest.02][0].lbl` filters answers, takes the first, then reads lbl.
 * Numeric brackets use the same indexing step as the existing `.0` syntax.
 */
export function parseJsonPath(path: string): PathSeg[] {
  const tokens = splitShowSyntax(path, ".").filter(Boolean);
  return tokens.flatMap((tok): PathSeg[] => {
    const firstBracket = tok.indexOf("[");
    if (firstBracket < 0) return [{ key: tok }];
    const segments: PathSeg[] = [];
    let key = tok.slice(0, firstBracket).trim();
    let position = firstBracket;
    while (position < tok.length) {
      if (/\s/.test(tok[position])) { position++; continue; }
      if (tok[position] !== "[") throw new Error("Use a dot before the next property.");
      const start = ++position;
      let quote = "";
      for (; position < tok.length; position++) {
        const ch = tok[position];
        if (quote) {
          if (ch === "\\") position++;
          else if (ch === quote) quote = "";
        } else if ((ch === "'" || ch === '"') && startsLikeQuote(tok, position)) quote = ch;
        else if (ch === "]") break;
      }
      if (position >= tok.length) throw new Error("Close the path selector bracket.");
      const inner = tok.slice(start, position++).trim();
      const like = inner.match(/^([^=]+?)\s+(NOT\s+)?LIKE(?:\s+([\s\S]*))?$/i);
      if (/^\d+$/.test(inner)) {
        if (key) segments.push({ key });
        segments.push({ key: inner });
      } else if (like) {
        const pattern = (like[3] ?? "").trim();
        segments.push({ key, pred: { k: like[1].trim(), v: pattern, like: parseLikePattern(pattern), negateLike: !!like[2] } });
      } else {
        const eq = inner.indexOf("=");
        segments.push(eq < 0 ? { key } : {
          key,
          pred: { k: inner.slice(0, eq).trim(), v: inner.slice(eq + 1).trim() },
        });
      }
      key = "";
    }
    return segments;
  });
}

function predMatches(el: unknown, pred: PathPredicate): boolean {
  if (el === null || typeof el !== "object") return false;
  const got = (el as Record<string, unknown>)[pred.k];
  if (pred.like) {
    /** Neither LIKE nor NOT LIKE selects missing, null, or structured values. */
    if (got == null || typeof got === "object") return false;
    const matched = matchesLike(String(got), pred.like);
    return pred.negateLike ? !matched : matched;
  }
  return got === pred.v || String(got) === pred.v;
}

/**
 * Walk a parsed path through JSON. Objects descend by key; a numeric segment
 * indexes an array; a `[k=v]` selector filters an array to matching elements;
 * any other segment hitting an array maps the remaining path over each element
 * (flattened). So `answers[q=eArrest.02].lbl` pulls `lbl` from the answer whose
 * `q` matches, and `answers.v` pulls `v` from every answer.
 */
export function extractAtPath(node: unknown, segs: PathSeg[]): unknown {
  if (segs.length === 0) return node;
  if (node === null || node === undefined) return undefined;
  const [seg, ...rest] = segs;

  if (Array.isArray(node)) {
    if (!seg.key && seg.pred) {
      const p = seg.pred;
      return extractAtPath(
        node.filter((el) => predMatches(el, p)),
        rest
      );
    }
    if (!seg.pred && /^\d+$/.test(seg.key)) {
      return extractAtPath(node[Number(seg.key)], rest);
    }
    return node.flatMap((el) => {
      const r = extractAtPath(el, segs);
      return r === undefined ? [] : Array.isArray(r) ? r : [r];
    });
  }

  if (typeof node !== "object") return undefined;
  let next: unknown = (node as Record<string, unknown>)[seg.key];
  if (seg.pred && Array.isArray(next)) {
    const p = seg.pred;
    next = next.filter((el) => predMatches(el, p));
  }
  return extractAtPath(next, rest);
}

function extractJsonForDisplay(value: unknown, path: string, segments?: PathSeg[]): unknown {
  let parsed: unknown = value;
  if (typeof value === "string") {
    try {
      parsed = JSON.parse(value);
    } catch {
      return value;
    }
  }
  const result = extractAtPath(parsed, segments ?? parseJsonPath(path));
  /* A mapped array of values is shown as a compact " · " list; a single value
     keeps its native type for typed coloring. */
  if (Array.isArray(result)) {
    if (result.length === 0) return undefined;
    if (result.length === 1) return result[0];
    return result.map(compactDisplay).join(" · ");
  }
  return result;
}

/** Compact one extracted value to a string, for joining multiple SHOW paths. */
export function compactDisplay(v: unknown): string {
  if (v === undefined) return "";
  if (v === null) return "null";
  if (typeof v === "string") return v;
  if (typeof v === "number" || typeof v === "boolean") return String(v);
  return JSON.stringify(v);
}

type ShowTerm = { kind: "path" | "literal"; text: string; segments?: PathSeg[] };
interface ShowExpression {
  source: string;
  alias?: string;
  terms: ShowTerm[];
}

/** Delimiters inside selectors or quoted text are always literal characters. */
function splitShowSyntax(text: string, delimiter: "," | "+" | "AS" | "."): string[] {
  const parts: string[] = [];
  let start = 0;
  let depth = 0;
  let quote = "";
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (quote) {
      if (ch === "\\") i++;
      else if (ch === quote) quote = "";
      continue;
    }
    if ((ch === "'" || ch === '"') && (depth === 0 || startsLikeQuote(text, i))) {
      quote = ch;
      continue;
    }
    if (ch === "[") depth++;
    else if (ch === "]") {
      if (--depth < 0) throw new Error("Unexpected closing bracket.");
    }
    if (depth !== 0) continue;
    const separator = delimiter === "AS"
      ? text.slice(i, i + 2).toUpperCase() === "AS" &&
        i > 0 && /\s/.test(text[i - 1]) &&
        (i + 2 === text.length || /\s/.test(text[i + 2]))
      : ch === delimiter;
    if (separator) {
      parts.push(text.slice(start, i).trim());
      i += delimiter.length - 1;
      start = i + 1;
    }
  }
  if (quote) throw new Error("Close the quoted text.");
  if (depth !== 0) throw new Error("Close the path selector bracket.");
  parts.push(text.slice(start).trim());
  return parts;
}

function quotedShowText(text: string): string {
  const quote = text[0];
  let result = "";
  for (let i = 1; i < text.length; i++) {
    const ch = text[i];
    if (ch === quote) {
      if (i !== text.length - 1) throw new Error("Use + between text and paths.");
      return result;
    }
    if (ch === "\\") {
      const escaped = text[++i];
      const escapes: Record<string, string> = { n: "\n", r: "\r", t: "\t", "\\": "\\", "'": "'", '"': '"' };
      if (!(escaped in escapes)) throw new Error("Unsupported text escape.");
      result += escapes[escaped];
    } else result += ch;
  }
  throw new Error("Close the quoted text.");
}

/** Cache syntax independently of row values; SHOW is evaluated for many cells. */
const showCache = new Map<string, { expressions: ShowExpression[]; error: string | null }>();

function parseShow(show: string) {
  const cached = showCache.get(show);
  if (cached) return cached;
  let result: { expressions: ShowExpression[]; error: string | null };
  try {
    const expressions = splitShowSyntax(show, ",").filter(Boolean).map((part) => {
      const [source, ...aliases] = splitShowSyntax(part, "AS");
      if (aliases.length > 1) throw new Error("Use one AS alias per expression; quote aliases containing AS.");
      let alias = aliases[0];
      if (alias !== undefined) {
        if (!alias) throw new Error("Enter a label after AS.");
        if (alias[0] === "'" || alias[0] === '"') alias = quotedShowText(alias);
        if (!alias.trim()) throw new Error("Aliases cannot be empty.");
      }
      const terms = splitShowSyntax(source, "+").map((term): ShowTerm => {
        if (!term) throw new Error("Enter a path or quoted text on each side of +.");
        if (term[0] === "'" || term[0] === '"') return { kind: "literal", text: quotedShowText(term) };
        return { kind: "path", text: term, segments: parseJsonPath(term) };
      });
      return { source, alias, terms };
    });
    result = { expressions, error: null };
  } catch (error) {
    result = { expressions: [], error: (error as Error).message };
  }
  if (showCache.size >= 100) showCache.delete(showCache.keys().next().value!);
  showCache.set(show, result);
  return result;
}

export function validateJsonShow(show: string): string | null {
  return parseShow(show).error;
}

function evaluateShow(value: unknown, expression: ShowExpression): unknown {
  const values = expression.terms.map((term) => term.kind === "literal"
    ? term.text : extractJsonForDisplay(value, term.text, term.segments));
  if (values.length === 1) return values[0];
  return values.map((v) => v == null ? "" : compactDisplay(v)).join("");
}

/** One labeled SHOW expression, for styled grid rendering. */
export interface JsonShowPart {
  label: string;
  value: string;
}

/**
 * Explicit aliases are shown even for a single expression. Multiple expressions
 * without aliases use their source as a label; a lone unaliased value stays typed.
 */
export function extractJsonShowParts(value: unknown, show: string): JsonShowPart[] | null {
  const { expressions, error } = parseShow(show);
  if (error || expressions.length === 0 || (expressions.length === 1 && expressions[0].alias === undefined)) return null;
  return expressions.map((expression) => ({
    label: expression.alias ?? expression.source,
    value: compactDisplay(evaluateShow(value, expression)),
  }));
}

/**
 * Resolve paths, text concatenation, and optional aliases against a JSON cell.
 * A lone unaliased path keeps its native type; labeled expressions use the same
 * text as the styled cell parts for tooltips and width estimation.
 */
export function extractJsonDisplay(value: unknown, show: string): unknown {
  const { expressions, error } = parseShow(show);
  if (error || expressions.length === 0) return value;
  const parts = extractJsonShowParts(value, show);
  return parts ? parts.map((part) => `${part.label}: ${part.value}`).join(", ")
    : evaluateShow(value, expressions[0]);
}

/**
 * Extract the candidate value(s) at a path from a (possibly stringified) JSON
 * cell, flattened to an array. Used by client-side result filtering: a filter
 * matches when any candidate satisfies it. Returns [] when the value isn't JSON
 * or the path resolves to nothing.
 */
export function extractJsonCandidates(value: unknown, path: string): unknown[] {
  let parsed: unknown = value;
  if (typeof value === "string") {
    try {
      parsed = JSON.parse(value);
    } catch {
      return [];
    }
  }
  try {
    const result = extractAtPath(parsed, parseJsonPath(path));
    if (result === undefined) return [];
    return Array.isArray(result) ? result : [result];
  } catch {
    return [];
  }
}
