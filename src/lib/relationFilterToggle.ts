import type { FilterOp } from "../types";

/** Clearing a relation filter must never open or activate its peek. */
export function toggleRelationFilter(
  current: FilterOp | null,
  clicked: FilterOp,
  setFilter: (op: FilterOp | null) => void,
  selectRelation?: () => void,
) {
  if (current === clicked) {
    setFilter(null);
    return;
  }
  setFilter(clicked);
  selectRelation?.();
}
