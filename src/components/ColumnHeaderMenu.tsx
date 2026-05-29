import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import {
  ArrowUp,
  ArrowDown,
  X,
  FunnelSimpleX,
} from "@phosphor-icons/react";
import clsx from "clsx";
import { AutoGrowTextarea } from "./AutoGrowTextarea";
import { COMPARE_OPS } from "../types";
import type { ColumnFilter, FilterOp, SortDirection, SortSpec } from "../types";

const COMPARE_OP_SET = new Set<FilterOp>(["gt", "gte", "lt", "lte"]);

interface Props {
  column: string;
  columnType: string;
  anchor: { x: number; y: number };
  currentSort: SortSpec | null;
  currentFilter: ColumnFilter | null;
  currentJsonShow: string | null;
  onClose: () => void;
  onSort: (direction: SortDirection | null) => void;
  onFilter: (filter: ColumnFilter | null) => void;
  onJsonShow: (path: string | null) => void;
}

const MENU_WIDTH = 380;

export function ColumnHeaderMenu({
  column,
  columnType,
  anchor,
  currentSort,
  currentFilter,
  currentJsonShow,
  onClose,
  onSort,
  onFilter,
  onJsonShow,
}: Props) {
  const isJson = columnType.trim().toLowerCase() === "json";
  const sortedHere =
    currentSort && currentSort.column === column ? currentSort.direction : null;

  const curOp = currentFilter?.op ?? null;
  const eqActive = curOp === "equals" || curOp === "ne";
  const likeActive = curOp === "like" || curOp === "notlike";
  const nullActive = curOp === "isnull" || curOp === "notnull";
  const compareActive = !!curOp && COMPARE_OP_SET.has(curOp);

  /* The combined toggles share one value input per pair, so prefill from
     whichever variant is the active filter. */
  const [eqOp, setEqOp] = useState<FilterOp>(eqActive ? curOp! : "equals");
  const [eqValue, setEqValue] = useState(eqActive ? currentFilter!.value : "");
  const [likeOp, setLikeOp] = useState<FilterOp>(likeActive ? curOp! : "like");
  const [likeValue, setLikeValue] = useState(
    likeActive ? currentFilter!.value : ""
  );
  const [compareOp, setCompareOp] = useState<FilterOp>(
    compareActive ? curOp! : "gt"
  );
  const [compareValue, setCompareValue] = useState(
    compareActive ? currentFilter!.value : ""
  );
  const [jsonPath, setJsonPath] = useState(currentFilter?.jsonPath ?? "");
  const [showPath, setShowPath] = useState(currentJsonShow ?? "");
  const ref = useRef<HTMLDivElement>(null);

  /** The displayed (extracted) property is independent of the filter property,
   *  and updates the column live as the user types. */
  const onShowChange = (v: string) => {
    setShowPath(v);
    onJsonShow(v.trim() ? v.trim() : null);
  };

  const showActive = showPath.trim().length > 0;

  useEffect(() => {
    const onMouseDown = (e: MouseEvent) => {
      if (!ref.current) return;
      const target = e.target as HTMLElement | null;
      if (!target) return;
      if (ref.current.contains(target)) return;
      /**
       * Skip closing when the mousedown is on any column header — the
       * column-header onClick handler is responsible for toggling its own
       * menu, and closing here first would re-open the menu on the upcoming
       * click event.
       */
      if (target.closest("[data-column-header]")) return;
      onClose();
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("mousedown", onMouseDown);
    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("mousedown", onMouseDown);
      window.removeEventListener("keydown", onKey);
    };
  }, [onClose]);

  const left = Math.max(8, Math.min(window.innerWidth - MENU_WIDTH - 8, anchor.x));
  const top = Math.max(8, Math.min(window.innerHeight - 24, anchor.y));

  /* JSON columns keep the original EQUALS / Contains fields (always op
     "equals"/"like" with a path); non-JSON columns use the combined toggles. */
  const commitEqJson = () => {
    const v = eqValue.trim();
    const path = jsonPath.trim();
    onFilter(v && path ? { column, op: "equals", value: v, jsonPath: path } : null);
    onClose();
  };
  const commitLikeJson = () => {
    const v = likeValue.trim();
    const path = jsonPath.trim();
    onFilter(v && path ? { column, op: "like", value: v, jsonPath: path } : null);
    onClose();
  };

  /* Combined-toggle commits (non-JSON). An empty value clears the filter. */
  const commitEquality = () => {
    const v = eqValue.trim();
    onFilter(v ? { column, op: eqOp, value: v } : null);
    onClose();
  };
  const commitLikeness = () => {
    const v = likeValue.trim();
    onFilter(v ? { column, op: likeOp, value: v } : null);
    onClose();
  };
  const commitNull = (op: FilterOp) => {
    onFilter({ column, op, value: "" });
    onClose();
  };
  const commitCompare = () => {
    const v = compareValue.trim();
    onFilter(v ? { column, op: compareOp, value: v } : null);
    onClose();
  };

  return createPortal(
    <div
      ref={ref}
      data-el="column-header-menu"
      style={{ top, left, width: MENU_WIDTH }}
      className="fixed z-[100] rounded border border-zinc-700 bg-zinc-900/95 backdrop-blur-sm shadow-xl shadow-black/60 text-[12px] text-zinc-200 select-none"
      onClick={(e) => e.stopPropagation()}
    >
      {!isJson && (
        <div className="py-1">
          <MenuItem
            icon={<ArrowUp size={15} />}
            active={sortedHere === "asc"}
            onClick={() => {
              onSort("asc");
              onClose();
            }}
          >
            Sort ascending
          </MenuItem>
          <MenuItem
            icon={<ArrowDown size={15} />}
            active={sortedHere === "desc"}
            onClick={() => {
              onSort("desc");
              onClose();
            }}
          >
            Sort descending
          </MenuItem>
          {sortedHere && (
            <MenuItem
              icon={<X size={15} />}
              onClick={() => {
                onSort(null);
                onClose();
              }}
            >
              Clear sort
            </MenuItem>
          )}
        </div>
      )}

      {isJson && (
        <div className="px-3 pt-3 pb-2 space-y-1">
          <div className="flex items-stretch">
            <span
              className={clsx(
                "flex items-center justify-center w-[88px] shrink-0 px-3 text-[11px] uppercase tracking-[0.12em] rounded-l whitespace-nowrap",
                showActive
                  ? "bg-emerald-500 text-black border-2 border-r-0 border-emerald-500"
                  : "bg-zinc-900 text-zinc-400 border border-r-0 border-zinc-700"
              )}
            >
              Show
            </span>
            <AutoGrowTextarea
              dataEl="json-show-input"
              value={showPath}
              placeholder="key · or a, b, c for several"
              onChange={onShowChange}
              onKeyDown={(e) => {
                if (e.key === "Enter") {
                  e.preventDefault();
                  onShowChange(showPath);
                  onClose();
                }
              }}
              className={clsx(
                "flex-1 min-w-0 bg-zinc-950 rounded-r px-2 py-[7px] text-[12.5px] font-mono text-zinc-100 outline-none focus:border-accent-500",
                showActive ? "border-2 border-emerald-500" : "border border-zinc-700"
              )}
            />
          </div>
          <p className="text-[11px] leading-snug text-zinc-500">
            Dotted path. Use{" "}
            <span className="font-mono text-zinc-400">arr[key=value].field</span>{" "}
            to target a matching element; comma-separate for several.
          </p>
        </div>
      )}

      <div className="border-t border-zinc-800 px-3 py-2 space-y-1">
        {isJson && (
          <div className="flex items-stretch">
            <span className="flex items-center justify-center w-[88px] shrink-0 px-3 text-[11px] uppercase tracking-[0.12em] bg-zinc-900 border border-r-0 rounded-l whitespace-nowrap text-zinc-400 border-zinc-700">
              Property
            </span>
            <input
              data-el="json-path-input"
              value={jsonPath}
              placeholder="key or a.b.c"
              onChange={(e) => setJsonPath(e.target.value)}
              className="flex-1 min-w-0 bg-zinc-950 border border-zinc-700 rounded-r px-2 py-1 text-[12.5px] font-mono text-zinc-100 outline-none focus:border-accent-500"
            />
          </div>
        )}
        {isJson ? (
          <>
            <FilterField
              label="EQUALS"
              value={eqValue}
              active={currentFilter?.op === "equals"}
              placeholder={'value · 33, true, "33"'}
              onChange={setEqValue}
              onSubmit={commitEqJson}
              onClear={() => {
                setEqValue("");
                if (currentFilter?.op === "equals") {
                  onFilter(null);
                  onClose();
                }
              }}
            />
            <FilterField
              label="Contains"
              value={likeValue}
              active={currentFilter?.op === "like"}
              placeholder="substring"
              onChange={setLikeValue}
              onSubmit={commitLikeJson}
              onClear={() => {
                setLikeValue("");
                if (currentFilter?.op === "like") {
                  onFilter(null);
                  onClose();
                }
              }}
            />
          </>
        ) : (
          <>
            <div className="flex">
              <Segmented
                options={[
                  { op: "isnull", label: "Null" },
                  { op: "notnull", label: "Not Null" },
                ]}
                value={nullActive ? currentFilter!.op : ""}
                active={nullActive}
                filled={nullActive}
                onChange={commitNull}
              />
            </div>
            <ToggleField
              options={[
                { op: "equals", label: "Equals" },
                { op: "ne", label: "Not Eq" },
              ]}
              op={eqOp}
              onOp={setEqOp}
              active={eqActive}
              value={eqValue}
              placeholder="value"
              onChange={setEqValue}
              onSubmit={commitEquality}
              onClear={() => {
                setEqValue("");
                if (eqActive) {
                  onFilter(null);
                  onClose();
                }
              }}
            />
            <ToggleField
              options={[
                { op: "like", label: "Like" },
                { op: "notlike", label: "Not Like" },
              ]}
              op={likeOp}
              onOp={setLikeOp}
              active={likeActive}
              value={likeValue}
              placeholder="contains"
              onChange={setLikeValue}
              onSubmit={commitLikeness}
              onClear={() => {
                setLikeValue("");
                if (likeActive) {
                  onFilter(null);
                  onClose();
                }
              }}
            />
            <ToggleField
              options={COMPARE_OPS}
              op={compareOp}
              onOp={setCompareOp}
              active={compareActive}
              value={compareValue}
              placeholder="value"
              onChange={setCompareValue}
              onSubmit={commitCompare}
              onClear={() => {
                setCompareValue("");
                if (compareActive) {
                  onFilter(null);
                  onClose();
                }
              }}
            />
          </>
        )}
        {isJson && (
          <p className="text-[11px] leading-snug text-zinc-500">
            Matches any object, including inside arrays. Values are auto-typed —
            wrap in quotes to force text.
          </p>
        )}
        {(currentFilter || (isJson && currentJsonShow)) && (
          <button
            className="w-full inline-flex items-center justify-center gap-1.5 mt-1 px-2 py-1 rounded text-rose-300 hover:bg-rose-500/10"
            onClick={() => {
              onFilter(null);
              if (isJson) onJsonShow(null);
              onClose();
            }}
          >
            <FunnelSimpleX size={15} /> {isJson ? "Clear" : "Clear filter"}
          </button>
        )}
      </div>
    </div>,
    document.body
  );
}

/** A segmented toggle: mutually-exclusive operator buttons. When `attached`,
 * it squares its right edge to butt against a value input. */
function Segmented({
  options,
  value,
  active,
  filled,
  onChange,
  attached,
}: {
  options: { op: FilterOp; label: string }[];
  value: FilterOp | "";
  /** The row is the applied filter (drives the 2px green outline). */
  active: boolean;
  /** The selected op has a value committed/typed (green vs. just toggled). */
  filled: boolean;
  onChange: (op: FilterOp) => void;
  attached?: boolean;
}) {
  return (
    <div
      className={clsx(
        /* Fixed total width so every toggle group lines up, regardless of how
           many buttons it has or how wide each label is. */
        "flex w-[160px] shrink-0",
        attached ? "rounded-l" : "rounded",
        active ? "border-2 border-emerald-500" : "border border-zinc-700",
        attached && "border-r-0"
      )}
    >
      {options.map((o, i) => {
        const selected = value === o.op;
        return (
          <button
            key={o.op}
            data-el={`filter-op-${o.op}`}
            onClick={() => onChange(o.op)}
            className={clsx(
              "flex-1 min-w-0 px-1 py-1 text-center text-[10px] font-semibold uppercase tracking-[0.06em] whitespace-nowrap transition-colors",
              i > 0 && "border-l border-zinc-700",
              selected
                ? filled
                  ? "bg-emerald-500 text-black"
                  : "bg-zinc-700 text-zinc-200"
                : "text-zinc-400 hover:bg-zinc-800"
            )}
          >
            {o.label}
          </button>
        );
      })}
    </div>
  );
}

/** A combined operator toggle (left) paired with a value input (right). */
function ToggleField({
  options,
  op,
  onOp,
  active,
  value,
  placeholder,
  onChange,
  onSubmit,
  onClear,
}: {
  options: { op: FilterOp; label: string }[];
  op: FilterOp;
  onOp: (op: FilterOp) => void;
  active: boolean;
  value: string;
  placeholder: string;
  onChange: (v: string) => void;
  onSubmit: () => void;
  onClear: () => void;
}) {
  const inputRef = useRef<HTMLInputElement>(null);
  return (
    <div className="flex items-stretch">
      <Segmented
        options={options}
        value={op}
        active={active}
        filled={value.trim().length > 0}
        onChange={onOp}
        attached
      />
      <div className="relative flex-1">
        <input
          ref={inputRef}
          data-el="column-filter-input"
          value={value}
          placeholder={placeholder}
          onChange={(e) => onChange(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              e.preventDefault();
              onSubmit();
            }
          }}
          className={clsx(
            "w-full bg-zinc-950 rounded-r pl-2 pr-6 py-1 text-[12.5px] font-mono text-zinc-100 outline-none focus:border-accent-500",
            active ? "border-2 border-emerald-500" : "border border-zinc-700"
          )}
        />
        {value && (
          <button
            onClick={() => {
              onClear();
              inputRef.current?.focus();
            }}
            className="absolute right-1.5 top-1/2 -translate-y-1/2 text-zinc-500 hover:text-zinc-200"
            aria-label="Clear"
          >
            <X size={14} />
          </button>
        )}
      </div>
    </div>
  );
}

function MenuItem({
  icon,
  active,
  onClick,
  children,
}: {
  icon: React.ReactNode;
  active?: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      onClick={onClick}
      className={clsx(
        "w-full text-left px-3 py-1.5 inline-flex items-center gap-2 hover:bg-zinc-800",
        active && "text-accent-300 bg-accent-500/10"
      )}
    >
      <span className={clsx(active ? "text-accent-300" : "text-zinc-500")}>
        {icon}
      </span>
      {children}
    </button>
  );
}

function FilterField({
  label,
  value,
  active,
  placeholder,
  onChange,
  onSubmit,
  onClear,
}: {
  label: string;
  value: string;
  active: boolean;
  placeholder: string;
  onChange: (v: string) => void;
  onSubmit: () => void;
  onClear: () => void;
}) {
  const inputRef = useRef<HTMLInputElement>(null);
  return (
    <div>
      <div className="flex items-stretch">
        <span
          className={clsx(
            "flex items-center justify-center w-[88px] shrink-0 px-3 text-[11px] uppercase tracking-[0.12em] rounded-l whitespace-nowrap",
            active
              ? "bg-emerald-500 text-black border-2 border-r-0 border-emerald-500"
              : "bg-zinc-900 text-zinc-400 border border-r-0 border-zinc-700"
          )}
        >
          {label}
        </span>
        <div className="relative flex-1">
          <input
            ref={inputRef}
            data-el="column-filter-input"
            value={value}
            placeholder={placeholder}
            onChange={(e) => onChange(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                e.preventDefault();
                onSubmit();
              }
            }}
            className={clsx(
              "w-full bg-zinc-950 rounded-r pl-2 pr-6 py-1 text-[12.5px] font-mono text-zinc-100 outline-none focus:border-accent-500",
              active ? "border-2 border-emerald-500" : "border border-zinc-700"
            )}
          />
          {value && (
            <button
              onClick={() => {
                onClear();
                inputRef.current?.focus();
              }}
              className="absolute right-1.5 top-1/2 -translate-y-1/2 text-zinc-500 hover:text-zinc-200"
              aria-label="Clear"
            >
              <X size={14} />
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
