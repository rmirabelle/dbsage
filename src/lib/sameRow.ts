import type { ColumnInfo, RowRecord } from "../types";

/**
 * Where the row at `oldIndex` of `oldRows` now sits in `newRows`, or -1 when
 * it is gone. Rows are matched by primary-key values when the table has a
 * key, else by comparing every cell — so a selection survives a filter, sort
 * or refresh that still includes the row.
 */
export function findSameRow(
  columns: ColumnInfo[],
  oldRows: RowRecord[] | undefined,
  oldIndex: number,
  newRows: RowRecord[]
): number {
  const row = oldRows?.[oldIndex];
  if (!row) return -1;
  const pk = columns.filter((c) => c.key === "PRI").map((c) => c.name);
  const keyOf = (r: RowRecord) =>
    JSON.stringify(pk.length > 0 ? pk.map((k) => r[k]) : r);
  const want = keyOf(row);
  return newRows.findIndex((r) => keyOf(r) === want);
}
