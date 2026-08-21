import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { Eye, EyeSlash } from "@phosphor-icons/react";
import clsx from "clsx";
import type { ColumnInfo } from "../types";

interface Props {
  anchor: { x: number; y: number };
  columns: ColumnInfo[];
  hidden: string[];
  selectedRowCount: number;
  totalRowCount: number;
  onChange: (hidden: string[]) => void;
  onSelectAllRows: () => void;
  onSelectNoRows: () => void;
  onClose: () => void;
}

const MENU_WIDTH = 280;
const MENU_MAX_HEIGHT = 420;

export function ColumnsVisibilityMenu({
  anchor,
  columns,
  hidden,
  selectedRowCount,
  totalRowCount,
  onChange,
  onSelectAllRows,
  onSelectNoRows,
  onClose,
}: Props) {
  const rowsAllSelected = totalRowCount > 0 && selectedRowCount === totalRowCount;
  const rowsNoneSelected = selectedRowCount === 0;
  const colsAllVisible = hidden.length === 0;
  const colsNoneVisible = columns.length > 0 && hidden.length === columns.length;
  const baseBtn = "px-1.5 rounded text-zinc-200 font-semibold hover:bg-zinc-800";
  const activeBtn = "px-1.5 rounded font-semibold bg-emerald-900/60 text-emerald-200";
  const ref = useRef<HTMLDivElement>(null);
  const hiddenSet = new Set(hidden);

  /* Track the viewport height while open: a too-short peek window grows while
     a column menu is open (see DataGrid), and the height cap below must follow
     the new size or the extra room goes unused. */
  const [viewportHeight, setViewportHeight] = useState(window.innerHeight);
  useEffect(() => {
    const onResize = () => setViewportHeight(window.innerHeight);
    window.addEventListener("resize", onResize);
    return () => window.removeEventListener("resize", onResize);
  }, []);

  useEffect(() => {
    const onClick = (e: MouseEvent) => {
      if (!ref.current) return;
      if (!ref.current.contains(e.target as Node)) onClose();
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("mousedown", onClick);
    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("mousedown", onClick);
      window.removeEventListener("keydown", onKey);
    };
  }, [onClose]);

  const toggle = (name: string) => {
    if (hiddenSet.has(name)) {
      onChange(hidden.filter((n) => n !== name));
    } else {
      onChange([...hidden, name]);
    }
  };

  const showAll = () => onChange([]);
  const hideAll = () => onChange(columns.map((c) => c.name));

  /* Floor at 0, not 8: this menu anchors to the gutter cell whose left edge sits
     at the window's left edge, so an 8px floor would leave a visible gap. The
     column filter menus never hit this — their cells start past the gutter. */
  const left = Math.max(
    0,
    Math.min(window.innerWidth - MENU_WIDTH - 8, anchor.x)
  );
  /* Stay anchored under the button (like ColumnHeaderMenu) rather than reserving
     the full menu height up front — in a short window (e.g. a peek) reserving
     MENU_MAX_HEIGHT would push `top` to the corner and detach the menu. Instead
     cap the height to whatever space is left below the anchor. */
  const top = Math.max(8, Math.min(viewportHeight - 60, anchor.y));
  const maxHeight = Math.min(MENU_MAX_HEIGHT, viewportHeight - top - 8);

  return createPortal(
    <div
      ref={ref}
      data-el="columns-menu"
      style={{ top, left, width: MENU_WIDTH, maxHeight }}
      className="fixed z-[100] flex flex-col rounded-b border border-zinc-700 bg-zinc-900/95 backdrop-blur-sm shadow-xl shadow-black/60 text-[11px] text-zinc-200 select-none overflow-hidden"
      onClick={(e) => e.stopPropagation()}
    >
      <div className="px-3 py-1.5 border-b border-zinc-800 flex items-center justify-between gap-2">
        <span className="text-[10px] uppercase tracking-[0.12em] text-zinc-500">
          Show COLUMNS
        </span>
        <div className="flex items-center gap-2 text-zinc-500">
          <button
            data-el="columns-show-all-btn"
            onClick={showAll}
            className={colsAllVisible ? activeBtn : baseBtn}
          >
            ALL
          </button>
          <span className="text-zinc-700">|</span>
          <button
            data-el="columns-hide-all-btn"
            onClick={hideAll}
            className={colsNoneVisible ? activeBtn : baseBtn}
          >
            NONE
          </button>
        </div>
      </div>

      <div className="px-3 py-1.5 border-b border-zinc-800 flex items-center justify-between gap-2">
        <span className="text-[10px] uppercase tracking-[0.12em] text-zinc-500">
          Select ROWS
        </span>
        <div className="flex items-center gap-2 text-zinc-500">
          <button
            data-el="rows-select-all-btn"
            onClick={() => {
              onSelectAllRows();
              onClose();
            }}
            className={rowsAllSelected ? activeBtn : baseBtn}
          >
            ALL
          </button>
          <span className="text-zinc-700">|</span>
          <button
            data-el="rows-select-none-btn"
            onClick={() => {
              onSelectNoRows();
              onClose();
            }}
            className={rowsNoneSelected ? activeBtn : baseBtn}
          >
            NONE
          </button>
        </div>
      </div>

      <div className="flex-1 min-h-0 overflow-y-auto py-1">
        {columns.map((col) => {
          const hide = hiddenSet.has(col.name);
          return (
            <button
              key={col.name}
              data-el="column-toggle"
              onClick={() => toggle(col.name)}
              className={clsx(
                "w-full flex items-center gap-2 px-3 py-1.5 hover:bg-zinc-800 text-left",
                hide ? "text-zinc-500" : "text-zinc-100"
              )}
              title={hide ? "Click to show" : "Click to hide"}
            >
              {hide ? (
                <EyeSlash size={14} className="shrink-0 text-zinc-500" />
              ) : (
                <Eye size={14} className="shrink-0 text-emerald-400" />
              )}
              <span className="truncate flex-1">{col.name}</span>
              <span className="text-[10px] font-mono text-zinc-600 truncate shrink-0">
                {col.dataType}
              </span>
            </button>
          );
        })}
      </div>
    </div>,
    document.body
  );
}
