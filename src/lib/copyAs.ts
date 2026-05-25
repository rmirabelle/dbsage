import type { CellValue, ColumnInfo, RowRecord } from "../types";

export type CopyAsFormat = "insert" | "update" | "tsv" | "tsv-header";

export const COPY_AS_OPTIONS: { format: CopyAsFormat; label: string }[] = [
  { format: "insert", label: "INSERT statement" },
  { format: "update", label: "UPDATE statement" },
  { format: "tsv", label: "Tab-separated values" },
  { format: "tsv-header", label: "Tab-separated values (w/ header row)" },
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

/** Flatten a cell to a TSV field: tabs/newlines collapse to a space; null → empty. */
function tsvCell(v: CellValue): string {
  if (v === null) return "";
  return String(v).replace(/[\t\r\n]+/g, " ");
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
  if (format === "tsv" || format === "tsv-header") {
    const lines: string[] = [];
    if (format === "tsv-header") lines.push(columns.map((c) => c.name).join("\t"));
    for (const row of rows) {
      lines.push(columns.map((c) => tsvCell(row[c.name])).join("\t"));
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
