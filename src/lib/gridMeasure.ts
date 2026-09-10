/** Height a DataGrid needs to show its header, one row, and the horizontal
 * scrollbar. `rows` is the element wrapping the grid; falls back to typical
 * sizes when the grid isn't mounted yet. */
export function oneRowGridHeight(rows: HTMLElement | null): number {
  const grid = rows?.querySelector<HTMLElement>('[data-el="data-grid"]');
  const header = grid?.querySelector<HTMLElement>('[data-el="grid-header"]');
  const scrollbar = grid ? grid.offsetHeight - grid.clientHeight : 0;
  return (header?.offsetHeight ?? 44) + 26 + scrollbar + 2;
}
