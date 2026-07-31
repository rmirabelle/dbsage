import type { CellValue, ColumnInfo, RowRecord } from "../types";

export type CopyAsFormat = "insert" | "update" | "psv" | "psv-header";

export const COPY_AS_OPTIONS: { format: CopyAsFormat; label: string }[] = [
  { format: "insert", label: "INSERT SQL" },
  { format: "update", label: "UPDATE SQL" },
  { format: "psv", label: "Pipe-delimited" },
  { format: "psv-header", label: "Pipe-delimited + header" },
];

export type ResultCopyFormat = "json" | "csv" | "tsv";

export const RESULT_COPY_OPTIONS: { format: ResultCopyFormat; label: string }[] = [
  { format: "json", label: "JSON" },
  { format: "csv", label: "CSV + header" },
  { format: "tsv", label: "Tab-delimited (Excel)" },
];

/** Backtick-quote an identifier (column / table / database name). */
const id = (name: string) => `\`${name.replace(/`/g, "``")}\``;

/** Render a cell value as a MySQL literal for INSERT/UPDATE. */
function sqlLiteral(v: CellValue): string {
  if (v === null) return "NULL";
  if (typeof v === "number") return String(v);
  if (typeof v === "boolean") return v ? "TRUE" : "FALSE";
  return `'${v.replace(/\\/g, "\\\\").replace(/'/g, "\\'")}'`;
}

/** A single `col = value` predicate, using IS NULL for null values. */
function predicate(col: ColumnInfo, v: CellValue): string {
  return v === null ? `${id(col.name)} IS NULL` : `${id(col.name)} = ${sqlLiteral(v)}`;
}

/** Flatten a cell to a pipe-delimited field: pipes/newlines collapse to a space; null → empty. */
function psvCell(v: CellValue): string {
  if (v === null) return "";
  return String(v).replace(/[|\r\n]+/g, " ");
}

/** Quote a CSV field per RFC 4180: wrap in double quotes when it contains a
 * comma, quote, or newline; double any embedded quotes. Null → empty field. */
function csvCell(v: CellValue): string {
  if (v === null) return "";
  const s = String(v);
  return /[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

/** Flatten a cell to a tab-delimited field: tabs/newlines collapse to a space
 * so a paste into Excel lands one grid row per spreadsheet row. Null → empty. */
function tsvCell(v: CellValue): string {
  if (v === null) return "";
  return String(v).replace(/[\t\r\n]+/g, " ");
}

/**
 * Build clipboard text for query-result rows — formats that need no table
 * target. JSON is a pretty-printed array of objects in visible-column order;
 * CSV and tab-delimited both include a header row.
 */
export function buildResultCopyText(
  format: ResultCopyFormat,
  columns: ColumnInfo[],
  rows: RowRecord[]
): string {
  if (format === "json") {
    const objs = rows.map((row) =>
      Object.fromEntries(columns.map((c) => [c.name, row[c.name] ?? null]))
    );
    return JSON.stringify(objs, null, 2);
  }
  const sep = format === "csv" ? "," : "\t";
  const cell = format === "csv" ? csvCell : tsvCell;
  const lines = [columns.map((c) => cell(c.name)).join(sep)];
  for (const row of rows) {
    lines.push(columns.map((c) => cell(row[c.name] ?? null)).join(sep));
  }
  return lines.join("\n");
}

/**
 * Build clipboard text for a set of rows in the requested format. SQL targets
 * are fully qualified (`db`.`table`). UPDATE keys its WHERE clause on the
 * primary-key columns and SETs the rest; with no primary key it matches and
 * sets every column.
 */
export function buildCopyText(
  format: CopyAsFormat,
  database: string,
  table: string,
  columns: ColumnInfo[],
  rows: RowRecord[]
): string {
  if (format === "psv" || format === "psv-header") {
    const lines: string[] = [];
    if (format === "psv-header") lines.push(columns.map((c) => c.name).join("|"));
    for (const row of rows) {
      lines.push(columns.map((c) => psvCell(row[c.name])).join("|"));
    }
    return lines.join("\n");
  }

  const target = `${id(database)}.${id(table)}`;

  if (format === "insert") {
    const colList = columns.map((c) => id(c.name)).join(", ");
    return rows
      .map((row) => {
        const vals = columns.map((c) => sqlLiteral(row[c.name])).join(", ");
        return `INSERT INTO ${target} (${colList}) VALUES (${vals});`;
      })
      .join("\n");
  }

  const pkCols = columns.filter((c) => c.key === "PRI");
  const whereCols = pkCols.length > 0 ? pkCols : columns;
  const setCols = pkCols.length > 0 ? columns.filter((c) => c.key !== "PRI") : columns;
  /* All columns are primary key: nothing left to SET, so set every column. */
  const effectiveSet = setCols.length > 0 ? setCols : columns;
  return rows
    .map((row) => {
      const setClause = effectiveSet
        .map((c) => `${id(c.name)} = ${sqlLiteral(row[c.name])}`)
        .join(", ");
      const whereClause = whereCols.map((c) => predicate(c, row[c.name])).join(" AND ");
      return `UPDATE ${target} SET ${setClause} WHERE ${whereClause};`;
    })
    .join("\n");
}
