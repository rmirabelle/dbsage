import { useLayoutEffect, useRef, useState, type ReactNode } from "react";
import {
  CaretRight,
  CaretDown,
  ArrowsOutSimple,
  ArrowsInSimple,
} from "@phosphor-icons/react";
import clsx from "clsx";

interface Props {
  data: unknown;
  search: string;
  /** Global active-match ordinal (shared with the text panel) to mark + scroll. */
  activeIndex: number;
}

interface Ctx {
  ordinal: number;
  active: number;
  activeRef: React.MutableRefObject<HTMLElement | null>;
  q: string;
}

function scalarTone(v: unknown): string {
  if (v === null) return "text-zinc-600 italic";
  if (typeof v === "number") return "text-accent-300";
  if (typeof v === "boolean") return "text-amber-300";
  return "text-zinc-200";
}

function scalarText(v: unknown): string {
  if (v === null) return "null";
  if (typeof v === "string") return v;
  return String(v);
}

/** Wrap case-insensitive matches of `ctx.q` in <mark>, threading a running match
 *  ordinal so the active match (shared with the text panel) gets the strong
 *  highlight and a ref for scroll-into-view. */
function highlight(str: string, ctx: Ctx): ReactNode {
  const q = ctx.q;
  if (!q) return str;
  const lower = str.toLowerCase();
  const ql = q.toLowerCase();
  let idx = lower.indexOf(ql, 0);
  if (idx === -1) return str;
  const out: ReactNode[] = [];
  let from = 0;
  while (idx !== -1) {
    if (idx > from) out.push(str.slice(from, idx));
    const ord = ctx.ordinal++;
    const isActive = ord === ctx.active;
    out.push(
      <mark
        key={`${idx}-${ord}`}
        ref={
          isActive
            ? (el) => {
                ctx.activeRef.current = el;
              }
            : undefined
        }
        className={clsx(
          "rounded-[1px] bg-lime-400 text-black",
          isActive && "ring-2 ring-black"
        )}
      >
        {str.slice(idx, idx + ql.length)}
      </mark>
    );
    from = idx + ql.length;
    idx = lower.indexOf(ql, from);
  }
  if (from < str.length) out.push(str.slice(from));
  return out;
}

function entriesOf(value: object): [string, unknown][] {
  return Array.isArray(value)
    ? value.map((v, i) => [String(i), v] as [string, unknown])
    : Object.entries(value as Record<string, unknown>);
}

/** Every collapsible (container) node path, for "collapse all". Mirrors the
 *  path scheme used while rendering; the root has no path so it's excluded. */
function collectContainerPaths(data: unknown): string[] {
  const out: string[] = [];
  const walk = (value: unknown, path: string) => {
    if (value === null || typeof value !== "object") return;
    if (path) out.push(path);
    for (const [k, v] of entriesOf(value)) walk(v, `${path}/${k}`);
  };
  walk(data, "");
  return out;
}

/** Initial collapsed set: everything collapsed, except — when the root is a
 *  non-empty array — the first element, so its shape is visible at a glance.
 *  (No-op if that element isn't itself a container.) */
function initialCollapsed(data: unknown): Set<string> {
  const set = new Set(collectContainerPaths(data));
  if (Array.isArray(data) && data.length > 0) set.delete("/0");
  return set;
}

export function JsonTreeView({ data, search, activeIndex }: Props) {
  const [collapsed, setCollapsed] = useState<Set<string>>(() =>
    initialCollapsed(data)
  );
  const scrollRef = useRef<HTMLDivElement>(null);
  const activeRef = useRef<HTMLElement | null>(null);
  const q = search.trim();
  const searching = q.length > 0;

  useLayoutEffect(() => {
    activeRef.current?.scrollIntoView({ block: "nearest" });
  }, [activeIndex, search, data]);

  const toggle = (path: string) =>
    setCollapsed((prev) => {
      const next = new Set(prev);
      if (next.has(path)) next.delete(path);
      else next.add(path);
      return next;
    });

  /* Match-ordinal counter, rebuilt each render in display order. Array indices
     are NOT highlighted/counted (they don't appear in the pretty-printed text),
     keeping the tree's ordinals aligned with the text panel's. */
  const ctx: Ctx = { ordinal: 0, active: activeIndex, activeRef, q };

  const keyNode = (k: string, isArrayIndex: boolean): ReactNode =>
    isArrayIndex ? (
      <span className="text-zinc-600 shrink-0">{k}:</span>
    ) : (
      <span className="shrink-0">
        <span className="text-sky-300">{highlight(k, ctx)}</span>
        <span className="text-zinc-600">:</span>
      </span>
    );

  const renderScalar = (value: unknown): ReactNode => (
    <span className={clsx("break-all", scalarTone(value))}>
      {typeof value === "string" ? (
        <>
          &quot;{highlight(value, ctx)}&quot;
        </>
      ) : (
        highlight(scalarText(value), ctx)
      )}
    </span>
  );

  const renderEntry = (
    keyLabel: ReactNode,
    value: unknown,
    path: string
  ): ReactNode => {
    if (value !== null && typeof value === "object") {
      const entries = entriesOf(value);
      const isArray = Array.isArray(value);
      const open = searching || !collapsed.has(path);
      return (
        <div key={path}>
          <div
            className="flex items-start gap-1 rounded px-1 -mx-1 cursor-pointer hover:bg-zinc-900/50"
            onClick={() => {
              if (!searching) toggle(path);
            }}
          >
            <span className="mt-[3px] shrink-0 text-zinc-500">
              {open ? <CaretDown size={11} /> : <CaretRight size={11} />}
            </span>
            {keyLabel}
            <span className="text-zinc-600">
              {isArray ? `[${entries.length}]` : `{${entries.length}}`}
            </span>
          </div>
          {open && (
            <div className="ml-[5px] border-l border-zinc-800/60 pl-3">
              {entries.map(([k, v]) =>
                renderEntry(keyNode(k, isArray), v, `${path}/${k}`)
              )}
            </div>
          )}
        </div>
      );
    }
    return (
      <div key={path} className="flex items-start gap-1 pl-[16px]">
        {keyLabel}
        {renderScalar(value)}
      </div>
    );
  };

  let body: ReactNode;
  if (data !== null && typeof data === "object") {
    const isArray = Array.isArray(data);
    body = entriesOf(data).map(([k, v]) =>
      renderEntry(keyNode(k, isArray), v, `/${k}`)
    );
  } else {
    body = <div className="pl-[16px]">{renderScalar(data)}</div>;
  }

  return (
    <div className="h-full flex flex-col">
      <div className="shrink-0 h-7 px-2 flex items-center justify-end gap-0.5 border-b border-zinc-800/40 text-zinc-400">
        <button
          data-el="json-tree-expand-all"
          onClick={() => setCollapsed(new Set())}
          title="Expand all"
          className="h-5 w-5 inline-flex items-center justify-center rounded hover:bg-zinc-800 hover:text-zinc-100"
        >
          <ArrowsOutSimple size={13} />
        </button>
        <button
          data-el="json-tree-collapse-all"
          onClick={() => setCollapsed(new Set(collectContainerPaths(data)))}
          title="Collapse all"
          className="h-5 w-5 inline-flex items-center justify-center rounded hover:bg-zinc-800 hover:text-zinc-100"
        >
          <ArrowsInSimple size={13} />
        </button>
      </div>
      <div
        ref={scrollRef}
        data-el="json-tree"
        className="flex-1 min-h-0 overflow-auto px-3 py-2 text-[12px] font-mono leading-5"
      >
        {body}
      </div>
    </div>
  );
}
