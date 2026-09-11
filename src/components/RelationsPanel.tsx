import { useEffect, useMemo, useRef, useState } from "react";
import { RELATIONS_PANEL_DEFAULT, useUi } from "../state/ui";
import { helpHandlers } from "../state/help";
import {
  Funnel,
  PencilSimple,
  Plus,
  Prohibit,
  AlignBottom,
  AlignRight,
  ArrowsClockwise,
  Eye,
  CaretDoubleLeft,
  X,
} from "@phosphor-icons/react";
import clsx from "clsx";
import { listen } from "@tauri-apps/api/event";
import { rowRelationTargets, type RowRelationTarget } from "../lib/relations";
import { toggleRelationFilter } from "../lib/relationFilterToggle";
import {
  relKey,
  checkRelatedExistence,
  dropRelatedExistence,
  TABLE_CHANGED_EVENT,
  type TableChanged,
} from "../lib/relatedExistence";
import type {
  ColumnFilter,
  FilterOp,
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
  onNew,
  onEdit,
  onRelationFilter,
  onFilterEnabled,
  onClose,
  onCollapse,
  onSelect,
  returnLabel,
  hideReturnRelations = false,
  activeRelationId,
  openRelationIds,
  solo = false,
  onSoloChange,
  onRefresh,
  dock = "bottom",
  onDockChange,
  hideNewRelation = false,
  neutralBorder = false,
  className,
  panelWidth,
  onWidthChange,
  hideFilterButtons = false,
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
  onNew: (column: string | null) => void;
  onEdit: (relation: Relation, column: string) => void;
  /** Filter the grid to rows that have (`hasrelated`) or lack (`norelated`)
   * related rows through this relation; null clears that filter. */
  onRelationFilter: (target: RowRelationTarget, op: FilterOp | null) => void;
  onFilterEnabled?: (target: RowRelationTarget) => void;
  onClose: () => void;
  onCollapse?: () => void;
  onSelect?: (target: RowRelationTarget) => void;
  returnLabel?: (target: RowRelationTarget) => string | undefined;
  hideReturnRelations?: boolean;
  activeRelationId?: string;
  openRelationIds?: string[];
  solo?: boolean;
  onSoloChange?: (solo: boolean) => void;
  /** Reload the peeks this panel opened, and every peek nested under them. */
  onRefresh?: () => void;
  dock?: "bottom" | "right";
  onDockChange?: (dock: "bottom" | "right") => void;
  hideNewRelation?: boolean;
  neutralBorder?: boolean;
  /** Extra classes on the panel root (e.g. padding in a peek). */
  className?: string;
  panelWidth?: number;
  onWidthChange?: (width: number) => void;
  hideFilterButtons?: boolean;
}) {
  /* Without a row the relations still list (their filters work row-free);
     every value is then null, so peeking is disabled. */
  const targets = useMemo(
    () => rowRelationTargets(relations, table, column ?? "", row ?? {}, !onSelect),
    [relations, table, column, row, !!onSelect]
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
  const [localWidth, setDisplayWidth] = useState(storedWidth);
  const width = panelWidth ?? localWidth;
  const setWidth = (px: number) => {
    const next = Math.max(200, Math.min(800, Math.round(px)));
    setDisplayWidth(next);
    setStoredWidth(next);
    onWidthChange?.(next);
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
  const items = (pending ? targets.map((m) => ({ ...m, exists: false })) : checked)
    .filter((m) => !hideReturnRelations || !returnLabel?.(m));

  /** Forget the cached related-row answers for every target table, re-check
   * them, then reload the peeks below. */
  const refresh = () => {
    for (const t of new Set(targets.map((m) => m.table))) dropRelatedExistence(profileId, database, t);
    setTick((t) => t + 1);
    onRefresh?.();
  };

  const LabelTag = onSelect ? "button" : "div";
  return (
    <div
      data-el="relations-panel"
      style={{ width }}
      className={clsx("relations-panel order-first relative shrink-0 flex flex-col border-r bg-[var(--peek-tint,#2d2a3b)] text-zinc-200", neutralBorder ? "border-zinc-700" : "border-violet-500/60", className)}
    >
      <div
        role="separator"
        aria-orientation="vertical"
        onPointerDown={onResizeStart}
        onDoubleClick={() => setWidth(RELATIONS_PANEL_DEFAULT)}
        className="absolute top-0 bottom-0 right-0 w-1.5 translate-x-1/2 z-10 cursor-ew-resize bg-transparent hover:bg-violet-500/50 transition-colors"

        {...helpHandlers("Drag to resize the Relations panel. Double-click to reset its width.")}
      />
      <div
        data-el="relations-panel-header"
        hidden
        style={{ display: "none" }}
        className="dbs-toolbar bg-[var(--peek-tint,#2d2a3b)] bg-none flex shrink-0 items-center gap-2 border-b border-zinc-800/60 px-3 py-1.5 text-[13px] font-semibold text-zinc-200"
      >
        <span className="flex-1 min-w-0 truncate" {...helpHandlers(`${table} Relations`)}>{table} Relations</span>
        <button
          onClick={onClose}
          className="inline-flex items-center justify-center rounded p-0.5 text-zinc-400 transition-colors hover:bg-zinc-800 hover:text-zinc-100"
          aria-label="Close the Relations panel"

          {...helpHandlers("Close the Relations panel")}
        >
          <X size={15} />
        </button>
      </div>
      <div data-el="relations-panel-body" className="min-h-0 flex-1 overflow-y-auto">
        {items.length === 0 ? null : (
          items.map((m) => {
            const label = m.relation.name?.trim() || m.table;
            /* The badge and name dim when the selected row has no related
               rows (or no value) through this relation right now; the
               buttons stay at full strength. */
            const hasRows = !pending && m.value != null && m.exists;
            const current = activeFilterOp(m);
            return (
              <div
                key={m.relation.id}
                className={clsx("border-b border-zinc-800/60 text-[12px]", (openRelationIds ? openRelationIds.includes(m.relation.id) : activeRelationId === m.relation.id) && "bg-violet-500/15")}
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
                <LabelTag
                  {...helpHandlers(returnLabel?.(m) ?? (openRelationIds ? `${openRelationIds.includes(m.relation.id) ? "Close" : "Open"} ${label} peek tab` : undefined))}
                  onClick={onSelect ? () => onSelect(m) : undefined}
                  aria-label={returnLabel?.(m) ?? (onSelect ? `${openRelationIds ? openRelationIds.includes(m.relation.id) ? "Close" : "Open" : "Select"} ${label} peek tab` : undefined)}
                  aria-pressed={onSelect ? openRelationIds ? openRelationIds.includes(m.relation.id) : activeRelationId === m.relation.id : undefined}
                  className={clsx("flex min-w-0 flex-1 items-center gap-2 text-left rounded", onSelect && "cursor-pointer hover:bg-violet-500/10 focus-visible:outline focus-visible:outline-violet-300")}
                >
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
                {returnLabel?.(m) && <span aria-hidden="true" className="text-violet-300 pr-1">↩</span>}
                </LabelTag>
                {/* One two-sided control: WITH on the left, WITHOUT on the
                    right; the active side is amber, click again to clear. */}
                {!hideFilterButtons && <div
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
                        type="button"
                        data-el={`relation-filter-${f.op}`}
                        onClick={(event) => {
                          event.preventDefault();
                          event.stopPropagation();
                          toggleRelationFilter(current, f.op,
                            (op) => onRelationFilter(m, op),
                            () => onFilterEnabled?.(m));
                        }}
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
                </div>}
                </div>
              </div>
            );
          })
        )}
      {(!hideNewRelation || onSoloChange || onDockChange || onCollapse || onRefresh) && <div role="group" aria-label="Relations tools" className="bg-[var(--peek-tint,#2d2a3b)] border-t border-zinc-800/60 px-2 py-1 flex flex-wrap items-center gap-1">
          {onCollapse && <button type="button" data-el="relation-panel-collapse"
            onClick={onCollapse} aria-label="Collapse master Relations panel"
            {...helpHandlers("Collapse the master Relations panel and keep peek tabs open")}
            className="inline-flex items-center justify-center rounded bg-zinc-800 p-1 text-zinc-300 hover:bg-zinc-700">
            <CaretDoubleLeft size={14} weight="bold" />
          </button>}
          {onDockChange && <div role="group" aria-label="Relations docking position" className="inline-flex overflow-hidden rounded">
            {(["bottom", "right"] as const).map((position) => <button type="button" key={position}
              aria-label={`Dock ${position}`}
              aria-pressed={dock === position} onClick={() => onDockChange(position)}
              {...helpHandlers(`Dock the Relations list and peek tabs to the ${position} of the table`)}
              className={clsx("inline-flex items-center justify-center border-0 shadow-none p-1", dock === position ? "bg-violet-600 text-white" : "bg-zinc-800 text-zinc-300 hover:bg-zinc-700")}>
              {position === "bottom" ? <AlignBottom size={14} /> : <AlignRight size={14} />}
            </button>)}
          </div>}
          {onSoloChange && <button type="button" data-el="relation-panel-solo"
            aria-label="Solo mode"
            aria-pressed={solo} onClick={() => onSoloChange(!solo)}
            {...helpHandlers("Solo mode: show only one relation tab at a time; the others stay loaded")}
            className={clsx("inline-flex items-center justify-center rounded border-0 shadow-none p-1 transition-colors",
              solo ? "bg-violet-600 text-white hover:bg-violet-500" : "bg-zinc-800 text-zinc-300 hover:bg-zinc-700")}>
            <Eye size={14} weight="bold" />
          </button>}
          {onRefresh && <button type="button" data-el="relation-panel-refresh"
            aria-label="Refresh relations" onClick={refresh}
            {...helpHandlers("Re-check which relations have rows and reload the peeks below, including nested peeks")}
            className="inline-flex items-center justify-center rounded bg-zinc-800 p-1 text-zinc-300 hover:bg-zinc-700">
            <ArrowsClockwise size={14} weight="bold" />
          </button>}
          {!hideNewRelation && <button
            type="button"
            data-el="relation-panel-new"
            onClick={() => onNew(column)}
            className="inline-flex items-center justify-center rounded bg-zinc-800 p-1 text-violet-300 hover:bg-zinc-700"
            aria-label="New Relation"

            {...helpHandlers(
              column
                ? `Define a new relation from ${column} to a column in another table`
                : "Define a new relation from this table to another table"
            )}
          >
            <Plus size={14} weight="bold" />
          </button>}
        </div>}
      </div>
    </div>
  );
}
