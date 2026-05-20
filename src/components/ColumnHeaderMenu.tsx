import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import {
  ArrowUp,
  ArrowDown,
  X,
  Funnel,
  FunnelSimpleX,
} from "@phosphor-icons/react";
import clsx from "clsx";
import type { ColumnFilter, SortDirection, SortSpec } from "../types";

interface Props {
  column: string;
  anchor: { x: number; y: number };
  currentSort: SortSpec | null;
  currentFilter: ColumnFilter | null;
  onClose: () => void;
  onSort: (direction: SortDirection | null) => void;
  onFilter: (filter: ColumnFilter | null) => void;
}

const MENU_WIDTH = 280;

export function ColumnHeaderMenu({
  column,
  anchor,
  currentSort,
  currentFilter,
  onClose,
  onSort,
  onFilter,
}: Props) {
  const sortedHere =
    currentSort && currentSort.column === column ? currentSort.direction : null;
  const initialEq =
    currentFilter && currentFilter.op === "equals" ? currentFilter.value : "";
  const initialLike =
    currentFilter && currentFilter.op === "like" ? currentFilter.value : "";

  const [eqValue, setEqValue] = useState(initialEq);
  const [likeValue, setLikeValue] = useState(initialLike);
  const ref = useRef<HTMLDivElement>(null);

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
    onFilter(v ? { column, op: "equals", value: v } : null);
    onClose();
  };
  const commitLike = () => {
    const v = likeValue.trim();
    onFilter(v ? { column, op: "like", value: v } : null);
    onClose();
  };

  return createPortal(
    <div
      ref={ref}
      style={{ top, left, width: MENU_WIDTH }}
      className="fixed z-50 rounded border border-zinc-700 bg-zinc-900/95 backdrop-blur-sm shadow-xl shadow-black/60 text-[11px] text-zinc-200 select-none"
      onClick={(e) => e.stopPropagation()}
    >
      <div className="px-3 py-1.5 border-b border-zinc-800 text-zinc-500 truncate">
        <span className="font-mono text-zinc-300">{column}</span>
      </div>

      <div className="py-1">
        <MenuItem
          icon={<ArrowUp size={11} />}
          active={sortedHere === "asc"}
          onClick={() => {
            onSort("asc");
            onClose();
          }}
        >
          Sort ascending
        </MenuItem>
        <MenuItem
          icon={<ArrowDown size={11} />}
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
            icon={<X size={11} />}
            onClick={() => {
              onSort(null);
              onClose();
            }}
          >
            Clear sort
          </MenuItem>
        )}
      </div>

      <div className="border-t border-zinc-800 px-3 py-2 space-y-2">
        <FilterField
          label="EQUALS"
          icon={<Funnel size={10} />}
          value={eqValue}
          active={currentFilter?.op === "equals"}
          placeholder="exact value"
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
          label="LIKE"
          icon={<Funnel size={10} />}
          value={likeValue}
          active={currentFilter?.op === "like"}
          placeholder="contains"
          hint="adds %…% automatically · type your own % or _ to keep them"
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
        {currentFilter && (
          <button
            className="w-full inline-flex items-center justify-center gap-1.5 mt-1 px-2 py-1 rounded text-rose-300 hover:bg-rose-500/10"
            onClick={() => {
              onFilter(null);
              onClose();
            }}
          >
            <FunnelSimpleX size={11} /> Clear filter
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
  icon,
  value,
  active,
  placeholder,
  hint,
  onChange,
  onSubmit,
  onClear,
}: {
  label: string;
  icon: React.ReactNode;
  value: string;
  active: boolean;
  placeholder: string;
  hint?: string;
  onChange: (v: string) => void;
  onSubmit: () => void;
  onClear: () => void;
}) {
  const inputRef = useRef<HTMLInputElement>(null);
  return (
    <div>
      <div
        className={clsx(
          "inline-flex items-center gap-1 text-[10px] uppercase tracking-[0.12em] mb-1",
          active ? "text-accent-300" : "text-zinc-500"
        )}
      >
        {icon}
        {label}
        {active && <span className="text-accent-400">•</span>}
      </div>
      <div className="relative">
        <input
          ref={inputRef}
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
            "w-full bg-zinc-950 border rounded pl-2 pr-6 py-1 text-[11.5px] font-mono text-zinc-100 outline-none focus:border-accent-500",
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
            <X size={11} />
          </button>
        )}
      </div>
      {hint && (
        <div className="text-[9.5px] text-zinc-600 mt-1 leading-tight">{hint}</div>
      )}
    </div>
  );
}
