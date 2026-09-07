export interface JsonTreeRow {
  path: string;
  depth: number;
  key: string;
  arrayIndex: boolean;
  value: unknown;
  text: string;
  lowerKey: string;
  lowerText: string;
  container: boolean;
  count: number;
  end: number;
}

/** Flatten once per document, with subtree boundaries for cheap collapsing. */
export function buildJsonTreeRows(data: unknown): JsonTreeRow[] {
  const rows: JsonTreeRow[] = [];
  const visit = (value: unknown, key: string, arrayIndex: boolean, path: string, depth: number) => {
    const container = value !== null && typeof value === "object";
    const entries = container ? Object.entries(value) : [];
    const text = container ? "" : value === null ? "null" : String(value);
    const row: JsonTreeRow = { path, depth, key, arrayIndex, value, text,
      lowerKey: arrayIndex ? "" : key.toLowerCase(), lowerText: text.toLowerCase(),
      container, count: entries.length, end: 0 };
    rows.push(row);
    for (const [childKey, child] of entries) {
      visit(child, childKey, Array.isArray(value), `${path}/${childKey.replace(/~/g, "~0").replace(/\//g, "~1")}`, depth + 1);
    }
    row.end = rows.length;
  };
  if (data !== null && typeof data === "object") {
    for (const [key, value] of Object.entries(data)) {
      visit(value, key, Array.isArray(data), `/${key.replace(/~/g, "~0").replace(/\//g, "~1")}`, 0);
    }
  } else visit(data, "", true, "", 0);
  return rows;
}

export function visibleJsonTreeRows(rows: JsonTreeRow[], collapsed: Set<string>, searching: boolean): JsonTreeRow[] {
  if (searching) return rows;
  const visible: JsonTreeRow[] = [];
  for (let i = 0; i < rows.length;) {
    const row = rows[i];
    visible.push(row);
    i = row.container && collapsed.has(row.path) ? row.end : i + 1;
  }
  return visible;
}

export function matchOffsets(lowerText: string, lowerQuery: string): number[] {
  if (!lowerQuery) return [];
  const offsets: number[] = [];
  let index = lowerText.indexOf(lowerQuery);
  while (index !== -1) {
    offsets.push(index);
    index = lowerText.indexOf(lowerQuery, index + lowerQuery.length);
  }
  return offsets;
}

export function indexJsonTreeMatches(rows: JsonTreeRow[], query: string) {
  const lowerQuery = query.toLowerCase();
  let count = 0;
  const matches = rows.map((row) => {
    const keys = matchOffsets(row.lowerKey, lowerQuery);
    const values = matchOffsets(row.lowerText, lowerQuery);
    const start = count;
    count += keys.length + values.length;
    return { keys, values, start, end: count };
  });
  return { matches, count };
}
