import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import {
  Copy,
  X,
  Check,
  CaretUp,
  CaretDown,
  MagnifyingGlass as Search,
} from "@phosphor-icons/react";
import clsx from "clsx";
import { useUi } from "../state/ui";
import type { ColumnInfo } from "../types";

interface Props {
  column: ColumnInfo | null;
  value: unknown;
  rowOrdinal: number | null;
  editable: boolean;
  onSave?: (value: string | null) => Promise<void>;
  onClose: () => void;
}

export function ExpandedPanel({
  column,
  value,
  rowOrdinal,
  editable,
  onSave,
  onClose,
}: Props) {
  const height = useUi((s) => s.expandedPanelHeight);
  const setHeight = useUi((s) => s.setExpandedPanelHeight);
  const dragStateRef = useRef<{ startY: number; startHeight: number } | null>(
    null
  );

  const { text: initialText, isJson } = useMemo(
    () => formatValue(value, column),
    [value, column]
  );

  const [text, setText] = useState(initialText);
  const [search, setSearch] = useState("");
  const [activeMatch, setActiveMatch] = useState(0);
  const [copied, setCopied] = useState(false);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);

  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const backdropRef = useRef<HTMLDivElement>(null);
  const activeMatchRef = useRef<HTMLElement | null>(null);
  const searchInputRef = useRef<HTMLInputElement>(null);

  /** Reset the editor whenever the selected cell (value/column) changes. */
  useEffect(() => {
    setText(initialText);
    setSearch("");
  }, [initialText]);

  const isNull = value === null || value === undefined;
  const isJsonColumn = isJsonType(column);
  const canEdit = editable && column != null && onSave != null;
  const dirty = canEdit && text !== initialText;

  const matches = useMemo(() => findMatches(text, search), [text, search]);
  const matchCount = matches.length;
  const activeIndex =
    matchCount > 0 ? ((activeMatch % matchCount) + matchCount) % matchCount : 0;

  const highlighted = useMemo(
    () =>
      renderHighlight(text, matches, search.length, activeIndex, activeMatchRef),
    [text, matches, activeIndex, search.length]
  );

  /** Reset to the first match whenever the search term changes. */
  useEffect(() => {
    setActiveMatch(0);
  }, [search]);

  const gotoMatch = (delta: number) => {
    if (matchCount === 0) return;
    setActiveMatch((m) => m + delta);
  };

  /** Scroll the active match into view in the textarea. */
  useLayoutEffect(() => {
    const ta = textareaRef.current;
    const mark = activeMatchRef.current;
    if (!ta || !mark || matchCount === 0) return;
    const target = Math.max(0, mark.offsetTop - 8);
    ta.scrollTop = target;
    if (backdropRef.current) backdropRef.current.scrollTop = target;
  }, [activeIndex, matchCount, search]);

  const syncScroll = () => {
    const ta = textareaRef.current;
    const bd = backdropRef.current;
    if (!ta || !bd) return;
    bd.scrollTop = ta.scrollTop;
    bd.scrollLeft = ta.scrollLeft;
  };

  const onCopy = async () => {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      setTimeout(() => setCopied(false), 1200);
    } catch {
      /* no-op */
    }
  };

  const handleSave = async () => {
    if (!onSave || !dirty || saving) return;
    if (column?.key === "PRI") {
      const ok = confirm(
        `"${column.name}" is a primary-key column. Editing it can break foreign-key references and shifts the row's identity.\n\nContinue?`
      );
      if (!ok) return;
    }
    let toSave: string | null =
      text.trim() === "" && column?.nullable ? null : text;
    if (toSave !== null && isJsonColumn) {
      try {
        toSave = JSON.stringify(JSON.parse(toSave));
      } catch {
        alert("This value isn't valid JSON — fix it before saving.");
        return;
      }
    }
    setSaving(true);
    try {
      await onSave(toSave);
      setSaved(true);
      window.setTimeout(() => setSaved(false), 2000);
    } catch (e) {
      alert(`Update failed: ${String(e)}`);
    } finally {
      setSaving(false);
    }
  };

  const layerClass =
    "px-3 py-2 text-[12px] leading-5 font-mono whitespace-pre-wrap break-words";

  return (
    <div
      data-el="expanded-panel"
      style={{ height }}
      className="shrink-0 border-t border-zinc-800 bg-zinc-950 flex flex-col relative"
    >
      <div
        role="separator"
        aria-orientation="horizontal"
        onPointerDown={(e) => {
          e.preventDefault();
          dragStateRef.current = { startY: e.clientY, startHeight: height };
          const prevCursor = document.body.style.cursor;
          const prevUserSelect = document.body.style.userSelect;
          document.body.style.cursor = "ns-resize";
          document.body.style.userSelect = "none";

          const onMove = (ev: PointerEvent) => {
            if (!dragStateRef.current) return;
            const dy = ev.clientY - dragStateRef.current.startY;
            // Dragging down shrinks the panel (panel is anchored at bottom).
            setHeight(dragStateRef.current.startHeight - dy);
          };
          const onUp = () => {
            dragStateRef.current = null;
            document.body.style.cursor = prevCursor;
            document.body.style.userSelect = prevUserSelect;
            document.removeEventListener("pointermove", onMove);
            document.removeEventListener("pointerup", onUp);
            document.removeEventListener("pointercancel", onUp);
          };
          document.addEventListener("pointermove", onMove);
          document.addEventListener("pointerup", onUp);
          document.addEventListener("pointercancel", onUp);
        }}
        onDoubleClick={() => setHeight(240)}
        className="absolute top-0 left-0 right-0 h-1.5 -translate-y-1/2 z-10 cursor-ns-resize bg-transparent hover:bg-accent-500/40 transition-colors"
        title="Drag to resize · double-click to reset"
      />
      <div className="h-7 shrink-0 px-3 flex items-center gap-3 border-b border-zinc-800/60 text-[11px] text-zinc-400">
        <span className="text-[10px] font-semibold uppercase tracking-[0.12em] text-zinc-500">
          Expanded
        </span>
        {column ? (
          <>
            <span className="text-zinc-600">·</span>
            <span className="font-mono text-zinc-200 truncate">{column.name}</span>
            <span className="text-zinc-600">·</span>
            <span className="font-mono text-zinc-500 truncate">
              {column.dataType}
              {isJson && " (pretty)"}
            </span>
            {rowOrdinal != null && (
              <>
                <span className="text-zinc-600">·</span>
                <span className="font-mono text-zinc-500">row {rowOrdinal}</span>
              </>
            )}
          </>
        ) : (
          <span className="text-zinc-600">Click a cell to view its value</span>
        )}

        <div className="ml-auto flex items-center gap-1">
          {column && (
            <button
              data-el="expanded-copy-btn"
              onClick={onCopy}
              className="inline-flex items-center gap-1 px-2 py-0.5 rounded hover:bg-zinc-800 text-zinc-400 hover:text-zinc-100"
              title="Copy to clipboard"
            >
              {copied ? (
                <>
                  <Check size={13} className="text-emerald-400" />
                  <span>Copied</span>
                </>
              ) : (
                <>
                  <Copy size={13} />
                  <span>Copy</span>
                </>
              )}
            </button>
          )}
          <button
            data-el="expanded-close-btn"
            onClick={onClose}
            className="p-1 rounded hover:bg-zinc-800 text-zinc-400 hover:text-zinc-100"
            aria-label="Close expanded panel"
            title="Close (Esc)"
          >
            <X size={13} />
          </button>
        </div>
      </div>

      <div className="relative flex-1 min-h-0">
        <div
          ref={backdropRef}
          aria-hidden="true"
          className={clsx(
            "absolute inset-0 overflow-hidden text-transparent select-none pointer-events-none",
            layerClass
          )}
        >
          {column ? highlighted : null}
        </div>
        <textarea
          ref={textareaRef}
          data-el="expanded-editor"
          value={column ? text : ""}
          spellCheck={false}
          readOnly={!canEdit}
          placeholder={column && isNull ? "NULL" : ""}
          onChange={(e) => {
            setText(e.target.value);
            setSaved(false);
          }}
          onScroll={syncScroll}
          className={clsx(
            "absolute inset-0 h-full w-full resize-none overflow-auto border-0 bg-transparent outline-none",
            layerClass,
            column ? "text-zinc-200" : "text-zinc-600",
            !canEdit && "cursor-default"
          )}
        />
      </div>

      <div
        data-el="expanded-footer"
        className="h-9 shrink-0 px-3 flex items-center gap-2 border-t border-zinc-800/60"
      >
        <div className="relative w-64 max-w-[55%]">
          <Search
            size={13}
            className="absolute left-2 top-1/2 -translate-y-1/2 text-zinc-500 pointer-events-none"
          />
          <input
            ref={searchInputRef}
            data-el="expanded-search-input"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                e.preventDefault();
                gotoMatch(e.shiftKey ? -1 : 1);
              }
            }}
            placeholder="Search value…"
            className="w-full bg-zinc-900 border border-zinc-800 rounded pl-7 pr-7 py-1 text-[11px] text-zinc-200 placeholder:text-zinc-600 focus:border-accent-500 outline-none"
          />
          {search && (
            <button
              data-el="expanded-search-clear-btn"
              onClick={() => {
                setSearch("");
                searchInputRef.current?.focus();
              }}
              className="absolute right-1.5 top-1/2 -translate-y-1/2 text-zinc-500 hover:text-zinc-200"
              aria-label="Clear search"
            >
              <X size={13} />
            </button>
          )}
        </div>
        {search &&
          (matchCount > 0 ? (
            <div className="flex items-center gap-0.5 shrink-0 text-zinc-400">
              <button
                data-el="search-prev-btn"
                onClick={() => gotoMatch(-1)}
                disabled={matchCount <= 1}
                aria-label="Previous match"
                title="Previous match (Shift+Enter)"
                className="h-5 w-5 inline-flex items-center justify-center rounded hover:bg-zinc-800 hover:text-zinc-100 disabled:opacity-30 disabled:hover:bg-transparent"
              >
                <CaretUp size={12} />
              </button>
              <button
                data-el="search-next-btn"
                onClick={() => gotoMatch(1)}
                disabled={matchCount <= 1}
                aria-label="Next match"
                title="Next match (Enter)"
                className="h-5 w-5 inline-flex items-center justify-center rounded hover:bg-zinc-800 hover:text-zinc-100 disabled:opacity-30 disabled:hover:bg-transparent"
              >
                <CaretDown size={12} />
              </button>
              <span className="ml-1 text-[10px] font-mono text-zinc-500 tabular-nums">
                {activeIndex + 1}/{matchCount}
              </span>
            </div>
          ) : (
            <span className="shrink-0 text-[10px] font-mono text-zinc-500">
              No matches
            </span>
          ))}

        <div className="ml-auto flex items-center gap-2">
          {saved && (
            <span
              data-el="expanded-save-status"
              className="inline-flex items-center gap-1 text-[11px] text-emerald-400"
            >
              <Check size={13} weight="bold" /> Saved
            </span>
          )}
          <button
            data-el="expanded-save-btn"
            onClick={handleSave}
            disabled={!dirty || saving}
            title={
              !editable
                ? "Editing requires a primary key on this table"
                : undefined
            }
            className="px-3 py-1 rounded text-[11px] font-semibold bg-accent-500 text-[#042f2e] hover:bg-accent-400 transition-colors disabled:bg-zinc-800 disabled:text-zinc-500 disabled:cursor-not-allowed"
          >
            {saving ? "Saving…" : "Save"}
          </button>
        </div>
      </div>
    </div>
  );
}

/** Start offsets of every case-insensitive occurrence of `query` in `text`. */
function findMatches(text: string, query: string): number[] {
  if (!query) return [];
  const lower = text.toLowerCase();
  const q = query.toLowerCase();
  const out: number[] = [];
  let idx = lower.indexOf(q, 0);
  while (idx !== -1) {
    out.push(idx);
    idx = lower.indexOf(q, idx + q.length);
  }
  return out;
}

/**
 * Render the highlight backdrop: the value text with each match wrapped in a
 * <mark>. The active match gets a stronger highlight and its element is
 * captured in `activeRef` so it can be scrolled into view.
 */
function renderHighlight(
  text: string,
  matches: number[],
  qLen: number,
  activeIndex: number,
  activeRef: React.MutableRefObject<HTMLElement | null>
): React.ReactNode {
  if (matches.length === 0 || qLen === 0) return text;
  const nodes: React.ReactNode[] = [];
  let from = 0;
  matches.forEach((start, i) => {
    if (start > from) nodes.push(text.slice(from, start));
    const isActive = i === activeIndex;
    nodes.push(
      <mark
        key={start}
        ref={
          isActive
            ? (el) => {
                activeRef.current = el;
              }
            : undefined
        }
        className={clsx(
          "rounded-[1px]",
          isActive ? "bg-amber-600/80" : "bg-amber-600/40"
        )}
      >
        {text.slice(start, start + qLen)}
      </mark>
    );
    from = start + qLen;
  });
  if (from < text.length) nodes.push(text.slice(from));
  return nodes;
}

function formatValue(
  value: unknown,
  column: ColumnInfo | null
): { text: string; isJson: boolean } {
  if (value === null || value === undefined) {
    return { text: "", isJson: false };
  }
  if (isJsonType(column)) {
    const parsed = typeof value === "string" ? safeParseJson(value) : value;
    try {
      return { text: JSON.stringify(parsed, null, 2), isJson: true };
    } catch {
      /* fall through */
    }
  }

  if (typeof value === "string") return { text: value, isJson: false };
  if (typeof value === "number" || typeof value === "boolean") {
    return { text: String(value), isJson: false };
  }
  try {
    return { text: JSON.stringify(value, null, 2), isJson: false };
  } catch {
    return { text: String(value), isJson: false };
  }
}

function isJsonType(column: ColumnInfo | null): boolean {
  const dt = (column?.dataType ?? "").toLowerCase();
  return dt === "json" || dt.startsWith("json");
}

function safeParseJson(s: string): unknown {
  try {
    return JSON.parse(s);
  } catch {
    return s;
  }
}
