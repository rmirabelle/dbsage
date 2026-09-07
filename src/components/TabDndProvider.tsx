import { useEffect, useRef, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import {
  DndContext,
  DragOverlay,
  PointerSensor,
  pointerWithin,
  useSensor,
  useSensors,
  type DragEndEvent,
  type DragStartEvent,
} from "@dnd-kit/core";
import { Table as Table2, PlugsConnected } from "@phosphor-icons/react";
import { useStore } from "../state/store";
import { useUi } from "../state/ui";

/** What a tree row / DB-view tile carries while being dragged. */
type DragData =
  | {
      source: "dbview";
      tabId: string;
      profileId: string;
      db: string;
      grabbed: string;
      names: string[];
    }
  | { source: "tree"; profileId: string; db: string; table: string }
  | { source: "connection"; profileId: string; name: string }
  | { source: "tab"; tabId: string; label: string; onTearOff?: () => void };

/** Use pointer coordinates and the whole bar, including its empty space. */
function isOutsideTabBar(point: { x: number; y: number } | null): boolean {
  const rect = document.querySelector('[data-el="tab-bar"]')?.getBoundingClientRect();
  return !!point && !!rect && (
    point.x < rect.left || point.x > rect.right ||
    point.y < rect.top || point.y > rect.bottom
  );
}

/** What a drop target advertises (read off the droppable's data). */
type OverData =
  | { kind: "dbv-folder"; folderId: string }
  | { kind: "dbv-up" }
  | { kind: "tree-folder"; profileId: string; db: string; folderId: string }
  | { kind: "tree-db"; profileId: string; db: string }
  | { kind: "connection-row"; profileId: string }
  | { kind: "tab-slot"; tabId: string };

/**
 * One drag context for a window's tab content. dnd-kit hooks (`useDraggable`,
 * `useDroppable`, `useDndMonitor`) throw without a `<DndContext>` ancestor, so
 * every window that renders the DB view (the main window AND torn-off tab
 * windows) must wrap its tab content in this. Drop targets that don't exist in a
 * given window (e.g. the connection tree in a torn-off window) simply never
 * match, so the same handlers are safe everywhere.
 */
export function TabDndProvider({ children }: { children: ReactNode }) {
  const setTablesFolder = useStore((s) => s.setTablesFolder);
  const assignTableFolder = useStore((s) => s.assignTableFolder);
  const openTableCopyPrompt = useUi((s) => s.openTableCopyPrompt);
  const canReorderTabs = useStore((s) => s.tabs.length > 1);
  const pointer = useRef<{ x: number; y: number } | null>(null);
  const tabDrag = useRef<Extract<DragData, { source: "tab" }> | null>(null);
  const [outsideTabBar, setOutsideTabBar] = useState(false);

  useEffect(() => {
    const trackPointer = (event: PointerEvent) => {
      pointer.current = { x: event.clientX, y: event.clientY };
      if (tabDrag.current) setOutsideTabBar(isOutsideTabBar(pointer.current));
    };
    /** Capture the release position before dnd-kit's drag-end handler runs. */
    document.addEventListener("pointermove", trackPointer, true);
    document.addEventListener("pointerup", trackPointer, true);
    return () => {
      document.removeEventListener("pointermove", trackPointer, true);
      document.removeEventListener("pointerup", trackPointer, true);
    };
  }, []);

  const [drag, setDrag] = useState<{
    label: string;
    count: number;
    kind: "table" | "connection" | "tab";
    canTearOff?: boolean;
  } | null>(null);

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 5 } })
  );

  const onDragStart = (e: DragStartEvent) => {
    const a = e.active.data.current as DragData | undefined;
    if (!a) return;
    tabDrag.current = a.source === "tab" ? a : null;
    setOutsideTabBar(isOutsideTabBar(pointer.current));
    if (a.source === "dbview")
      setDrag({ label: a.grabbed, count: a.names.length, kind: "table" });
    else if (a.source === "connection")
      setDrag({ label: a.name, count: 1, kind: "connection" });
    else if (a.source === "tab")
      setDrag({ label: a.label, count: 1, kind: "tab", canTearOff: !!a.onTearOff });
    else setDrag({ label: a.table, count: 1, kind: "table" });
  };

  const onDragEnd = (e: DragEndEvent) => {
    setDrag(null);
    tabDrag.current = null;
    const a = e.active.data.current as DragData | undefined;
    const o = e.over?.data.current as OverData | undefined;
    if (!a) return;

    if (a.source === "tab") {
      const state = useStore.getState();
      const tab = state.tabs.find((t) => t.id === a.tabId);
      if (!tab) return;
      if (isOutsideTabBar(pointer.current)) {
        if (tab.kind !== "database") a.onTearOff?.();
      } else if (state.tabs.length > 1 && o?.kind === "tab-slot" && o.tabId !== a.tabId) {
        state.reorderTabs(a.tabId, o.tabId);
      }
      return;
    }

    if (!o) return;

    if (a.source === "connection") {
      if (o.kind === "connection-row" && o.profileId !== a.profileId) {
        useStore.getState().reorderProfiles(a.profileId, o.profileId);
      }
      return;
    }

    const names = a.source === "dbview" ? a.names : [a.table];

    if (o.kind === "dbv-folder" || o.kind === "dbv-up") {
      if (a.source !== "dbview") return;
      setTablesFolder(a.tabId, names, o.kind === "dbv-up" ? null : o.folderId);
      return;
    }
    if (o.kind === "tree-folder") {
      /* Folder assignment is only meaningful within the same connection + db. */
      if (o.profileId !== a.profileId || o.db !== a.db) return;
      for (const t of names) assignTableFolder(a.profileId, a.db, t, o.folderId);
      return;
    }
    if (o.kind === "tree-db") {
      const crossConnection = o.profileId !== a.profileId;
      /* Same connection + same database is a no-op; cross-connection to a
         like-named database is a legitimate copy. */
      if (!crossConnection && o.db === a.db) return;
      const targetConnectionName = crossConnection
        ? useStore.getState().profiles.find((p) => p.id === o.profileId)?.name
        : undefined;
      const rect = e.over!.rect;
      openTableCopyPrompt({
        profileId: a.profileId,
        sourceDb: a.db,
        tables: names,
        targetProfileId: o.profileId,
        targetDb: o.db,
        targetConnectionName,
        x: Math.round(rect.left + 16),
        y: Math.round(rect.top + rect.height),
      });
    }
  };

  return (
    <DndContext
      sensors={sensors}
      collisionDetection={pointerWithin}
      onDragStart={onDragStart}
      onDragEnd={onDragEnd}
      onDragCancel={() => {
        tabDrag.current = null;
        setDrag(null);
      }}
    >
      {children}
      {createPortal(
        <DragOverlay dropAnimation={null}>
          {drag && (drag.kind !== "tab" || (outsideTabBar ? drag.canTearOff : canReorderTabs)) ? (
            <div className="inline-flex items-center gap-2 whitespace-nowrap rounded border border-accent-500/60 bg-zinc-900/95 px-2.5 py-1 text-xs text-zinc-100 shadow-xl shadow-black/60">
              {drag.kind === "connection" ? (
                <PlugsConnected size={13} className="text-accent-400 shrink-0" />
              ) : drag.kind !== "tab" ? (
                <Table2 size={13} className="text-accent-400 shrink-0" />
              ) : null}
              {drag.kind === "tab" ? (
                <span>
                  {outsideTabBar && drag.canTearOff ? (
                    <>Open {drag.label} in a new window</>
                  ) : (
                    <><span className="text-zinc-500">Reorder:</span> {drag.label}</>
                  )}
                </span>
              ) : drag.label}
              {drag.count > 1 && (
                <span className="rounded-full bg-accent-500/20 text-accent-200 px-1.5 text-[10px] font-semibold tabular-nums">
                  {drag.count}
                </span>
              )}
            </div>
          ) : null}
        </DragOverlay>,
        document.body
      )}
    </DndContext>
  );
}
