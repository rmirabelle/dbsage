import { useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { useVirtualizer } from "@tanstack/react-virtual";
import {
  ArrowUp,
  ArrowDown,
  Columns,
  Funnel,
  RowsPlusBottom,
  PencilSimple,
  Table,
  Rows,
  ShareNetwork,
  Key,
  Trash,
  Copy,
} from "@phosphor-icons/react";
import clsx from "clsx";
import type {
  ColumnFilter,
  ColumnInfo,
  RowRecord,
  SortDirection,
  SortSpec,
} from "../types";
import { ColumnHeaderMenu } from "./ColumnHeaderMenu";
import { Tooltip } from "./Tooltip";
import { ColumnsVisibilityMenu } from "./ColumnsVisibilityMenu";
import { RowDeleteConfirmDialog } from "./RowDeleteConfirmDialog";
import { extractJsonDisplay, extractJsonShowParts } from "../lib/jsonPath";
import { useAnchoredPosition } from "../lib/useAnchoredPosition";
import { buildCopyText, COPY_AS_OPTIONS, type CopyAsFormat } from "../lib/copyAs";
import { notifyError, notifySuccess } from "../state/notify";
import { helpHandlers } from "../state/help";

interface Props {
  columns: ColumnInfo[];
  rows: RowRecord[];
  offset: number;
  sort: SortSpec | null;
  filters: ColumnFilter[];
  hiddenColumns: string[];
  jsonDisplay: Record<string, string>;
  activeCell: { rowIndex: number; column: string } | null;
  onActiveCellChange: (cell: { rowIndex: number; column: string } | null) => void;
  onSortChange: (sort: SortSpec | null) => void;
  onFilterChange: (column: string, filter: ColumnFilter | null) => void;
  onHiddenColumnsChange: (hidden: string[]) => void;
  onJsonShow: (column: string, path: string | null) => void;
  onCellEdit: (rowIndex: number, column: string, value: string | null) => Promise<void>;
  /** When true, selecting a row clears the active (highlighted) cell. */
  clearActiveCellOnRowSelect?: boolean;
  /** When true, cells are never editable (no double-click edit), regardless of PK. */
  readOnly?: boolean;
  /** Reports the currently selected row indices (ascending) on every change. */
  onSelectionChange?: (indices: number[]) => void;
  /** Row indices to select on mount — restores a persisted selection when the
   * grid is (re)mounted, e.g. carried into a torn-off window. Read once. */
  initialSelectedRows?: number[];
  /** Persisted manual column widths (px), keyed by column name. */
  columnWidths?: Record<string, number>;
  /** Reports the full name→width map after a resize completes, for persistence. */
  onColumnWidthsChange?: (widths: Record<string, number>) => void;
  /** When set, right-clicking a row's number gutter opens a "Copy As" menu that
   * copies the selected rows (or just the clicked row) targeting this table. */
  copyTarget?: { database: string; table: string };
  /** When set, the row-gutter context menu shows a Delete item that calls this
   * with the right-clicked row's selection. The grid handles the confirmation. */
  onDeleteRows?: (indices: number[]) => Promise<void>;
  /** When set, the row-gutter context menu shows a Duplicate item. The host
   * performs the copy and owns all result messaging (success/conflict/error). */
  onDuplicateRows?: (indices: number[]) => Promise<void>;
  /** Column names that participate in a relation — marked with the relation icon
   * in their header to signal a peek can be launched from them. */
  peekableColumns?: Set<string>;
  /** Suppress the native hover tooltip showing a cell's full value (used in peek
   * windows, where the value tooltip is noise). */
  hideValueTooltip?: boolean;
  /** Reports a single-click on a cell (after it becomes active) with the cell's
   * on-screen rect, so the host can anchor a menu to it — e.g. the relation
   * dropdown on peekable cells. Called with null on double-click (edit begins),
   * so an open menu can be dismissed. */
  onCellMenu?: (
    cell: { rowIndex: number; column: string; rect: DOMRect } | null
  ) => void;
}

const ROW_HEIGHT = 26;
const MIN_COL_WIDTH = 80;
const MAX_INITIAL_COL_WIDTH = 360;
const ROW_GUTTER_W = 56; // pinned row-number gutter

const COPY_AS_ICONS: Record<CopyAsFormat, typeof Table> = {
  insert: RowsPlusBottom,
  update: PencilSimple,
  psv: Table,
  "psv-header": Rows,
};

interface MenuAnchor {
  column: string;
  x: number;
  y: number;
}

export function DataGrid({
  columns,
  rows,
  offset,
  sort,
  filters,
  hiddenColumns,
  jsonDisplay,
  activeCell,
  onActiveCellChange,
  onSortChange,
  onFilterChange,
  onHiddenColumnsChange,
  onJsonShow,
  onCellEdit,
  clearActiveCellOnRowSelect = false,
  readOnly = false,
  onSelectionChange,
  initialSelectedRows,
  columnWidths,
  onColumnWidthsChange,
  copyTarget,
  onDeleteRows,
  onDuplicateRows,
  peekableColumns,
  hideValueTooltip = false,
  onCellMenu,
}: Props) {
  const scrollRef = useRef<HTMLDivElement>(null);
  const [widths, setWidths] = useState<number[]>([]);
  const [menu, setMenu] = useState<MenuAnchor | null>(null);
  const [rowMenu, setRowMenu] = useState<{
    x: number;
    y: number;
    indices: number[];
  } | null>(null);
  const [columnsMenu, setColumnsMenu] = useState<{ x: number; y: number } | null>(
    null
  );
  const [selectedRows, setSelectedRows] = useState<Set<number>>(
    () => new Set(initialSelectedRows ?? [])
  );
  const [anchor, setAnchor] = useState<number | null>(null);
  /** Row indices pending a delete confirmation (null = dialog closed). */
  const [deleteConfirm, setDeleteConfirm] = useState<number[] | null>(null);
  const draggingRef = useRef(false);
  const [editing, setEditing] = useState<{ rowIndex: number; column: string } | null>(
    null
  );
  const [saving, setSaving] = useState(false);

  const hasPrimaryKey = useMemo(
    () => columns.some((c) => c.key === "PRI"),
    [columns]
  );
  const editable = hasPrimaryKey && !readOnly;

  const visibleColumns = useMemo(() => {
    if (hiddenColumns.length === 0) return columns;
    const hidden = new Set(hiddenColumns);
    return columns.filter((c) => !hidden.has(c.name));
  }, [columns, hiddenColumns]);

  /* Stable identity for the visible column set (names + order). */
  const columnKey = useMemo(
    () => visibleColumns.map((c) => c.name).join(" "),
    [visibleColumns]
  );

  /* Re-derive widths only when the column set changes — NOT on every page
     change — so manual column resizes survive pagination. Persisted overrides
     (keyed by column name) win over the content-derived defaults. */
  useEffect(() => {
    const defaults = initialWidths(visibleColumns, rows);
    setWidths(
      visibleColumns.map((c, i) => columnWidths?.[c.name] ?? defaults[i])
    );
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [columnKey]);

  /* Latest widths, read on resize-end to persist without stale closures. */
  const widthsRef = useRef(widths);
  widthsRef.current = widths;

  /* On resize completion, report every visible column's width (merged over any
     persisted widths for currently-hidden columns) so the setup survives. */
  const handleResizeEnd = () => {
    if (!onColumnWidthsChange) return;
    const next = { ...(columnWidths ?? {}) };
    visibleColumns.forEach((c, i) => {
      const w = widthsRef.current[i];
      if (w != null) next[c.name] = Math.round(w);
    });
    onColumnWidthsChange(next);
  };

  /* Clear transient selection/edit state when the columns or page change — but
     NOT on the initial mount, so a persisted selection seeded from the tab
     (e.g. carried into a torn-off window) survives. A ref holds the identity
     seen last render; it starts at the mount values so the first run is a
     no-op. */
  /* Clear transient selection/edit state only when the VIEW actually changes —
     columns, page (offset), sort, or filters. Keying on these props (not the
     `rows` array reference) means re-applying the same page's data — a torn-off
     window seeding from its tab, a same-view reload, StrictMode's double-invoke
     — does NOT wipe a persisted selection, while a real page/sort/filter change
     still does. */
  const viewKey = `${columnKey}|${offset}|${JSON.stringify(sort)}|${JSON.stringify(
    filters
  )}`;
  const clearGuardRef = useRef(viewKey);
  useEffect(() => {
    if (clearGuardRef.current === viewKey) return;
    clearGuardRef.current = viewKey;
    setSelectedRows(new Set());
    setAnchor(null);
    setEditing(null);
  }, [viewKey]);

  useEffect(() => {
    const onUp = () => {
      draggingRef.current = false;
    };
    window.addEventListener("mouseup", onUp);
    return () => window.removeEventListener("mouseup", onUp);
  }, []);

  /* Report selection to the parent. Held in a ref so an inline callback prop
     doesn't retrigger the effect on every render. */
  const onSelectionChangeRef = useRef(onSelectionChange);
  onSelectionChangeRef.current = onSelectionChange;
  useEffect(() => {
    onSelectionChangeRef.current?.([...selectedRows].sort((a, b) => a - b));
  }, [selectedRows]);

  const extendSelection = (from: number, to: number, additive = false) => {
    const [lo, hi] = from < to ? [from, to] : [to, from];
    setSelectedRows((prev) => {
      const next = additive ? new Set(prev) : new Set<number>();
      for (let i = lo; i <= hi; i++) next.add(i);
      return next;
    });
  };

  const handleRowMouseDown = (index: number, e: React.MouseEvent) => {
    if (e.button !== 0) return;
    if (clearActiveCellOnRowSelect && activeCell) onActiveCellChange(null);
    if (e.shiftKey) {
      const from = anchor ?? index;
      extendSelection(from, index, e.ctrlKey || e.metaKey);
      setAnchor(from);
      return;
    }
    if (e.ctrlKey || e.metaKey) {
      setSelectedRows((prev) => {
        const next = new Set(prev);
        if (next.has(index)) next.delete(index);
        else next.add(index);
        return next;
      });
      setAnchor(index);
      return;
    }
    /* A plain click on the row-number gutter toggles that row's selection, so
       clicking an already-selected row's number de-selects it. */
    const inGutter = !!(e.target as HTMLElement).closest('[data-el="row-gutter"]');
    if (inGutter && selectedRows.has(index)) {
      setSelectedRows((prev) => {
        const next = new Set(prev);
        next.delete(index);
        return next;
      });
      setAnchor(null);
      return;
    }
    setSelectedRows(new Set([index]));
    setAnchor(index);
    draggingRef.current = true;
  };

  const handleRowMouseEnter = (index: number) => {
    if (!draggingRef.current || anchor === null) return;
    extendSelection(anchor, index);
  };

  /* Right-click a row's number gutter → row context menu (Delete + Copy As).
     Operate on the whole selection when the clicked row is part of it;
     otherwise select just that row and operate on it. */
  const handleRowContextMenu = (index: number, e: React.MouseEvent) => {
    if (!copyTarget && !onDeleteRows && !onDuplicateRows) return;
    e.preventDefault();
    e.stopPropagation();
    let indices: number[];
    if (selectedRows.has(index)) {
      indices = [...selectedRows].sort((a, b) => a - b);
    } else {
      indices = [index];
      setSelectedRows(new Set([index]));
      setAnchor(index);
    }
    setRowMenu({ x: e.clientX, y: e.clientY, indices });
  };

  /* Open the in-app confirmation; the actual delete runs from confirmDelete. */
  const deleteRows = (indices: number[]) => {
    setRowMenu(null);
    if (!onDeleteRows || indices.length === 0) return;
    setDeleteConfirm(indices);
  };

  const confirmDelete = async () => {
    const indices = deleteConfirm;
    if (!onDeleteRows || !indices || indices.length === 0) return;
    await onDeleteRows(indices);
    setSelectedRows(new Set());
    setAnchor(null);
    notifySuccess(`Deleted ${indices.length} row${indices.length === 1 ? "" : "s"}`);
  };

  const duplicateRows = async (indices: number[]) => {
    setRowMenu(null);
    if (!onDuplicateRows || indices.length === 0) return;
    try {
      await onDuplicateRows(indices);
    } catch (e) {
      notifyError(`Duplicate failed: ${String(e)}`);
    }
  };

  const copyRowsAs = async (
    format: CopyAsFormat,
    label: string,
    indices: number[]
  ) => {
    setRowMenu(null);
    if (!copyTarget) return;
    const picked = indices
      .map((i) => rows[i])
      .filter((r): r is RowRecord => r != null);
    if (picked.length === 0) return;
    try {
      const text = buildCopyText(
        format,
        copyTarget.database,
        copyTarget.table,
        visibleColumns,
        picked
      );
      await navigator.clipboard.writeText(text);
      notifySuccess(
        `Copied ${picked.length} row${picked.length === 1 ? "" : "s"} as ${label}`
      );
    } catch {
      notifyError("Could not copy to the clipboard");
    }
  };

  const beginEdit = (rowIndex: number, col: ColumnInfo) => {
    if (!editable) return;
    if (col.key === "PRI") {
      const ok = confirm(
        `"${col.name}" is a primary-key column. Editing it can break foreign-key references and shifts the row's identity.\n\nContinue?`
      );
      if (!ok) return;
    }
    setEditing({ rowIndex, column: col.name });
  };

  const commitEdit = async (newValue: string | null) => {
    if (!editing) return;
    const { rowIndex, column } = editing;
    setSaving(true);
    try {
      await onCellEdit(rowIndex, column, newValue);
      setEditing(null);
    } catch (e) {
      alert(`Update failed: ${String(e)}`);
    } finally {
      setSaving(false);
    }
  };

  const filterByColumn = useMemo(() => {
    const m = new Map<string, ColumnFilter>();
    for (const f of filters) m.set(f.column, f);
    return m;
  }, [filters]);

  const totalWidth = useMemo(
    () => ROW_GUTTER_W + widths.reduce((a, b) => a + b, 0),
    [widths]
  );

  const rowVirtualizer = useVirtualizer({
    count: rows.length,
    getScrollElement: () => scrollRef.current,
    estimateSize: () => ROW_HEIGHT,
    overscan: 12,
  });

  /* Scroll a column into view, accounting for the pinned 56px row-number
     gutter that would otherwise cover the left columns. */
  const scrollColumnIntoView = (colIndex: number) => {
    const el = scrollRef.current;
    if (!el) return;
    const left = 56 + widths.slice(0, colIndex).reduce((a, b) => a + b, 0);
    const right = left + (widths[colIndex] ?? MIN_COL_WIDTH);
    if (left - 56 < el.scrollLeft) el.scrollLeft = left - 56;
    else if (right > el.scrollLeft + el.clientWidth)
      el.scrollLeft = right - el.clientWidth;
  };

  /* On mount, scroll a pre-existing active cell into view — restores the user's
     place when a persisted selection is returned to (e.g. switching tabs). */
  const didInitialScroll = useRef(false);
  useEffect(() => {
    if (didInitialScroll.current || !activeCell) return;
    didInitialScroll.current = true;
    const ci = visibleColumns.findIndex((c) => c.name === activeCell.column);
    requestAnimationFrame(() => {
      rowVirtualizer.scrollToIndex(activeCell.rowIndex, { align: "center" });
      if (ci >= 0) scrollColumnIntoView(ci);
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  /* Arrow keys move the active cell by one (instead of scrolling the grid).
     Works for both the rows view and query-results grid. */
  const handleGridKeyDown = (e: React.KeyboardEvent) => {
    if (editing) return;
    /* Keystrokes from an editable element (e.g. the column filter menu's text
       input, which renders through a portal) bubble up the React tree to this
       handler. Let arrow keys move the text caret there instead of the cell. */
    if (
      e.target instanceof HTMLElement &&
      e.target.closest("input, textarea, select, [contenteditable='true']")
    )
      return;
    if (
      e.key !== "ArrowUp" &&
      e.key !== "ArrowDown" &&
      e.key !== "ArrowLeft" &&
      e.key !== "ArrowRight"
    )
      return;
    if (rows.length === 0 || visibleColumns.length === 0) return;
    e.preventDefault();

    if (!activeCell) {
      onActiveCellChange({ rowIndex: 0, column: visibleColumns[0].name });
      setSelectedRows(new Set([0]));
      setAnchor(0);
      rowVirtualizer.scrollToIndex(0);
      return;
    }

    let rowIndex = activeCell.rowIndex;
    let colIndex = Math.max(
      0,
      visibleColumns.findIndex((c) => c.name === activeCell.column)
    );
    if (e.key === "ArrowDown") rowIndex = Math.min(rowIndex + 1, rows.length - 1);
    else if (e.key === "ArrowUp") rowIndex = Math.max(rowIndex - 1, 0);
    else if (e.key === "ArrowRight")
      colIndex = Math.min(colIndex + 1, visibleColumns.length - 1);
    else if (e.key === "ArrowLeft") colIndex = Math.max(colIndex - 1, 0);

    onActiveCellChange({ rowIndex, column: visibleColumns[colIndex].name });
    /* Row selection follows the active cell, matching click behavior. */
    setSelectedRows(new Set([rowIndex]));
    setAnchor(rowIndex);
    rowVirtualizer.scrollToIndex(rowIndex);
    scrollColumnIntoView(colIndex);
  };

  return (
    <div
      ref={scrollRef}
      data-el="data-grid"
      tabIndex={0}
      onKeyDown={handleGridKeyDown}
      className="flex-1 overflow-auto bg-zinc-950 select-none focus:outline-none"
      style={{ contain: "strict" }}
    >
      <div style={{ width: totalWidth, minWidth: "100%" }}>
        <HeaderRow
          columns={visibleColumns}
          widths={widths}
          onResizeColumn={(i, delta) =>
            setWidths((prev) => {
              const next = prev.slice();
              next[i] = Math.max(
                MIN_COL_WIDTH,
                (next[i] ?? MIN_COL_WIDTH) + delta
              );
              return next;
            })
          }
          onResizeEnd={handleResizeEnd}
          sort={sort}
          filterByColumn={filterByColumn}
          jsonDisplay={jsonDisplay}
          peekableColumns={peekableColumns}
          hasHiddenColumns={hiddenColumns.length > 0}
          onColumnClick={(column, rect) =>
            setMenu((prev) =>
              prev?.column === column
                ? null
                : { column, x: rect.left, y: rect.bottom }
            )
          }
          onColumnsButtonClick={(rect) =>
            setColumnsMenu({ x: rect.left, y: rect.bottom })
          }
        />
        {rows.length === 0 ? (
          <div
            data-el="grid-empty"
            className="sticky left-0 flex items-center justify-center text-zinc-600 text-xs italic"
            style={{ height: 160 }}
          >
            No rows
          </div>
        ) : (
          <div
            style={{
              height: rowVirtualizer.getTotalSize(),
              position: "relative",
            }}
          >
            {rowVirtualizer.getVirtualItems().map((vItem) => {
              const row = rows[vItem.index];
              const isSelected = selectedRows.has(vItem.index);
              const stripe = vItem.index % 2 === 0 ? "bg-zinc-950" : "bg-zinc-900/30";
              /* The pinned row-number gutter must be OPAQUE, or columns scrolled
                 underneath it show through. The odd-row stripe (bg-zinc-900/30)
                 is translucent, so the gutter uses its pre-blended opaque
                 equivalent over the zinc-950 grid bg (#242732). */
              const gutterStripe =
                vItem.index % 2 === 0 ? "bg-zinc-950" : "bg-[#242732]";
              return (
                <div
                  key={vItem.key}
                  data-el="grid-row"
                  onMouseDown={(e) => handleRowMouseDown(vItem.index, e)}
                  onMouseEnter={() => handleRowMouseEnter(vItem.index)}
                  className={clsx(
                    "absolute left-0 right-0 flex items-stretch border-b border-zinc-900 cursor-default",
                    isSelected ? "bg-emerald-900/60" : stripe,
                    !isSelected && "hover:bg-accent-500/5"
                  )}
                  style={{
                    height: ROW_HEIGHT,
                    transform: `translateY(${vItem.start}px)`,
                  }}
                >
                  <div
                    data-el="row-gutter"
                    onContextMenu={(e) => handleRowContextMenu(vItem.index, e)}
                    className={clsx(
                      "sticky left-0 z-10 w-14 shrink-0 flex items-center justify-end pr-3 text-[10px] font-mono border-r border-zinc-900",
                      (copyTarget || onDeleteRows) && "cursor-context-menu",
                      isSelected
                        ? "bg-[#113e36] text-emerald-200 font-semibold"
                        : `${gutterStripe} text-zinc-600`
                    )}
                  >
                    {offset + vItem.index + 1}
                  </div>
                  {visibleColumns.map((col, ci) => {
                    const isEditingThis =
                      editing?.rowIndex === vItem.index &&
                      editing.column === col.name;
                    const isActiveCell =
                      activeCell?.rowIndex === vItem.index &&
                      activeCell.column === col.name;
                    return (
                      <Cell
                        key={col.name}
                        column={col}
                        value={row[col.name]}
                        jsonPath={jsonDisplay[col.name]}
                        width={widths[ci] ?? MIN_COL_WIDTH}
                        editable={editable}
                        isEditing={isEditingThis}
                        saving={isEditingThis && saving}
                        isActive={isActiveCell}
                        isPeekable={peekableColumns?.has(col.name) ?? false}
                        hideValueTooltip={hideValueTooltip}
                        onActivate={() =>
                          onActiveCellChange({
                            rowIndex: vItem.index,
                            column: col.name,
                          })
                        }
                        onMenu={(rect) =>
                          onCellMenu?.(
                            rect
                              ? { rowIndex: vItem.index, column: col.name, rect }
                              : null
                          )
                        }
                        onBeginEdit={() => beginEdit(vItem.index, col)}
                        onCommit={commitEdit}
                        onCancel={() => setEditing(null)}
                      />
                    );
                  })}
                </div>
              );
            })}
          </div>
        )}
      </div>

      {menu && (
        <ColumnHeaderMenu
          column={menu.column}
          columnType={
            columns.find((c) => c.name === menu.column)?.dataType ?? ""
          }
          anchor={{ x: menu.x, y: menu.y }}
          currentSort={sort}
          currentFilter={filterByColumn.get(menu.column) ?? null}
          currentJsonShow={jsonDisplay[menu.column] ?? null}
          onClose={() => setMenu(null)}
          onSort={(direction: SortDirection | null) =>
            onSortChange(direction ? { column: menu.column, direction } : null)
          }
          onFilter={(filter) => onFilterChange(menu.column, filter)}
          onJsonShow={(path) => onJsonShow(menu.column, path)}
        />
      )}

      {columnsMenu && (
        <ColumnsVisibilityMenu
          anchor={columnsMenu}
          columns={columns}
          hidden={hiddenColumns}
          selectedRowCount={selectedRows.size}
          totalRowCount={rows.length}
          onChange={onHiddenColumnsChange}
          onSelectAllRows={() =>
            setSelectedRows(new Set(rows.map((_, i) => i)))
          }
          onSelectNoRows={() => setSelectedRows(new Set())}
          onClose={() => setColumnsMenu(null)}
        />
      )}

      {rowMenu && (
        <RowContextMenu
          x={rowMenu.x}
          y={rowMenu.y}
          count={rowMenu.indices.length}
          canCopy={!!copyTarget}
          canDelete={!!onDeleteRows}
          canDuplicate={!!onDuplicateRows}
          onPick={(format, label) => copyRowsAs(format, label, rowMenu.indices)}
          onDelete={() => deleteRows(rowMenu.indices)}
          onDuplicate={() => duplicateRows(rowMenu.indices)}
          onClose={() => setRowMenu(null)}
        />
      )}

      {deleteConfirm && (
        <RowDeleteConfirmDialog
          count={deleteConfirm.length}
          onConfirm={confirmDelete}
          onClose={() => setDeleteConfirm(null)}
        />
      )}
    </div>
  );
}

function RowContextMenu({
  x,
  y,
  count,
  canCopy,
  canDelete,
  canDuplicate,
  onPick,
  onDelete,
  onDuplicate,
  onClose,
}: {
  x: number;
  y: number;
  count: number;
  canCopy: boolean;
  canDelete: boolean;
  canDuplicate: boolean;
  onPick: (format: CopyAsFormat, label: string) => void;
  onDelete: () => void;
  onDuplicate: () => void;
  onClose: () => void;
}) {
  useEffect(() => {
    const onDown = () => onClose();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("mousedown", onDown);
    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("mousedown", onDown);
      window.removeEventListener("keydown", onKey);
    };
  }, [onClose]);

  const { ref: menuRef, style: menuStyle } = useAnchoredPosition(x, y);
  return createPortal(
    <div
      ref={menuRef}
      data-el="row-context-menu"
      style={menuStyle}
      onMouseDown={(e) => e.stopPropagation()}
      className="dbs-context-menu fixed z-50 w-max rounded border border-zinc-700 bg-zinc-900/95 backdrop-blur-sm py-1 shadow-xl shadow-black/60 text-zinc-200"
    >
      {canDuplicate && (
        <>
          <button
            onClick={onDuplicate}
            className="flex w-full items-center gap-2.5 px-3 py-1.5 text-left text-emerald-200 hover:bg-emerald-950/50 whitespace-nowrap"
          >
            <Copy size={14} className="text-emerald-400 shrink-0" />
            Duplicate {count} row{count === 1 ? "" : "s"}
          </button>
          {(canDelete || canCopy) && (
            <div className="my-1 border-t border-zinc-800" />
          )}
        </>
      )}
      {canDelete && (
        <>
          <button
            onClick={onDelete}
            className="flex w-full items-center gap-2.5 px-3 py-1.5 text-left text-rose-300 hover:bg-rose-950/60 whitespace-nowrap"
          >
            <Trash size={14} className="text-rose-400 shrink-0" />
            Delete {count} row{count === 1 ? "" : "s"}
          </button>
          {canCopy && <div className="my-1 border-t border-zinc-800" />}
        </>
      )}
      {canCopy && (
        <>
          <div className="px-3 py-1 text-[10px] uppercase tracking-wide text-zinc-500">
            Copy {count} row{count === 1 ? "" : "s"} as
          </div>
          {COPY_AS_OPTIONS.map((opt) => {
            const Icon = COPY_AS_ICONS[opt.format];
            return (
              <button
                key={opt.format}
                onClick={() => onPick(opt.format, opt.label)}
                className="flex w-full items-center gap-2.5 px-3 py-1.5 text-left hover:bg-zinc-800 whitespace-nowrap"
              >
                <Icon size={14} className="text-zinc-400 shrink-0" />
                {opt.label}
              </button>
            );
          })}
        </>
      )}
    </div>,
    document.body
  );
}

function HeaderRow({
  columns,
  widths,
  onResizeColumn,
  onResizeEnd,
  sort,
  filterByColumn,
  jsonDisplay,
  peekableColumns,
  hasHiddenColumns,
  onColumnClick,
  onColumnsButtonClick,
}: {
  columns: ColumnInfo[];
  widths: number[];
  onResizeColumn: (index: number, delta: number) => void;
  onResizeEnd: () => void;
  sort: SortSpec | null;
  filterByColumn: Map<string, ColumnFilter>;
  jsonDisplay: Record<string, string>;
  peekableColumns?: Set<string>;
  hasHiddenColumns: boolean;
  onColumnClick: (column: string, rect: DOMRect) => void;
  onColumnsButtonClick: (rect: DOMRect) => void;
}) {
  return (
    <div data-el="grid-header" className="sticky top-0 z-20 flex items-stretch bg-zinc-900 border-b border-zinc-800 select-none">
      <div className="sticky left-0 z-30 w-14 shrink-0 border-r border-zinc-800 bg-zinc-900 flex items-center justify-center">
        <button
          data-el="columns-toggle-btn"
          onClick={(e) => {
            /* Anchor to the gutter cell, not the centered button, so the menu's
               left edge aligns with the cell's left edge — matching how the
               column filter menus anchor to their header cell. */
            const cell = (e.currentTarget as HTMLElement).parentElement;
            const rect = (cell ?? e.currentTarget).getBoundingClientRect();
            onColumnsButtonClick(rect);
          }}
          title={
            hasHiddenColumns
              ? "Some columns are hidden — click to manage"
              : "Show/hide columns"
          }
          className={clsx(
            "p-1 rounded transition-colors",
            hasHiddenColumns
              ? "text-amber-400 hover:bg-amber-400/10"
              : "text-zinc-500 hover:text-zinc-200 hover:bg-zinc-800"
          )}
        >
          <Columns size={15} />
        </button>
      </div>
      {columns.map((col, i) => {
        const isSorted = sort?.column === col.name;
        const isFiltered =
          filterByColumn.has(col.name) || !!jsonDisplay[col.name];
        const isPeekable = peekableColumns?.has(col.name) ?? false;
        const comment = col.comment?.trim();
        const cell = (
          <div
            key={col.name}
            data-column-header={col.name}
            style={{ width: widths[i] ?? MIN_COL_WIDTH }}
            className={clsx(
              "relative shrink-0 px-3 py-1.5 border-r border-zinc-800 flex flex-col justify-center cursor-pointer hover:bg-zinc-800/60",
              (isSorted || isFiltered) && "bg-zinc-800/40"
            )}
            onClick={(e) => {
              if ((e.target as HTMLElement).closest("[data-resize-handle]"))
                return;
              const rect = (e.currentTarget as HTMLElement).getBoundingClientRect();
              onColumnClick(col.name, rect);
            }}
          >
            <div
              className={clsx(
                "flex items-center gap-1.5 text-[12px] font-medium truncate",
                isFiltered ? "text-amber-400" : "text-zinc-200"
              )}
            >
              {col.key === "PRI" && (
                <Key size={12} weight="fill" className="text-emerald-400 shrink-0" />
              )}
              <span className="truncate flex-1">{col.name}</span>
              {isPeekable && (
                <ShareNetwork size={12} className="text-violet-400 shrink-0" />
              )}
              {isFiltered && (
                <Funnel size={12} className="text-amber-400 shrink-0" />
              )}
              {isSorted && (
                <span className="text-accent-400 shrink-0">
                  {sort?.direction === "asc" ? (
                    <ArrowUp size={13} />
                  ) : (
                    <ArrowDown size={13} />
                  )}
                </span>
              )}
            </div>
            <div className="text-[10px] text-zinc-500 truncate font-mono">
              {col.dataType}
            </div>
            <ResizeHandle
              onDelta={(delta) => onResizeColumn(i, delta)}
              onEnd={onResizeEnd}
            />
          </div>
        );
        if (!comment) return cell;
        return (
          <Tooltip
            key={col.name}
            className="flex shrink-0"
            label={
              <div>
                <div className="text-[11px] font-mono text-accent-400 mb-1">
                  {col.name}
                </div>
                <div className="whitespace-pre-wrap">{comment}</div>
              </div>
            }
          >
            {cell}
          </Tooltip>
        );
      })}
    </div>
  );
}

function ResizeHandle({
  onDelta,
  onEnd,
}: {
  onDelta: (delta: number) => void;
  onEnd: () => void;
}) {
  return (
    <div
      data-resize-handle
      onPointerDown={(e) => {
        e.preventDefault();
        e.stopPropagation();
        let lastX = e.clientX;
        const prevUserSelect = document.body.style.userSelect;
        const prevCursor = document.body.style.cursor;
        document.body.style.userSelect = "none";
        document.body.style.cursor = "col-resize";

        const onMove = (ev: PointerEvent) => {
          const delta = ev.clientX - lastX;
          if (delta === 0) return;
          lastX = ev.clientX;
          onDelta(delta);
        };
        const cleanup = () => {
          document.body.style.userSelect = prevUserSelect;
          document.body.style.cursor = prevCursor;
          document.removeEventListener("pointermove", onMove);
          document.removeEventListener("pointerup", cleanup);
          document.removeEventListener("pointercancel", cleanup);
          onEnd();
        };

        document.addEventListener("pointermove", onMove);
        document.addEventListener("pointerup", cleanup);
        document.addEventListener("pointercancel", cleanup);
      }}
      onMouseDown={(e) => e.stopPropagation()}
      onClick={(e) => e.stopPropagation()}
      className="absolute top-0 right-0 h-full w-2 -mr-px cursor-col-resize hover:bg-accent-500/40 z-20 touch-none"
    />
  );
}

function Cell({
  column,
  value,
  jsonPath,
  width,
  editable,
  isEditing,
  saving,
  isActive,
  isPeekable,
  hideValueTooltip,
  onActivate,
  onMenu,
  onBeginEdit,
  onCommit,
  onCancel,
}: {
  column: ColumnInfo;
  value: unknown;
  jsonPath?: string;
  width: number;
  editable: boolean;
  isEditing: boolean;
  saving: boolean;
  isActive: boolean;
  isPeekable: boolean;
  hideValueTooltip: boolean;
  onActivate: () => void;
  /** Single-click reports the cell rect (anchor a menu); double-click reports
   * null (dismiss it — editing starts). */
  onMenu?: (rect: DOMRect | null) => void;
  onBeginEdit: () => void;
  onCommit: (next: string | null) => void;
  onCancel: () => void;
}) {
  if (isEditing) {
    return (
      <CellEditor
        width={width}
        column={column}
        initialValue={value}
        saving={saving}
        onCommit={onCommit}
        onCancel={onCancel}
      />
    );
  }

  /* When a JSON column has an active "Show" path, display the extracted
     property (truncated) in place of the raw JSON. Editing still uses the raw
     value (CellEditor above, before this transform). A multi-path "Show" is
     rendered as labeled parts so each path label can be styled like a subtitle. */
  const showParts = jsonPath ? extractJsonShowParts(value, jsonPath) : null;
  const { display, tone } = renderCell(
    jsonPath ? extractJsonDisplay(value, jsonPath) : value
  );
  /* Colorize peekable (relation) values in the relation violet, so cells you can
   * peek from stand out. NULL stays muted — there's nothing to match on. */
  const peekTone =
    isPeekable && value !== null && value !== undefined
      ? "text-violet-400 font-bold"
      : null;
  /* What the cell publishes to the help strip on hover: an edit hint when
     editable, otherwise its full value so truncated content stays readable.
     Suppressed (undefined) when the value tooltip is hidden (e.g. peeks). */
  const cellHelp = editable
    ? `Double-click to edit${column.key === "PRI" ? " (primary key)" : ""}`
    : hideValueTooltip
    ? undefined
    : showParts
    ? display
    : typeof value === "string"
    ? value
    : display;
  return (
    <div
      style={{ width }}
      data-el="grid-cell"
      data-active-cell={isActive ? "true" : undefined}
      onClick={(e) => {
        e.stopPropagation();
        onActivate();
        onMenu?.(e.currentTarget.getBoundingClientRect());
      }}
      onDoubleClick={(e) => {
        if (!editable) return;
        e.stopPropagation();
        onMenu?.(null);
        onBeginEdit();
      }}
      className={clsx(
        "shrink-0 px-3 py-1 border-r border-zinc-900 flex items-center font-mono text-[11.5px] whitespace-nowrap overflow-hidden text-ellipsis",
        editable && "cursor-text",
        isActive && "ring-1 ring-inset ring-accent-400 bg-accent-500/10"
      )}
      {...(cellHelp ? helpHandlers(cellHelp) : {})}
    >
      {showParts ? (
        <span className="truncate text-zinc-200">
          {showParts.map((part, i) => (
            <span key={part.label}>
              {i > 0 && <span className="text-zinc-600">, </span>}
              <span className="text-[10px] text-zinc-500">{part.label}: </span>
              {part.value}
            </span>
          ))}
        </span>
      ) : (
        <span className={clsx("truncate", peekTone ?? tone)}>
          {column.key === "PRI" ? (
            <strong className={peekTone ?? "text-zinc-100"}>{display}</strong>
          ) : (
            display
          )}
        </span>
      )}
    </div>
  );
}

function CellEditor({
  width,
  column,
  initialValue,
  saving,
  onCommit,
  onCancel,
}: {
  width: number;
  column: ColumnInfo;
  initialValue: unknown;
  saving: boolean;
  onCommit: (next: string | null) => void;
  onCancel: () => void;
}) {
  const initialString =
    initialValue === null || initialValue === undefined
      ? ""
      : typeof initialValue === "string"
      ? initialValue
      : typeof initialValue === "number" || typeof initialValue === "boolean"
      ? String(initialValue)
      : JSON.stringify(initialValue);

  const [value, setValue] = useState(initialString);
  const startedNull = initialValue === null || initialValue === undefined;
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    inputRef.current?.focus();
    inputRef.current?.select();
  }, []);

  const submit = (e: React.KeyboardEvent<HTMLInputElement>) => {
    /**
     * Empty input commits NULL when the column is nullable.
     * Ctrl+Enter forces an empty string instead (useful for nullable VARCHARs
     * where the user really does want an empty value).
     */
    const trimmed = value;
    if (trimmed === "" && !e.ctrlKey && !e.metaKey && column.nullable) {
      onCommit(null);
    } else {
      onCommit(trimmed);
    }
  };

  return (
    <div
      style={{ width }}
      className="shrink-0 px-1 border-r border-zinc-900 flex items-center bg-zinc-900"
      onClick={(e) => e.stopPropagation()}
      onMouseDown={(e) => e.stopPropagation()}
      onDoubleClick={(e) => e.stopPropagation()}
    >
      <input
        ref={inputRef}
        data-el="cell-editor-input"
        value={value}
        disabled={saving}
        onChange={(e) => setValue(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter") {
            e.preventDefault();
            submit(e);
          } else if (e.key === "Escape") {
            e.preventDefault();
            onCancel();
          }
        }}
        onBlur={onCancel}
        placeholder={column.nullable ? "NULL" : ""}
        className={clsx(
          "w-full bg-zinc-950 border rounded px-1.5 py-0.5 text-[11.5px] font-mono text-zinc-100 outline-none focus:border-accent-500",
          startedNull && value === ""
            ? "border-zinc-700 italic text-zinc-500"
            : "border-accent-500/60"
        )}
        title={
          column.nullable
            ? "Enter = save · Esc = cancel · empty = NULL · Ctrl+Enter = empty string"
            : "Enter = save · Esc = cancel"
        }
      />
    </div>
  );
}

function renderCell(value: unknown): { display: string; tone: string } {
  if (value === null || value === undefined) {
    return { display: "NULL", tone: "text-zinc-600 italic" };
  }
  if (typeof value === "boolean") {
    return { display: value ? "true" : "false", tone: "text-amber-300" };
  }
  if (typeof value === "number") {
    return { display: String(value), tone: "text-accent-300" };
  }
  if (typeof value === "string") {
    return { display: value, tone: "text-zinc-200" };
  }
  return { display: JSON.stringify(value), tone: "text-zinc-300" };
}

/** The grid's natural content width (px): the row-number gutter plus every
 * visible column's width, with manual overrides winning over content-derived
 * defaults. Lets a container size itself to the grid instead of guessing. */
export function gridContentWidth(
  columns: ColumnInfo[],
  rows: RowRecord[],
  columnWidths: Record<string, number> | undefined,
  hiddenColumns: string[]
): number {
  const hidden = new Set(hiddenColumns);
  const visible = columns.filter((c) => !hidden.has(c.name));
  const defaults = initialWidths(visible, rows);
  const sum = visible.reduce(
    (acc, c, i) => acc + (columnWidths?.[c.name] ?? defaults[i]),
    0
  );
  return ROW_GUTTER_W + sum;
}

function initialWidths(columns: ColumnInfo[], rows: RowRecord[]): number[] {
  const sampleSize = Math.min(rows.length, 50);
  return columns.map((col) => {
    const headerLen = col.name.length;
    let maxLen = headerLen;
    for (let i = 0; i < sampleSize; i++) {
      const v = rows[i]?.[col.name];
      if (v == null) continue;
      const s = typeof v === "string" ? v : String(v);
      if (s.length > maxLen) maxLen = s.length;
    }
    const px = Math.min(MAX_INITIAL_COL_WIDTH, Math.max(MIN_COL_WIDTH, 8 * maxLen + 32));
    return px;
  });
}
