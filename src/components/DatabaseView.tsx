import { useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import {
  ArrowUp,
  Folder as FolderIcon,
  FolderPlus,
  CircleNotch as Loader2,
  ArrowsClockwise as RefreshCw,
  MagnifyingGlass as Search,
  ShareNetwork,
  Table as Table2,
  Code,
  Trash,
  TextT,
  X,
} from "@phosphor-icons/react";
import clsx from "clsx";
import { useDraggable, useDroppable, useDndMonitor } from "@dnd-kit/core";
import { useStore } from "../state/store";
import { notifyError } from "../state/notify";
import { TableActionDialog, type TableAction } from "./TableActionDialog";
import { TableContextMenu } from "./TableContextMenu";
import { FolderDeleteDialog } from "./FolderDeleteDialog";
import type { DatabaseTab, Folder, TableInfo } from "../types";

interface Props {
  tab: DatabaseTab;
}

const MIN_TILE_PX = 220;
const UP_DROP_ID = "dbv-up";
const folderDropId = (id: string) => `dbv-folder:${id}`;
const tableDragId = (name: string) => `dbv-table:${name}`;

interface ContextMenuState {
  folderId: string;
  x: number;
  y: number;
}

export function DatabaseView({ tab }: Props) {
  const setDatabaseFilter = useStore((s) => s.setDatabaseFilter);
  const refreshTab = useStore((s) => s.refreshTab);
  const openTable = useStore((s) => s.openTable);
  const enterFolder = useStore((s) => s.enterFolder);
  const exitFolder = useStore((s) => s.exitFolder);
  const createFolder = useStore((s) => s.createFolder);
  const renameFolder = useStore((s) => s.renameFolder);
  const deleteFolder = useStore((s) => s.deleteFolder);
  const openRelations = useStore((s) => s.openRelations);
  const openQuery = useStore((s) => s.openQuery);
  const openTableDesigner = useStore((s) => s.openTableDesigner);
  const openTableEditor = useStore((s) => s.openTableEditor);
  const exportTableSql = useStore((s) => s.exportTableSql);
  const renameTable = useStore((s) => s.renameTable);
  const loadRelations = useStore((s) => s.loadRelations);
  const relationCount = useStore(
    (s) => (s.relations[`${tab.profileId}::${tab.database}`] ?? []).length
  );
  const rememberedTable = useStore(
    (s) => s.lastOpenedTables[`${tab.profileId}::${tab.database}`]
  );

  useEffect(() => {
    loadRelations(tab.profileId, tab.database).catch(() => {});
  }, [tab.profileId, tab.database, loadRelations]);

  const currentFolder = useMemo(
    () =>
      tab.currentFolderId
        ? tab.folders.find((f) => f.id === tab.currentFolderId) ?? null
        : null,
    [tab.folders, tab.currentFolderId]
  );

  const folderByTable = useMemo(() => {
    const map = new Map<string, string>();
    for (const f of tab.folders) for (const t of f.tables) map.set(t, f.id);
    return map;
  }, [tab.folders]);

  const filter = tab.filter.trim().toLowerCase();

  const visibleTables: TableInfo[] = useMemo(() => {
    let list = tab.tables;
    if (currentFolder) {
      const inFolder = new Set(currentFolder.tables);
      list = list.filter((t) => inFolder.has(t.name));
    } else {
      list = list.filter((t) => !folderByTable.has(t.name));
    }
    if (filter) list = list.filter((t) => t.name.toLowerCase().includes(filter));
    return list;
  }, [tab.tables, currentFolder, folderByTable, filter]);

  const visibleFolders: Folder[] = useMemo(() => {
    if (currentFolder) return [];
    const sorted = [...tab.folders].sort((a, b) =>
      a.name.localeCompare(b.name, undefined, { sensitivity: "base" })
    );
    if (!filter) return sorted;
    return sorted.filter((f) => f.name.toLowerCase().includes(filter));
  }, [tab.folders, currentFolder, filter]);

  const totalCount = currentFolder
    ? currentFolder.tables.length
    : tab.folders.length +
      tab.tables.filter((t) => !folderByTable.has(t.name)).length;
  const visibleCount = visibleFolders.length + visibleTables.length;

  const inputRef = useRef<HTMLInputElement>(null);

  /** Focus the filter field whenever this DB view is shown (mount or DB switch). */
  useEffect(() => {
    inputRef.current?.focus();
  }, [tab.id]);

  const [creating, setCreating] = useState(false);
  const [renamingId, setRenamingId] = useState<string | null>(null);
  const [activeTable, setActiveTable] = useState<string | null>(null);
  const [contextMenu, setContextMenu] = useState<ContextMenuState | null>(null);
  const [tableMenu, setTableMenu] = useState<{
    table: string;
    x: number;
    y: number;
  } | null>(null);
  const [pendingTableAction, setPendingTableAction] = useState<{
    kind: TableAction;
    table: string;
  } | null>(null);
  const [pendingFolderDelete, setPendingFolderDelete] = useState<{
    folderId: string;
    folderName: string;
    tableCount: number;
  } | null>(null);
  const [emptyMenu, setEmptyMenu] = useState<{ x: number; y: number } | null>(
    null
  );
  const [renamingTable, setRenamingTable] = useState<string | null>(null);
  const [selectedTables, setSelectedTables] = useState<Set<string>>(new Set());
  const lastSelectedRef = useRef<string | null>(null);
  const scrollContainerRef = useRef<HTMLDivElement>(null);
  const appliedRememberedRef = useRef(false);
  const [marqueeRect, setMarqueeRect] = useState<{
    left: number;
    top: number;
    width: number;
    height: number;
  } | null>(null);
  const marqueeStartRef = useRef<{ x: number; y: number } | null>(null);
  const marqueeMovedRef = useRef(false);

  /**
   * Drop the selection whenever the visible table set changes shape — keeps
   * stale names out of the selection after a move, folder switch, or filter.
   */
  useEffect(() => {
    setSelectedTables((prev) => {
      const visible = new Set(visibleTables.map((t) => t.name));
      let changed = false;
      const next = new Set<string>();
      for (const n of prev) {
        if (visible.has(n)) next.add(n);
        else changed = true;
      }
      return changed ? next : prev;
    });
  }, [visibleTables]);

  /**
   * On first load, re-select the table most recently opened from this database
   * so returning to the DB view highlights (and scrolls to) it. Runs once.
   */
  useEffect(() => {
    if (appliedRememberedRef.current) return;
    if (!rememberedTable) {
      appliedRememberedRef.current = true;
      return;
    }
    if (tab.tables.length === 0) return;
    appliedRememberedRef.current = true;
    if (!visibleTables.some((t) => t.name === rememberedTable)) return;
    setSelectedTables(new Set([rememberedTable]));
    lastSelectedRef.current = rememberedTable;
    requestAnimationFrame(() => {
      scrollContainerRef.current
        ?.querySelector(`[data-table-name="${CSS.escape(rememberedTable)}"]`)
        ?.scrollIntoView({ block: "nearest" });
    });
  }, [rememberedTable, tab.tables, visibleTables]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        setSelectedTables(new Set());
        lastSelectedRef.current = null;
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  const handleTableClick = (
    name: string,
    e: React.MouseEvent | React.PointerEvent
  ) => {
    const index = visibleTables.findIndex((t) => t.name === name);
    if (e.shiftKey && lastSelectedRef.current) {
      const lastIndex = visibleTables.findIndex(
        (t) => t.name === lastSelectedRef.current
      );
      if (lastIndex >= 0 && index >= 0) {
        const [from, to] =
          lastIndex < index ? [lastIndex, index] : [index, lastIndex];
        const range = visibleTables.slice(from, to + 1).map((t) => t.name);
        const additive = e.ctrlKey || e.metaKey;
        setSelectedTables((prev) => {
          const next = additive ? new Set(prev) : new Set<string>();
          for (const n of range) next.add(n);
          return next;
        });
        return;
      }
    }
    if (e.ctrlKey || e.metaKey) {
      setSelectedTables((prev) => {
        const next = new Set(prev);
        if (next.has(name)) next.delete(name);
        else next.add(name);
        return next;
      });
      lastSelectedRef.current = name;
      return;
    }
    setSelectedTables(new Set([name]));
    lastSelectedRef.current = name;
  };

  const clearSelection = () => {
    setSelectedTables(new Set());
    lastSelectedRef.current = null;
  };

  /**
   * Rubber-band (lasso) selection: press on empty grid space and drag a box to
   * select every table tile it touches. dnd-kit only captures pointer-downs on
   * the tiles themselves, so a press on empty space is free for the marquee.
   * Hold Shift/Ctrl to add to the existing selection.
   */
  const handleMarqueeDown = (e: React.PointerEvent) => {
    if (e.button !== 0) return;
    /* Start only on background presses — never on a tile or control (those drive
       dnd-kit drags and clicks). Works anywhere in the scroll area, including the
       padding and the empty space inside a folder. */
    const target = e.target as HTMLElement;
    if (
      target.closest(
        '[data-table-name], [data-el="folder-tile"], [data-el="up-tile"], button, input, textarea, a'
      )
    ) {
      return;
    }
    const base =
      e.shiftKey || e.metaKey || e.ctrlKey
        ? new Set(selectedTables)
        : new Set<string>();
    marqueeStartRef.current = { x: e.clientX, y: e.clientY };
    marqueeMovedRef.current = false;

    const onMove = (ev: PointerEvent) => {
      const start = marqueeStartRef.current;
      if (!start) return;
      if (
        !marqueeMovedRef.current &&
        Math.hypot(ev.clientX - start.x, ev.clientY - start.y) < 4
      )
        return;
      marqueeMovedRef.current = true;
      const left = Math.min(start.x, ev.clientX);
      const top = Math.min(start.y, ev.clientY);
      const right = Math.max(start.x, ev.clientX);
      const bottom = Math.max(start.y, ev.clientY);
      setMarqueeRect({ left, top, width: right - left, height: bottom - top });

      const names = new Set(base);
      const tiles =
        scrollContainerRef.current?.querySelectorAll<HTMLElement>(
          "[data-table-name]"
        ) ?? [];
      tiles.forEach((el) => {
        const r = el.getBoundingClientRect();
        const hit = !(
          r.right < left ||
          r.left > right ||
          r.bottom < top ||
          r.top > bottom
        );
        const name = el.getAttribute("data-table-name");
        if (hit && name) names.add(name);
      });
      setSelectedTables(names);
      lastSelectedRef.current = null;
    };

    const onUp = () => {
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
      marqueeStartRef.current = null;
      setMarqueeRect(null);
      if (marqueeMovedRef.current) {
        /* Swallow the trailing click so it doesn't clear the new selection. */
        const swallow = (ce: MouseEvent) => {
          ce.stopPropagation();
          ce.preventDefault();
          window.removeEventListener("click", swallow, true);
        };
        window.addEventListener("click", swallow, true);
      }
    };

    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
  };

  useEffect(() => {
    if (!contextMenu) return;
    const close = () => setContextMenu(null);
    window.addEventListener("click", close);
    window.addEventListener("contextmenu", close);
    return () => {
      window.removeEventListener("click", close);
      window.removeEventListener("contextmenu", close);
    };
  }, [contextMenu]);

  useEffect(() => {
    if (!tableMenu) return;
    const close = () => setTableMenu(null);
    window.addEventListener("click", close);
    window.addEventListener("contextmenu", close);
    return () => {
      window.removeEventListener("click", close);
      window.removeEventListener("contextmenu", close);
    };
  }, [tableMenu]);

  useEffect(() => {
    if (!emptyMenu) return;
    const close = () => setEmptyMenu(null);
    window.addEventListener("click", close);
    window.addEventListener("contextmenu", close);
    return () => {
      window.removeEventListener("click", close);
      window.removeEventListener("contextmenu", close);
    };
  }, [emptyMenu]);

  /**
   * The DndContext now lives at the app root (so tables can be dragged to the
   * tree). We just observe drags that belong to this DB view to keep the
   * active-tile styling and the click-to-implicit-select behaviour; the actual
   * folder/copy moves are routed by the app-level coordinator. Selecting an
   * unselected tile on drag-start matches the previous behaviour.
   */
  useDndMonitor({
    onDragStart(e) {
      const d = e.active.data.current as
        | { source?: string; tabId?: string; grabbed?: string }
        | undefined;
      if (d?.source !== "dbview" || d.tabId !== tab.id || !d.grabbed) return;
      setActiveTable(d.grabbed);
      if (!selectedTables.has(d.grabbed)) {
        setSelectedTables(new Set([d.grabbed]));
        lastSelectedRef.current = d.grabbed;
      }
    },
    onDragEnd() {
      setActiveTable(null);
    },
    onDragCancel() {
      setActiveTable(null);
    },
  });

  /** Drop target for removing a table from the current folder (the folder title's up button). */
  const { isOver: upIsOver, setNodeRef: setUpDropRef } = useDroppable({
    id: UP_DROP_ID,
    data: { kind: "dbv-up" },
  });

  return (
    <>
      <div data-el="database-view" className="flex-1 flex flex-col min-h-0">
        <div data-el="database-toolbar" className="dbs-toolbar pl-1.5 pr-3 py-1.5 border-b border-zinc-800/60 flex items-center gap-1 text-[11px] text-zinc-400">
          <div className="relative">
            <Search
              size={13}
              className="absolute left-2 top-1/2 -translate-y-1/2 text-zinc-500 pointer-events-none"
            />
            <input
              ref={inputRef}
              data-el="table-filter-input"
              value={tab.filter}
              onChange={(e) => setDatabaseFilter(tab.id, e.target.value)}
              placeholder={currentFolder ? "Filter tables…" : "Filter folders & tables…"}
              className="bg-zinc-900 border border-zinc-800 rounded pl-7 pr-7 py-1 w-56 text-[11px] text-zinc-200 placeholder:text-zinc-600 focus:border-accent-500"
            />
            {tab.filter && (
              <button
                data-el="filter-clear-btn"
                onClick={() => {
                  setDatabaseFilter(tab.id, "");
                  inputRef.current?.focus();
                }}
                className="absolute right-1.5 top-1/2 -translate-y-1/2 text-zinc-500 hover:text-zinc-200"
                aria-label="Clear filter"
              >
                <X size={13} />
              </button>
            )}
          </div>

          <button
            data-el="new-table-btn"
            onClick={() =>
              openTableDesigner(
                tab.profileId,
                tab.profileName,
                tab.database,
                currentFolder?.id ?? null
              )
            }
            style={{ fontSize: 13 }}
            className="inline-flex items-center gap-1.5 px-3 py-1 rounded font-semibold bg-emerald-400 text-emerald-950 hover:bg-emerald-300 transition-colors"
            title="Design a new table"
          >
            <span className="text-[19px] leading-none">+</span> Table
          </button>

          <button
            data-el="new-query-btn"
            onClick={() =>
              openQuery(tab.profileId, tab.profileName, tab.database)
            }
            style={{ fontSize: 13 }}
            className="inline-flex items-center gap-1.5 px-3 py-1 rounded font-semibold bg-emerald-600 text-emerald-50 hover:bg-emerald-500 transition-colors"
            title="Open a SQL query pane"
          >
            <Code size={16} weight="bold" /> Query
          </button>

          <button
            data-el="relationships-btn"
            onClick={() =>
              openRelations(tab.profileId, tab.profileName, tab.database)
            }
            style={{ fontSize: 13 }}
            className="inline-flex items-center gap-1.5 px-3 py-1 rounded font-semibold bg-violet-500 text-violet-950 hover:bg-violet-400 transition-colors"
            title="Open the relationships view for this database"
          >
            <ShareNetwork size={17} /> Relationships
            {relationCount > 0 && (
              <span className="rounded-full bg-violet-950/40 text-violet-50 px-1.5 text-[10px] font-semibold tabular-nums">
                {relationCount}
              </span>
            )}
          </button>

          <span className="ml-auto">
            {tab.loading ? (
              <span className="inline-flex items-center gap-1.5">
                <Loader2 size={13} className="animate-spin" />
                Loading…
              </span>
            ) : (
              <>
                <span className="text-zinc-200">{visibleCount}</span>
                {filter && (
                  <>
                    {" "}
                    of <span className="text-zinc-200">{totalCount}</span>
                  </>
                )}{" "}
                items
              </>
            )}
          </span>

          <button
            data-el="database-refresh-btn"
            onClick={() => refreshTab(tab.id)}
            disabled={tab.loading}
            className="inline-flex items-center gap-1.5 px-2 py-1 rounded hover:bg-zinc-800 disabled:opacity-30"
            title="Refresh"
          >
            {tab.loading ? (
              <Loader2 size={17} className="animate-spin" />
            ) : (
              <RefreshCw size={17} />
            )}
          </button>
        </div>

        {currentFolder && (
          <div
            data-el="folder-title"
            className="shrink-0 px-3 py-2 flex items-center gap-2 border-b border-zinc-800/40"
          >
            <button
              ref={setUpDropRef}
              data-el="folder-up-btn"
              onClick={() => exitFolder(tab.id)}
              className={clsx(
                "inline-flex items-center justify-center gap-1.5 h-6 px-2 rounded text-[12px] font-semibold transition-colors shrink-0",
                upIsOver
                  ? "ring-1 ring-inset ring-accent-400 bg-accent-500/25 text-accent-100"
                  : "bg-amber-300 text-black hover:bg-amber-200"
              )}
              title="Back to all tables · drop a table here to remove it from this folder"
            >
              <ArrowUp size={14} />
              <span className="truncate">{tab.database}</span>
            </button>
            <span className="text-[14px] font-semibold text-amber-300 truncate">
              {currentFolder.name}
            </span>
          </div>
        )}

        {tab.error && (
          <div className="px-3 py-2 bg-rose-950/40 border-b border-rose-900/60 text-rose-300 text-[11px]">
            {tab.error}
          </div>
        )}

        <div
          ref={scrollContainerRef}
          className="flex-1 min-h-0 overflow-auto p-2 bg-[#1d2029] select-none"
          onPointerDown={handleMarqueeDown}
          onClick={(e) => {
            if (e.target === e.currentTarget) clearSelection();
          }}
          onContextMenu={(e) => {
            const t = e.target as HTMLElement;
            if (
              t.closest(
                '[data-table-name], [data-el="folder-tile"], button, input, textarea'
              )
            )
              return;
            e.preventDefault();
            e.stopPropagation();
            setContextMenu(null);
            setTableMenu(null);
            setEmptyMenu({ x: e.clientX, y: e.clientY });
          }}
        >
          {tab.loading && tab.tables.length === 0 ? (
            <div className="h-full flex items-center justify-center text-zinc-500 text-xs gap-2">
              <Loader2 size={16} className="animate-spin" /> Loading…
            </div>
          ) : visibleCount === 0 && !creating && !currentFolder ? (
            <div className="h-full flex items-center justify-center text-zinc-600 text-xs">
              {filter
                ? `No matches for "${tab.filter}"`
                : tab.tables.length === 0
                ? "No tables in this database"
                : "All tables are foldered"}
            </div>
          ) : (
            <div
              data-el="tile-grid"
              onClick={(e) => {
                if (e.target === e.currentTarget) clearSelection();
              }}
              style={{
                columnWidth: MIN_TILE_PX,
                columnGap: 0,
                columnFill: "auto",
                height: "100%",
              }}
            >
              {creating && (
                <NewFolderTile
                  onCommit={async (name) => {
                    setCreating(false);
                    const trimmed = name.trim();
                    if (!trimmed) return;
                    try {
                      await createFolder(tab.id, trimmed);
                    } catch (e) {
                      alert(`Could not create folder: ${String(e)}`);
                    }
                  }}
                  onCancel={() => setCreating(false)}
                />
              )}

              {visibleFolders.map((folder) => (
                <FolderTile
                  key={folder.id}
                  folder={folder}
                  renaming={renamingId === folder.id}
                  onOpen={() => enterFolder(tab.id, folder.id)}
                  onContextMenu={(e) => {
                    e.preventDefault();
                    e.stopPropagation();
                    setTableMenu(null);
                    setEmptyMenu(null);
                    setContextMenu({
                      folderId: folder.id,
                      x: e.clientX,
                      y: e.clientY,
                    });
                  }}
                  onCommitRename={async (name) => {
                    setRenamingId(null);
                    const trimmed = name.trim();
                    if (!trimmed || trimmed === folder.name) return;
                    try {
                      await renameFolder(tab.id, folder.id, trimmed);
                    } catch (e) {
                      alert(`Could not rename: ${String(e)}`);
                    }
                  }}
                  onCancelRename={() => setRenamingId(null)}
                />
              ))}

              {visibleTables.map((t) => (
                <TableTile
                  key={t.name}
                  table={t}
                  tabId={tab.id}
                  profileId={tab.profileId}
                  database={tab.database}
                  moveNames={
                    selectedTables.has(t.name)
                      ? Array.from(selectedTables)
                      : [t.name]
                  }
                  isSelected={selectedTables.has(t.name)}
                  isAnyDragging={activeTable !== null}
                  isActiveDrag={activeTable === t.name}
                  onClick={(e) => handleTableClick(t.name, e)}
                  onOpen={() =>
                    openTable(tab.profileId, tab.profileName, tab.database, t.name)
                  }
                  onContextMenu={(e) => {
                    e.preventDefault();
                    e.stopPropagation();
                    setContextMenu(null);
                    setEmptyMenu(null);
                    /* Right-click selects the table, unless it's already part of
                       a multi-selection (then keep the whole selection). */
                    if (!selectedTables.has(t.name)) {
                      setSelectedTables(new Set([t.name]));
                      lastSelectedRef.current = t.name;
                    }
                    setTableMenu({ table: t.name, x: e.clientX, y: e.clientY });
                  }}
                  renaming={renamingTable === t.name}
                  onCommitRename={(name) => {
                    setRenamingTable(null);
                    const trimmed = name.trim();
                    if (!trimmed || trimmed === t.name) return;
                    renameTable(tab.profileId, tab.database, t.name, trimmed).catch(
                      (e) => notifyError(`Could not rename "${t.name}": ${String(e)}`)
                    );
                  }}
                  onCancelRename={() => setRenamingTable(null)}
                />
              ))}

              {currentFolder && visibleCount === 0 && (
                <div className="break-inside-avoid px-2.5 py-2 text-[12px] text-zinc-600">
                  {filter ? `No matches for "${tab.filter}"` : "This folder is empty"}
                </div>
              )}
            </div>
          )}
        </div>

        {contextMenu && (
          <FolderContextMenu
            x={contextMenu.x}
            y={contextMenu.y}
            onRename={() => {
              setRenamingId(contextMenu.folderId);
              setContextMenu(null);
            }}
            onDelete={() => {
              const folder = tab.folders.find((f) => f.id === contextMenu.folderId);
              setContextMenu(null);
              if (!folder) return;
              setPendingFolderDelete({
                folderId: folder.id,
                folderName: folder.name,
                tableCount: folder.tables.length,
              });
            }}
          />
        )}

        {emptyMenu && (
          <EmptyAreaContextMenu
            x={emptyMenu.x}
            y={emptyMenu.y}
            showNewFolder={!currentFolder}
            onNewTable={() => {
              setEmptyMenu(null);
              openTableDesigner(
                tab.profileId,
                tab.profileName,
                tab.database,
                currentFolder?.id ?? null
              );
            }}
            onNewFolder={() => {
              setEmptyMenu(null);
              setCreating(true);
            }}
          />
        )}

        {tableMenu && (
          <TableContextMenu
            x={tableMenu.x}
            y={tableMenu.y}
            onTruncate={() => {
              setPendingTableAction({ kind: "truncate", table: tableMenu.table });
              setTableMenu(null);
            }}
            onDelete={() => {
              setPendingTableAction({ kind: "delete", table: tableMenu.table });
              setTableMenu(null);
            }}
            onEdit={() => {
              const table = tableMenu.table;
              setTableMenu(null);
              openTableEditor(tab.profileId, tab.profileName, tab.database, table).catch(
                (e) => notifyError(`Could not open "${table}" for editing: ${String(e)}`)
              );
            }}
            onRename={() => {
              setRenamingTable(tableMenu.table);
              setTableMenu(null);
            }}
            onSaveSql={(includeData) => {
              const table = tableMenu.table;
              setTableMenu(null);
              exportTableSql(tab.profileId, tab.database, table, includeData);
            }}
          />
        )}

        {pendingTableAction && (
          <TableActionDialog
            action={pendingTableAction.kind}
            profileId={tab.profileId}
            database={tab.database}
            table={pendingTableAction.table}
            onClose={() => setPendingTableAction(null)}
          />
        )}

        {pendingFolderDelete && (
          <FolderDeleteDialog
            folderName={pendingFolderDelete.folderName}
            tableCount={pendingFolderDelete.tableCount}
            onConfirm={() => deleteFolder(tab.id, pendingFolderDelete.folderId)}
            onClose={() => setPendingFolderDelete(null)}
          />
        )}
      </div>

      {marqueeRect &&
        createPortal(
          <div
            data-el="marquee"
            className="fixed z-50 rounded-[1px] border border-accent-400/70 bg-accent-500/15 pointer-events-none"
            style={{
              left: marqueeRect.left,
              top: marqueeRect.top,
              width: marqueeRect.width,
              height: marqueeRect.height,
            }}
          />,
          document.body
        )}
    </>
  );
}

/** First entry in a folder's tile list: a solid button that returns to the
 * full table list. Also a drop target — dropping a table here removes it from
 * the current folder. */
function FolderTile({
  folder,
  renaming,
  onOpen,
  onContextMenu,
  onCommitRename,
  onCancelRename,
}: {
  folder: Folder;
  renaming: boolean;
  onOpen: () => void;
  onContextMenu: (e: React.MouseEvent) => void;
  onCommitRename: (name: string) => void;
  onCancelRename: () => void;
}) {
  const { isOver, setNodeRef } = useDroppable({
    id: folderDropId(folder.id),
    data: { kind: "dbv-folder", folderId: folder.id },
  });
  return (
    <div
      ref={setNodeRef}
      data-el="folder-tile"
      onDoubleClick={renaming ? undefined : onOpen}
      onContextMenu={onContextMenu}
      title={`${folder.name} · ${folder.tables.length} table(s)\nDouble-click to open · right-click for actions`}
      className={clsx(
        "group flex items-center gap-2 px-2.5 py-1.5 bg-transparent hover:bg-accent-500/10 text-left transition-colors min-w-0 cursor-pointer break-inside-avoid",
        isOver && "ring-1 ring-inset ring-accent-400 bg-accent-500/15"
      )}
    >
      <FolderIcon size={15} className="text-amber-300 shrink-0" strokeWidth={1.8} />
      {renaming ? (
        <RenameInput
          initial={folder.name}
          onCommit={onCommitRename}
          onCancel={onCancelRename}
        />
      ) : (
        <>
          <span className="text-[12px] text-amber-300 truncate flex-1 font-semibold">
            {folder.name}
          </span>
          <span className="text-[10px] font-mono text-zinc-500 shrink-0 ml-auto">
            {folder.tables.length}
          </span>
        </>
      )}
    </div>
  );
}

function NewFolderTile({
  onCommit,
  onCancel,
}: {
  onCommit: (name: string) => void;
  onCancel: () => void;
}) {
  return (
    <div className="group flex items-center gap-2 px-2.5 py-1.5 bg-amber-300/5 ring-1 ring-inset ring-amber-300/40 min-w-0 break-inside-avoid">
      <FolderIcon size={15} className="text-amber-300 shrink-0" strokeWidth={1.8} />
      <RenameInput initial="" placeholder="Folder name" onCommit={onCommit} onCancel={onCancel} />
    </div>
  );
}

function TableTile({
  table,
  tabId,
  profileId,
  database,
  moveNames,
  isSelected,
  isAnyDragging,
  isActiveDrag,
  renaming,
  onClick,
  onOpen,
  onContextMenu,
  onCommitRename,
  onCancelRename,
}: {
  table: TableInfo;
  tabId: string;
  profileId: string;
  database: string;
  moveNames: string[];
  isSelected: boolean;
  isAnyDragging: boolean;
  isActiveDrag: boolean;
  renaming: boolean;
  onClick: (e: React.MouseEvent) => void;
  onOpen: () => void;
  onContextMenu: (e: React.MouseEvent) => void;
  onCommitRename: (name: string) => void;
  onCancelRename: () => void;
}) {
  const { attributes, listeners, setNodeRef, isDragging } = useDraggable({
    id: tableDragId(table.name),
    disabled: renaming,
    data: {
      source: "dbview",
      tabId,
      profileId,
      db: database,
      grabbed: table.name,
      names: moveNames,
    },
  });

  return (
    <div
      ref={setNodeRef}
      data-el="table-tile"
      data-table-name={table.name}
      {...(renaming ? {} : attributes)}
      {...(renaming ? {} : listeners)}
      onClick={renaming ? undefined : onClick}
      onDoubleClick={renaming ? undefined : onOpen}
      onContextMenu={onContextMenu}
      title={`${table.name} · ${table.kind}${
        table.estimatedRows != null
          ? ` · ~${table.estimatedRows.toLocaleString()} rows`
          : ""
      }\nClick to select · Shift/Ctrl+click to extend · Double-click to open · drag onto a folder to move`}
      className={clsx(
        "group flex items-center gap-2 px-2.5 py-1.5 text-left transition-colors min-w-0 break-inside-avoid",
        renaming ? "cursor-default" : "cursor-grab active:cursor-grabbing",
        isSelected
          ? "bg-accent-500/15"
          : isAnyDragging
          ? "bg-transparent"
          : "bg-transparent hover:bg-accent-500/10",
        (isDragging || isActiveDrag) && "opacity-50",
        isAnyDragging && isSelected && !isActiveDrag && "opacity-60"
      )}
    >
      <Table2
        size={14}
        className={clsx(
          "shrink-0",
          isSelected
            ? "text-accent-300"
            : isAnyDragging
            ? "text-zinc-500"
            : "text-zinc-500 group-hover:text-emerald-400"
        )}
      />
      {renaming ? (
        <RenameInput
          initial={table.name}
          onCommit={onCommitRename}
          onCancel={onCancelRename}
        />
      ) : (
        <>
          <span
            className={clsx(
              "text-[12px] truncate flex-1",
              isSelected ? "text-zinc-50 font-medium" : "text-zinc-200"
            )}
          >
            {table.name}
          </span>
          {table.estimatedRows != null && (
            <span className="text-[10px] font-mono text-zinc-500 shrink-0 ml-auto">
              {formatCount(table.estimatedRows)}
            </span>
          )}
        </>
      )}
    </div>
  );
}

function RenameInput({
  initial,
  placeholder,
  onCommit,
  onCancel,
}: {
  initial: string;
  placeholder?: string;
  onCommit: (name: string) => void;
  onCancel: () => void;
}) {
  const [value, setValue] = useState(initial);
  const ref = useRef<HTMLInputElement>(null);
  useEffect(() => {
    ref.current?.focus();
    ref.current?.select();
  }, []);
  return (
    <input
      ref={ref}
      value={value}
      placeholder={placeholder}
      onChange={(e) => setValue(e.target.value)}
      onKeyDown={(e) => {
        if (e.key === "Enter") {
          e.preventDefault();
          onCommit(value);
        } else if (e.key === "Escape") {
          e.preventDefault();
          onCancel();
        }
      }}
      onBlur={() => onCommit(value)}
      onClick={(e) => e.stopPropagation()}
      onDoubleClick={(e) => e.stopPropagation()}
      onPointerDown={(e) => e.stopPropagation()}
      className="bg-zinc-900 border border-zinc-700 rounded px-1.5 py-0.5 text-[12px] text-zinc-100 outline-none focus:border-accent-500 flex-1 min-w-0"
    />
  );
}

function FolderContextMenu({
  x,
  y,
  onRename,
  onDelete,
}: {
  x: number;
  y: number;
  onRename: () => void;
  onDelete: () => void;
}) {
  return createPortal(
    <div
      data-el="folder-context-menu"
      style={{ top: y, left: x }}
      onClick={(e) => e.stopPropagation()}
      className="dbs-context-menu fixed z-50 min-w-[150px] rounded border border-zinc-700 bg-zinc-900/95 backdrop-blur-sm py-1 shadow-xl shadow-black/60"
    >
      <button
        className="flex w-full items-center gap-2.5 px-3 py-1.5 text-left hover:bg-zinc-800 text-zinc-200"
        onClick={onRename}
      >
        <TextT size={14} className="text-accent-400 shrink-0" />
        Rename Folder
      </button>
      <button
        className="flex w-full items-center gap-2.5 px-3 py-1.5 text-left hover:bg-zinc-800 text-rose-400"
        onClick={onDelete}
      >
        <Trash size={14} className="shrink-0" />
        Delete Folder
      </button>
    </div>,
    document.body
  );
}

function EmptyAreaContextMenu({
  x,
  y,
  showNewFolder,
  onNewTable,
  onNewFolder,
}: {
  x: number;
  y: number;
  showNewFolder: boolean;
  onNewTable: () => void;
  onNewFolder: () => void;
}) {
  return createPortal(
    <div
      data-el="empty-context-menu"
      style={{ top: y, left: x }}
      onClick={(e) => e.stopPropagation()}
      className="dbs-context-menu fixed z-50 min-w-[160px] rounded border border-zinc-700 bg-zinc-900/95 backdrop-blur-sm py-1 shadow-xl shadow-black/60"
    >
      <button
        data-el="ctx-new-table"
        className="flex w-full items-center gap-2.5 px-3 py-1.5 text-left hover:bg-zinc-800 text-zinc-200"
        onClick={onNewTable}
      >
        <Table2 size={14} className="text-emerald-400 shrink-0" />
        New Table
      </button>
      {showNewFolder && (
        <button
          data-el="ctx-new-folder"
          className="flex w-full items-center gap-2.5 px-3 py-1.5 text-left hover:bg-zinc-800 text-zinc-200"
          onClick={onNewFolder}
        >
          <FolderPlus size={14} className="text-amber-300 shrink-0" />
          New Folder
        </button>
      )}
    </div>,
    document.body
  );
}

function formatCount(n: number): string {
  if (n < 1_000) return String(n);
  if (n < 1_000_000) return `${(n / 1_000).toFixed(n < 10_000 ? 1 : 0)}K`;
  if (n < 1_000_000_000)
    return `${(n / 1_000_000).toFixed(n < 10_000_000 ? 1 : 0)}M`;
  return `${(n / 1_000_000_000).toFixed(1)}B`;
}
