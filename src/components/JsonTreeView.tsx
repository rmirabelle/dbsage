import { helpHandlers } from "../state/help";
import { memo, useCallback, useLayoutEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { useVirtualizer } from "@tanstack/react-virtual";
import { CaretRight, CaretDown, ArrowsOutSimple, ArrowsInSimple, PencilSimple, BracketsCurly } from "@phosphor-icons/react";
import clsx from "clsx";
import { buildJsonTreeRows, indexJsonTreeMatches, visibleJsonTreeRows } from "../lib/jsonTreeModel";

interface Props {
  data: unknown;
  search: string;
  activeIndex: number;
  /** Switch the host to the raw JSON editor. Absent = read-only tree. */
  onEdit?: () => void;
  /** Start fully expanded (the host remembered Expand all). */
  expandAll?: boolean;
  /** Reports Expand all / Collapse all clicks so the host can remember them. */
  onExpandAllChange?: (expandAll: boolean) => void;
}

function highlight(text: string, offsets: number[], length: number, start: number, active: number): ReactNode {
  if (!offsets.length) return text;
  const parts: ReactNode[] = [];
  let from = 0;
  offsets.forEach((offset, i) => {
    if (offset > from) parts.push(text.slice(from, offset));
    parts.push(<mark key={offset} className={clsx("rounded-[1px] bg-lime-400 text-black", start + i === active && "ring-2 ring-black")}>{text.slice(offset, offset + length)}</mark>);
    from = offset + length;
  });
  if (from < text.length) parts.push(text.slice(from));
  return parts;
}

/** Searching expands the logical tree, but mounts only the viewport's rows. */
export const JsonTreeView = memo(function JsonTreeView({ data, search, activeIndex, onEdit, expandAll = false, onExpandAllChange }: Props) {
  const rows = useMemo(() => buildJsonTreeRows(data), [data]);
  const [collapsed, setCollapsed] = useState(() => expandAll
    ? new Set<string>()
    : new Set(rows.filter((row) => row.container && !(Array.isArray(data) && row.path === "/0")).map((row) => row.path)));
  const visible = useMemo(() => visibleJsonTreeRows(rows, collapsed, !!search), [rows, collapsed, search]);
  const index = useMemo(() => indexJsonTreeMatches(visible, search), [visible, search]);
  const scrollRef = useRef<HTMLDivElement>(null);
  const getItemKey = useCallback((i: number) => visible[i].path, [visible]);
  const virtualizer = useVirtualizer({
    count: visible.length,
    getScrollElement: () => scrollRef.current,
    estimateSize: () => 20,
    getItemKey,
    overscan: 8,
    paddingStart: 8,
    paddingEnd: 8,
    scrollPaddingStart: 8,
  });
  const activeRow = search ? index.matches.findIndex((match) => activeIndex >= match.start && activeIndex < match.end) : -1;
  useLayoutEffect(() => {
    if (activeRow >= 0) virtualizer.scrollToIndex(activeRow, { align: "start" });
  }, [activeRow, activeIndex, search, data, virtualizer]);

  return <div className="h-full flex flex-col">
    <div className="shrink-0 h-7 pl-1 pr-2 bg-[#262a34] flex items-center gap-1 border-b border-zinc-800/40 text-[11px] text-zinc-400">
      {onEdit && <button data-el="json-tree-edit" onClick={onEdit} {...helpHandlers("Edit JSON")} className="h-5 w-5 inline-flex items-center justify-center rounded text-orange-400 hover:bg-zinc-800 hover:text-orange-300"><PencilSimple size={13} /></button>}
      <button data-el="json-tree-expand-all" onClick={() => { setCollapsed(new Set()); onExpandAllChange?.(true); }} {...helpHandlers("Expand all")} className="h-5 inline-flex items-center gap-1 px-1.5 rounded hover:bg-zinc-800 hover:text-zinc-100"><ArrowsOutSimple size={13} />Expand</button>
      <button data-el="json-tree-collapse-all" onClick={() => { setCollapsed(new Set(rows.filter((row) => row.container).map((row) => row.path))); onExpandAllChange?.(false); }} {...helpHandlers("Collapse all")} className="h-5 inline-flex items-center gap-1 px-1.5 rounded hover:bg-zinc-800 hover:text-zinc-100"><ArrowsInSimple size={13} />Collapse</button>
    </div>
    <div ref={scrollRef} data-el="json-tree" className="relative flex-1 min-h-0 overflow-auto px-3 text-[12px] font-mono leading-5">
      <div style={{ height: virtualizer.getTotalSize(), position: "relative", width: "100%" }}>
        {virtualizer.getVirtualItems().map((item) => {
          const row = visible[item.index];
          const match = index.matches[item.index];
          const open = !!search || !collapsed.has(row.path);
          return <div key={item.key} data-index={item.index} ref={virtualizer.measureElement}
            style={{ position: "absolute", top: 0, left: 0, width: "100%", transform: `translateY(${item.start}px)`, paddingLeft: row.depth * 18 }}>
            <div className={clsx("flex items-start gap-1", row.container && "rounded cursor-pointer hover:bg-zinc-900/50")}
              onClick={row.container ? () => { if (!search) setCollapsed((prev) => { const next = new Set(prev); if (next.has(row.path)) next.delete(row.path); else next.add(row.path); return next; }); } : undefined}>
              <span className="w-3 shrink-0 mt-[3px] text-zinc-500">{row.container && (open ? <CaretDown size={11} /> : <CaretRight size={11} />)}</span>
              {row.path !== "" && (row.arrayIndex && row.container && !Array.isArray(row.value)
                ? <span className="shrink-0 inline-flex items-center gap-1 text-zinc-500 italic"><BracketsCurly size={13} aria-hidden="true" />{row.key}</span>
                : <span className={clsx("shrink-0", row.arrayIndex ? "text-zinc-600" : "text-sky-300")}>{row.arrayIndex ? row.key : highlight(row.key, match.keys, search.length, match.start, activeIndex)}<span className="text-zinc-600">:</span></span>)}
              {row.container ? (Array.isArray(row.value) && <span className="text-zinc-600">{`[${row.count}]`}</span>)
                : <span className={clsx("min-w-0 break-all", row.value === null ? "text-zinc-600 italic" : typeof row.value === "number" ? "text-accent-300" : typeof row.value === "boolean" ? "text-amber-300" : "text-zinc-200")}>
                  {typeof row.value === "string" && '"'}{highlight(row.text, match.values, search.length, match.start + match.keys.length, activeIndex)}{typeof row.value === "string" && '"'}
                </span>}
            </div>
          </div>;
        })}
      </div>
    </div>
  </div>;
});
