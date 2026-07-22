import {
  useEffect,
  useMemo,
  useRef,
  useState,
  type ComponentType,
} from "react";
import { createPortal } from "react-dom";
import {
  X,
  CircleNotch as Loader2,
  ArrowsClockwise as RefreshCw,
  CaretLeft as ChevronLeft,
  CaretRight as ChevronRight,
  CaretUp,
  CaretDown,
  Table as Table2,
  Database,
  ShareNetwork,
  Binoculars,
  PencilSimple,
  Code,
  ArrowSquareOut,
  WarningCircle as AlertCircle,
  GitDiff,
  BracketsCurly,
} from "@phosphor-icons/react";
import clsx from "clsx";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { emit } from "@tauri-apps/api/event";
import { useStore, isDesignerTabDirty } from "../state/store";
import type { DuplicateConflict } from "../state/store";
import { notifyError, notifySuccess } from "../state/notify";
import { helpHandlers } from "../state/help";
import { CloseTabConfirmDialog } from "./CloseTabConfirmDialog";
import { DataGrid } from "./DataGrid";
import { DatabaseView } from "./DatabaseView";
import { QueryView } from "./QueryView";
import { RelationsView } from "./RelationsView";
import { TableDesignerView } from "./TableDesignerView";
import { SchemaDiffView } from "./SchemaDiffView";
import { DatabaseDiffView } from "./DatabaseDiffView";
import { ExpandedPanel } from "./ExpandedPanel";
import { TableViewPresetMenu } from "./TableViewPresetMenu";
import { InsertRowDialog } from "./InsertRowDialog";
import { ImportJsonDialog } from "./ImportJsonDialog";
import { Tooltip } from "./Tooltip";
import appIconLarge from "../assets/app-icon-large.png";
import { ipc } from "../ipc";
import { useAnchoredPosition } from "../lib/useAnchoredPosition";
import type { PeekDescriptor, PeekSeed, Relation, RowsTab, Tab } from "../types";
import {
  relationTargets,
  peekableColumnsFor,
  cellToFilterValue,
  peekIdentity,
  openPeekIdentities,
  type RelationTarget,
} from "../lib/relations";
import {
  useRelatedExistence,
  relKey,
  checkRelatedExistence,
} from "../lib/relatedExistence";

const EMPTY_RELATIONS: Relation[] = [];

/** Short display title for a tab (window title when torn off, tab-bar primary). */
export function tabTitle(tab: Tab): string {
  switch (tab.kind) {
    case "database":
      return tab.database;
    case "relations":
      return "Relations";
    case "query":
      return "Query";
    case "create-table":
      return (
        tab.tableName.trim() ||
        (tab.mode === "edit" ? tab.originalName : "New table")
      );
    case "schema-diff":
      return tab.table === tab.right.table
        ? `Diff: ${tab.table}`
        : `Diff: ${tab.table} ⇄ ${tab.right.table}`;
    case "db-diff":
      return tab.database === tab.right.database
        ? `Diff: ${tab.database}`
        : `Diff: ${tab.database} ⇄ ${tab.right.database}`;
    default:
      return tab.table;
  }
}

export function Tabs() {
  const tabs = useStore((s) => s.tabs);
  const activeTabId = useStore((s) => s.activeTabId);
  const setActiveTab = useStore((s) => s.setActiveTab);
  const requestCloseTab = useStore((s) => s.requestCloseTab);
  const closeTab = useStore((s) => s.closeTab);
  const tabDropActive = useStore((s) => s.tabDropActive);

  const active = tabs.find((t) => t.id === activeTabId) ?? null;

  /** Publish the tab bar's on-screen rectangle (screen CSS px) so a torn-off
   * tab window can hit-test it for re-docking. Refreshed when the bar appears /
   * disappears and whenever this window moves or resizes. When there are no tabs
   * (the bar is hidden), accept drops on a band near the top of the window. */
  const barRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const publish = () => {
      const el = barRef.current;
      const rect = el
        ? (() => {
            const r = el.getBoundingClientRect();
            return {
              left: window.screenX + r.left,
              top: window.screenY + r.top,
              right: window.screenX + r.right,
              bottom: window.screenY + r.bottom,
            };
          })()
        : {
            left: window.screenX,
            top: window.screenY + 34,
            right: window.screenX + window.innerWidth,
            bottom: window.screenY + 74,
          };
      ipc.setTabstripRect(rect).catch(() => {});
    };
    publish();
    window.addEventListener("resize", publish);
    const w = getCurrentWindow();
    const moved = w.onMoved(publish);
    const resized = w.onResized(publish);
    return () => {
      window.removeEventListener("resize", publish);
      moved.then((f) => f());
      resized.then((f) => f());
    };
  }, [tabs.length]);

  /** Right-click tab menu. */
  const [tabMenu, setTabMenu] = useState<{
    tab: Tab;
    x: number;
    y: number;
  } | null>(null);

  /** Pop the tab out into its own window, then drop it from this window. The
   * window opens 50px shorter and narrower than the on-screen data grid (for a
   * query with no visible results, its empty-state pane instead), floored at
   * the torn-tab window's minimum size (`min_inner_size` in `open_tab_window`),
   * and centered over that measured element. Falls back to the tabs pane when
   * neither is rendered (e.g. tearing off a background tab). */
  const tearOff = (tab: Tab) => {
    const live = useStore.getState().tabs.find((t) => t.id === tab.id);
    if (!live) return;
    const MIN_W = 480;
    const MIN_H = 320;
    /* Size the window to the whole on-screen tab content (the main pane), a
       touch smaller, and center it over that region. Measuring the pane — not
       the inner data grid — keeps the height correct even when the Inspector
       panel is compressing the grid; the pane already spans editor + grid +
       inspector for every tab kind. */
    const pane = document.querySelector('[data-el="main-pane"]');
    const p = pane?.getBoundingClientRect();
    const width = Math.max(MIN_W, (p?.width ?? 1050) - 40);
    const height = Math.max(MIN_H, (p?.height ?? 730) - 40);
    const cx =
      window.screenX + (p ? p.left + p.width / 2 : window.innerWidth / 2);
    const cy =
      window.screenY + (p ? p.top + p.height / 2 : window.innerHeight / 2);
    ipc
      .openTabWindow(
        live,
        `${tabTitle(live)} - DB Sage`,
        Math.max(0, cx - width / 2),
        Math.max(0, cy - height / 2),
        width,
        height
      )
      .then(() => closeTab(tab.id))
      .catch((err) => notifyError(`Could not pop out the tab: ${String(err)}`));
  };

  return (
    <div className="w-full h-full flex flex-col bg-zinc-950 min-w-0">
      {tabs.length > 0 && (
      <div
        ref={barRef}
        data-el="tab-bar"
        className={clsx(
          "flex items-stretch bg-zinc-950 overflow-hidden",
          /* The bottom rail isn't on this bar — each tab (and the trailing
             spacer) draws its own bottom border, so the active query tab can
             leave a gap and merge into the context bar below it. */
          tabDropActive && "ring-1 ring-inset ring-accent-500/70 bg-accent-500/5"
        )}
      >
        <div className="flex-1 flex items-stretch overflow-x-auto">
        {tabs.map((tab) => {
            let primary: string;
            let prefix: string | null = null;
            let secondary: string;
            let Icon: ComponentType<{ size?: number; className?: string }>;
            let iconColor: string;
            let dirty = false;
            if (tab.kind === "database") {
              primary = tab.database;
              secondary = tab.profileName;
              Icon = Database;
              iconColor = "text-accent-400";
            } else if (tab.kind === "relations") {
              primary = "Relations";
              secondary = `${tab.profileName} / ${tab.database}`;
              Icon = ShareNetwork;
              iconColor = "text-violet-400";
            } else if (tab.kind === "query") {
              primary = "Query";
              secondary = `${tab.profileName} / ${tab.database}`;
              Icon = Code;
              iconColor = "text-emerald-400";
            } else if (tab.kind === "create-table") {
              const editing = tab.mode === "edit";
              if (editing) {
                prefix = "Edit Table";
                primary = tab.tableName.trim() || tab.originalName;
              } else {
                primary = tab.tableName.trim() || "New table";
              }
              secondary = `${tab.profileName} / ${tab.database}`;
              Icon = editing ? TableEditIcon : Table2;
              iconColor = "text-orange-400";
              dirty = isDesignerTabDirty(tab);
            } else if (tab.kind === "schema-diff") {
              prefix = "Diff";
              primary =
                tab.table === tab.right.table
                  ? tab.table
                  : `${tab.table} ⇄ ${tab.right.table}`;
              secondary =
                tab.profileId !== tab.right.profileId
                  ? `${tab.profileName} ⇄ ${tab.right.profileName}`
                  : tab.database !== tab.right.database
                    ? `${tab.database} ⇄ ${tab.right.database}`
                    : `${tab.profileName} / ${tab.database}`;
              Icon = GitDiff;
              iconColor = "text-amber-400";
            } else if (tab.kind === "db-diff") {
              prefix = "Diff";
              primary =
                tab.database === tab.right.database
                  ? tab.database
                  : `${tab.database} ⇄ ${tab.right.database}`;
              secondary =
                tab.profileId !== tab.right.profileId
                  ? `${tab.profileName} ⇄ ${tab.right.profileName}`
                  : tab.profileName;
              Icon = GitDiff;
              iconColor = "text-amber-400";
            } else {
              primary = tab.table;
              secondary = `${tab.profileName} / ${tab.database}`;
              Icon = Table2;
              iconColor = "text-emerald-400";
            }
            const tableComment =
              tab.kind === "rows" ? tab.tableComment?.trim() : undefined;
            const tabEl = (
              <div
                key={tab.id}
                data-el="tab"
                onClick={() => setActiveTab(tab.id)}
                onContextMenu={(e) => {
                  e.preventDefault();
                  setActiveTab(tab.id);
                  setTabMenu({ tab, x: e.clientX, y: e.clientY });
                }}
                className={clsx(
                  "group flex items-center gap-2 pl-3 pr-1.5 border-r border-r-zinc-800/60 cursor-pointer min-w-0 max-w-[260px] shrink-0",
                  tab.id === activeTabId
                    ? "bg-zinc-900 text-zinc-100"
                    : "text-zinc-400 hover:bg-zinc-900/50",
                  /* The active query tab breaks the rail so it flows into the
                     query context bar (same bg) directly below it; every other
                     tab keeps its bottom border. Side-specific colors so the
                     bottom border isn't overridden by the right border's color. */
                  tab.id === activeTabId && tab.kind === "query"
                    ? "border-b border-b-transparent"
                    : "border-b border-b-zinc-800/80"
                )}
              >
                <Icon
                  size={26}
                  className={clsx(
                    iconColor,
                    tab.id !== activeTabId && "opacity-60"
                  )}
                />
                <div className="min-w-0 flex flex-col leading-tight py-2.5">
                  <span
                    data-el="tab-title"
                    className="text-[13px] font-semibold mb-1 flex items-baseline min-w-0"
                  >
                    {prefix && (
                      <span className="text-[10px] text-zinc-500 font-normal uppercase mr-1 shrink-0">
                        {prefix}
                      </span>
                    )}
                    <span className="truncate">{primary}</span>
                    {dirty && (
                      <span
                        data-el="tab-dirty"
                        className="ml-0.5 shrink-0 text-red-500"
                        title="Unsaved changes"
                      >
                        *
                      </span>
                    )}
                  </span>
                  <span data-el="tab-subtitle" className="text-[10px] text-zinc-500 truncate">
                    {secondary}
                  </span>
                </div>
                {tab.kind !== "database" && (
                  <button
                    data-el="tab-popout-btn"
                    onClick={(e) => {
                      e.stopPropagation();
                      tearOff(tab);
                    }}
                    className="ml-1 p-0.5 rounded text-zinc-500 hover:text-accent-300 hover:bg-zinc-800 opacity-0 group-hover:opacity-100 transition"
                    aria-label="Open in new window"
                    title="Open in new window"
                  >
                    <ArrowSquareOut size={14} />
                  </button>
                )}
                <button
                  data-el="tab-close-btn"
                  onClick={(e) => {
                    e.stopPropagation();
                    requestCloseTab(tab.id);
                  }}
                  className="ml-0.5 p-0.5 rounded text-zinc-500 hover:text-zinc-100 hover:bg-zinc-800 opacity-0 group-hover:opacity-100 transition"
                  aria-label="Close tab"
                >
                  <X size={14} />
                </button>
              </div>
            );
            if (!tableComment) return tabEl;
            return (
              <Tooltip
                key={tab.id}
                className="flex min-w-0 shrink-0"
                maxWidth={420}
                label={
                  <div>
                    <div className="text-[11px] font-mono text-accent-400 mb-1">
                      {tab.kind === "rows" ? tab.table : ""}
                    </div>
                    <div className="whitespace-pre-wrap">{tableComment}</div>
                  </div>
                }
              >
                {tabEl}
              </Tooltip>
            );
        })}
        {/* Fills the strip to the right of the last tab and carries the bottom
            rail across the empty space. */}
        <div className="flex-1 border-b border-zinc-800/80" />
        </div>
      </div>
      )}

      <div className="flex-1 min-h-0 flex flex-col">
        {active ? <TabBody tab={active} /> : <EmptyState />}
      </div>

      {tabMenu && (
        <TabContextMenu
          x={tabMenu.x}
          y={tabMenu.y}
          canPopOut={tabMenu.tab.kind !== "database"}
          onPopOut={() => tearOff(tabMenu.tab)}
          onClose={() => requestCloseTab(tabMenu.tab.id)}
          onDismiss={() => setTabMenu(null)}
        />
      )}

      <CloseTabConfirmDialog />
    </div>
  );
}

/** Right-click menu for a tab: pop it out into its own window, or close it. */
function TabContextMenu({
  x,
  y,
  canPopOut,
  onPopOut,
  onClose,
  onDismiss,
}: {
  x: number;
  y: number;
  canPopOut: boolean;
  onPopOut: () => void;
  onClose: () => void;
  onDismiss: () => void;
}) {
  useEffect(() => {
    const down = () => onDismiss();
    const key = (e: KeyboardEvent) => {
      if (e.key === "Escape") onDismiss();
    };
    window.addEventListener("mousedown", down);
    window.addEventListener("keydown", key);
    return () => {
      window.removeEventListener("mousedown", down);
      window.removeEventListener("keydown", key);
    };
  }, [onDismiss]);

  const { ref, style } = useAnchoredPosition(x, y);
  return createPortal(
    <div
      ref={ref}
      data-el="tab-context-menu"
      style={style}
      onMouseDown={(e) => e.stopPropagation()}
      className="dbs-context-menu fixed z-50 w-max rounded border border-zinc-700 bg-zinc-900/95 backdrop-blur-sm py-1 shadow-xl shadow-black/60 text-zinc-200"
    >
      {canPopOut && (
        <button
          onClick={() => {
            onDismiss();
            onPopOut();
          }}
          className="flex w-full items-center gap-2.5 px-3 py-1.5 text-left text-[12px] hover:bg-zinc-800 whitespace-nowrap"
        >
          <ArrowSquareOut size={14} className="text-accent-400 shrink-0" />
          Open in New Window
        </button>
      )}
      <button
        onClick={() => {
          onDismiss();
          onClose();
        }}
        className="flex w-full items-center gap-2.5 px-3 py-1.5 text-left text-[12px] hover:bg-zinc-800 whitespace-nowrap"
      >
        <X size={14} className="text-zinc-400 shrink-0" />
        Close Tab
      </button>
    </div>,
    document.body
  );
}

export function TabBody({ tab }: { tab: Tab }) {
  if (tab.kind === "database") {
    return <DatabaseView tab={tab} />;
  }
  if (tab.kind === "relations") {
    return <RelationsView tab={tab} />;
  }
  if (tab.kind === "query") {
    return <QueryView tab={tab} />;
  }
  if (tab.kind === "create-table") {
    return <TableDesignerView tab={tab} />;
  }
  if (tab.kind === "schema-diff") {
    return <SchemaDiffView tab={tab} />;
  }
  if (tab.kind === "db-diff") {
    return <DatabaseDiffView tab={tab} />;
  }
  return <RowsTabBody tab={tab} />;
}

function RowsTabBody({ tab }: { tab: RowsTab }) {
  const setTabPage = useStore((s) => s.setTabPage);
  const setPageSize = useStore((s) => s.setPageSize);
  const refreshTab = useStore((s) => s.refreshTab);
  const countExactRows = useStore((s) => s.countExactRows);
  const setRowsSort = useStore((s) => s.setRowsSort);
  const setRowsFilter = useStore((s) => s.setRowsFilter);
  const setHiddenColumns = useStore((s) => s.setHiddenColumns);
  const setJsonDisplay = useStore((s) => s.setJsonDisplay);
  const setColumnWidths = useStore((s) => s.setColumnWidths);
  const saveTablePreset = useStore((s) => s.saveTablePreset);
  const applyTablePreset = useStore((s) => s.applyTablePreset);
  const deleteTablePreset = useStore((s) => s.deleteTablePreset);
  const clearTableView = useStore((s) => s.clearTableView);
  const updateCell = useStore((s) => s.updateCell);
  const insertRow = useStore((s) => s.insertRow);
  const deleteRows = useStore((s) => s.deleteRows);
  const duplicateRows = useStore((s) => s.duplicateRows);
  const openTableEditor = useStore((s) => s.openTableEditor);
  const loadRelations = useStore((s) => s.loadRelations);
  const setRowsActiveCell = useStore((s) => s.setRowsActiveCell);
  const setRowsSelection = useStore((s) => s.setRowsSelection);
  const relations =
    useStore((s) => s.relations[`${tab.profileId}::${tab.database}`]) ??
    EMPTY_RELATIONS;

  /** Selected cell lives in the store so it survives tab switches. */
  const activeCell = tab.activeCell;
  const setActiveCell = (cell: { rowIndex: number; column: string } | null) =>
    setRowsActiveCell(tab.id, cell);
  /** Inspector visibility lives on the tab (not component state) so tearing
   * the tab into its own window — or docking it back — keeps whatever state it
   * had. Tabs predating the field fall back to open-in-main, closed elsewhere. */
  const setTabInspectorOpen = useStore((s) => s.setTabInspectorOpen);
  const expanded = tab.inspectorOpen ?? getCurrentWindow().label === "main";
  const setExpanded = (open: boolean) => setTabInspectorOpen(tab.id, open);
  const [insertOpen, setInsertOpen] = useState(false);
  const [importOpen, setImportOpen] = useState(false);
  /** Rows whose duplicate hit a unique/PK conflict, awaiting edit-and-retry.
   * Shown one at a time; submitting or cancelling advances to the next. */
  const [dupQueue, setDupQueue] = useState<DuplicateConflict[]>([]);

  const handleDuplicateRows = async (indices: number[]) => {
    const { okCount, conflicts, errors } = await duplicateRows(tab.id, indices);
    if (okCount > 0) {
      notifySuccess(
        `Duplicated ${okCount} row${okCount === 1 ? "" : "s"} in "${tab.table}"`
      );
    }
    for (const message of errors) {
      notifyError(`Couldn't duplicate a row: ${message}`);
    }
    if (conflicts.length > 0) setDupQueue(conflicts);
  };
  const [picker, setPicker] = useState<{
    x: number;
    y: number;
    matches: { table: string; column: string }[];
    /** The cell the menu is anchored to, so re-clicking it toggles closed. */
    cell: { rowIndex: number; column: string };
  } | null>(null);
  const pickerRef = useRef<HTMLDivElement>(null);
  const { style: pickerStyle } = useAnchoredPosition(
    picker?.x ?? 0,
    picker?.y ?? 0,
    8,
    pickerRef
  );

  /** The relation menu opens as a side effect of selecting a cell, so it must
   * never block interaction the way a backdrop would (the next cell click has
   * to land). Dismissal is listener-based instead: mousedown outside the menu,
   * any key (incl. arrow-key cell navigation), or scrolling the grid away. */
  useEffect(() => {
    if (!picker) return;
    const close = () => setPicker(null);
    const onDown = (e: MouseEvent) => {
      /* Grid-cell mousedowns are arbitrated by onCellMenu on the subsequent
         click (open / move / same-cell toggle). Closing here too would defeat
         the toggle: the menu would close on mousedown and reopen on click. */
      if ((e.target as HTMLElement).closest('[data-el="grid-cell"]')) return;
      if (!pickerRef.current?.contains(e.target as Node)) close();
    };
    window.addEventListener("mousedown", onDown);
    window.addEventListener("keydown", close);
    window.addEventListener("scroll", close, true);
    return () => {
      window.removeEventListener("mousedown", onDown);
      window.removeEventListener("keydown", close);
      window.removeEventListener("scroll", close, true);
    };
  }, [picker]);

  useEffect(() => {
    loadRelations(tab.profileId, tab.database).catch(() => {});
  }, [tab.profileId, tab.database, loadRelations]);

  /** Drop the active cell when the row set actually changes (page / refresh /
   * sort / filter), but NOT on remount — so switching tabs keeps the selection.
   * A ref tracks the rows identity seen on the previous render. */
  const seenRowsRef = useRef(tab.data?.rows);
  useEffect(() => {
    if (seenRowsRef.current !== tab.data?.rows) {
      seenRowsRef.current = tab.data?.rows;
      setRowsActiveCell(tab.id, null);
    }
  }, [tab.data?.rows, tab.id, setRowsActiveCell]);

  /** Esc collapses the expanded inspector panel. */
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      if (expanded) setExpanded(false);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [expanded]);

  const estimateTotal = tab.data?.total ?? null;
  const displayTotal = tab.exactTotal ?? estimateTotal;
  const isExactTotal = tab.exactTotal != null;
  const totalPages =
    displayTotal != null
      ? Math.max(1, Math.ceil(displayTotal / tab.pageSize))
      : null;
  /** A short page (fewer rows than the limit) is the last page — there's no next. */
  const atLastPage = (tab.data?.rows.length ?? 0) < tab.pageSize;

  const activeColumn =
    activeCell && tab.data
      ? tab.data.columns.find((c) => c.name === activeCell.column) ?? null
      : null;
  const activeValue =
    activeCell && tab.data
      ? tab.data.rows[activeCell.rowIndex]?.[activeCell.column]
      : undefined;
  const activeRowOrdinal =
    activeCell && tab.data ? tab.data.offset + activeCell.rowIndex + 1 : null;
  const hasPrimaryKey =
    tab.data?.columns.some((c) => c.key === "PRI") ?? false;

  /**
   * Persist an edit made from the expanded panel, then re-select the same cell.
   * updateCell reloads the page (new rows identity), which the effect above
   * uses to clear activeCell — re-selecting on the next frame keeps the panel
   * showing the freshly-saved value instead of going blank.
   */
  const saveActiveCell = async (newValue: string | null) => {
    if (!activeCell) return;
    const cell = activeCell;
    await updateCell(tab.id, cell.rowIndex, cell.column, newValue);
    requestAnimationFrame(() => setActiveCell(cell));
  };

  const peekValue = cellToFilterValue(activeValue);

  /* Broadcast the selected source value so open peek windows launched from this
     table+column live-follow the selection across windows. */
  useEffect(() => {
    if (!activeColumn || peekValue == null) return;
    emit("dbsage://peek-follow", {
      profileId: tab.profileId,
      database: tab.database,
      sourceTable: tab.table,
      sourceColumn: activeColumn.name,
      value: peekValue,
    });
  }, [activeColumn?.name, peekValue, tab.table, tab.profileId, tab.database]);

  const relMatches = useMemo(
    () =>
      activeColumn
        ? relationTargets(relations, tab.table, activeColumn.name)
        : [],
    [relations, tab.table, activeColumn]
  );
  const hasRelation = !!activeCell && peekValue != null && relMatches.length > 0;
  /** Mark relation targets that have no matching rows, so the dropdown disables
   * them. While the check is in flight items stay enabled (optimistic). */
  const { exists: relExists } = useRelatedExistence(
    tab.profileId,
    tab.database,
    relMatches,
    hasRelation ? peekValue : null
  );
  const peekableColumns = useMemo(
    () => peekableColumnsFor(relations, tab.table),
    [relations, tab.table]
  );

  /** Launch a peek for a relation in its own OS window, placed just below the
   * active cell (screen px). The window persists until closed manually. */
  const openPeek = (t: RelationTarget) => {
    if (peekValue == null || !activeColumn) return;
    const cell = document
      .querySelector('[data-el="main-pane"] [data-active-cell]')
      ?.getBoundingClientRect();
    const x = window.screenX + (cell ? cell.left : 80);
    const y = window.screenY + (cell ? cell.bottom + 6 : 120);
    const seed: PeekSeed = {
      profileId: tab.profileId,
      profileName: tab.profileName,
      database: tab.database,
      target: { table: t.table, column: t.column, value: peekValue },
      sourceTable: tab.table,
      sourceColumn: activeColumn.name,
    };
    ipc
      .openPeekWindow(seed, x, y, 900, 440)
      .catch((e) => notifyError(`Could not open peek window: ${String(e)}`));
  };

  /** Single-clicking a relation cell selects it (unchanged) AND drops the
   * relation menu just below it; clicking the same cell again toggles it
   * closed. Clicking any non-relation (or NULL) cell dismisses the menu; a
   * double-click (edit begins) reports null and dismisses too. Selection
   * itself never opens a peek — the menu is the chooser. */
  const onCellMenu = async (
    cell: { rowIndex: number; column: string; rect: DOMRect } | null
  ) => {
    if (!cell || !tab.data) {
      setPicker(null);
      return;
    }
    if (
      picker &&
      picker.cell.rowIndex === cell.rowIndex &&
      picker.cell.column === cell.column
    ) {
      setPicker(null);
      return;
    }
    const value = cellToFilterValue(tab.data.rows[cell.rowIndex]?.[cell.column]);
    const matches = relationTargets(relations, tab.table, cell.column);
    if (value == null || matches.length === 0) {
      setPicker(null);
      return;
    }
    /* Drop targets that already have a peek window open — re-picking them would
       just refocus the existing window. If that leaves nothing, show no menu. */
    let open = new Set<string>();
    try {
      open = openPeekIdentities(await ipc.listOpenPeeks<PeekDescriptor>());
    } catch {
      /* If the lookup fails, fall back to showing every target. */
    }
    const visible = matches.filter(
      (m) =>
        !open.has(
          peekIdentity(
            tab.profileId,
            tab.database,
            tab.table,
            cell.column,
            m.table,
            m.column
          )
        )
    );
    if (visible.length === 0) {
      setPicker(null);
      return;
    }
    /* Skip the menu if every remaining target is disabled (no related rows) —
       leaving only greyed-out items. Disabled items still show when at least one
       target is actionable. */
    const existence = await checkRelatedExistence(
      tab.profileId,
      tab.database,
      visible,
      value
    );
    if (visible.every((m) => existence[relKey(m)] === false)) {
      setPicker(null);
      return;
    }
    setPicker({
      x: cell.rect.left,
      y: cell.rect.bottom + 4,
      matches: visible,
      cell: { rowIndex: cell.rowIndex, column: cell.column },
    });
  };

  return (
    <div className="flex-1 flex flex-col min-h-0">
      <div
        data-el="rows-toolbar"
        data-toolbar="rows"
        className="dbs-toolbar h-9 pl-1 pr-1 border-b border-zinc-800/60 flex items-center gap-1 text-zinc-400"
      >
        <button
          data-el="edit-table-btn"
          onClick={() =>
            openTableEditor(
              tab.profileId,
              tab.profileName,
              tab.database,
              tab.table
            ).catch((e) =>
              notifyError(
                `Could not open "${tab.table}" for editing: ${String(e)}`
              )
            )
          }
          className="inline-flex items-center gap-1.5 px-2 py-1 rounded text-[11px] font-semibold bg-orange-400 text-orange-950 hover:bg-orange-300 transition-colors"
          {...helpHandlers("Edit this table's structure")}
        >
          <PencilSimple size={17} />
          Edit Table
        </button>

        <button
          data-el="add-row-btn"
          onClick={() => setInsertOpen(true)}
          className="inline-flex items-center gap-1.5 px-2 py-1 rounded text-[11px] font-semibold bg-emerald-500 text-emerald-950 hover:bg-emerald-400 transition-colors"
          {...helpHandlers("Insert a new row")}
        >
          <span className="relative -top-px text-[16px] leading-none">+</span> Row
        </button>

        <TableViewPresetMenu
          presets={tab.presets}
          activeName={tab.activePreset}
          autoOpenKey={`${tab.id}:${tab.openSeq ?? ""}`}
          onApply={(name) => applyTablePreset(tab.id, name)}
          onSave={(name) => saveTablePreset(tab.id, name)}
          onDelete={(name) => deleteTablePreset(tab.id, name)}
          onClear={() => clearTableView(tab.id)}
        />

        <button
          data-el="refresh-btn"
          onClick={() => refreshTab(tab.id)}
          disabled={tab.loading}
          aria-label="Refresh"
          {...helpHandlers("Refresh the row set")}
          className="inline-flex items-center justify-center h-7 w-7 rounded transition-colors bg-zinc-800 text-zinc-300 hover:bg-zinc-700 hover:text-zinc-100 disabled:opacity-40 disabled:hover:bg-zinc-800"
        >
          {tab.loading ? (
            <Loader2 size={15} className="animate-spin" />
          ) : (
            <RefreshCw size={15} />
          )}
        </button>

        <button
          data-el="import-json-btn"
          onClick={() => setImportOpen(true)}
          className="ml-auto inline-flex items-center gap-1.5 px-2 py-1 rounded text-[11px] font-semibold transition-colors bg-zinc-800 hover:bg-zinc-700 text-emerald-300"
          {...helpHandlers("Import rows from a JSON file")}
        >
          <BracketsCurly size={15} />
          Import
        </button>

        <button
          data-el="expanded-toggle-btn"
          onClick={() => setExpanded(!expanded)}
          className={clsx(
            "inline-flex items-center gap-1.5 px-2 py-1 rounded text-[11px] font-semibold transition-colors bg-zinc-800 hover:bg-zinc-700",
            expanded ? "text-emerald-300" : "text-zinc-500 hover:text-zinc-400"
          )}
          {...helpHandlers("Toggle the Inspector panel")}
        >
          <Binoculars size={17} />
          Inspector
        </button>
      </div>


      {tab.error && (
        <div className="px-3 py-2 bg-rose-950/40 border-b border-rose-900/60 text-rose-300 text-[11px] flex items-start gap-2">
          <AlertCircle size={14} className="mt-0.5 shrink-0" />
          <span className="break-words">{tab.error}</span>
        </div>
      )}

      {tab.loading && !tab.data ? (
        <div className="flex-1 flex items-center justify-center text-zinc-500 text-xs gap-2">
          <Loader2 size={16} className="animate-spin" /> Loading rows…
        </div>
      ) : tab.data ? (
        <DataGrid
          /* Keyed by tab so switching to (or docking back) another rows tab
             remounts the grid — that's what re-runs the selection seed from
             `tab.selectedRows`. Without it, React reuses one grid instance
             across same-kind tab switches and the seed (a useState initializer)
             never re-fires. */
          key={tab.id}
          columns={tab.data.columns}
          rows={tab.data.rows}
          offset={tab.data.offset}
          sort={tab.sort}
          filters={tab.filters}
          hiddenColumns={tab.hiddenColumns}
          jsonDisplay={tab.jsonDisplay}
          columnWidths={tab.columnWidths}
          copyTarget={{ database: tab.database, table: tab.table }}
          peekableColumns={peekableColumns}
          activeCell={activeCell}
          clearActiveCellOnRowSelect
          initialSelectedRows={tab.selectedRows}
          onSelectionChange={(indices) => setRowsSelection(tab.id, indices)}
          onActiveCellChange={setActiveCell}
          onCellMenu={onCellMenu}
          onColumnWidthsChange={(w) => setColumnWidths(tab.id, w)}
          onSortChange={(sort) => setRowsSort(tab.id, sort)}
          onFilterChange={(column, filter) =>
            setRowsFilter(tab.id, column, filter)
          }
          onHiddenColumnsChange={(hidden) => setHiddenColumns(tab.id, hidden)}
          onJsonShow={(column, path) => setJsonDisplay(tab.id, column, path)}
          onCellEdit={(rowIndex, column, value) =>
            updateCell(tab.id, rowIndex, column, value)
          }
          onDeleteRows={hasPrimaryKey ? (indices) => deleteRows(tab.id, indices) : undefined}
          onDuplicateRows={hasPrimaryKey ? handleDuplicateRows : undefined}
        />
      ) : (
        <div className="flex-1" />
      )}

      <div data-el="rows-pager" className="h-8 pl-1 pr-3 border-t border-zinc-800/60 flex items-center gap-1 text-[11px] text-zinc-400 bg-zinc-950">
        <button
          data-el="prev-page-btn"
          className="inline-flex items-center gap-1.5 px-2 py-1 rounded text-[11px] font-semibold transition-colors bg-zinc-800 text-zinc-300 hover:bg-zinc-700 hover:text-zinc-100 disabled:opacity-40 disabled:hover:bg-zinc-800"
          onClick={() => setTabPage(tab.id, tab.page - 1)}
          disabled={tab.page <= 1 || tab.loading}
        >
          <ChevronLeft size={15} /> Prev
        </button>
        <button
          data-el="next-page-btn"
          className="inline-flex items-center gap-1.5 px-2 py-1 rounded text-[11px] font-semibold transition-colors bg-zinc-800 text-zinc-300 hover:bg-zinc-700 hover:text-zinc-100 disabled:opacity-40 disabled:hover:bg-zinc-800"
          onClick={() => setTabPage(tab.id, tab.page + 1)}
          disabled={
            tab.loading ||
            atLastPage ||
            (isExactTotal && totalPages != null && tab.page >= totalPages)
          }
        >
          Next <ChevronRight size={15} />
        </button>

        <div className="ml-2 flex items-center gap-1.5">
          <span>page</span>
          <PageInput
            page={tab.page}
            maxPage={isExactTotal ? totalPages : null}
            disabled={tab.loading}
            onCommit={(p) => setTabPage(tab.id, p)}
          />
          <span>of</span>
          <span className="font-mono text-zinc-300">
            {totalPages == null ? "?" : `${isExactTotal ? "" : "~"}${totalPages}`}
          </span>
        </div>

        <PageSizeDropup
          value={tab.pageSize}
          disabled={tab.loading}
          onChange={(n) => setPageSize(tab.id, n)}
        />

        {tab.data && (
          <span className="ml-auto inline-flex items-center gap-1.5">
            <span>
              <span className="text-zinc-200">{tab.data.rows.length}</span> rows
              {displayTotal != null ? (
                <>
                  {" "}
                  of{" "}
                  <span className="text-zinc-200">
                    {isExactTotal ? "" : "~"}
                    {displayTotal.toLocaleString()}
                  </span>
                </>
              ) : (
                <> of <span className="text-zinc-500">?</span></>
              )}
            </span>
            {!isExactTotal && (
              <ExactCountButton onCount={() => countExactRows(tab.id)} />
            )}
          </span>
        )}

      </div>

      {expanded && (
        <ExpandedPanel
          column={activeColumn}
          value={activeValue}
          rowOrdinal={activeRowOrdinal}
          editable={hasPrimaryKey}
          onSave={activeCell ? saveActiveCell : undefined}
          onClose={() => setExpanded(false)}
        />
      )}

      {insertOpen && (
        <InsertRowDialog
          profileId={tab.profileId}
          database={tab.database}
          table={tab.table}
          onSubmit={async (values) => {
            await insertRow(tab.id, values);
            notifySuccess(`Inserted a row into "${tab.table}"`);
          }}
          onClose={() => setInsertOpen(false)}
        />
      )}

      {importOpen && (
        <ImportJsonDialog
          profileId={tab.profileId}
          database={tab.database}
          table={tab.table}
          onClose={() => setImportOpen(false)}
          onImported={() => refreshTab(tab.id)}
        />
      )}

      {dupQueue.length > 0 && (
        <InsertRowDialog
          key={dupQueue.length}
          profileId={tab.profileId}
          database={tab.database}
          table={tab.table}
          heading={
            dupQueue.length > 1
              ? `Duplicate row (${dupQueue.length} conflicts left)`
              : "Duplicate row"
          }
          submitText="Insert copy"
          seed={dupQueue[0].seed}
          validate={async (values) => {
            const conflicts = await ipc.checkRowConflicts({
              profileId: tab.profileId,
              database: tab.database,
              table: tab.table,
              values,
            });
            if (conflicts.length === 0) return null;
            const columns = conflicts.flatMap((c) => c.columns);
            const groups = conflicts.map((c) =>
              c.columns.length === 1
                ? `"${c.columns[0]}"`
                : `(${c.columns.map((x) => `"${x}"`).join(", ")})`
            );
            const message =
              `A row already exists with the same ${groups.join(" and ")}. ` +
              `Change at least one highlighted value${
                conflicts.length > 1 ? " in each group" : ""
              } to insert a copy.`;
            return { columns, message };
          }}
          onSubmit={async (values) => {
            await insertRow(tab.id, values);
            notifySuccess(`Duplicated a row into "${tab.table}"`);
          }}
          onClose={() => setDupQueue((q) => q.slice(1))}
          onAbort={
            dupQueue.length > 1 ? () => setDupQueue([]) : undefined
          }
        />
      )}

      {picker &&
        createPortal(
          <div
            ref={pickerRef}
            data-el="related-picker"
            style={pickerStyle}
            className="dbs-context-menu fixed z-50 w-max rounded border border-zinc-700 bg-zinc-900/95 backdrop-blur-sm py-1 shadow-xl shadow-black/60 text-zinc-200"
          >
            <div className="px-3 py-1 text-[10px] uppercase tracking-wide text-zinc-500">
              Peek into
            </div>
            {picker.matches.map((m) => {
              const empty = relExists[relKey(m)] === false;
              return (
                <button
                  key={`${m.table}::${m.column}`}
                  disabled={empty}
                  onClick={() => {
                    setPicker(null);
                    openPeek(m);
                  }}
                  {...(empty
                    ? helpHandlers(`No related rows in ${m.table}`)
                    : {})}
                  className={clsx(
                    "flex w-full items-center gap-1 px-3 py-1.5 text-left text-[12px] whitespace-nowrap",
                    empty ? "cursor-not-allowed opacity-40" : "hover:bg-zinc-800"
                  )}
                >
                  <span className="font-medium text-zinc-100">{m.table}</span>
                  <span className="font-mono text-zinc-500">.{m.column}</span>
                </button>
              );
            })}
          </div>,
          document.body
        )}
    </div>
  );
}

function PageInput({
  page,
  maxPage,
  disabled,
  onCommit,
}: {
  page: number;
  maxPage: number | null;
  disabled: boolean;
  onCommit: (page: number) => void;
}) {
  const [val, setVal] = useState(String(page));
  useEffect(() => setVal(String(page)), [page]);

  const commit = () => {
    const n = parseInt(val, 10);
    if (Number.isNaN(n)) {
      setVal(String(page));
      return;
    }
    let next = Math.max(1, n);
    if (maxPage != null) next = Math.min(next, maxPage);
    if (next === page) setVal(String(page));
    else onCommit(next);
  };

  return (
    <input
      data-el="page-input"
      value={val}
      disabled={disabled}
      onChange={(e) => setVal(e.target.value.replace(/[^0-9]/g, ""))}
      onFocus={(e) => e.currentTarget.select()}
      onKeyDown={(e) => {
        if (e.key === "Enter") {
          e.preventDefault();
          commit();
        }
      }}
      onBlur={commit}
      className="w-12 text-center bg-zinc-900 border border-zinc-800 rounded px-1 py-0.5 font-mono text-zinc-200 focus:border-accent-500 outline-none disabled:opacity-50"
    />
  );
}

function ExactCountButton({ onCount }: { onCount: () => Promise<void> }) {
  const [loading, setLoading] = useState(false);
  return (
    <button
      data-el="exact-count-btn"
      disabled={loading}
      onClick={async () => {
        setLoading(true);
        try {
          await onCount();
        } catch (e) {
          alert(`Count failed: ${String(e)}`);
        } finally {
          setLoading(false);
        }
      }}
      {...helpHandlers("Run an exact COUNT(*) — may be slow on very large tables")}
      className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-accent-400 hover:bg-zinc-800 hover:text-accent-300 disabled:opacity-50"
    >
      {loading ? <Loader2 size={11} className="animate-spin" /> : null}
      {loading ? "counting…" : "= exact"}
    </button>
  );
}

const PAGE_SIZE_PRESETS = [10, 100, 1000];
const MAX_PAGE_SIZE = 100000;

function PageSizeDropup({
  value,
  disabled,
  onChange,
}: {
  value: number;
  disabled: boolean;
  onChange: (size: number) => void;
}) {
  const [open, setOpen] = useState(false);
  const [custom, setCustom] = useState("");
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    window.addEventListener("mousedown", onDown);
    return () => window.removeEventListener("mousedown", onDown);
  }, [open]);

  const apply = (n: number) => {
    onChange(Math.max(1, Math.min(MAX_PAGE_SIZE, n)));
    setOpen(false);
    setCustom("");
  };

  const applyCustom = () => {
    const n = parseInt(custom, 10);
    if (!Number.isNaN(n)) apply(n);
  };

  return (
    <div ref={ref} className="relative">
      <button
        data-el="page-size-btn"
        disabled={disabled}
        onClick={() => setOpen((o) => !o)}
        className="inline-flex items-center gap-1 px-2 py-0.5 rounded hover:bg-zinc-800 hover:text-zinc-100 disabled:opacity-30"
        {...helpHandlers("Rows per page")}
      >
        <span className="font-mono text-zinc-300">{value}</span>
        <span className="text-zinc-500">/ page</span>
        {open ? <CaretDown size={11} /> : <CaretUp size={11} />}
      </button>
      {open && (
        <div
          data-el="page-size-menu"
          className="absolute bottom-full left-0 mb-1 w-40 rounded border border-zinc-700 bg-zinc-900/95 backdrop-blur-sm py-1 shadow-xl shadow-black/60"
        >
          {PAGE_SIZE_PRESETS.map((p) => (
            <button
              key={p}
              onClick={() => apply(p)}
              className={clsx(
                "w-full text-left px-3 py-1.5 hover:bg-zinc-800 font-mono",
                p === value ? "text-accent-300" : "text-zinc-200"
              )}
            >
              {p} rows
            </button>
          ))}
          <div className="my-1 border-t border-zinc-800" />
          <div className="px-2 py-1 flex items-center gap-1">
            <input
              data-el="page-size-custom-input"
              value={custom}
              placeholder="Enter a number"
              onChange={(e) => setCustom(e.target.value.replace(/[^0-9]/g, ""))}
              onKeyDown={(e) => {
                if (e.key === "Enter") {
                  e.preventDefault();
                  applyCustom();
                }
              }}
              className="w-full min-w-0 bg-zinc-950 border border-zinc-700 rounded px-1.5 py-0.5 font-mono text-zinc-100 outline-none focus:border-accent-500"
            />
            <button
              onClick={applyCustom}
              disabled={!custom}
              className="px-2 py-0.5 rounded bg-accent-500 text-[#042f2e] font-semibold disabled:opacity-40"
            >
              Set
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

/** "Edit table" glyph: the table icon with a small pencil badge at its corner.
 * Distinguishes an edit-table tab from a new-table tab (plain Table icon). */
function TableEditIcon({
  size = 24,
  className,
}: {
  size?: number;
  className?: string;
}) {
  return (
    <span
      className={clsx("relative inline-flex shrink-0", className)}
      style={{ width: size, height: size }}
    >
      <Table2 size={size} />
      <PencilSimple
        size={Math.round(size * 0.6)}
        weight="fill"
        className="absolute -bottom-0.5 -right-0.5"
      />
    </span>
  );
}

function EmptyState() {
  return (
    <div data-el="tabs-empty-state" className="flex-1 flex items-end justify-end p-6">
      <img
        src={appIconLarge}
        alt=""
        className="w-[120px] h-[120px] object-contain opacity-[0.08] select-none pointer-events-none"
      />
    </div>
  );
}
