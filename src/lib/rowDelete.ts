import { ipc } from "../ipc";
import { cellToFilterValue } from "./relations";
import { invalidateRelatedExistence } from "./relatedExistence";
import type {
  CascadeTarget,
  ColumnInfo,
  Relation,
  RowRecord,
} from "../types";

/** Serialise a grid cell value for an IPC call (null stays null). */
export function toIpcString(v: unknown): string | null {
  if (v === null || v === undefined) return null;
  if (typeof v === "string") return v;
  if (typeof v === "number" || typeof v === "boolean") return String(v);
  return JSON.stringify(v);
}

interface RowSet {
  profileId: string;
  database: string;
  table: string;
  columns: ColumnInfo[];
  rows: RowRecord[];
}

/** Related-row cascade preview for a pending delete: relations FROM this
 * table that fan outward — has_many (one-to-many) always; has_one only when
 * anchored on a PK column (one-to-one). A has_one hanging off an FK column
 * is many-to-one (a shared parent) and is never offered for cascade. Only
 * targets that actually hold matching rows are returned. Shared by the main
 * table view and peek windows so both offer the same cascade. */
export async function previewCascadeTargets(
  set: RowSet,
  relations: Relation[],
  indices: number[]
): Promise<CascadeTarget[]> {
  const pkCols = new Set(
    set.columns.filter((c) => c.key === "PRI").map((c) => c.name)
  );
  const eligible = relations.filter(
    (r) =>
      r.fromTable === set.table &&
      (r.kind === "has_many" || pkCols.has(r.fromColumn))
  );
  /* Two relations can share a target table.column — count each once. */
  const seen = new Set<string>();
  const targets: CascadeTarget[] = [];
  await Promise.all(
    eligible.map(async (r) => {
      const key = `${r.toTable}::${r.toColumn}`;
      if (seen.has(key)) return;
      seen.add(key);
      const values = [
        ...new Set(
          indices
            .map((i) => cellToFilterValue(set.rows[i]?.[r.fromColumn]))
            .filter((v): v is string => v != null)
        ),
      ];
      if (values.length === 0) return;
      const counts = await Promise.all(
        values.map((v) =>
          ipc.countRows({
            profileId: set.profileId,
            database: set.database,
            table: r.toTable,
            filters: [{ column: r.toColumn, op: "equals", value: v }],
          })
        )
      );
      const count = counts.reduce((a, b) => a + b, 0);
      if (count > 0)
        targets.push({ table: r.toTable, column: r.toColumn, values, count });
    })
  );
  return targets.sort((a, b) => a.table.localeCompare(b.table));
}

/** Delete the rows at `indices` by primary key, cascading into `cascade`
 * targets first so a failure midway never leaves orphaned related rows.
 * Every touched table has its related-existence cache invalidated (in this
 * window and every other open window) so relation menus re-check. */
export async function deleteRowsWithCascade(
  set: RowSet,
  indices: number[],
  cascade: CascadeTarget[] | null | undefined
): Promise<void> {
  const pkColumns = set.columns.filter((c) => c.key === "PRI");
  if (pkColumns.length === 0) {
    throw new Error("Table has no primary key - row deletion is disabled.");
  }
  try {
    for (const c of cascade ?? []) {
      await ipc.deleteRowsByValues({
        profileId: set.profileId,
        database: set.database,
        table: c.table,
        column: c.column,
        values: c.values,
      });
    }
    for (const rowIndex of indices) {
      const row = set.rows[rowIndex];
      if (!row) continue;
      const pk = pkColumns.map((c) => ({
        column: c.name,
        value: toIpcString(row[c.name]),
      }));
      await ipc.deleteRow({
        profileId: set.profileId,
        database: set.database,
        table: set.table,
        pk,
      });
    }
  } finally {
    /* Even a partial failure may have removed rows — always invalidate. */
    for (const c of cascade ?? []) {
      invalidateRelatedExistence(set.profileId, set.database, c.table);
    }
    invalidateRelatedExistence(set.profileId, set.database, set.table);
  }
}
