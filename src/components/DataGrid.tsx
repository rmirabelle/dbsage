import { useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { useVirtualizer } from "@tanstack/react-virtual";
import { getCurrentWindow, LogicalSize } from "@tauri-apps/api/window";
import {
  ArrowUp,
  ArrowDown,
  Eye,
  Funnel,
  RowsPlusBottom,
  PencilSimple,
  Table,
  Rows,
  ShareNetwork,
  Key,
  Trash,
  Copy,
  BracketsCurly,
  FileCsv,
  MicrosoftExcelLogo,
} from "@phosphor-icons/react";
import clsx from "clsx";
import type {
  CascadeTarget,
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
import {
  buildCopyText,
  buildResultCopyText,
  COPY_AS_OPTIONS,
  RESULT_COPY_OPTIONS,
  type CopyAsFormat,
  type ResultCopyFormat,
} from "../lib/copyAs";
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
  /** Commits a batch cell-edit session (type-to-overwrite or paste): one value
   * per row, all in a single column. The host should apply every UPDATE and
   * reload the page once. Absent = typing/paste editing disabled (read-only
   * grids still get cell selection and copy). */
  onBatchEdit?: (
    edits: { rowIndex: number; column: string; value: string | null }[]
  ) => Promise<void>;
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
  /** When true, right-clicking a row's number gutter opens a "Copy As" menu with
   * table-free result formats (JSON / CSV / tab-delimited) — for grids showing
   * query results, which have no db.table target for SQL-shaped copies. */
  resultCopy?: boolean;
  /** When set, the row-gutter context menu shows a Delete item that calls this
   * with the right-clicked row's selection. The grid handles the confirmation.
   * `cascade` carries the related-row targets the user opted to delete too
   * (null = no cascade). */
  onDeleteRows?: (
    indices: number[],
    cascade: CascadeTarget[] | null
  ) => Promise<void>;
  /** Computes the related-row cascade preview for the rows pending deletion
   * (targets with matching rows only). Absent = the delete confirmation offers
   * no cascade option. */
  onCascadePreview?: (indices: number[]) => Promise<CascadeTarget[]>;
  /** When set, the row-gutter context menu shows a Duplicate item. The host
   * performs the copy and owns all result messaging (success/conflict/error). */
  onDuplicateRows?: (indices: number[]) => Promise<void>;
  /** Column names that participate in a relation — marked with the relation icon
   * in their header to signal a peek can be launched from them. */
  peekableColumns?: Set<string>;
  /** Suppress the native hover tooltip showing a cell's full value (used in peek
   * windows, where the value tooltip is noise). */
  hideValueTooltip?: boolean;
  /** Reports a right-click on a cell at the pointer position, so the host can
   * open its own cell menu. Without it, right-clicking a cell does nothing —
   * the row menu lives on the gutter. */
  onCellContextMenu?: (cell: {
    rowIndex: number;
    column: string;
    x: number;
    y: number;
  }) => void;
}

const ROW_HEIGHT = 26;
/** Peek windows shorter than this grow to it while a column menu is open. */
const PEEK_MENU_MIN_HEIGHT = 520;
const MIN_COL_WIDTH = 80;
const MAX_INITIAL_COL_WIDTH = 360;
const ROW_GUTTER_W = 56; // pinned row-number gutter

const COPY_AS_ICONS: Record<CopyAsFormat, typeof Table> = {
  insert: RowsPlusBottom,
  update: PencilSimple,
  psv: Table,
  "psv-header": Rows,
};

const RESULT_COPY_ICONS: Record<ResultCopyFormat, typeof Table> = {
  json: BracketsCurly,
  csv: FileCsv,
  tsv: MicrosoftExcelLogo,
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
  onBatchEdit,
  clearActiveCellOnRowSelect = false,
  readOnly = false,
  onSelectionChange,
  initialSelectedRows,
  columnWidths,
  onColumnWidthsChange,
  copyTarget,
  resultCopy = false,
  onDeleteRows,
  onCascadePreview,
  onDuplicateRows,
  peekableColumns,
  hideValueTooltip = false,
  onCellContextMenu,
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

  /**
   * A peek window sized down to a few rows leaves no room for the column
   * menus (header sort/filter menu, show/hide columns list). While one is
   * open in a too-short peek window, extend the window's bottom edge to a
   * workable minimum height, then snap back to the previous size when the
   * menu closes. Main/tab windows are never resized.
   */
  const columnMenuOpen = menu != null || columnsMenu != null;
  useEffect(() => {
    if (!columnMenuOpen) return;
    const win = getCurrentWindow();
    if (!win.label.startsWith("peek-")) return;
    if (window.innerHeight >= PEEK_MENU_MIN_HEIGHT) return;
    let cancelled = false;
    let prev: { width: number; height: number } | null = null;
    void (async () => {
      const scale = await win.scaleFactor();
      const size = (await win.innerSize()).toLogical(scale);
      if (cancelled) return;
      prev = { width: size.width, height: size.height };
      await win.setSize(new LogicalSize(size.width, PEEK_MENU_MIN_HEIGHT));
    })();
    return () => {
      cancelled = true;
      if (prev) void win.setSize(new LogicalSize(prev.width, prev.height));
    };
  }, [columnMenuOpen]);
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
  /** Excel-like cell selection: a set of rows within ONE column. Independent
   * of row selection (gutter) — starting one clears the other. */
  const [cellSel, setCellSel] = useState<{
    column: string;
    rows: Set<number>;
  } | null>(null);
  const [cellAnchor, setCellAnchor] = useState<number | null>(null);
  const cellDraggingRef = useRef(false);
  /** A pending multi-cell edit session. "type" mirrors one live text into every
   * selected cell; "paste" stages one clipboard line per cell. Enter commits
   * (via onBatchEdit), Esc reverts — nothing touches the DB until commit. */
  const [batch, setBatch] = useState<
    | { mode: "type"; column: string; rows: number[]; text: string }
    | { mode: "paste"; column: string; rows: number[]; values: string[] }
    | null
  >(null);

  const hasPrimaryKey = useMemo(
    () => columns.some((c) => c.key === "PRI"),
    [columns]
  );
  const editable = hasPrimaryKey && !readOnly;
  const canBatchEdit = editable && !!onBatchEdit;

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
    setCellSel(null);
    setCellAnchor(null);
    setBatch(null);
  }, [viewKey]);

  useEffect(() => {
    const onUp = () => {
      draggingRef.current = false;
      cellDraggingRef.current = false;
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

  /** Row selection now lives on the gutter only (like Excel's row headers) —
   * clicking a cell selects the cell, never the row. */
  const handleRowMouseDown = (index: number, e: React.MouseEvent) => {
    if (e.button !== 0) return;
    if (batch) cancelBatch();
    if (cellSel) {
      setCellSel(null);
      setCellAnchor(null);
    }
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
    if (selectedRows.has(index)) {
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

  const selectCellRange = (
    column: string,
    from: number,
    to: number,
    additive = false
  ) => {
    const [lo, hi] = from < to ? [from, to] : [to, from];
    setCellSel((prev) => {
      const rowsSet =
        additive && prev && prev.column === column
          ? new Set(prev.rows)
          : new Set<number>();
      for (let i = lo; i <= hi; i++) rowsSet.add(i);
      return { column, rows: rowsSet };
    });
  };

  const handleCellMouseDown = (
    rowIndex: number,
    column: string,
    e: React.MouseEvent
  ) => {
    if (e.button !== 0) return;
    if (batch) cancelBatch();
    if (selectedRows.size) {
      setSelectedRows(new Set());
      setAnchor(null);
    }
    onActiveCellChange({ rowIndex, column });
    if (e.shiftKey && cellSel?.column === column && cellAnchor != null) {
      selectCellRange(column, cellAnchor, rowIndex, e.ctrlKey || e.metaKey);
      return;
    }
    if ((e.ctrlKey || e.metaKey) && cellSel?.column === column) {
      setCellSel((prev) => {
        if (!prev) return { column, rows: new Set([rowIndex]) };
        const next = new Set(prev.rows);
        if (next.has(rowIndex)) next.delete(rowIndex);
        else next.add(rowIndex);
        return { column, rows: next };
      });
      setCellAnchor(rowIndex);
      return;
    }
    setCellSel({ column, rows: new Set([rowIndex]) });
    setCellAnchor(rowIndex);
    cellDraggingRef.current = true;
  };

  const handleRowMouseEnter = (index: number) => {
    /* A cell drag extends the cell selection down its anchor column no matter
       which column the pointer is over — the selection is single-column. */
    if (cellDraggingRef.current && cellSel && cellAnchor != null) {
      selectCellRange(cellSel.column, cellAnchor, index);
      return;
    }
    if (!draggingRef.current || anchor === null) return;
    extendSelection(anchor, index);
  };

  /** The cell selection used by copy / paste / type-to-edit: the explicit
   * selection, else the active cell as a one-cell selection. Rows ascending. */
  const effCellSel = (): { column: string; rows: number[] } | null => {
    if (cellSel && cellSel.rows.size > 0)
      return {
        column: cellSel.column,
        rows: [...cellSel.rows].sort((a, b) => a - b),
      };
    if (activeCell)
      return { column: activeCell.column, rows: [activeCell.rowIndex] };
    return null;
  };

  const copySelectedCells = async () => {
    const sel = effCellSel();
    if (!sel) return;
    const text = sel.rows
      .map((i) => cellToText(rows[i]?.[sel.column]))
      .join("\r\n");
    try {
      await navigator.clipboard.writeText(text);
      notifySuccess(
        `Copied ${sel.rows.length} cell${sel.rows.length === 1 ? "" : "s"}`
      );
    } catch {
      notifyError("Could not copy to the clipboard");
    }
  };

  /** Guard shared by both batch modes: resolves the target column and rejects
   * primary keys (one value across N rows would collide; even single-cell
   * batch edits are routed to the double-click editor's explicit warning). */
  const batchTargetColumn = (sel: {
    column: string;
    rows: number[];
  }): ColumnInfo | null => {
    const col = visibleColumns.find((c) => c.name === sel.column);
    if (!col) return null;
    if (col.key === "PRI") {
      notifyError(
        "Primary-key columns can't be batch-edited — double-click a cell to edit it."
      );
      return null;
    }
    return col;
  };

  const beginTypeSession = (initial: string) => {
    const sel = effCellSel();
    if (!sel || !canBatchEdit || !batchTargetColumn(sel)) return;
    /* Sync the visible selection with the session so the preview and the
       commit target the same cells (covers the active-cell-only fallback). */
    setCellSel({ column: sel.column, rows: new Set(sel.rows) });
    setBatch({ mode: "type", column: sel.column, rows: sel.rows, text: initial });
  };

  const startPasteSession = async () => {
    const sel = effCellSel();
    if (!sel || !canBatchEdit || !batchTargetColumn(sel)) return;
    let text: string;
    try {
      text = await navigator.clipboard.readText();
    } catch {
      notifyError("Could not read the clipboard");
      return;
    }
    if (text === "") return;
    const lines = text.replace(/\r\n?/g, "\n").split("\n");
    if (lines.length > 1 && lines[lines.length - 1] === "") lines.pop();
    /* One copied value fills every selected cell (Excel fill-down); multiple
       values map top-down, stopping at whichever side runs out first. */
    const targets =
      lines.length === 1 ? sel.rows : sel.rows.slice(0, lines.length);
    const values = targets.map((_, i) =>
      lines.length === 1 ? lines[0] : lines[i]
    );
    setCellSel({ column: sel.column, rows: new Set(targets) });
    setBatch({ mode: "paste", column: sel.column, rows: targets, values });
  };

  const commitBatch = async (forceEmpty = false) => {
    if (!batch || !onBatchEdit || saving) return;
    const col = columns.find((c) => c.name === batch.column);
    const nullable = col?.nullable ?? false;
    const edits = batch.rows.map((rowIndex, i) => {
      const raw = batch.mode === "type" ? batch.text : batch.values[i];
      const value = raw === "" && nullable && !forceEmpty ? null : raw;
      return { rowIndex, column: batch.column, value };
    });
    setSaving(true);
    try {
      await onBatchEdit(edits);
      setBatch(null);
      scrollRef.current?.focus();
    } catch (e) {
      notifyError(`Update failed: ${String(e)}`);
    } finally {
      setSaving(false);
    }
  };

  const cancelBatch = (refocusGrid = false) => {
    setBatch(null);
    if (refocusGrid) scrollRef.current?.focus();
  };

  /* A staged paste has no input to blur — dismiss it on any mousedown, like
     the type session's blur-cancel. */
  useEffect(() => {
    if (!batch || batch.mode !== "paste") return;
    const onDown = () => setBatch(null);
    window.addEventListener("mousedown", onDown);
    return () => window.removeEventListener("mousedown", onDown);
  }, [batch]);

  /** Per-row pending preview values for the active batch session. */
  const pendingByRow = useMemo(() => {
    if (!batch) return null;
    const m = new Map<number, string>();
    if (batch.mode === "type") batch.rows.forEach((r) => m.set(r, batch.text));
    else batch.rows.forEach((r, i) => m.set(r, batch.values[i]));
    return m;
  }, [batch]);

  /** The cell hosting the type session's live input — the active cell when it
   * is part of the session, else the session's first row. */
  const batchInputRow =
    batch?.mode === "type"
      ? activeCell &&
        activeCell.column === batch.column &&
        batch.rows.includes(activeCell.rowIndex)
        ? activeCell.rowIndex
        : batch.rows[0]
      : null;

  /* Right-click a row's number gutter → row context menu (Delete + Copy As).
     Operate on the whole selection when the clicked row is part of it;
     otherwise select just that row and operate on it. */
  const handleRowContextMenu = (index: number, e: React.MouseEvent) => {
    if (!copyTarget && !resultCopy && !onDeleteRows && !onDuplicateRows) return;
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

  const confirmDelete = async (cascade: CascadeTarget[] | null) => {
    const indices = deleteConfirm;
    if (!onDeleteRows || !indices || indices.length === 0) return;
    await onDeleteRows(indices, cascade);
    setSelectedRows(new Set());
    setAnchor(null);
    const related = (cascade ?? []).reduce((a, t) => a + t.count, 0);
    notifySuccess(
      `Deleted ${indices.length} row${indices.length === 1 ? "" : "s"}` +
        (related > 0 ? ` and ${related} related` : "")
    );
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

  const copyResultsAs = async (
    format: ResultCopyFormat,
    label: string,
    indices: number[]
  ) => {
    setRowMenu(null);
    const picked = indices
      .map((i) => rows[i])
      .filter((r): r is RowRecord => r != null);
    if (picked.length === 0) return;
    try {
      const text = buildResultCopyText(format, visibleColumns, picked);
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

  /* Keyboard: arrows move the active cell (Shift+Up/Down extends the cell
     selection), Ctrl+C/V copy and paste cell values, and any printable key
     starts a type-to-overwrite session on the selected cells. */
  const handleGridKeyDown = (e: React.KeyboardEvent) => {
    if (editing) return;
    /* Keystrokes from an editable element (e.g. the column filter menu's text
       input, or the batch editor's own input, which handle their own keys)
       bubble up the React tree to this handler — ignore them here. */
    if (
      e.target instanceof HTMLElement &&
      e.target.closest("input, textarea, select, [contenteditable='true']")
    )
      return;

    /* A pending batch without a focused input (staged paste, or a type session
       whose input scrolled out of the virtualizer): Enter commits, Esc
       reverts. stopPropagation keeps Esc from also collapsing the Inspector. */
    if (batch) {
      if (e.key === "Enter") {
        e.preventDefault();
        e.stopPropagation();
        void commitBatch(e.ctrlKey || e.metaKey);
      } else if (e.key === "Escape") {
        e.preventDefault();
        e.stopPropagation();
        cancelBatch();
      }
      return;
    }

    if ((e.ctrlKey || e.metaKey) && (e.key === "c" || e.key === "C")) {
      e.preventDefault();
      void copySelectedCells();
      return;
    }
    if ((e.ctrlKey || e.metaKey) && (e.key === "v" || e.key === "V")) {
      if (canBatchEdit) {
        e.preventDefault();
        void startPasteSession();
      }
      return;
    }

    if (canBatchEdit) {
      if (e.key.length === 1 && !e.ctrlKey && !e.metaKey && !e.altKey) {
        e.preventDefault();
        beginTypeSession(e.key);
        return;
      }
      if (e.key === "Delete" || e.key === "Backspace") {
        e.preventDefault();
        beginTypeSession("");
        return;
      }
    }

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
      setCellSel({ column: visibleColumns[0].name, rows: new Set([0]) });
      setCellAnchor(0);
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

    /* Shift+Up/Down extends the cell selection from its anchor, Excel-style. */
    if (
      e.shiftKey &&
      (e.key === "ArrowUp" || e.key === "ArrowDown") &&
      cellSel &&
      cellAnchor != null
    ) {
      selectCellRange(cellSel.column, cellAnchor, rowIndex);
      onActiveCellChange({ rowIndex, column: cellSel.column });
      rowVirtualizer.scrollToIndex(rowIndex);
      return;
    }

    const column = visibleColumns[colIndex].name;
    onActiveCellChange({ rowIndex, column });
    /* Cell selection follows the active cell; row selection collapses. */
    setCellSel({ column, rows: new Set([rowIndex]) });
    setCellAnchor(rowIndex);
    if (selectedRows.size) {
      setSelectedRows(new Set());
      setAnchor(null);
    }
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
                    onMouseDown={(e) => handleRowMouseDown(vItem.index, e)}
                    onContextMenu={(e) => handleRowContextMenu(vItem.index, e)}
                    className={clsx(
                      "sticky left-0 z-10 w-14 shrink-0 border-r border-zinc-900",
                      (copyTarget || resultCopy || onDeleteRows) && "cursor-context-menu",
                      isSelected ? "bg-[#113e36]" : gutterStripe
                    )}
                  />
                  {visibleColumns.map((col, ci) => {
                    const isEditingThis =
                      editing?.rowIndex === vItem.index &&
                      editing.column === col.name;
                    const isActiveCell =
                      activeCell?.rowIndex === vItem.index &&
                      activeCell.column === col.name;
                    if (
                      batch?.mode === "type" &&
                      batch.column === col.name &&
                      vItem.index === batchInputRow
                    ) {
                      return (
                        <BatchCellEditor
                          key={col.name}
                          width={widths[ci] ?? MIN_COL_WIDTH}
                          column={col}
                          value={batch.text}
                          count={batch.rows.length}
                          saving={saving}
                          onChange={(text) =>
                            setBatch((b) =>
                              b && b.mode === "type" ? { ...b, text } : b
                            )
                          }
                          onCommit={(force) => void commitBatch(force)}
                          onCancel={cancelBatch}
                        />
                      );
                    }
                    const pendingRaw =
                      batch?.column === col.name
                        ? pendingByRow?.get(vItem.index)
                        : undefined;
                    const pending =
                      pendingRaw === undefined
                        ? undefined
                        : pendingRaw === "" && col.nullable
                        ? null
                        : pendingRaw;
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
                        isCellSelected={
                          cellSel?.column === col.name &&
                          cellSel.rows.has(vItem.index)
                        }
                        pending={pending}
                        isPeekable={peekableColumns?.has(col.name) ?? false}
                        hideValueTooltip={hideValueTooltip}
                        onCellMouseDown={(e) =>
                          handleCellMouseDown(vItem.index, col.name, e)
                        }
                        onContext={
                          onCellContextMenu &&
                          ((x, y) => {
                            onActiveCellChange({
                              rowIndex: vItem.index,
                              column: col.name,
                            });
                            /* Right-click inside the current selection keeps
                               it; outside, collapse to the clicked cell. */
                            if (
                              !(
                                cellSel?.column === col.name &&
                                cellSel.rows.has(vItem.index)
                              )
                            ) {
                              setCellSel({
                                column: col.name,
                                rows: new Set([vItem.index]),
                              });
                              setCellAnchor(vItem.index);
                            }
                            onCellContextMenu({
                              rowIndex: vItem.index,
                              column: col.name,
                              x,
                              y,
                            });
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
          canCopyResult={resultCopy}
          canDelete={!!onDeleteRows}
          canDuplicate={!!onDuplicateRows}
          onPick={(format, label) => copyRowsAs(format, label, rowMenu.indices)}
          onPickResult={(format, label) =>
            copyResultsAs(format, label, rowMenu.indices)
          }
          onDelete={() => deleteRows(rowMenu.indices)}
          onDuplicate={() => duplicateRows(rowMenu.indices)}
          onClose={() => setRowMenu(null)}
        />
      )}

      {deleteConfirm && (
        <RowDeleteConfirmDialog
          count={deleteConfirm.length}
          cascadePreview={
            onCascadePreview
              ? () => onCascadePreview(deleteConfirm)
              : undefined
          }
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
  canCopyResult,
  canDelete,
  canDuplicate,
  onPick,
  onPickResult,
  onDelete,
  onDuplicate,
  onClose,
}: {
  x: number;
  y: number;
  count: number;
  canCopy: boolean;
  canCopyResult: boolean;
  canDelete: boolean;
  canDuplicate: boolean;
  onPick: (format: CopyAsFormat, label: string) => void;
  onPickResult: (format: ResultCopyFormat, label: string) => void;
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
          {(canDelete || canCopy || canCopyResult) && (
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
          {(canCopy || canCopyResult) && (
            <div className="my-1 border-t border-zinc-800" />
          )}
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
      {/* Table-free data formats. In a table grid these continue the "Copy … as"
          section above; in a results grid they form the section themselves. */}
      {canCopyResult && (
        <>
          {!canCopy && (
            <div className="px-3 py-1 text-[10px] uppercase tracking-wide text-zinc-500">
              Copy {count} result{count === 1 ? "" : "s"} as
            </div>
          )}
          {RESULT_COPY_OPTIONS.map((opt) => {
            const Icon = RESULT_COPY_ICONS[opt.format];
            return (
              <button
                key={opt.format}
                onClick={() => onPickResult(opt.format, opt.label)}
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
  /** Any active filter (including one on a column scrolled out of view or
   * hidden) lights a 2px amber bar across the top of the header, so a restored
   * filter is impossible to miss. Complements — does not replace — the amber
   * highlight on the filtered column headers themselves. */
  const anyFiltered =
    filterByColumn.size > 0 || Object.keys(jsonDisplay).length > 0;
  return (
    <div
      data-el="grid-header"
      className={clsx(
        "sticky top-0 z-20 flex items-stretch bg-zinc-900 border-b border-zinc-800 select-none",
        anyFiltered && "border-t-2 border-t-amber-400"
      )}
    >
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
          <Eye size={15} />
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
              "relative shrink-0 px-3 py-1.5 border-r border-zinc-800 flex flex-col justify-center cursor-pointer",
              isFiltered
                ? "bg-amber-400 hover:bg-amber-300"
                : "hover:bg-zinc-800/60",
              !isFiltered && isSorted && "bg-zinc-800/40"
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
                isFiltered ? "text-black" : "text-zinc-200"
              )}
            >
              {col.key === "PRI" && (
                <Key
                  size={12}
                  weight="fill"
                  className={clsx(
                    "shrink-0",
                    isFiltered ? "text-black" : "text-emerald-400"
                  )}
                />
              )}
              <span className="truncate flex-1">{col.name}</span>
              {isPeekable && (
                <ShareNetwork
                  size={12}
                  className={clsx(
                    "shrink-0",
                    isFiltered ? "text-black" : "text-violet-400"
                  )}
                />
              )}
              {isFiltered && (
                <Funnel size={12} className="text-black shrink-0" />
              )}
              {isSorted && (
                <span
                  className={clsx(
                    "shrink-0",
                    isFiltered ? "text-black" : "text-accent-400"
                  )}
                >
                  {sort?.direction === "asc" ? (
                    <ArrowUp size={13} />
                  ) : (
                    <ArrowDown size={13} />
                  )}
                </span>
              )}
            </div>
            <div
              className={clsx(
                "text-[10px] truncate font-mono",
                isFiltered ? "text-black/70" : "text-zinc-500"
              )}
            >
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
  isCellSelected,
  pending,
  isPeekable,
  hideValueTooltip,
  onCellMouseDown,
  onContext,
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
  isCellSelected: boolean;
  /** Uncommitted batch-session value shown in place of the real one — a
   * string, null for a staged NULL, or undefined when no session covers this
   * cell. */
  pending: string | null | undefined;
  isPeekable: boolean;
  hideValueTooltip: boolean;
  /** Mousedown drives cell selection (click, shift/ctrl-click, drag start). */
  onCellMouseDown: (e: React.MouseEvent) => void;
  /** Right-click, reported at the pointer position. */
  onContext?: (x: number, y: number) => void;
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
    ? column.key === "PRI"
      ? "Double-click to edit (primary key)"
      : "Type to overwrite · double-click to edit"
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
      onMouseDown={onCellMouseDown}
      onClick={(e) => e.stopPropagation()}
      onDoubleClick={(e) => {
        if (!editable) return;
        e.stopPropagation();
        onBeginEdit();
      }}
      onContextMenu={
        onContext &&
        ((e) => {
          e.preventDefault();
          e.stopPropagation();
          onContext(e.clientX, e.clientY);
        })
      }
      className={clsx(
        "shrink-0 px-3 py-1 border-r border-zinc-900 flex items-center font-mono text-[11.5px] whitespace-nowrap overflow-hidden text-ellipsis",
        editable && "cursor-text",
        isCellSelected && !isActive && "bg-accent-500/20",
        isActive && "ring-1 ring-inset ring-accent-400 bg-accent-500/10",
        pending !== undefined && "bg-amber-500/10"
      )}
      {...(cellHelp ? helpHandlers(cellHelp) : {})}
    >
      {pending !== undefined ? (
        <span
          className={clsx(
            "truncate",
            pending === null ? "italic text-amber-500/70" : "text-amber-300"
          )}
        >
          {pending === null ? "NULL" : pending}
        </span>
      ) : showParts ? (
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

/** The live input of a type-to-overwrite batch session. Controlled by the
 * grid's session state so every other selected cell can mirror the text as it
 * is typed. Enter commits all cells, Esc reverts, blur cancels. */
function BatchCellEditor({
  width,
  column,
  value,
  count,
  saving,
  onChange,
  onCommit,
  onCancel,
}: {
  width: number;
  column: ColumnInfo;
  value: string;
  count: number;
  saving: boolean;
  onChange: (next: string) => void;
  onCommit: (forceEmpty: boolean) => void;
  onCancel: (refocusGrid?: boolean) => void;
}) {
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    const el = inputRef.current;
    if (!el) return;
    el.focus();
    el.setSelectionRange(el.value.length, el.value.length);
  }, []);

  const plural = count === 1 ? "" : "s";
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
        data-el="batch-editor-input"
        value={value}
        disabled={saving}
        onChange={(e) => onChange(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter") {
            e.preventDefault();
            e.stopPropagation();
            onCommit(e.ctrlKey || e.metaKey);
          } else if (e.key === "Escape") {
            e.preventDefault();
            e.stopPropagation();
            onCancel(true);
          }
        }}
        onBlur={() => {
          /* Disabling the input during the commit fires blur — that blur must
             not cancel the session being saved. */
          if (!saving) onCancel();
        }}
        placeholder={column.nullable ? "NULL" : ""}
        className={clsx(
          "w-full bg-zinc-950 border rounded px-1.5 py-0.5 text-[11.5px] font-mono text-zinc-100 outline-none focus:border-amber-400",
          value === "" && column.nullable
            ? "border-zinc-700 italic text-zinc-500"
            : "border-amber-400/60"
        )}
        title={
          column.nullable
            ? `Enter = apply to ${count} cell${plural} · Esc = cancel · empty = NULL · Ctrl+Enter = empty string`
            : `Enter = apply to ${count} cell${plural} · Esc = cancel`
        }
      />
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
            /* Esc reverts the edit only — don't let it bubble to the window
               listener that collapses the Inspector. */
            e.stopPropagation();
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

/** A cell value as clipboard text. NULL copies as an empty string — matching
 * Excel, where empty cells copy as blank lines. */
function cellToText(value: unknown): string {
  if (value === null || value === undefined) return "";
  if (typeof value === "string") return value;
  if (typeof value === "number" || typeof value === "boolean")
    return String(value);
  return JSON.stringify(value);
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
