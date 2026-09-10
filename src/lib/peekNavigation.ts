import type { ColumnFilter, PeekTarget, RowRecord } from "../types";

export interface PeekLocation {
  profileId: string;
  database: string;
  table: string;
  /** Child table reached from this ancestor along the current peek path. */
  childTable?: string;
  target?: PeekTarget;
  filters?: ColumnFilter[];
  row?: RowRecord | null;
  label: string;
  reveal: () => void;
}

/** Return only along a reversed table relationship, and only to matching records. */
export function findPeekLocation(locations: PeekLocation[], profileId: string, database: string,
  target: PeekTarget, kind: "has_one" | "has_many", sourceTable: string) {
  if (target.value == null) return undefined;
  return locations.find((location) => {
    if (location.childTable !== sourceTable) return false;
    if (location.profileId !== profileId || location.database !== database || location.table !== target.table) return false;
    if (kind === "has_one" && location.row?.[target.column] != null && String(location.row[target.column]) === target.value) return true;
    return !location.filters?.length && location.target?.column === target.column && location.target.value === target.value;
  });
}
