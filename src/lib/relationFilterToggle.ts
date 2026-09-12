import type { FilterOp } from "../types";

/** Clicking the active filter clears it; clicking the other sets it. Only
 * enabling WITH (has related rows) also selects the relation's peek — WITHOUT
 * has nothing to show, and clearing never opens a peek. */
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
  if (clicked === "hasrelated") selectRelation?.();
}
