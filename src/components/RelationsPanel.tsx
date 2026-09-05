import { useEffect, useMemo, useRef, useState } from "react";
import { RELATIONS_PANEL_DEFAULT, useUi } from "../state/ui";
import { helpHandlers } from "../state/help";
import { Funnel, PencilSimple, Plus, Prohibit, X } from "@phosphor-icons/react";
import clsx from "clsx";
import { listen } from "@tauri-apps/api/event";
import { rowRelationTargets, type RowRelationTarget } from "../lib/relations";
import {
  relKey,
  checkRelatedExistence,
  TABLE_CHANGED_EVENT,
  type TableChanged,
} from "../lib/relatedExistence";
import type { ColumnFilter, FilterOp, Relation, RowRecord } from "../types";

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

  return (
    <div
      data-el="relations-panel"
      style={{ width }}
      className="relations-panel order-first relative shrink-0 flex flex-col border-r border-violet-500/60 bg-zinc-900 text-zinc-200"
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
      <div className="flex shrink-0 items-center gap-2 bg-violet-600 px-3 py-1.5 text-[13px] font-semibold text-violet-50">
        <span className="flex-1">Relations</span>
        <button
          data-el="relation-panel-new"
          onClick={() => onNew(column)}
          className="inline-flex items-center gap-1.5 rounded bg-violet-500 px-2 py-1 text-[11px] font-semibold text-white transition-colors hover:bg-violet-400"
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
      <div className="min-h-0 flex-1 overflow-y-auto">
        {!row && items.length > 0 && (
          <p className="px-3 py-2 text-[11px] leading-relaxed text-zinc-500 border-b border-zinc-800/60">
            Select a cell or row to peek into its related rows.
          </p>
        )}
        {items.length === 0 ? (
          <p className="px-3 py-3 text-[12px] leading-relaxed text-zinc-500">
            No relations lead out of <span className="font-mono text-zinc-300">{table}</span>.
            Use New Relation to add one.
          </p>
        ) : (
          items.map((m) => {
            const noValue = m.value == null;
            const empty = !pending && !noValue && !m.exists;
            const disabled = pending || noValue || empty;
            const label = m.relation.name?.trim() || m.table;
            const filterOp = activeFilterOp(m);
            const filterBtn = (op: FilterOp, title: string, icon: React.ReactNode) => {
              const active = filterOp === op;
              const help = active
                ? `Clear this filter and show every row of ${table} again`
                : op === "hasrelated"
                ? `Filter ${table} to rows that have at least one related row in ${m.table}`
                : `Filter ${table} to rows that have no related row in ${m.table}`;
              return (
                <button
                  data-el={`relation-filter-${op}`}
                  onClick={() => onRelationFilter(m, active ? null : op)}
                  {...helpHandlers(help)}
                  className={clsx(
                    "flex w-8 shrink-0 items-center justify-center border-l border-zinc-800 transition-colors",
                    active
                      ? "bg-amber-400 text-black hover:bg-amber-300"
                      : "text-zinc-500 hover:bg-zinc-800 hover:text-amber-300"
                  )}
                  aria-label={title}
                  title={active ? `Clear: ${title}` : title}
                >
                  {icon}
                </button>
              );
            };
            return (
              <div
                key={m.relation.id}
                className="flex items-stretch border-b border-zinc-800/60"
              >
                <button
                  disabled={disabled}
                  onClick={() => onOpen(m)}
                  title={
                    !row
                      ? "Select a row to peek"
                      : noValue
                      ? `${m.sourceColumn} is NULL in this row`
                      : empty
                      ? `No related rows in ${m.table}`
                      : `Peek ${m.table} where ${m.column} = ${m.value}`
                  }
                  {...helpHandlers(
                    !row
                      ? "Select a cell or row first, then choose a relation to peek into its related rows"
                      : noValue
                      ? `${m.sourceColumn} is NULL in the selected row, so there is nothing to peek`
                      : empty
                      ? `The selected row has no related rows in ${m.table}`
                      : `Open a peek window showing the ${m.table} rows where ${m.column} = ${m.value}`
                  )}
                  className={clsx(
                    "flex min-w-0 flex-1 items-center gap-2 px-3 py-1 text-left text-[12px]",
                    disabled ? "cursor-not-allowed opacity-40" : "hover:bg-zinc-800"
                  )}
                >
                  <span
                    className={clsx(
                      "shrink-0 rounded px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide",
                      m.relation.kind === "has_many"
                        ? "bg-accent-500/15 text-accent-300"
                        : "bg-amber-500/15 text-amber-300"
                    )}
                  >
                    {m.relation.kind === "has_many" ? "has many" : "has one"}
                  </span>
                  <span className="min-w-0 flex-1 truncate font-medium text-zinc-100">
                    {label}
                  </span>
                </button>
                <button
                  data-el="relation-panel-edit"
                  onClick={() => onEdit(m.relation, m.sourceColumn)}
                  className="flex w-9 shrink-0 items-center justify-center border-l border-zinc-800 text-violet-400 hover:bg-zinc-800 hover:text-violet-300"
                  aria-label={`Edit relation ${label}`}
                  title="Edit relation"
                  {...helpHandlers(`Edit this relation: its name, kind, and the columns it joins`)}
                >
                  <PencilSimple size={16} />
                </button>
                {filterBtn(
                  "hasrelated",
                  `Show only rows with related rows in ${m.table}`,
                  <Funnel size={15} weight="fill" />
                )}
                {filterBtn(
                  "norelated",
                  `Show only rows with no related rows in ${m.table}`,
                  <Prohibit size={15} weight="bold" />
                )}
              </div>
            );
          })
        )}
      </div>
    </div>
  );
}
