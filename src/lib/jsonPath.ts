/**
 * JSON property-path extraction shared by the data grid's "Show" display and the
 * query view's client-side result filtering. Walks a dotted path through a JSON
 * value, supporting array-of-objects mapping and `[key=value]` element selectors
 * (e.g. `answers[q=eArrest.02].lbl`).
 */

interface PathSeg {
  key: string;
  /** Optional `[k=v]` selector: keep only array elements where element.k == v. */
  pred?: { k: string; v: string };
}

/**
 * Parse a property path into segments. Splits on `.` but not inside `[…]` (so
 * selector values may contain dots), and parses a trailing `[key=value]`
 * selector on a segment. e.g. `answers[q=eArrest.02].lbl`.
 */
export function parseJsonPath(path: string): PathSeg[] {
  const tokens: string[] = [];
  let buf = "";
  let depth = 0;
  for (const ch of path) {
    if (ch === "[") depth++;
    else if (ch === "]") depth = Math.max(0, depth - 1);
    if (ch === "." && depth === 0) {
      if (buf.trim()) tokens.push(buf.trim());
      buf = "";
    } else {
      buf += ch;
    }
  }
  if (buf.trim()) tokens.push(buf.trim());
  return tokens.map((tok) => {
    const m = tok.match(/^([^[]*)\[([^\]]*)\]$/);
    if (!m) return { key: tok };
    const key = m[1].trim();
    const inner = m[2];
    const eq = inner.indexOf("=");
    if (eq < 0) return { key };
    return {
      key,
      pred: { k: inner.slice(0, eq).trim(), v: inner.slice(eq + 1).trim() },
    };
  });
}

function predMatches(el: unknown, pred: { k: string; v: string }): boolean {
  if (el === null || typeof el !== "object") return false;
  const got = (el as Record<string, unknown>)[pred.k];
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

function extractJsonForDisplay(value: unknown, path: string): unknown {
  let parsed: unknown = value;
  if (typeof value === "string") {
    try {
      parsed = JSON.parse(value);
    } catch {
      return value;
    }
  }
  const result = extractAtPath(parsed, parseJsonPath(path));
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

function splitShow(show: string): string[] {
  return show
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
}

/** One labeled segment of a multi-path SHOW spec, for styled grid rendering. */
export interface JsonShowPart {
  label: string;
  value: string;
}

/**
 * Break a multi-path SHOW spec into labeled `{ label, value }` parts so the grid
 * can style the path labels differently from their values. Returns null for a
 * single (or empty) path, where the native typed value is shown without a label.
 */
export function extractJsonShowParts(value: unknown, show: string): JsonShowPart[] | null {
  const paths = splitShow(show);
  if (paths.length <= 1) return null;
  return paths.map((p) => ({
    label: p,
    value: compactDisplay(extractJsonForDisplay(value, p)),
  }));
}

/**
 * Resolve a SHOW spec — a single property path or a comma-separated list — against
 * a JSON cell value. A single path keeps its native type (so numbers/bools still
 * get typed coloring); multiple paths are labeled with their path and joined as
 * `path: value, path: value` (used for tooltips and width estimation).
 */
export function extractJsonDisplay(value: unknown, show: string): unknown {
  const paths = splitShow(show);
  if (paths.length <= 1) {
    return extractJsonForDisplay(value, paths[0] ?? show);
  }
  return paths
    .map((p) => `${p}: ${compactDisplay(extractJsonForDisplay(value, p))}`)
    .join(", ");
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
  const result = extractAtPath(parsed, parseJsonPath(path));
  if (result === undefined) return [];
  return Array.isArray(result) ? result : [result];
}
