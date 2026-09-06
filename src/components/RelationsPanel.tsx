import { useEffect, useMemo, useRef, useState } from "react";
import { RELATIONS_PANEL_DEFAULT, useUi } from "../state/ui";
import { helpHandlers } from "../state/help";
import {
  Funnel,
  PencilSimple,
  Plus,
  Prohibit,
  AppWindow,
  X,
} from "@phosphor-icons/react";
import clsx from "clsx";
import { listen } from "@tauri-apps/api/event";
import { rowRelationTargets, type RowRelationTarget } from "../lib/relations";
import {
  relKey,
  checkRelatedExistence,
  TABLE_CHANGED_EVENT,
  PEEKS_CHANGED_EVENT,
  type TableChanged,
} from "../lib/relatedExistence";
import { ipc } from "../ipc";
import type {
  ColumnFilter,
  FilterOp,
  PeekDescriptor,
  Relation,
  RowRecord,
} from "../types";

/**
 * The Relations side panel: every relation reachable from the grid's current
 * row, with the active column's own relations first. It follows the grid —
 * whenever the host passes a new row/column, or the relations list changes,
 * or rows change in one of the target tables, the entries re-check whether
 * related rows exist and grey out when none do. Shared by rows tabs and peek
 * windows; the host owns visibility, the row/column, and what "open" does.
 */
export function RelationsPanel({
  profileId,
  database,
  table,
  relations,
  row,
  column,
  filters,
  onOpen,
  onNew,
  onEdit,
  onRelationFilter,
  onClose,
}: {
  profileId: string;
  database: string;
  table: string;
  relations: Relation[];
  /** The grid's current row (active cell's row, else the first selected row),
   * or null when nothing is selected. */
  row: RowRecord | null;
  /** The active column, whose relations list first and seed "New Relation". */
  column: string | null;
  /** The grid's current filters, to show which relation filter is active. */
  filters: ColumnFilter[];
  onOpen: (target: RowRelationTarget) => void;
  onNew: (column: string | null) => void;
  onEdit: (relation: Relation, column: string) => void;
  /** Filter the grid to rows that have (`hasrelated`) or lack (`norelated`)
   * related rows through this relation; null clears that filter. */
  onRelationFilter: (target: RowRelationTarget, op: FilterOp | null) => void;
  onClose: () => void;
}) {
  /* Without a row the relations still list (their filters work row-free);
     every value is then null, so peeking is disabled. */
  const targets = useMemo(
    () => rowRelationTargets(relations, table, column ?? "", row ?? {}),
    [relations, table, column, row]
  );
  const activeFilterOp = (m: RowRelationTarget): FilterOp | null => {
    const f = filters.find(
      (f) =>
        f.column === m.sourceColumn &&
        f.relation?.table === m.table &&
        f.relation?.column === m.column
    );
    return f ? f.op : null;
  };
  const [checked, setChecked] = useState<
    (RowRelationTarget & { exists: boolean })[]
  >([]);
  const [pending, setPending] = useState(false);
  /** Bumped when a target table's rows change, to re-run the existence checks. */
  const [tick, setTick] = useState(0);
  const requestRef = useRef(0);
  /* Display width vs. stored width: the stored width is the shared default
     for panels opened later (persisted, synced across windows). Each panel
     keeps its own display width so resizing one — in a peek, say — never
     resizes the table view's panel too. */
  const storedWidth = useUi((s) => s.relationsPanelWidth);
  const setStoredWidth = useUi((s) => s.setRelationsPanelWidth);
  const [width, setDisplayWidth] = useState(storedWidth);
  const setWidth = (px: number) => {
    setDisplayWidth(Math.max(200, Math.min(800, Math.round(px))));
    setStoredWidth(px);
  };

  /** Drag the panel's right edge to resize; the width persists across
   * windows and sessions like the Inspector height. */
  const onResizeStart = (e: React.PointerEvent) => {
    e.preventDefault();
    const startX = e.clientX;
    const startWidth = width;
    const prevCursor = document.body.style.cursor;
    const prevUserSelect = document.body.style.userSelect;
    document.body.style.cursor = "ew-resize";
    document.body.style.userSelect = "none";
    const onMove = (ev: PointerEvent) =>
      setWidth(startWidth + (ev.clientX - startX));
    const onUp = () => {
      document.body.style.cursor = prevCursor;
      document.body.style.userSelect = prevUserSelect;
      document.removeEventListener("pointermove", onMove);
      document.removeEventListener("pointerup", onUp);
      document.removeEventListener("pointercancel", onUp);
    };
    document.addEventListener("pointermove", onMove);
    document.addEventListener("pointerup", onUp);
    document.addEventListener("pointercancel", onUp);
  };

  useEffect(() => {
    const request = ++requestRef.current;
    if (targets.length === 0) {
      setChecked([]);
      setPending(false);
      return;
    }
    setPending(true);
    (async () => {
      const next = await Promise.all(
        targets.map(async (m) => {
          if (m.value == null) return { ...m, exists: false };
          const exists = await checkRelatedExistence(
            profileId,
            database,
            [m],
            m.value
          );
          return { ...m, exists: exists[relKey(m)] !== false };
        })
      );
      if (request !== requestRef.current) return;
      setChecked(next);
      setPending(false);
    })();
  }, [targets, profileId, database, tick]);

  useEffect(() => {
    const un = listen<TableChanged>(TABLE_CHANGED_EVENT, (e) => {
      const m = e.payload;
      if (
        m.profileId === profileId &&
        m.database === database &&
        targets.some((t) => t.table === m.table)
      ) {
        setTick((t) => t + 1);
      }
    });
    return () => {
      un.then((f) => f());
    };
  }, [targets, profileId, database]);

  /* While a row's checks run, list its targets disabled instead of flashing
     the previous row's entries or an empty panel. */
  const items = pending ? targets.map((m) => ({ ...m, exists: false })) : checked;

  /* Which relations already have a peek window open (keyed by the peek's
     identity, value aside), so the peek button can toggle it and show state.
     Refreshed whenever Rust reports a peek opened or closed. */
  const peekKey = (t: {
    table: string;
    column: string;
    sourceTable: string;
    sourceColumn: string;
  }) => `${t.table}::${t.column}::${t.sourceTable}::${t.sourceColumn}`;
  const [openPeeks, setOpenPeeks] = useState<Map<string, string>>(new Map());
  useEffect(() => {
    let cancelled = false;
    const refresh = async () => {
      try {
        const open = await ipc.listOpenPeeks<PeekDescriptor>();
        if (cancelled) return;
        const next = new Map<string, string>();
        for (const p of open) {
          if (p.profileId !== profileId || p.database !== database || !p.label) continue;
          next.set(
            peekKey({
              table: p.target.table,
              column: p.target.column,
              sourceTable: p.sourceTable,
              sourceColumn: p.sourceColumn,
            }),
            p.label
          );
        }
        setOpenPeeks(next);
      } catch {
        /* keep the last known state */
      }
    };
    void refresh();
    const un = listen(PEEKS_CHANGED_EVENT, () => void refresh());
    return () => {
      cancelled = true;
      un.then((f) => f());
    };
  }, [profileId, database]);

  return (
    <div
      data-el="relations-panel"
      style={{ width }}
      className="relations-panel order-first relative shrink-0 flex flex-col border-r border-violet-500/60 bg-[#2d2a3b] text-zinc-200"
    >
      <div
        role="separator"
        aria-orientation="vertical"
        onPointerDown={onResizeStart}
        onDoubleClick={() => setWidth(RELATIONS_PANEL_DEFAULT)}
        className="absolute top-0 bottom-0 right-0 w-1.5 translate-x-1/2 z-10 cursor-ew-resize bg-transparent hover:bg-violet-500/50 transition-colors"
        title="Drag to resize · double-click to reset"
        {...helpHandlers("Drag to resize the Relations panel. Double-click to reset its width.")}
      />
      <div
        data-el="relations-panel-header"
        className="flex shrink-0 items-center gap-2 bg-violet-600 px-3 py-1.5 text-[13px] font-semibold text-violet-50"
      >
        <span className="flex-1">Relations</span>
        <button
          onClick={onClose}
          className="inline-flex items-center justify-center rounded p-0.5 text-violet-200 transition-colors hover:bg-violet-500 hover:text-white"
          aria-label="Close the Relations panel"
          title="Close"
          {...helpHandlers("Close the Relations panel")}
        >
          <X size={15} />
        </button>
      </div>
      <div data-el="relations-panel-body" className="min-h-0 flex-1 overflow-y-auto pt-[10px]">
        {items.length === 0 ? null : (
          items.map((m) => {
            const label = m.relation.name?.trim() || m.table;
            /* The badge and name dim when the selected row has no related
               rows (or no value) through this relation right now; the
               buttons stay at full strength. */
            const hasRows = !pending && m.value != null && m.exists;
            const current = activeFilterOp(m);
            const openLabel = openPeeks.get(
              peekKey({
                table: m.table,
                column: m.column,
                sourceTable: table,
                sourceColumn: m.sourceColumn,
              })
            );
            return (
              <div
                key={m.relation.id}
                className="border-b border-zinc-800/60 text-[12px]"
              >
                <div className="flex items-center gap-2 py-1 pl-2 pr-1.5">
                <button
                  data-el="relation-edit-btn"
                  onClick={() => onEdit(m.relation, m.sourceColumn)}
                  className="shrink-0 inline-flex items-center justify-center rounded p-0.5 text-violet-400 transition-colors hover:bg-zinc-700 hover:text-violet-300"
                  aria-label={`Edit relation ${label}`}
                  {...helpHandlers("Edit this relation: its name, kind, and the columns it joins")}
                >
                  <PencilSimple size={14} />
                </button>
                <span
                  className={clsx(
                    "shrink-0 rounded px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide",
                    m.relation.kind === "has_many"
                      ? "bg-accent-500/15 text-accent-300"
                      : "bg-amber-500/15 text-amber-300",
                    !hasRows && "opacity-40"
                  )}
                >
                  {m.relation.kind === "has_many" ? "has many" : "has one"}
                </span>
                <span
                  className={clsx(
                    "min-w-0 flex-1 truncate font-medium text-zinc-100",
                    !hasRows && "opacity-40"
                  )}
                  {...helpHandlers(
                    !row
                      ? `${label}: select a row to see whether it has related rows`
                      : hasRows
                      ? `${label}: the selected row has related rows in ${m.table}`
                      : m.value == null
                      ? `${label}: ${m.sourceColumn} is NULL in the selected row`
                      : `${label}: the selected row has no related rows in ${m.table}`
                  )}
                >
                  {label}
                </span>
                {/* One two-sided control: WITH on the left, WITHOUT on the
                    right; the active side is amber, click again to clear. */}
                <div
                  data-el="relation-filter-toggle"
                  className="inline-flex shrink-0 overflow-hidden rounded"
                >
                  {(
                    [
                      {
                        op: "hasrelated" as FilterOp,
                        icon: <Funnel size={14} weight="fill" />,
                        title: `${table} WITH ${label}`,
                        help: `Show only ${table} rows that have at least one related row in ${m.table}`,
                      },
                      {
                        op: "norelated" as FilterOp,
                        icon: <Prohibit size={14} weight="bold" />,
                        title: `${table} WITHOUT ${label}`,
                        help: `Show only ${table} rows that have no related row in ${m.table}`,
                      },
                    ] as const
                  ).map((f) => {
                    const active = current === f.op;
                    return (
                      <button
                        key={f.op}
                        data-el={`relation-filter-${f.op}`}
                        onClick={() => onRelationFilter(m, active ? null : f.op)}
                        aria-pressed={active}
                        aria-label={f.title}
                        className={clsx(
                          "inline-flex items-center justify-center p-1 transition-colors",
                          f.op === "norelated" && "border-l border-zinc-700",
                          active
                            ? "bg-amber-400 text-black hover:bg-amber-300"
                            : "bg-zinc-800 text-zinc-400 hover:bg-zinc-700 hover:text-amber-300"
                        )}
                        {...helpHandlers(
                          active
                            ? `Clear this filter and show every row of ${table} again`
                            : f.help
                        )}
                      >
                        {f.icon}
                      </button>
                    );
                  })}
                </div>
                <button
                  data-el="relation-peek-btn"
                  onClick={() => {
                    if (openLabel) ipc.closePeeks([openLabel]).catch(() => {});
                    else onOpen(m);
                  }}
                  className={clsx(
                    "shrink-0 inline-flex items-center justify-center rounded p-1 transition-colors",
                    openLabel
                      ? "bg-violet-600 text-white hover:bg-violet-500"
                      : "bg-zinc-800 text-zinc-400 hover:bg-zinc-700 hover:text-zinc-200"
                  )}
                  aria-label={openLabel ? `Close the ${m.table} peek` : `Peek ${m.table}`}
                  aria-pressed={!!openLabel}
                  {...helpHandlers(
                    openLabel
                      ? `Close the open ${m.table} peek window`
                      : hasRows
                      ? `Open a peek window showing the ${m.table} rows where ${m.column} = ${m.value}`
                      : `Open a peek window on ${m.table}; it fills in once a selected row has related rows`
                  )}
                >
                  <AppWindow size={14} weight="bold" />
                </button>
                </div>
              </div>
            );
          })
        )}
        <div className="px-3 py-2">
          <button
            data-el="relation-panel-new"
            onClick={() => onNew(column)}
            className="inline-flex items-center gap-1.5 rounded bg-violet-600 px-2 py-1 text-[11px] font-semibold text-white transition-colors hover:bg-violet-500"
            aria-label="New Relation"
            title={column ? `New relation from ${column}` : "New relation"}
            {...helpHandlers(
              column
                ? `Define a new relation from ${column} to a column in another table`
                : "Define a new relation from this table to another table"
            )}
          >
            <Plus size={13} weight="bold" />
            New Relation
          </button>
        </div>
      </div>
    </div>
  );
}
