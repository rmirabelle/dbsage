import { useEffect, useMemo, useRef, useState } from "react";
import { useVirtualizer } from "@tanstack/react-virtual";
import { ArrowUp, ArrowDown, Columns, Funnel } from "@phosphor-icons/react";
import clsx from "clsx";
import type {
  ColumnFilter,
  ColumnInfo,
  RowRecord,
  SortDirection,
  SortSpec,
} from "../types";
import { ColumnHeaderMenu } from "./ColumnHeaderMenu";
import { ColumnsVisibilityMenu } from "./ColumnsVisibilityMenu";

interface Props {
  columns: ColumnInfo[];
  rows: RowRecord[];
  offset: number;
  sort: SortSpec | null;
  filters: ColumnFilter[];
  hiddenColumns: string[];
  activeCell: { rowIndex: number; column: string } | null;
  onActiveCellChange: (cell: { rowIndex: number; column: string } | null) => void;
  onSortChange: (sort: SortSpec | null) => void;
  onFilterChange: (column: string, filter: ColumnFilter | null) => void;
  onHiddenColumnsChange: (hidden: string[]) => void;
  onCellEdit: (rowIndex: number, column: string, value: string | null) => Promise<void>;
}

const ROW_HEIGHT = 26;
const MIN_COL_WIDTH = 80;
const MAX_INITIAL_COL_WIDTH = 360;

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
  activeCell,
  onActiveCellChange,
  onSortChange,
  onFilterChange,
  onHiddenColumnsChange,
  onCellEdit,
}: Props) {
  const scrollRef = useRef<HTMLDivElement>(null);
  const [widths, setWidths] = useState<number[]>([]);
  const [menu, setMenu] = useState<MenuAnchor | null>(null);
  const [columnsMenu, setColumnsMenu] = useState<{ x: number; y: number } | null>(
    null
  );
  const [selectedRows, setSelectedRows] = useState<Set<number>>(new Set());
  const [anchor, setAnchor] = useState<number | null>(null);
  const draggingRef = useRef(false);
  const [editing, setEditing] = useState<{ rowIndex: number; column: string } | null>(
    null
  );
  const [saving, setSaving] = useState(false);

  const hasPrimaryKey = useMemo(
    () => columns.some((c) => c.key === "PRI"),
    [columns]
  );

  const visibleColumns = useMemo(() => {
    if (hiddenColumns.length === 0) return columns;
    const hidden = new Set(hiddenColumns);
    return columns.filter((c) => !hidden.has(c.name));
  }, [columns, hiddenColumns]);

  useEffect(() => {
    setWidths(initialWidths(visibleColumns, rows));
    setSelectedRows(new Set());
    setAnchor(null);
    setEditing(null);
  }, [visibleColumns, rows]);

  useEffect(() => {
    const onUp = () => {
      draggingRef.current = false;
    };
    window.addEventListener("mouseup", onUp);
    return () => window.removeEventListener("mouseup", onUp);
  }, []);

  /**
   * Horizontal wheel scrolling. Registered non-passively so preventDefault
   * actually works (React's onWheel is passive). Shift+wheel scrolls
   * horizontally, and a vertical wheel over a wide table with no vertical
   * overflow is redirected horizontally so off-screen columns are reachable
   * without the scrollbar. A native horizontal wheel/trackpad (deltaX) is left
   * alone to scroll on its own.
   */
  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    const onWheel = (e: WheelEvent) => {
      if (e.deltaY === 0) return;
      if (el.scrollWidth <= el.clientWidth) return;
      const hasVerticalOverflow = el.scrollHeight > el.clientHeight;
      if (e.shiftKey || !hasVerticalOverflow) {
        el.scrollLeft += e.deltaY;
        e.preventDefault();
      }
    };
    el.addEventListener("wheel", onWheel, { passive: false });
    return () => el.removeEventListener("wheel", onWheel);
  }, []);

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
    setSelectedRows(new Set([index]));
    setAnchor(index);
    draggingRef.current = true;
  };

  const handleRowMouseEnter = (index: number) => {
    if (!draggingRef.current || anchor === null) return;
    extendSelection(anchor, index);
  };

  const beginEdit = (rowIndex: number, col: ColumnInfo) => {
    if (!hasPrimaryKey) return;
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
    () => 56 + widths.reduce((a, b) => a + b, 0),
    [widths]
  );

  const rowVirtualizer = useVirtualizer({
    count: rows.length,
    getScrollElement: () => scrollRef.current,
    estimateSize: () => ROW_HEIGHT,
    overscan: 12,
  });

  return (
    <div
      ref={scrollRef}
      data-el="data-grid"
      className="flex-1 overflow-auto bg-zinc-950 select-none"
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
          sort={sort}
          filterByColumn={filterByColumn}
          hasHiddenColumns={hiddenColumns.length > 0}
          onColumnClick={(column, rect) =>
            setMenu((prev) =>
              prev?.column === column
                ? null
                : { column, x: rect.left, y: rect.bottom }
            )
          }
          onColumnsButtonClick={(rect) =>
            setColumnsMenu({ x: rect.right + 4, y: rect.bottom })
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
              return (
                <div
                  key={vItem.key}
                  data-el="grid-row"
                  onMouseDown={(e) => handleRowMouseDown(vItem.index, e)}
                  onMouseEnter={() => handleRowMouseEnter(vItem.index)}
                  className={clsx(
                    "absolute left-0 right-0 flex items-stretch border-b border-zinc-900 cursor-default",
                    isSelected
                      ? "bg-accent-500/20 ring-1 ring-inset ring-accent-500/50"
                      : stripe,
                    !isSelected && "hover:bg-accent-500/5"
                  )}
                  style={{
                    height: ROW_HEIGHT,
                    transform: `translateY(${vItem.start}px)`,
                  }}
                >
                  <div
                    className={clsx(
                      "sticky left-0 z-10 w-14 shrink-0 flex items-center justify-end pr-3 text-[10px] font-mono border-r border-zinc-900",
                      isSelected
                        ? "bg-[#26303f] text-accent-300 font-semibold"
                        : `${stripe} text-zinc-600`
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
                        width={widths[ci] ?? MIN_COL_WIDTH}
                        editable={hasPrimaryKey}
                        isEditing={isEditingThis}
                        saving={isEditingThis && saving}
                        isActive={isActiveCell}
                        onActivate={() =>
                          onActiveCellChange({
                            rowIndex: vItem.index,
                            column: col.name,
                          })
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
          anchor={{ x: menu.x, y: menu.y }}
          currentSort={sort}
          currentFilter={filterByColumn.get(menu.column) ?? null}
          onClose={() => setMenu(null)}
          onSort={(direction: SortDirection | null) =>
            onSortChange(direction ? { column: menu.column, direction } : null)
          }
          onFilter={(filter) => onFilterChange(menu.column, filter)}
        />
      )}

      {columnsMenu && (
        <ColumnsVisibilityMenu
          anchor={columnsMenu}
          columns={columns}
          hidden={hiddenColumns}
          onChange={onHiddenColumnsChange}
          onClose={() => setColumnsMenu(null)}
        />
      )}
    </div>
  );
}

function HeaderRow({
  columns,
  widths,
  onResizeColumn,
  sort,
  filterByColumn,
  hasHiddenColumns,
  onColumnClick,
  onColumnsButtonClick,
}: {
  columns: ColumnInfo[];
  widths: number[];
  onResizeColumn: (index: number, delta: number) => void;
  sort: SortSpec | null;
  filterByColumn: Map<string, ColumnFilter>;
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
            const rect = (e.currentTarget as HTMLElement).getBoundingClientRect();
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
        const isFiltered = filterByColumn.has(col.name);
        return (
          <div
            key={col.name}
            data-column-header={col.name}
            style={{ width: widths[i] ?? MIN_COL_WIDTH }}
            className={clsx(
              "relative shrink-0 px-3 py-1.5 border-r border-zinc-800 flex flex-col justify-center cursor-pointer hover:bg-zinc-800/60",
              (isSorted || isFiltered) && "bg-zinc-800/40"
            )}
            title={`${col.name} · ${col.dataType}${
              col.key === "PRI" ? " · PK" : ""
            }\nClick to sort or filter`}
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
                <span className="text-accent-400 text-[10px]">★</span>
              )}
              <span className="truncate flex-1">{col.name}</span>
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
            <ResizeHandle onDelta={(delta) => onResizeColumn(i, delta)} />
          </div>
        );
      })}
    </div>
  );
}

function ResizeHandle({ onDelta }: { onDelta: (delta: number) => void }) {
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
  width,
  editable,
  isEditing,
  saving,
  isActive,
  onActivate,
  onBeginEdit,
  onCommit,
  onCancel,
}: {
  column: ColumnInfo;
  value: unknown;
  width: number;
  editable: boolean;
  isEditing: boolean;
  saving: boolean;
  isActive: boolean;
  onActivate: () => void;
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

  const { display, tone } = renderCell(value);
  return (
    <div
      style={{ width }}
      data-el="grid-cell"
      onClick={(e) => {
        e.stopPropagation();
        onActivate();
      }}
      onDoubleClick={(e) => {
        if (!editable) return;
        e.stopPropagation();
        onBeginEdit();
      }}
      className={clsx(
        "shrink-0 px-3 py-1 border-r border-zinc-900 flex items-center font-mono text-[11.5px] whitespace-nowrap overflow-hidden text-ellipsis",
        editable && "cursor-text",
        isActive && "ring-1 ring-inset ring-accent-400 bg-accent-500/10"
      )}
      title={
        editable
          ? `Double-click to edit${column.key === "PRI" ? " (primary key)" : ""}`
          : typeof value === "string"
          ? value
          : display
      }
    >
      <span className={clsx("truncate", tone)}>
        {column.key === "PRI" ? <strong className="text-zinc-100">{display}</strong> : display}
      </span>
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
