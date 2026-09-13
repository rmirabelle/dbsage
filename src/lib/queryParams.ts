/**
 * Placeholders in saved or typed SQL, filled in from a dialog on Execute.
 *
 *   {{Primary Email}}              → a text input labeled "Primary Email"
 *   {{Locked=1|Unlocked=0}}        → a menu whose options are Locked / Unlocked
 *   {{State^SELECT code, label FROM us_states}}
 *                                  → a searchable menu filled by running that
 *                                    query: one column is label and value, two
 *                                    columns are value then label
 *
 * An option query may itself contain placeholders, written with balanced
 * braces: {{Column^SELECT name FROM cols WHERE db=\'{{Database}}\'}}. The
 * inner field is asked first and the outer query runs with its value.
 *
 * Double braces keep clear of JSON literals such as '{"a":1}'. A placeholder
 * inside a single- or double-quoted string is escaped on substitution, so the
 * user writes the quotes and the value can safely contain quotes. Inside the
 * braces, write \' or \" for a quote that belongs to the option query.
 */

export interface QueryParamOption {
  label: string;
  value: string;
}

export interface QueryParam {
  /** The label shown in the dialog; also the key values are remembered by. */
  name: string;
  /** Present for a menu placeholder; absent for a text input. */
  options?: QueryParamOption[];
  /** Present for a query-fed menu: SQL that lists the options at run time. It
   * may hold placeholders of its own; see `dependsOn`. */
  optionsSql?: string;
  /** Names of the placeholders inside `optionsSql`, which must be filled first. */
  dependsOn?: string[];
}

/** A top-level `{{…}}` span in some text, with nested braces balanced. */
export interface PlaceholderSpan {
  start: number;
  /** Just past the closing `}}`. */
  end: number;
  /** The text between the braces, nested placeholders included. */
  body: string;
}

/** Every top-level placeholder span in `text`, left to right. An unclosed
 * `{{` is ignored. */
export function placeholderSpans(text: string): PlaceholderSpan[] {
  const spans: PlaceholderSpan[] = [];
  let depth = 0;
  let start = -1;
  for (let i = 0; i < text.length - 1; i++) {
    if (text[i] === "{" && text[i + 1] === "{") {
      if (depth === 0) start = i;
      depth++;
      i++;
    } else if (text[i] === "}" && text[i + 1] === "}" && depth > 0) {
      depth--;
      i++;
      if (depth === 0) {
        spans.push({ start, end: i + 1, body: text.slice(start + 2, i - 1) });
      }
    }
  }
  return spans;
}

/** `text` with every top-level placeholder replaced by spaces, same length. */
export function blankPlaceholders(text: string): string {
  let out = text;
  for (const s of placeholderSpans(text)) {
    out = out.slice(0, s.start) + " ".repeat(s.end - s.start) + out.slice(s.end);
  }
  return out;
}

/** `\'` and `\"` inside a placeholder stand for plain quotes, so an option query can
 * quote its own strings while the placeholder sits inside a quoted SQL string. */
function unescapeBody(body: string): string {
  return body.replace(/\\(['"\\])/g, "$1");
}

function parseOptions(body: string): QueryParamOption[] | null {
  if (!body.includes("|") && !body.includes("=")) return null;
  const options = body.split("|").map((part) => {
    const eq = part.indexOf("=");
    if (eq < 0) return { label: part.trim(), value: part.trim() };
    return { label: part.slice(0, eq).trim(), value: part.slice(eq + 1).trim() };
  });
  return options.filter((o) => o.label !== "");
}

/** Split a placeholder body into its parts, shared by parse and substitute. */
function describe(rawBody: string): QueryParam {
  const body = unescapeBody(rawBody.trim());
  const caret = body.indexOf("^");
  if (caret >= 0) {
    const name = body.slice(0, caret).trim();
    const optionsSql = body.slice(caret + 1).trim().replace(/;\s*$/, "");
    if (name && optionsSql) {
      const inner = placeholderSpans(optionsSql).map((s) => describe(s.body).name);
      return { name, optionsSql, dependsOn: [...new Set(inner)] };
    }
  }
  const options = parseOptions(body);
  if (options) return { name: options.map((o) => o.label).join(" / "), options };
  return { name: body };
}

/**
 * Every distinct placeholder in `sql`, dependencies first. A name repeated as
 * a bare {{Name}} shares the options of the instance that has them. Throws
 * when placeholders depend on each other in a cycle.
 */
export function parseQueryParams(sql: string): QueryParam[] {
  const byName = new Map<string, QueryParam>();
  const collect = (text: string) => {
    for (const span of placeholderSpans(text)) {
      const param = describe(span.body);
      const prior = byName.get(param.name);
      if (!prior || (!prior.options && !prior.optionsSql && (param.options || param.optionsSql))) {
        byName.set(param.name, param);
      }
      if (param.optionsSql) collect(param.optionsSql);
    }
  };
  collect(sql);

  /* Dependencies first, so the dialog lists inner fields above outer ones. */
  const ordered: QueryParam[] = [];
  const state = new Map<string, "visiting" | "done">();
  const visit = (name: string) => {
    const mark = state.get(name);
    if (mark === "done") return;
    if (mark === "visiting") throw new Error(`Placeholder "${name}" depends on itself.`);
    state.set(name, "visiting");
    const param = byName.get(name);
    if (param) {
      for (const dep of param.dependsOn ?? []) visit(dep);
      ordered.push(param);
    }
    state.set(name, "done");
  };
  for (const name of byName.keys()) visit(name);
  return ordered;
}

/** True when the character at `index` sits inside a quoted string literal. */
function insideQuotes(sql: string, index: number): boolean {
  let quote = "";
  for (let i = 0; i < index; i++) {
    const ch = sql[i];
    if (quote) {
      if (ch === "\\") i++;
      else if (ch === quote) quote = "";
    } else if (ch === "'" || ch === '"') {
      quote = ch;
    }
  }
  return quote !== "";
}

function escapeForString(value: string): string {
  return value.replace(/\\/g, "\\\\").replace(/'/g, "\\'").replace(/"/g, '\\"');
}

/** Replace every top-level placeholder with its value from `values` (keyed by
 * name). Works on the main SQL and on an option query alike. */
export function substituteQueryParams(sql: string, values: Record<string, string>): string {
  let out = "";
  let last = 0;
  for (const span of placeholderSpans(sql)) {
    const value = values[describe(span.body).name];
    out += sql.slice(last, span.start);
    if (value === undefined) {
      out += sql.slice(span.start, span.end);
    } else {
      out += insideQuotes(sql, span.start) ? escapeForString(value) : value;
    }
    last = span.end;
  }
  return out + sql.slice(last);
}
