import { useEffect, useRef } from "react";
import { createPortal } from "react-dom";
import { Eye, EyeSlash } from "@phosphor-icons/react";
import clsx from "clsx";
import type { ColumnInfo } from "../types";

interface Props {
  anchor: { x: number; y: number };
  columns: ColumnInfo[];
  hidden: string[];
  onChange: (hidden: string[]) => void;
  onClose: () => void;
}

const MENU_WIDTH = 280;
const MENU_MAX_HEIGHT = 420;

export function ColumnsVisibilityMenu({
  anchor,
  columns,
  hidden,
  onChange,
  onClose,
}: Props) {
  const ref = useRef<HTMLDivElement>(null);
  const hiddenSet = new Set(hidden);

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

  const left = Math.max(
    8,
    Math.min(window.innerWidth - MENU_WIDTH - 8, anchor.x)
  );
  const top = Math.max(
    8,
    Math.min(window.innerHeight - MENU_MAX_HEIGHT - 8, anchor.y)
  );

  return createPortal(
    <div
      ref={ref}
      data-el="columns-menu"
      style={{ top, left, width: MENU_WIDTH, maxHeight: MENU_MAX_HEIGHT }}
      className="fixed z-[100] flex flex-col rounded border border-zinc-700 bg-zinc-900/95 backdrop-blur-sm shadow-xl shadow-black/60 text-[11px] text-zinc-200 select-none overflow-hidden"
      onClick={(e) => e.stopPropagation()}
    >
      <div className="px-3 py-1.5 border-b border-zinc-800 flex items-center justify-between gap-2">
        <span className="text-[10px] uppercase tracking-[0.12em] text-zinc-500">
          Columns
        </span>
        <div className="flex items-center gap-1">
          <button
            data-el="columns-show-all-btn"
            onClick={showAll}
            className="px-2 py-0.5 rounded text-zinc-300 hover:bg-zinc-800"
          >
            Show all
          </button>
          <button
            data-el="columns-hide-all-btn"
            onClick={hideAll}
            className="px-2 py-0.5 rounded text-zinc-300 hover:bg-zinc-800"
          >
            Hide all
          </button>
        </div>
      </div>

      <div className="overflow-y-auto py-1">
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
                <Eye size={14} className="shrink-0 text-accent-400" />
              )}
              <span className={clsx("truncate flex-1", hide && "line-through")}>
                {col.name}
              </span>
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
