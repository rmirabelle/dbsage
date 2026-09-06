import { useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { ipc } from "../ipc";
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
  Article,
  XCircle,
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
  SuggestResult,
  SortDirection,
  SortSpec,
} from "../types";
import { ColumnHeaderMenu } from "./ColumnHeaderMenu";
import { Tooltip } from "./Tooltip";
import { ColumnsVisibilityMenu } from "./ColumnsVisibilityMenu";
import { RowDeleteConfirmDialog } from "./RowDeleteConfirmDialog";
import { ConfirmDialog } from "./ConfirmDialog";
import { FormViewDialog } from "./FormViewDialog";
import { extractJsonDisplay, extractJsonShowParts } from "../lib/jsonPath";
import { useAnchoredPosition } from "../lib/useAnchoredPosition";
import { useNativeMenuLayer } from "../lib/useNativeMenuLayer";
import {
  buildCopyText,
  buildResultCopyText,
  COPY_AS_OPTIONS,
  RESULT_COPY_OPTIONS,
  type CopyAsFormat,
  type ResultCopyFormat,
} from "../lib/copyAs";
import { notifyError, notifyInfo, notifySuccess } from "../state/notify";
import { helpHandlers } from "../state/help";


/** Column types whose values are not useful (or are too costly) to suggest in
 *  the Equals filter: JSON, blobs, binary, long text, spatial, and bit. */
const NO_SUGGEST_TYPES = new Set([
  "json",
  "blob",
  "tinyblob",
  "mediumblob",
  "longblob",
  "binary",
  "varbinary",
  "text",
  "tinytext",
  "mediumtext",
  "longtext",
  "geometry",
  "point",
  "linestring",
  "polygon",
  "multipoint",
  "multilinestring",
  "multipolygon",
  "geometrycollection",
  "bit",
]);

/** Distinct values of `column` across `rows` that start with `prefix`
 *  (case-insensitive), sorted, for query-result grids where there is no table
 *  to ask. Mirrors the backend's shape so the menu treats both alike. */
function suggestFromRows(
  rows: RowRecord[],
  column: string,
  prefix: string,
  limit: number
): SuggestResult {
  const needle = prefix.trim().toLowerCase();
  const seen = new Set<string>();
  for (const row of rows) {
    const v = row[column];
    if (v == null) continue;
    const s = String(v);
    if (needle && !s.toLowerCase().startsWith(needle)) continue;
    seen.add(s);
  }
  const values = [...seen].sort((a, b) => a.localeCompare(b)).slice(0, limit);
  return { values, skipped: false };
}

function canSuggestValues(columnType: string): boolean {
  const base = columnType.trim().toLowerCase().match(/^[a-z]+/)?.[0] ?? "";
  return base.length > 0 && !NO_SUGGEST_TYPES.has(base);
}

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
  /** Commits a batch cell-edit session (type-to-overwrite or rectangular
   * paste). The host should apply every UPDATE and reload the page once.
   * Absent = typing/paste editing disabled (read-only grids still get cell
   * selection and copy). */
  onBatchEdit?: (
    edits: { rowIndex: number; column: string; value: string | null }[]
  ) => Promise<void>;
  /** Append rows containing only the selected columns. Omitted columns use
   * their database defaults, matching the regular Insert Row flow. */
  onInsertRows?: (
    rows: { column: string; value: string | null }[][]
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
  /** When set, the column menu's Equals input suggests distinct values from
   * this table as the user types. Absent for query-result grids. */
  suggestSource?: { profileId: string; database: string; table: string };
  /** When set (query-result grids), the Equals input suggests the distinct
   * values this column holds across these rows — the full, unfiltered result
   * set — instead of querying a table. */
  suggestRows?: RowRecord[];
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
  /** Show Duplicate in the row-gutter context menu. Duplicates are staged as
   * local draft rows and use `onInsertRows` only when the user presses Enter. */
  canDuplicateRows?: boolean;
  /** Column names that participate in a relation — marked with the relation icon
   * in their header to signal a peek can be launched from them. */
  peekableColumns?: Set<string>;
  /** Columns whose filter is fixed by the host (a peek's row match): the
   * header still highlights as filtered, but its menu shows the fixed value
   * instead of filter controls. */
  lockedFilterColumns?: string[];
  /** Tint the alternating row stripes with a hint of colour — green for
   * query results, violet for peek windows — so those grids read differently
   * from a table's rows at a glance. */
  stripeTint?: "green" | "violet";
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
  /** Lets the host dismiss its single-cell menu when a rectangular Copy menu
   * takes over the same right-click gesture. */
  onCellCopyMenuOpen?: () => void;
}

const ROW_HEIGHT = 26;
/** Peek windows shorter than this grow to it while a column menu is open. */
const PEEK_MENU_MIN_HEIGHT = 520;
const MIN_COL_WIDTH = 80;

/** Column types whose content is short enough to size a column to: numbers,
 * short strings, dates and the like. JSON/TEXT/BLOB families are excluded. */
function isAutoFitType(dataType: string): boolean {
  const t = dataType.trim().toLowerCase();
  return !/^(json|text|tinytext|mediumtext|longtext|blob|tinyblob|mediumblob|longblob|geometry|point|linestring|polygon)/.test(
    t
  );
}
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

interface CellPoint {
  rowIndex: number;
  column: string;
}

interface CellRange {
  anchor: CellPoint;
  focus: CellPoint;
}

interface ResolvedCellRange {
  rows: number[];
  columns: string[];
}

interface DraftRow {
  id: number;
  /** Missing key = omitted from INSERT, so the database supplies its default. */
  values: Partial<Record<string, string | null>>;
}

interface DraftBatch {
  afterRowIndex: number;
  rows: DraftRow[];
}

type DisplayRow =
  | { kind: "stored"; sourceIndex: number; row: RowRecord }
  | { kind: "draft"; draft: DraftRow };

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
  onInsertRows,
  clearActiveCellOnRowSelect = false,
  readOnly = false,
  onSelectionChange,
  initialSelectedRows,
  columnWidths,
  onColumnWidthsChange,
  copyTarget,
  suggestSource,
  suggestRows,
  resultCopy = false,
  onDeleteRows,
  onCascadePreview,
  canDuplicateRows = false,
  peekableColumns,
  lockedFilterColumns,
  stripeTint,
  hideValueTooltip = false,
  onCellContextMenu,
  onCellCopyMenuOpen,
}: Props) {
  const scrollRef = useRef<HTMLDivElement>(null);
  const [widths, setWidths] = useState<number[]>([]);
  const [menu, setMenu] = useState<MenuAnchor | null>(null);
  const [rowMenu, setRowMenu] = useState<{
    x: number;
    y: number;
    indices: number[];
    focusIndex: number;
  } | null>(null);
  const [formRowIndex, setFormRowIndex] = useState<number | null>(null);
  const [cellCopyMenu, setCellCopyMenu] = useState<{
    x: number;
    y: number;
    selection: ResolvedCellRange;
  } | null>(null);
  useNativeMenuLayer(cellCopyMenu !== null);
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
  /** A primary-key cell awaiting the user's OK before it becomes editable. */
  const [pkEditConfirm, setPkEditConfirm] = useState<{
    rowIndex: number;
    column: string;
  } | null>(null);
  const draggingRef = useRef(false);
  const [editing, setEditing] = useState<{ rowIndex: number; column: string } | null>(
    null
  );
  const [saving, setSaving] = useState(false);
  /** Excel-like rectangular cell selection. Independent of row selection
   * (gutter) — starting one clears the other. */
  const [cellSel, setCellSel] = useState<CellRange | null>(null);
  const cellDraggingRef = useRef(false);
  /** A pending multi-cell edit session. "type" mirrors one live text into every
   * selected cell; "paste" stages one clipboard line per cell. Enter commits
   * (via onBatchEdit), Esc reverts — nothing touches the DB until commit. */
  const [batch, setBatch] = useState<
    | { mode: "type"; cells: CellPoint[]; text: string }
    | {
        mode: "paste";
        edits: { rowIndex: number; column: string; value: string | null }[];
      }
    | null
  >(null);
  const draftIdRef = useRef(0);
  const [draftBatch, setDraftBatch] = useState<DraftBatch | null>(null);
  const [draftSaving, setDraftSaving] = useState(false);

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

  const resolvedCellSel = useMemo<ResolvedCellRange | null>(() => {
    if (!cellSel) return null;
    const anchorColumn = visibleColumns.findIndex(
      (c) => c.name === cellSel.anchor.column
    );
    const focusColumn = visibleColumns.findIndex(
      (c) => c.name === cellSel.focus.column
    );
    if (anchorColumn < 0 || focusColumn < 0) return { rows: [], columns: [] };

    const [rowLo, rowHi] =
      cellSel.anchor.rowIndex <= cellSel.focus.rowIndex
        ? [cellSel.anchor.rowIndex, cellSel.focus.rowIndex]
        : [cellSel.focus.rowIndex, cellSel.anchor.rowIndex];
    const [columnLo, columnHi] =
      anchorColumn <= focusColumn
        ? [anchorColumn, focusColumn]
        : [focusColumn, anchorColumn];
    return {
      rows: Array.from({ length: rowHi - rowLo + 1 }, (_, i) => rowLo + i),
      columns: visibleColumns.slice(columnLo, columnHi + 1).map((c) => c.name),
    };
  }, [cellSel, visibleColumns]);

  const displayRows = useMemo<DisplayRow[]>(() => {
    if (!draftBatch) {
      return rows.map((row, sourceIndex) => ({
        kind: "stored" as const,
        sourceIndex,
        row,
      }));
    }
    const out: DisplayRow[] = [];
    rows.forEach((row, sourceIndex) => {
      out.push({ kind: "stored", sourceIndex, row });
      if (sourceIndex === draftBatch.afterRowIndex) {
        out.push(
          ...draftBatch.rows.map((draft) => ({
            kind: "draft" as const,
            draft,
          }))
        );
      }
    });
    return out;
  }, [rows, draftBatch]);

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
  /** Double-clicking a column's resize handle sizes it to its content: the
   * widest loaded value (or the header), measured in the grid's own font.
   * Wide-content types (JSON, TEXT, BLOB, …) are left alone. */
  const autoFitColumn = (index: number) => {
    const col = visibleColumns[index];
    if (!col || !isAutoFitType(col.dataType)) return;
    const font = (el: Element | null, fallback: string) =>
      el ? getComputedStyle(el).font || fallback : fallback;
    const ctx = document.createElement("canvas").getContext("2d");
    if (!ctx) return;
    ctx.font = font(
      scrollRef.current?.querySelector('[data-el="grid-cell"]') ?? null,
      "12px ui-monospace, monospace"
    );
    let content = 0;
    const sample = Math.min(rows.length, 2000);
    for (let i = 0; i < sample; i++) {
      const v = rows[i]?.[col.name];
      const s = v == null ? "NULL" : typeof v === "string" ? v : String(v);
      content = Math.max(content, ctx.measureText(s).width);
    }
    ctx.font = font(
      scrollRef.current?.querySelector(`[data-column-header="${CSS.escape(col.name)}"]`) ?? null,
      "600 12px system-ui, sans-serif"
    );
    const header = ctx.measureText(col.name).width;
    const px = Math.min(800, Math.max(MIN_COL_WIDTH, Math.ceil(Math.max(content, header) + 26)));
    const next = widthsRef.current.slice();
    next[index] = px;
    widthsRef.current = next;
    setWidths(next);
    handleResizeEnd();
  };

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
    setBatch(null);
  }, [viewKey]);

  /* Draft rows survive hide/show-column changes so a required hidden column
     can be revealed and completed. Page/sort/filter/schema changes cancel the
     local draft batch because its insertion point would no longer be stable. */
  const draftViewKey = `${columns.map((column) => column.name).join(" ")}|${offset}|${JSON.stringify(
    sort
  )}|${JSON.stringify(filters)}`;
  const draftClearGuardRef = useRef(draftViewKey);
  useEffect(() => {
    if (draftClearGuardRef.current === draftViewKey) return;
    draftClearGuardRef.current = draftViewKey;
    setDraftBatch(null);
  }, [draftViewKey]);

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
    const point = { rowIndex, column };
    onActiveCellChange(point);
    if ((e.shiftKey || e.ctrlKey || e.metaKey) && cellSel) {
      setCellSel({ anchor: cellSel.anchor, focus: point });
      return;
    }
    setCellSel({ anchor: point, focus: point });
    cellDraggingRef.current = true;
  };

  const handleCellMouseEnter = (rowIndex: number, column: string) => {
    if (!cellDraggingRef.current) return;
    const focus = { rowIndex, column };
    setCellSel((current) =>
      current ? { anchor: current.anchor, focus } : null
    );
    onActiveCellChange(focus);
  };

  const handleRowMouseEnter = (index: number) => {
    if (!draggingRef.current || anchor === null) return;
    extendSelection(anchor, index);
  };

  /** The cell selection used by copy / paste / type-to-edit: the explicit
   * selection, else the active cell as a one-cell selection. */
  const effCellSel = (): ResolvedCellRange | null => {
    if (
      resolvedCellSel &&
      resolvedCellSel.rows.length > 0 &&
      resolvedCellSel.columns.length > 0
    )
      return resolvedCellSel;
    if (activeCell)
      return { columns: [activeCell.column], rows: [activeCell.rowIndex] };
    return null;
  };

  const copySelectedCells = async () => {
    const sel = effCellSel();
    if (!sel) return;
    const text = selectionTsv(rows, sel);
    try {
      await navigator.clipboard.writeText(text);
      const count = sel.rows.length * sel.columns.length;
      notifySuccess(
        `Copied ${count} cell${count === 1 ? "" : "s"}`
      );
    } catch {
      notifyError("Could not copy to the clipboard");
    }
  };

  const copyCellSelection = async (
    selection: ResolvedCellRange,
    format: "Tab-delimited" | "JSON"
  ) => {
    setCellCopyMenu(null);
    const text =
      format === "JSON"
        ? selectionJson(rows, selection)
        : selectionTsv(rows, selection);
    try {
      await navigator.clipboard.writeText(text);
      notifySuccess(
        `Copied ${selection.rows.length} row${
          selection.rows.length === 1 ? "" : "s"
        }, ${selection.columns.length} column${
          selection.columns.length === 1 ? "" : "s"
        } as ${format}`
      );
    } catch {
      notifyError("Could not copy to the clipboard");
    }
  };

  const stageRowsAsDrafts = (rowIndices: number[], columnNames: string[]) => {
    setCellCopyMenu(null);
    setRowMenu(null);
    if (!onInsertRows) return;
    if (draftBatch) {
      notifyError("Commit or cancel the current new rows first.");
      return;
    }
    const drafts = rowIndices
      .map((rowIndex) => rows[rowIndex])
      .filter((row): row is RowRecord => row != null)
      .map((row) => {
        const values: DraftRow["values"] = {};
        for (const column of columnNames) {
          const info = columns.find((candidate) => candidate.name === column);
          if (info && !isServerGenerated(info)) {
            values[column] = cellToInsertValue(row[column]);
          }
        }
        return { id: ++draftIdRef.current, values };
      });
    if (drafts.length === 0) return;
    const afterRowIndex = Math.max(...rowIndices);
    setBatch(null);
    setEditing(null);
    setDraftBatch({ afterRowIndex, rows: drafts });
    requestAnimationFrame(() => {
      rowVirtualizer.scrollToIndex(afterRowIndex + 1, { align: "center" });
    });
  };

  const stageSelectionAsRows = (selection: ResolvedCellRange) => {
    stageRowsAsDrafts(selection.rows, selection.columns);
  };

  const updateDraftCell = (
    draftId: number,
    column: string,
    value: string | null
  ) => {
    setDraftBatch((current) =>
      current
        ? {
            ...current,
            rows: current.rows.map((draft) =>
              draft.id === draftId
                ? { ...draft, values: { ...draft.values, [column]: value } }
                : draft
            ),
          }
        : null
    );
  };

  const cancelDraftRows = () => {
    if (draftSaving) return;
    setDraftBatch(null);
    scrollRef.current?.focus();
  };

  const commitDraftRows = async () => {
    if (!draftBatch || !onInsertRows || draftSaving) return;
    const inserts = draftBatch.rows.map((draft) =>
      Object.entries(draft.values)
        .filter(([column]) => {
          const info = columns.find((candidate) => candidate.name === column);
          return !info || !isServerGenerated(info);
        })
        .map(([column, value]) => {
          const info = columns.find((candidate) => candidate.name === column);
          return {
            column,
            value: value === "" && info?.nullable ? null : value ?? null,
          };
        })
    );
    setDraftSaving(true);
    try {
      await onInsertRows(inserts);
      setDraftBatch(null);
      notifySuccess(
        `Appended ${inserts.length} new row${inserts.length === 1 ? "" : "s"}`
      );
    } catch (e) {
      notifyError(`Could not commit new rows: ${String(e)}`);
    } finally {
      setDraftSaving(false);
    }
  };

  const stageSelectionNull = (selection: ResolvedCellRange) => {
    setCellCopyMenu(null);
    if (!canBatchEdit) return;
    const notNullable = selection.columns.filter(
      (name) => !columns.find((column) => column.name === name)?.nullable
    );
    if (notNullable.length > 0) {
      notifyError(
        `Cannot set non-nullable column${notNullable.length === 1 ? "" : "s"} to NULL: ${notNullable.join(", ")}`
      );
      return;
    }
    if (!validateBatchColumns(selection.columns)) return;
    const edits = selection.rows.flatMap((rowIndex) =>
      selection.columns.map((column) => ({
        rowIndex,
        column,
        value: null,
      }))
    );
    setBatch({ mode: "paste", edits });
    /* The context-menu button owns focus when this action fires. Once its
       portal unmounts, explicitly return focus to the grid so its staged-edit
       Enter/Escape handler remains active. */
    requestAnimationFrame(() => scrollRef.current?.focus());
    notifyInfo(
      `NULL staged for ${edits.length} cell${
        edits.length === 1 ? "" : "s"
      } — press Enter to apply or Escape to cancel.`
    );
  };

  /** Batch operations reject primary-key targets; direct PK editing remains
   * available through the guarded double-click editor. */
  const validateBatchColumns = (columnNames: string[]): boolean => {
    const targetColumns = columnNames
      .map((name) => visibleColumns.find((c) => c.name === name))
      .filter((c): c is ColumnInfo => c != null);
    if (targetColumns.length !== columnNames.length) return false;
    if (targetColumns.some((c) => c.key === "PRI")) {
      notifyError(
        "Primary-key columns can't be batch-edited — double-click a cell to edit it."
      );
      return false;
    }
    return true;
  };

  const beginTypeSession = (initial: string) => {
    const sel = effCellSel();
    if (!sel || !canBatchEdit) return;
    if (!validateBatchColumns(sel.columns)) return;
    const cells = sel.rows.flatMap((rowIndex) =>
      sel.columns.map((column) => ({ rowIndex, column }))
    );
    setBatch({ mode: "type", cells, text: initial });
  };

  const startPasteSession = async () => {
    const sel = effCellSel();
    if (!sel || !canBatchEdit) return;
    let text: string;
    try {
      text = await navigator.clipboard.readText();
    } catch {
      notifyError("Could not read the clipboard");
      return;
    }
    if (text === "") return;
    const matrix = text.replace(/\r\n?/g, "\n").split("\n");
    if (matrix.length > 1 && matrix[matrix.length - 1] === "") matrix.pop();
    const values = matrix.map((line) => line.split("\t"));
    const oneValue = values.length === 1 && values[0].length === 1;
    const edits: {
      rowIndex: number;
      column: string;
      value: string | null;
    }[] = [];

    if (oneValue && (sel.rows.length > 1 || sel.columns.length > 1)) {
      for (const rowIndex of sel.rows) {
        for (const column of sel.columns) {
          edits.push({ rowIndex, column, value: values[0][0] });
        }
      }
    } else {
      const start = activeCell ?? {
        rowIndex: sel.rows[0],
        column: sel.columns[0],
      };
      const startColumn = visibleColumns.findIndex(
        (c) => c.name === start.column
      );
      if (startColumn < 0) return;
      values.forEach((line, rowOffset) => {
        const rowIndex = start.rowIndex + rowOffset;
        if (rowIndex >= rows.length) return;
        line.forEach((value, columnOffset) => {
          const column = visibleColumns[startColumn + columnOffset]?.name;
          if (column) edits.push({ rowIndex, column, value });
        });
      });
    }
    if (edits.length === 0) return;
    const targetColumns = [...new Set(edits.map((edit) => edit.column))];
    if (!validateBatchColumns(targetColumns)) return;

    const last = edits[edits.length - 1];
    setCellSel({
      anchor: { rowIndex: edits[0].rowIndex, column: edits[0].column },
      focus: { rowIndex: last.rowIndex, column: last.column },
    });
    setBatch({ mode: "paste", edits });
  };

  const commitBatch = async (forceEmpty = false) => {
    if (!batch || !onBatchEdit || saving) return;
    const edits =
      batch.mode === "type"
        ? batch.cells.map(({ rowIndex, column }) => {
            const nullable =
              columns.find((c) => c.name === column)?.nullable ?? false;
            const value =
              batch.text === "" && nullable && !forceEmpty ? null : batch.text;
            return { rowIndex, column, value };
          })
        : batch.edits.map((edit) => {
            const nullable =
              columns.find((c) => c.name === edit.column)?.nullable ?? false;
            const value =
              edit.value === "" && nullable && !forceEmpty ? null : edit.value;
            return { ...edit, value };
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

  /** Per-cell pending preview values for the active batch session. */
  const pendingByCell = useMemo(() => {
    if (!batch) return null;
    const m = new Map<string, string | null>();
    if (batch.mode === "type") {
      batch.cells.forEach(({ rowIndex, column }) =>
        m.set(cellKey(rowIndex, column), batch.text)
      );
    } else {
      batch.edits.forEach((edit) =>
        m.set(cellKey(edit.rowIndex, edit.column), edit.value)
      );
    }
    return m;
  }, [batch]);

  /** The cell hosting the type session's live input — the active cell when it
   * is part of the session, else the session's first cell. */
  const batchInputCell =
    batch?.mode === "type"
      ? activeCell &&
        batch.cells.some(
          (cell) =>
            cell.rowIndex === activeCell.rowIndex &&
            cell.column === activeCell.column
        )
        ? activeCell
        : batch.cells[0]
      : null;

  /* Right-click a row's number gutter → row context menu (Delete + Copy As).
     Operate on the whole selection when the clicked row is part of it;
     otherwise select just that row and operate on it. */
  const handleRowContextMenu = (index: number, e: React.MouseEvent) => {
    if (!copyTarget && !resultCopy && !onDeleteRows && !canDuplicateRows) return;
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
    setRowMenu({ x: e.clientX, y: e.clientY, indices, focusIndex: index });
  };

  const openFormView = (rowIndex: number) => {
    setRowMenu(null);
    setFormRowIndex(rowIndex);
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

  const duplicateRows = (indices: number[]) => {
    if (!canDuplicateRows || indices.length === 0) return;
    stageRowsAsDrafts(
      indices,
      columns.map((column) => column.name)
    );
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
      setPkEditConfirm({ rowIndex, column: col.name });
      return;
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
    count: displayRows.length,
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

  /* Keyboard: arrows move the active cell (Shift+arrows extends the cell
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

    if (draftBatch) {
      if (e.key === "Enter") {
        e.preventDefault();
        void commitDraftRows();
      } else if (e.key === "Escape") {
        e.preventDefault();
        e.stopPropagation();
        cancelDraftRows();
      }
      return;
    }

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
      const point = { rowIndex: 0, column: visibleColumns[0].name };
      onActiveCellChange(point);
      setCellSel({ anchor: point, focus: point });
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

    const column = visibleColumns[colIndex].name;
    /* Shift+any arrow extends the rectangle from its original anchor. */
    if (e.shiftKey && cellSel) {
      const focus = { rowIndex, column };
      setCellSel({ anchor: cellSel.anchor, focus });
      onActiveCellChange(focus);
      rowVirtualizer.scrollToIndex(rowIndex);
      scrollColumnIntoView(colIndex);
      return;
    }

    const point = { rowIndex, column };
    onActiveCellChange(point);
    /* Cell selection follows the active cell; row selection collapses. */
    setCellSel({ anchor: point, focus: point });
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
      className={clsx(
        "flex-1 overflow-auto select-none focus:outline-none",
        stripeTint === "green"
          ? "bg-[#22292d]"
          : stripeTint === "violet"
          ? "bg-[#272433]"
          : "bg-zinc-950"
      )}
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
          onAutoFitColumn={autoFitColumn}
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
              const entry = displayRows[vItem.index];
              if (!entry) return null;
              if (entry.kind === "draft") {
                return (
                  <DraftGridRow
                    key={`draft-${entry.draft.id}`}
                    draft={entry.draft}
                    columns={visibleColumns}
                    widths={widths}
                    top={vItem.start}
                    saving={draftSaving}
                    focusFirst={entry.draft.id === draftBatch?.rows[0]?.id}
                    onChange={(column, value) =>
                      updateDraftCell(entry.draft.id, column, value)
                    }
                    onCommit={() => void commitDraftRows()}
                    onCancel={cancelDraftRows}
                  />
                );
              }
              const { row, sourceIndex } = entry;
              const isSelected = selectedRows.has(sourceIndex);
              const even = vItem.index % 2 === 0;
              /* Green-tinted stripes are the zinc-950 / #242732 pair nudged
                 toward emerald — opaque, so they double as the gutter colour. */
              const stripe =
                stripeTint === "green"
                  ? even
                    ? "bg-[#22292d]"
                    : "bg-[#262f33]"
                  : stripeTint === "violet"
                  ? even
                    ? "bg-[#272433]"
                    : "bg-[#2b2838]"
                  : even
                  ? "bg-zinc-950"
                  : "bg-zinc-900/30";
              /* The pinned row-number gutter must be OPAQUE, or columns scrolled
                 underneath it show through. The odd-row stripe (bg-zinc-900/30)
                 is translucent, so the gutter uses its pre-blended opaque
                 equivalent over the zinc-950 grid bg (#242732). */
              const gutterStripe = stripeTint
                ? stripe
                : even
                ? "bg-zinc-950"
                : "bg-[#242732]";
              return (
                <div
                  key={vItem.key}
                  data-el="grid-row"
                  onMouseEnter={() => handleRowMouseEnter(sourceIndex)}
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
                    onMouseDown={(e) => handleRowMouseDown(sourceIndex, e)}
                    onContextMenu={(e) => handleRowContextMenu(sourceIndex, e)}
                    className={clsx(
                      "sticky left-0 z-10 w-14 shrink-0 border-r border-zinc-900",
                      (copyTarget || resultCopy || onDeleteRows) && "cursor-context-menu",
                      isSelected ? "bg-[#113e36]" : gutterStripe
                    )}
                  />
                  {visibleColumns.map((col, ci) => {
                    const isEditingThis =
                      editing?.rowIndex === sourceIndex &&
                      editing.column === col.name;
                    const isActiveCell =
                      activeCell?.rowIndex === sourceIndex &&
                      activeCell.column === col.name;
                    if (
                      batch?.mode === "type" &&
                      batchInputCell?.column === col.name &&
                      sourceIndex === batchInputCell.rowIndex
                    ) {
                      return (
                        <BatchCellEditor
                          key={col.name}
                          width={widths[ci] ?? MIN_COL_WIDTH}
                          column={col}
                          value={batch.text}
                          count={batch.cells.length}
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
                    const pendingRaw = pendingByCell?.get(
                      cellKey(sourceIndex, col.name)
                    );
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
                          resolvedCellSel?.columns.includes(col.name) === true &&
                          resolvedCellSel.rows.includes(sourceIndex)
                        }
                        pending={pending}
                        isPeekable={peekableColumns?.has(col.name) ?? false}
                        hideValueTooltip={hideValueTooltip}
                        onCellMouseDown={(e) =>
                          handleCellMouseDown(sourceIndex, col.name, e)
                        }
                        onCellMouseEnter={() =>
                          handleCellMouseEnter(sourceIndex, col.name)
                        }
                        onContext={
                          (onCellContextMenu || copyTarget) &&
                          ((x, y) => {
                            const point = {
                              rowIndex: sourceIndex,
                              column: col.name,
                            };
                            onActiveCellChange(point);
                            /* Right-click inside the current selection keeps
                               it; outside, collapse to the clicked cell. The
                               selection menu (copy, set NULL, stage as rows)
                               opens for any selection, a single cell included. */
                            const inSelection =
                              resolvedCellSel?.columns.includes(col.name) === true &&
                              resolvedCellSel.rows.includes(sourceIndex);
                            if (!inSelection) {
                              setCellSel({ anchor: point, focus: point });
                            }
                            if (copyTarget) {
                              onCellCopyMenuOpen?.();
                              setCellCopyMenu({
                                x,
                                y,
                                selection: inSelection
                                  ? resolvedCellSel
                                  : { rows: [sourceIndex], columns: [col.name] },
                              });
                              return;
                            }
                            onCellContextMenu?.({
                              rowIndex: sourceIndex,
                              column: col.name,
                              x,
                              y,
                            });
                          })
                        }
                        onBeginEdit={() => beginEdit(sourceIndex, col)}
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
          locked={lockedFilterColumns?.includes(menu.column) ?? false}
          suggest={
            !canSuggestValues(
              columns.find((c) => c.name === menu.column)?.dataType ?? ""
            )
              ? undefined
              : suggestSource
                ? (prefix) =>
                    ipc.suggestColumnValues({
                      ...suggestSource,
                      column: menu.column,
                      prefix,
                      limit: 50,
                    })
                : suggestRows
                  ? (prefix) =>
                      Promise.resolve(
                        suggestFromRows(suggestRows, menu.column, prefix, 50)
                      )
                  : undefined
          }
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
          canDuplicate={canDuplicateRows && !!onInsertRows}
          canOpenForm={!!copyTarget}
          onOpenForm={() => openFormView(rowMenu.focusIndex)}
          onPick={(format, label) => copyRowsAs(format, label, rowMenu.indices)}
          onPickResult={(format, label) =>
            copyResultsAs(format, label, rowMenu.indices)
          }
          onDelete={() => deleteRows(rowMenu.indices)}
          onDuplicate={() => duplicateRows(rowMenu.indices)}
          onClose={() => setRowMenu(null)}
        />
      )}

      {cellCopyMenu && (
        <CellSelectionCopyMenu
          x={cellCopyMenu.x}
          y={cellCopyMenu.y}
          rowCount={cellCopyMenu.selection.rows.length}
          columnCount={cellCopyMenu.selection.columns.length}
          canInsert={!!onInsertRows}
          canSetNull={!!onBatchEdit}
          onInsert={() => stageSelectionAsRows(cellCopyMenu.selection)}
          onSetNull={() => stageSelectionNull(cellCopyMenu.selection)}
          onCopyTsv={() =>
            void copyCellSelection(cellCopyMenu.selection, "Tab-delimited")
          }
          onCopyJson={() =>
            void copyCellSelection(cellCopyMenu.selection, "JSON")
          }
          onClose={() => setCellCopyMenu(null)}
        />
      )}

      {pkEditConfirm && (
        <ConfirmDialog
          title="Edit a primary key?"
          confirmLabel="Edit"
          danger={false}
          message={
            <p>
              <span className="font-mono text-zinc-100">{pkEditConfirm.column}</span>{" "}
              is a primary-key column. Editing it can break foreign-key
              references and changes the row's identity. Continue?
            </p>
          }
          onConfirm={() => {
            setEditing(pkEditConfirm);
            setPkEditConfirm(null);
          }}
          onCancel={() => setPkEditConfirm(null)}
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

      {formRowIndex !== null && copyTarget && rows[formRowIndex] && (
        <FormViewDialog
          table={copyTarget.table}
          columns={columns}
          rows={rows}
          initialRowIndex={formRowIndex}
          offset={offset}
          onClose={() => setFormRowIndex(null)}
        />
      )}
    </div>
  );
}

function DraftGridRow({
  draft,
  columns,
  widths,
  top,
  saving,
  focusFirst,
  onChange,
  onCommit,
  onCancel,
}: {
  draft: DraftRow;
  columns: ColumnInfo[];
  widths: number[];
  top: number;
  saving: boolean;
  focusFirst: boolean;
  onChange: (column: string, value: string | null) => void;
  onCommit: () => void;
  onCancel: () => void;
}) {
  const firstEditable = columns.findIndex((column) => !isServerGenerated(column));
  return (
    <div
      data-el="draft-grid-row"
      className="absolute left-0 right-0 flex items-stretch border-y border-amber-500/50 bg-amber-500/10 shadow-[inset_0_0_0_1px_rgba(245,158,11,0.08)]"
      style={{
        height: ROW_HEIGHT,
        transform: `translateY(${top}px)`,
      }}
      {...helpHandlers(
        "New row draft · edit values, Enter commits all drafts, Escape cancels"
      )}
    >
      <div className="sticky left-0 z-10 flex w-14 shrink-0 items-center justify-center border-r border-amber-500/30 bg-[#3b321f] text-[9px] font-bold uppercase tracking-wide text-amber-300">
        New
      </div>
      {columns.map((column, index) => {
        const generated = isServerGenerated(column);
        const supplied = Object.prototype.hasOwnProperty.call(
          draft.values,
          column.name
        );
        const value = draft.values[column.name];
        return (
          <input
            key={column.name}
            data-el="draft-cell"
            autoFocus={focusFirst && index === firstEditable}
            style={{ width: widths[index] ?? MIN_COL_WIDTH }}
            value={value ?? ""}
            disabled={saving || generated}
            placeholder={
              generated
                ? "auto"
                : supplied && value === null
                ? "NULL"
                : "default"
            }
            onChange={(event) => onChange(column.name, event.target.value)}
            onKeyDown={(event) => {
              if (event.nativeEvent.isComposing) return;
              if (event.key === "Enter") {
                event.preventDefault();
                onCommit();
              } else if (event.key === "Escape") {
                event.preventDefault();
                event.stopPropagation();
                onCancel();
              }
            }}
            className={clsx(
              "h-full shrink-0 border-r border-amber-500/20 bg-transparent px-3 font-mono text-[11.5px] text-amber-100 outline-none placeholder:text-amber-600/60 focus:bg-amber-500/15 focus:ring-1 focus:ring-inset focus:ring-amber-400",
              generated && "cursor-not-allowed italic text-amber-600"
            )}
          />
        );
      })}
    </div>
  );
}

function CellSelectionCopyMenu({
  x,
  y,
  rowCount,
  columnCount,
  canInsert,
  canSetNull,
  onInsert,
  onSetNull,
  onCopyTsv,
  onCopyJson,
  onClose,
}: {
  x: number;
  y: number;
  rowCount: number;
  columnCount: number;
  canInsert: boolean;
  canSetNull: boolean;
  onInsert: () => void;
  onSetNull: () => void;
  onCopyTsv: () => void;
  onCopyJson: () => void;
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

  const { ref, style } = useAnchoredPosition(x, y);
  return createPortal(
    <div
      ref={ref}
      data-el="cell-copy-menu"
      style={style}
      onMouseDown={(e) => e.stopPropagation()}
      className="dbs-context-menu fixed z-50 w-max rounded border border-zinc-700 bg-zinc-900/95 backdrop-blur-sm py-1 shadow-xl shadow-black/60 text-zinc-200"
    >
      {canSetNull && (
        <>
          <button
            onClick={onSetNull}
            className="flex w-full items-center gap-2.5 px-3 py-1.5 text-left text-amber-200 hover:bg-amber-950/50 whitespace-nowrap"
          >
            <XCircle size={14} className="shrink-0 text-amber-400" />
            Set to NULL
          </button>
          <div className="my-1 border-t border-zinc-800" />
        </>
      )}
      <div className="px-3 py-1 text-[10px] uppercase tracking-wide text-zinc-500">
        Copy {rowCount} row{rowCount === 1 ? "" : "s"}, {columnCount} column
        {columnCount === 1 ? "" : "s"}
      </div>
      {canInsert && (
        <button
          onClick={onInsert}
          className="flex w-full items-center gap-2.5 px-3 py-1.5 text-left text-emerald-200 hover:bg-emerald-950/50 whitespace-nowrap"
        >
          <RowsPlusBottom size={14} className="shrink-0 text-emerald-400" />
          To New Rows
        </button>
      )}
      <button
        onClick={onCopyTsv}
        className="flex w-full items-center gap-2.5 px-3 py-1.5 text-left hover:bg-zinc-800 whitespace-nowrap"
      >
        <MicrosoftExcelLogo size={14} className="shrink-0 text-zinc-400" />
        Tab-delimited (Excel)
      </button>
      <button
        onClick={onCopyJson}
        className="flex w-full items-center gap-2.5 px-3 py-1.5 text-left hover:bg-zinc-800 whitespace-nowrap"
      >
        <BracketsCurly size={14} className="shrink-0 text-zinc-400" />
        JSON
      </button>
    </div>,
    document.body
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
  canOpenForm,
  onOpenForm,
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
  canOpenForm: boolean;
  onOpenForm: () => void;
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
      {canOpenForm && (
        <>
          <button
            onClick={onOpenForm}
            className="flex w-full items-center gap-2.5 px-3 py-1.5 text-left text-zinc-100 hover:bg-zinc-800 whitespace-nowrap"
          >
            <Article size={14} className="shrink-0 text-emerald-400" />
            Form View
          </button>
          {(canDuplicate || canDelete || canCopy || canCopyResult) && (
            <div className="my-1 border-t border-zinc-800" />
          )}
        </>
      )}
      {canDuplicate && (
        <button
          onClick={onDuplicate}
          className="flex w-full items-center gap-2.5 px-3 py-1.5 text-left text-emerald-200 hover:bg-emerald-950/50 whitespace-nowrap"
        >
          <Copy size={14} className="text-emerald-400 shrink-0" />
          Duplicate {count} row{count === 1 ? "" : "s"}
        </button>
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
  onAutoFitColumn,
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
  onAutoFitColumn: (index: number) => void;
  sort: SortSpec | null;
  filterByColumn: Map<string, ColumnFilter>;
  jsonDisplay: Record<string, string>;
  peekableColumns?: Set<string>;
  hasHiddenColumns: boolean;
  onColumnClick: (column: string, rect: DOMRect) => void;
  onColumnsButtonClick: (rect: DOMRect) => void;
}) {
  /** Any active filter — value/JSON filters or column visibility from the
   * eyeball menu — lights a 2px amber bar across the top of the header, so a
   * restored filtered view is impossible to miss. Complements — does not
   * replace — the amber highlight on each filtered control/header. */
  const anyFiltered =
    hasHiddenColumns ||
    filterByColumn.size > 0 ||
    Object.keys(jsonDisplay).length > 0;
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
              onAutoFit={() => onAutoFitColumn(i)}
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
  onAutoFit,
}: {
  onDelta: (delta: number) => void;
  onEnd: () => void;
  /** Double-click: size the column to its content. */
  onAutoFit: () => void;
}) {
  return (
    <div
      data-resize-handle
      title="Drag to resize · double-click to fit the content"
      onDoubleClick={(e) => {
        e.stopPropagation();
        onAutoFit();
      }}
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
  onCellMouseEnter,
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
  /** Extends a drag selection into this cell. */
  onCellMouseEnter: () => void;
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
  const hoverHelp = cellHelp ? helpHandlers(cellHelp) : null;
  return (
    <div
      style={{ width }}
      data-el="grid-cell"
      data-active-cell={isActive ? "true" : undefined}
      onMouseDown={onCellMouseDown}
      onMouseEnter={() => {
        onCellMouseEnter();
        hoverHelp?.onMouseEnter();
      }}
      onMouseLeave={hoverHelp?.onMouseLeave}
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

const cellKey = (rowIndex: number, column: string) =>
  `${rowIndex}\u0000${column}`;

/** Excel clipboard cells cannot contain literal tabs/newlines without changing
 * the pasted rectangle, so flatten them to spaces. */
function cellToTsv(value: unknown): string {
  return cellToText(value).replace(/[\t\r\n]+/g, " ");
}

function selectionTsv(rows: RowRecord[], selection: ResolvedCellRange): string {
  return selection.rows
    .map((rowIndex) => {
      const row = rows[rowIndex];
      return selection.columns
        .map((column) => cellToTsv(row?.[column]))
        .join("\t");
    })
    .join("\r\n");
}

function selectionJson(rows: RowRecord[], selection: ResolvedCellRange): string {
  const picked = selection.rows.map((rowIndex) => {
    const row = rows[rowIndex];
    return Object.fromEntries(
      selection.columns.map((column) => [column, row?.[column] ?? null])
    );
  });
  return JSON.stringify(picked, null, 2);
}

function cellToInsertValue(value: unknown): string | null {
  if (value === null || value === undefined) return null;
  return cellToText(value);
}

function isServerGenerated(column: ColumnInfo): boolean {
  const extra = column.extra?.toLowerCase() ?? "";
  return extra.includes("auto_increment") || extra.includes("generated");
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
