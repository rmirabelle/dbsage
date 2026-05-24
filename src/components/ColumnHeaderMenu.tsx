import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import {
  ArrowUp,
  ArrowDown,
  X,
  FunnelSimpleX,
} from "@phosphor-icons/react";
import clsx from "clsx";
import type { ColumnFilter, SortDirection, SortSpec } from "../types";

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

const MENU_WIDTH = 320;

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
  const initialEq =
    currentFilter && currentFilter.op === "equals" ? currentFilter.value : "";
  const initialLike =
    currentFilter && currentFilter.op === "like" ? currentFilter.value : "";

  const [eqValue, setEqValue] = useState(initialEq);
  const [likeValue, setLikeValue] = useState(initialLike);
  const [jsonPath, setJsonPath] = useState(currentFilter?.jsonPath ?? "");
  const [showPath, setShowPath] = useState(currentJsonShow ?? "");
  const ref = useRef<HTMLDivElement>(null);

  /** The displayed (extracted) property is independent of the filter property,
   *  and updates the column live as the user types. */
  const onShowChange = (v: string) => {
    setShowPath(v);
    onJsonShow(v.trim() ? v.trim() : null);
  };

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

  const commitEq = () => {
    const v = eqValue.trim();
    if (isJson) {
      const path = jsonPath.trim();
      onFilter(v && path ? { column, op: "equals", value: v, jsonPath: path } : null);
    } else {
      onFilter(v ? { column, op: "equals", value: v } : null);
    }
    onClose();
  };
  const commitLike = () => {
    const v = likeValue.trim();
    if (isJson) {
      const path = jsonPath.trim();
      onFilter(v && path ? { column, op: "like", value: v, jsonPath: path } : null);
    } else {
      onFilter(v ? { column, op: "like", value: v } : null);
    }
    onClose();
  };

  return createPortal(
    <div
      ref={ref}
      data-el="column-header-menu"
      style={{ top, left, width: MENU_WIDTH }}
      className="fixed z-50 rounded border border-zinc-700 bg-zinc-900/95 backdrop-blur-sm shadow-xl shadow-black/60 text-[12px] text-zinc-200 select-none"
      onClick={(e) => e.stopPropagation()}
    >
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

      {isJson && (
        <div className="px-3 pt-1 pb-2 space-y-1">
          <div className="flex items-stretch">
            <span className="flex items-center justify-center w-[88px] shrink-0 px-3 text-[11px] uppercase tracking-[0.12em] bg-zinc-900 border border-r-0 rounded-l whitespace-nowrap text-zinc-400 border-zinc-700">
              Show
            </span>
            <input
              data-el="json-show-input"
              value={showPath}
              placeholder="key · or a, b, c for several"
              onChange={(e) => onShowChange(e.target.value)}
              className="flex-1 min-w-0 bg-zinc-950 border border-zinc-700 rounded-r px-2 py-1 text-[12.5px] font-mono text-zinc-100 outline-none focus:border-accent-500"
            />
          </div>
          <p className="text-[11px] leading-snug text-zinc-500">
            Dotted path. Use{" "}
            <span className="font-mono text-zinc-400">arr[key=value].field</span>{" "}
            to target a matching element; comma-separate for several.
          </p>
        </div>
      )}

      <div className="border-t border-zinc-800 px-3 py-2 space-y-2">
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
        <FilterField
          label="EQUALS"
          value={eqValue}
          active={currentFilter?.op === "equals"}
          placeholder={isJson ? 'value · 33, true, "33"' : "exact value"}
          onChange={setEqValue}
          onSubmit={commitEq}
          onClear={() => {
            setEqValue("");
            if (currentFilter?.op === "equals") {
              onFilter(null);
              onClose();
            }
          }}
        />
        <FilterField
          label={isJson ? "Contains" : "LIKE"}
          value={likeValue}
          active={currentFilter?.op === "like"}
          placeholder={isJson ? "substring" : "contains"}
          onChange={setLikeValue}
          onSubmit={commitLike}
          onClear={() => {
            setLikeValue("");
            if (currentFilter?.op === "like") {
              onFilter(null);
              onClose();
            }
          }}
        />
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
            "flex items-center justify-center w-[88px] shrink-0 px-3 text-[11px] uppercase tracking-[0.12em] bg-zinc-900 border border-r-0 rounded-l whitespace-nowrap",
            active ? "text-accent-300 border-accent-500/60" : "text-zinc-400 border-zinc-700"
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
              "w-full bg-zinc-950 border rounded-r pl-2 pr-6 py-1 text-[12.5px] font-mono text-zinc-100 outline-none focus:border-accent-500",
              active ? "border-accent-500/60" : "border-zinc-700"
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
