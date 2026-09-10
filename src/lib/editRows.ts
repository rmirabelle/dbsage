import type { ColumnInfo, RowRecord } from "../types";

export type CellEdit = { rowIndex: number; column: string; value: string | null };
type Update = { pk: { column: string; value: string | null }[]; column: string; value: string | null };

/** Snapshot row identities before asynchronous writes; track edited composite keys
 * so later edits to the same row still address the correct record. */
export async function editRows(columns: ColumnInfo[], rows: RowRecord[], edits: CellEdit[],
  write: (update: Update) => Promise<unknown>): Promise<void> {
  const keys = columns.filter((column) => column.key === "PRI");
  if (!keys.length) throw new Error("Table has no primary key — cell editing is disabled.");
  const identities = new Map(edits.map(({ rowIndex }) => {
    const row = rows[rowIndex];
    if (!row) throw new Error("The selected row is no longer available.");
    return [rowIndex, keys.map(({ name }) => ({ column: name, value: row[name] == null ? null : String(row[name]) }))];
  }));
  for (const edit of edits) {
    const pk = identities.get(edit.rowIndex)!;
    await write({ pk: pk.map((key) => ({ ...key })), column: edit.column, value: edit.value });
    const changedKey = pk.find((key) => key.column === edit.column);
    if (changedKey) changedKey.value = edit.value;
  }
}
