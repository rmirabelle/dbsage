/** Root objects only; arrays and malformed JSON contribute no keys. */
export function rootJsonProperties(rows: Record<string, unknown>[], column: string, arrayProperty?: string, selectorProperty?: string): string[] {
  const keys = new Set<string>();
  for (const row of rows.slice(0, 100)) {
    try {
      let value = typeof row[column] === "string" ? JSON.parse(row[column] as string) : row[column];
      if (arrayProperty !== undefined) {
        const array = arrayProperty === "" ? value : value?.[arrayProperty];
        if (selectorProperty !== undefined) {
          if (Array.isArray(array)) for (const item of array.slice(0, 1000)) {
            const candidate = item && typeof item === "object" && !Array.isArray(item) ? item[selectorProperty] : null;
            if (candidate != null && ["string", "number", "boolean"].includes(typeof candidate)) keys.add(String(candidate));
          }
          continue;
        }
        value = Array.isArray(array) ? array[0] : null;
      }
      if (value && typeof value === "object" && !Array.isArray(value)) Object.keys(value).forEach((key) => keys.add(key));
    } catch { /* A malformed document does not prevent suggestions from other rows. */ }
  }
  return [...keys].sort();
}

/** Complete the property side of a root/named-array selector, never its value or operator. */
export function jsonPropertyCompletion(text: string, caret: number) {
  const root = rootCompletion(text, caret);
  if (root) return { ...root, arrayProperty: undefined as string | undefined, selectorProperty: undefined as string | undefined };
  const bracket = text.lastIndexOf("[", caret - 1);
  if (bracket < 0) return null;
  const array = rootCompletion(text, bracket);
  if (!array) return null;
  const equality = text.slice(bracket + 1, caret).match(/^\s*([\p{L}_$-][\p{L}\p{N}_$-]*)\s*=\s*/u);
  if (equality) {
    const start = bracket + 1 + equality[0].length;
    const prefix = text.slice(start, caret);
    if (/[\[\]'"\r\n]/.test(prefix)) return null;
    const closing = text.indexOf("]", caret);
    const end = closing < 0 ? text.length : closing;
    return { start, end, prefix, arrayProperty: array.prefix, selectorProperty: equality[1] };
  }
  const leading = text.slice(bracket + 1, caret).match(/^\s*/)?.[0].length ?? 0;
  const start = bracket + 1 + leading;
  const prefix = text.slice(start, caret);
  if (!/^[\p{L}_$-][\p{L}\p{N}_$-]*$/u.test(prefix) && prefix !== "") return null;
  let end = caret;
  while (end < text.length && /[\p{L}\p{N}_$-]/u.test(text[end])) end++;
  return { start, end, prefix, arrayProperty: array.prefix, selectorProperty: undefined as string | undefined };
}

/** Only suggest a root path term, never an alias, literal, nested path or selector. */
export function rootCompletion(text: string, caret: number) {
  let quote = "";
  let brackets = 0;
  let start = 0;
  let alias = false;
  for (let i = 0; i < caret; i++) {
    const ch = text[i];
    if (quote) {
      if (ch === "\\") i++;
      else if (ch === quote) quote = "";
      continue;
    }
    if (ch === "'" || ch === '"') { quote = ch; continue; }
    if (ch === "[") brackets++;
    if (ch === "]") brackets--;
    if (!brackets && ch === ",") { start = i + 1; alias = false; }
    if (!brackets && ch === "+" && !alias) start = i + 1;
    if (!brackets && /^AS\s/i.test(text.slice(i)) && /\s/.test(text[i - 1] ?? "")) alias = true;
  }
  if (quote || brackets || alias) return null;
  const leading = text.slice(start, caret).match(/^\s*/)?.[0].length ?? 0;
  start += leading;
  const prefix = text.slice(start, caret);
  if (!/^[\p{L}\p{N}_$-]*$/u.test(prefix)) return null;
  let end = caret;
  while (end < text.length && /[\p{L}\p{N}_$-]/u.test(text[end])) end++;
  return { start, end, prefix };
}

export function matchingRootProperties(keys: string[], prefix: string) {
  return keys.filter((key) => /^[\p{L}\p{N}_$-]+$/u.test(key) && key.toLowerCase().startsWith(prefix.toLowerCase()))
    .sort((a, b) => a.localeCompare(b)).slice(0, 50);
}

export function matchingSelectorValues(values: string[], prefix: string) {
  return values.filter((value) => value.length > 0 && value.trim() === value && !/[\[\]'"\r\n]/.test(value)
    && value.toLowerCase().startsWith(prefix.toLowerCase()))
    .sort((a, b) => a.localeCompare(b)).slice(0, 50);
}
