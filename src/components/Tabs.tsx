import {
  useEffect,
  useMemo,
  useRef,
  useState,
  type ComponentType,
  type ReactNode,
} from "react";
import { createPortal } from "react-dom";
import { useDraggable, useDroppable } from "@dnd-kit/core";
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
  Funnel,
} from "@phosphor-icons/react";
import clsx from "clsx";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { emit, listen } from "@tauri-apps/api/event";
import { useStore, isDesignerTabDirty, peeksReachableFrom } from "../state/store";
import { PEEKS_CHANGED_EVENT } from "../lib/relatedExistence";
import { findSameRow } from "../lib/sameRow";
import { notifyError, notifySuccess } from "../state/notify";
import { helpHandlers } from "../state/help";
import { CloseTabConfirmDialog } from "./CloseTabConfirmDialog";
import { DataGrid } from "./DataGrid";
import { DatabaseView } from "./DatabaseView";
import { RelationEditDialog } from "./RelationEditDialog";
import { QueryView } from "./QueryView";
import { RelationsView } from "./RelationsView";
import { TableDesignerView } from "./TableDesignerView";
import { SchemaDiffView } from "./SchemaDiffView";
import { DatabaseDiffView } from "./DatabaseDiffView";
import { ExpandedPanel } from "./ExpandedPanel";
import { RelationsPanel } from "./RelationsPanel";
import { TableViewPresetMenu } from "./TableViewPresetMenu";
import { InsertRowDialog } from "./InsertRowDialog";
import { ImportJsonDialog } from "./ImportJsonDialog";
import { Tooltip } from "./Tooltip";
import appIconLarge from "../assets/app-icon-large.png";
import { ipc } from "../ipc";
import { useAnchoredPosition } from "../lib/useAnchoredPosition";
import type {
  CascadeTarget,
  PeekDescriptor,
  PeekSeed,
  Relation,
  RowsTab,
  Tab,
} from "../types";
import {
  peekableColumnsFor,
  cellToFilterValue,
  type RowRelationTarget,
} from "../lib/relations";
import { previewCascadeTargets } from "../lib/rowDelete";

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

/**
 * Render-prop wrapper that makes a tab both draggable (to reorder tabs) and a
 * drop target (the tab another tab lands on). Drops are handled by
 * `TabDndProvider` (source "tab" → `reorderTabs`).
 */
function TabReorderSlot({
  tabId,
  label,
  index,
  children,
}: {
  tabId: string;
  label: string;
  index: number;
  children: (p: {
    setNodeRef: (el: HTMLElement | null) => void;
    listeners: ReturnType<typeof useDraggable>["listeners"];
    dropEdge: "left" | "right" | null;
    isDragging: boolean;
  }) => ReactNode;
}) {
  const tabs = useStore((s) => s.tabs);
  const drag = useDraggable({
    id: `tab-drag:${tabId}`,
    data: { source: "tab", tabId, label },
  });
  const drop = useDroppable({
    id: `tab-drop:${tabId}`,
    data: { kind: "tab-slot", tabId },
  });
  const setNodeRef = (el: HTMLElement | null) => {
    drag.setNodeRef(el);
    drop.setNodeRef(el);
  };

  /* Show the insertion line on the edge the drop will land on: dragging right
     drops after this tab, dragging left drops before it (mirrors reorderTabs). */
  const draggedId =
    drop.active?.data.current?.source === "tab"
      ? (drop.active.data.current.tabId as string)
      : null;
  const draggedIndex = draggedId
    ? tabs.findIndex((t) => t.id === draggedId)
    : -1;
  const dropEdge: "left" | "right" | null =
    !drop.isOver || draggedIndex < 0 || draggedIndex === index
      ? null
      : draggedIndex < index
        ? "right"
        : "left";

  return (
    <>
      {children({
        setNodeRef,
        listeners: drag.listeners,
        dropEdge,
        isDragging: drag.isDragging,
      })}
    </>
  );
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
        {tabs.map((tab, index) => {
            let primary: string;
            let prefix: string | null = null;
            /* Connection and database sit on separate lines so each truncates
               on its own — a long connection name can't swallow the database. */
            let secondaryLines: string[];
            let Icon: ComponentType<{ size?: number; className?: string }>;
            let iconColor: string;
            let dirty = false;
            if (tab.kind === "database") {
              primary = tab.database;
              secondaryLines = [tab.profileName];
              Icon = Database;
              iconColor = "text-accent-400";
            } else if (tab.kind === "relations") {
              primary = "Relations";
              secondaryLines = [tab.profileName, tab.database];
              Icon = ShareNetwork;
              iconColor = "text-violet-400";
            } else if (tab.kind === "query") {
              primary = "Query";
              secondaryLines = [tab.profileName, tab.database];
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
              secondaryLines = [tab.profileName, tab.database];
              Icon = editing ? TableEditIcon : Table2;
              iconColor = "text-orange-400";
              dirty = isDesignerTabDirty(tab);
            } else if (tab.kind === "schema-diff") {
              prefix = "Diff";
              primary =
                tab.table === tab.right.table
                  ? tab.table
                  : `${tab.table} ⇄ ${tab.right.table}`;
              secondaryLines = [
                tab.profileId !== tab.right.profileId
                  ? `${tab.profileName} ⇄ ${tab.right.profileName}`
                  : tab.profileName,
                tab.database !== tab.right.database
                  ? `${tab.database} ⇄ ${tab.right.database}`
                  : tab.database,
              ];
              Icon = GitDiff;
              iconColor = "text-amber-400";
            } else if (tab.kind === "db-diff") {
              prefix = "Diff";
              primary =
                tab.database === tab.right.database
                  ? tab.database
                  : `${tab.database} ⇄ ${tab.right.database}`;
              secondaryLines = [
                tab.profileId !== tab.right.profileId
                  ? `${tab.profileName} ⇄ ${tab.right.profileName}`
                  : tab.profileName,
              ];
              Icon = GitDiff;
              iconColor = "text-amber-400";
            } else {
              primary = tab.table;
              secondaryLines = [tab.profileName, tab.database];
              Icon = Table2;
              iconColor = "text-emerald-400";
            }
            const tableComment =
              tab.kind === "rows" ? tab.tableComment?.trim() : undefined;
            const tabEl = (
              <TabReorderSlot
                key={tab.id}
                tabId={tab.id}
                label={tabTitle(tab)}
                index={index}
              >
                {({ setNodeRef, listeners, dropEdge, isDragging }) => (
              <div
                ref={setNodeRef}
                {...listeners}
                data-el="tab"
                onClick={() => setActiveTab(tab.id)}
                onContextMenu={(e) => {
                  e.preventDefault();
                  setActiveTab(tab.id);
                  setTabMenu({ tab, x: e.clientX, y: e.clientY });
                }}
                className={clsx(
                  "group relative flex items-center gap-2 pl-3 pr-1.5 border-r border-r-zinc-800/60 cursor-pointer min-w-0 max-w-[260px] shrink-0",
                  tab.id === activeTabId
                    ? "bg-zinc-900 text-zinc-100"
                    : "text-zinc-400 hover:bg-zinc-900/50",
                  /* The active query tab breaks the rail so it flows into the
                     query context bar (same bg) directly below it; every other
                     tab keeps its bottom border. Side-specific colors so the
                     bottom border isn't overridden by the right border's color. */
                  tab.id === activeTabId && tab.kind === "query"
                    ? "border-b border-b-transparent"
                    : "border-b border-b-zinc-800/80",
                  isDragging && "opacity-50"
                )}
              >
                {dropEdge && (
                  <div
                    className={clsx(
                      "pointer-events-none absolute top-0 bottom-0 z-10 w-0.5 bg-accent-400",
                      dropEdge === "left" ? "-left-px" : "-right-px"
                    )}
                  />
                )}
                <Icon
                  size={26}
                  className={clsx(
                    iconColor,
                    tab.id !== activeTabId && "opacity-60"
                  )}
                />
                <div className="min-w-0 flex flex-col leading-tight py-1.5">
                  <span
                    data-el="tab-title"
                    className="text-[13px] font-semibold mb-0.5 flex items-baseline min-w-0"
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
                  {secondaryLines.map((line, i) => (
                    <span
                      key={i}
                      data-el="tab-subtitle"
                      className={clsx(
                        "text-[10px] truncate",
                        /* First line is the connection → connection green;
                           second line is the database → database blue. */
                        i === 0 ? "text-lime-400" : "text-accent-400",
                        tab.id !== activeTabId && "opacity-60"
                      )}
                    >
                      {line}
                    </span>
                  ))}
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
                )}
              </TabReorderSlot>
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

/** A peek descriptor reduced to what a saved view compares: no window label,
 * no null/undefined fields, geometry rounded to whole pixels. */
function normalizePeek(p: PeekDescriptor): string {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(p)) {
    if (k === "label" || v == null) continue;
    out[k] = typeof v === "number" ? Math.round(v) : v;
  }
  return JSON.stringify(out, Object.keys(out).sort());
}

/** Whether the peeks on screen (reachable from `tab`) differ from the ones the
 * active saved view captured — a different set, a moved/resized window, or a
 * changed filter/sort/Inspector inside one. */
function samePeeks(live: PeekDescriptor[], saved: PeekDescriptor[]): boolean {
  const a = live.map(normalizePeek).sort();
  const b = saved.map(normalizePeek).sort();
  return a.length === b.length && a.every((x, i) => x === b[i]);
}

/** Table opens (`tabId:openSeq`) whose first cell was already auto-selected.
 * Module scope so a tab switch (which remounts the body) does not re-select. */
const autoSelectedTabs = new Set<string>();

/** Whether the tab's current setup differs from its active saved view (sort,
 * filters, hidden columns, JSON display, column widths, Relations panel). */
function isViewDirty(tab: RowsTab, relationsOpen: boolean): boolean {
  const setup = tab.presets.find((p) => p.name === tab.activePreset)?.setup;
  if (!setup) return false;
  const same = (a: unknown, b: unknown) =>
    JSON.stringify(a ?? null) === JSON.stringify(b ?? null);
  return (
    !same(tab.sort, setup.sort) ||
    !same(tab.filters, setup.filters) ||
    !same(tab.hiddenColumns, setup.hiddenColumns) ||
    !same(tab.jsonDisplay, setup.jsonDisplay) ||
    !same(tab.columnWidths, setup.columnWidths) ||
    (setup.relationsOpen != null && relationsOpen !== setup.relationsOpen)
  );
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
  const updateCells = useStore((s) => s.updateCells);
  const insertRow = useStore((s) => s.insertRow);
  const insertRows = useStore((s) => s.insertRows);
  const deleteRows = useStore((s) => s.deleteRows);
  const clearRowsFilters = useStore((s) => s.clearRowsFilters);
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
  /* Defaults until the user toggles them: Inspector closed; Relations panel
     open when the table has relations defined from it. */
  const expanded = tab.inspectorOpen ?? false;
  const setExpanded = (open: boolean) => setTabInspectorOpen(tab.id, open);
  const setTabRelationsOpen = useStore((s) => s.setTabRelationsOpen);
  const relationsOpen =
    tab.relationsOpen ?? relations.some((r) => r.fromTable === tab.table);
  const setRelationsOpen = (open: boolean) => setTabRelationsOpen(tab.id, open);
  const [insertOpen, setInsertOpen] = useState(false);
  const [importOpen, setImportOpen] = useState(false);
  /** The open relation dialog: an existing relation, or null for a new one
   * seeded from `column`. */
  /* Peek windows live outside this window: re-compare them with the active
     view's captured peeks whenever Rust reports a peek changed. */
  const [peeksDirty, setPeeksDirty] = useState(false);
  const activeSetup = tab.presets.find((p) => p.name === tab.activePreset)?.setup;
  useEffect(() => {
    if (!activeSetup) {
      setPeeksDirty(false);
      return;
    }
    let cancelled = false;
    const check = async () => {
      try {
        const open = await ipc.listOpenPeeks<PeekDescriptor>();
        if (cancelled) return;
        const live = peeksReachableFrom(open, tab);
        setPeeksDirty(!samePeeks(live, activeSetup.peeks ?? []));
      } catch {
        /* leave the flag as is */
      }
    };
    void check();
    const un = listen(PEEKS_CHANGED_EVENT, () => void check());
    return () => {
      cancelled = true;
      un.then((f) => f());
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeSetup, tab.profileId, tab.database, tab.table]);

  const [relDialog, setRelDialog] = useState<{
    relation: Relation | null;
    column: string;
  } | null>(null);

  useEffect(() => {
    loadRelations(tab.profileId, tab.database).catch(() => {});
  }, [tab.profileId, tab.database, loadRelations]);

  /** When the row set changes (page / refresh / sort / filter), follow the
   * selected row to its new position if it is still present (matched by
   * primary key, else by every cell), otherwise drop the selection. NOT on
   * remount — so switching tabs keeps the selection. A ref tracks the rows
   * identity seen on the previous render. */
  const seenRowsRef = useRef(tab.data?.rows);
  useEffect(() => {
    const rows = tab.data?.rows;
    if (seenRowsRef.current === rows) return;
    const oldRows = seenRowsRef.current;
    seenRowsRef.current = rows;
    const cell = tab.activeCell;
    if (!cell) return;
    const idx =
      rows && tab.data
        ? findSameRow(tab.data.columns, oldRows, cell.rowIndex, rows)
        : -1;
    setRowsActiveCell(
      tab.id,
      idx >= 0 && tab.data?.columns.some((c) => c.name === cell.column)
        ? { rowIndex: idx, column: cell.column }
        : null
    );
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tab.data?.rows, tab.id, setRowsActiveCell]);

  /* A table with relations defined from it starts with its first cell
     selected (first row, first visible column), so the Relations panel is
     active at once. Once per table open (`openSeq`), and only while nothing
     is selected. */
  useEffect(() => {
    const key = `${tab.id}:${tab.openSeq ?? ""}`;
    if (autoSelectedTabs.has(key)) return;
    if (!tab.data || tab.data.rows.length === 0) return;
    if (!relations.some((r) => r.fromTable === tab.table)) return;
    autoSelectedTabs.add(key);
    if (tab.activeCell || tab.selectedRows?.length) return;
    const column = tab.data.columns.find(
      (c) => !tab.hiddenColumns.includes(c.name)
    )?.name;
    if (column) setRowsActiveCell(tab.id, { rowIndex: 0, column });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tab.data, relations]);

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

  const activeRow =
    activeCell && tab.data ? tab.data.rows[activeCell.rowIndex] ?? null : null;
  /** The row the Relations panel describes: the active cell's, else the first
   * selected row (a row-header click clears the active cell). */
  const relationsRow =
    activeRow ??
    (tab.data && tab.selectedRows?.length
      ? tab.data.rows[tab.selectedRows[0]] ?? null
      : null);
  const peekableColumns = useMemo(
    () => peekableColumnsFor(relations, tab.table),
    [relations, tab.table]
  );

  /* Selecting any cell identifies its whole row. Broadcast every relation
     source value from that row so open peeks keep following even when the
     clicked cell itself is not a relation source column. */
  useEffect(() => {
    /* With no selected row (cleared, or filtered away) every peek is told
       to show nothing, so none stays open on a row that is no longer here. */
    for (const sourceColumn of peekableColumns) {
      const value = activeRow ? cellToFilterValue(activeRow[sourceColumn]) : null;
      emit("dbsage://peek-follow", {
        profileId: tab.profileId,
        database: tab.database,
        sourceTable: tab.table,
        sourceColumn,
        value,
      });
    }
  }, [activeRow, peekableColumns, tab.table, tab.profileId, tab.database]);

  /** Launch a peek for a relation in its own OS window, placed just below the
   * active cell (screen px). The window persists until closed manually. */
  /** A NULL / missing source value still opens the peek (matching nothing
   * yet): it follows later selections, so it can be set up ahead of time. */
  const openPeek = (t: RowRelationTarget) => {
    const cell = document
      .querySelector('[data-el="main-pane"] [data-active-cell]')
      ?.getBoundingClientRect();
    /* Open just right of the selected cell, top-aligned with it. */
    const x = window.screenX + (cell ? cell.right + 6 : 80);
    const y = window.screenY + (cell ? cell.top : 120);
    const seed: PeekSeed = {
      profileId: tab.profileId,
      profileName: tab.profileName,
      database: tab.database,
      target: { table: t.table, column: t.column, value: t.value },
      sourceTable: tab.table,
      sourceColumn: t.sourceColumn,
      kind: t.relation.kind,
    };
    ipc
      .openPeekWindow(seed, x, y, 900, 440)
      .catch((e) => notifyError(`Could not open peek window: ${String(e)}`));
  };

  /** Related-row cascade preview for a pending delete (see rowDelete.ts). */
  const previewCascade = (indices: number[]): Promise<CascadeTarget[]> =>
    tab.data
      ? previewCascadeTargets(
          {
            profileId: tab.profileId,
            database: tab.database,
            table: tab.table,
            columns: tab.data.columns,
            rows: tab.data.rows,
          },
          relations,
          indices
        )
      : Promise.resolve([]);

  return (
    <div className="flex-1 flex flex-col min-h-0">
      <div
        data-el="rows-toolbar"
        data-toolbar="rows"
        className="dbs-toolbar h-9 pl-1 pr-1 border-b border-zinc-800/60 flex items-center gap-1 text-zinc-400"
      >
        <button
          data-el="relations-toggle-btn"
          onClick={() => setRelationsOpen(!relationsOpen)}
          className={clsx(
            "inline-flex items-center gap-1.5 px-2 py-1 rounded text-[11px] font-semibold transition-colors",
            relationsOpen
              ? "bg-violet-600 text-white hover:bg-violet-500"
              : "bg-zinc-800 text-violet-300 hover:bg-zinc-700 hover:text-violet-200"
          )}
          {...helpHandlers(
            "Toggle the Relations panel: peek into the rows related to the selected row"
          )}
        >
          <ShareNetwork size={17} />
          Relations
        </button>

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
          dirty={isViewDirty(tab, relationsOpen) || peeksDirty}
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

        {(tab.filters.length > 0 || tab.hiddenColumns.length > 0) && (
          <button
            data-el="clear-filters-btn"
            onClick={() => clearRowsFilters(tab.id)}
            disabled={tab.loading}
            className="inline-flex items-center gap-1.5 px-2 py-1 rounded text-[11px] font-semibold bg-amber-400 text-black hover:bg-amber-300 transition-colors disabled:opacity-40"
            {...helpHandlers("Remove every filter and show all columns")}
          >
            <Funnel size={15} weight="fill" />
            Clear Filters
          </button>
        )}

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
        <div className="flex-1 min-h-0 flex">
        <div className="flex-1 min-w-0 min-h-0 flex flex-col">
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
          suggestSource={{
            profileId: tab.profileId,
            database: tab.database,
            table: tab.table,
          }}
          resultCopy
          peekableColumns={peekableColumns}
          activeCell={activeCell}
          clearActiveCellOnRowSelect
          initialSelectedRows={tab.selectedRows}
          onSelectionChange={(indices) => setRowsSelection(tab.id, indices)}
          onActiveCellChange={setActiveCell}
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
          onBatchEdit={async (edits) => {
            /**
             * The commit reloads the page (new rows identity), which the
             * seenRowsRef effect uses to clear activeCell — re-select on the
             * next frame so the Inspector keeps showing the edited cell.
             */
            const cell = activeCell;
            await updateCells(tab.id, edits);
            if (cell) requestAnimationFrame(() => setActiveCell(cell));
          }}
          onInsertRows={(rows) => insertRows(tab.id, rows)}
          onDeleteRows={
            hasPrimaryKey
              ? (indices, cascade) =>
                  deleteRows(tab.id, indices, cascade ?? undefined)
              : undefined
          }
          onCascadePreview={hasPrimaryKey ? previewCascade : undefined}
          canDuplicateRows={hasPrimaryKey}
        />
        </div>
        {relationsOpen && (
          <RelationsPanel
            profileId={tab.profileId}
            database={tab.database}
            table={tab.table}
            relations={relations}
            row={relationsRow}
            column={activeCell?.column ?? null}
            onOpen={openPeek}
            onNew={(column) =>
              setRelDialog({
                relation: null,
                column: column ?? tab.data?.columns[0]?.name ?? "",
              })
            }
            onEdit={(relation, column) => setRelDialog({ relation, column })}
            filters={tab.filters}
            onRelationFilter={(t, op) =>
              setRowsFilter(
                tab.id,
                t.sourceColumn,
                op
                  ? {
                      column: t.sourceColumn,
                      op,
                      value: "",
                      relation: { table: t.table, column: t.column },
                    }
                  : null
              )
            }
            onClose={() => setRelationsOpen(false)}
          />
        )}
        </div>
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

      {relDialog && (
        <RelationEditDialog
          profileId={tab.profileId}
          database={tab.database}
          relation={relDialog.relation}
          from={{ table: tab.table, column: relDialog.column }}
          onClose={() => setRelDialog(null)}
          /* The store has already reloaded the relation set (which is what
             lights up the peekable columns); refresh the rows too so the whole
             view reflects the change. */
          onSaved={() => {
            setRelDialog(null);
            refreshTab(tab.id);
          }}
          onDeleted={() => {
            setRelDialog(null);
            refreshTab(tab.id);
          }}
        />
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
