import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import {
  Copy,
  X,
  Check,
  CaretUp,
  CaretDown,
  Binoculars,
  MagnifyingGlass as Search,
} from "@phosphor-icons/react";
import clsx from "clsx";
import { useUi, PANEL_BOUNDS } from "../state/ui";
import { JsonTreeView } from "./JsonTreeView";
import type { ColumnInfo } from "../types";

interface Props {
  column: ColumnInfo | null;
  value: unknown;
  rowOrdinal: number | null;
  editable: boolean;
  onSave?: (value: string | null) => Promise<void>;
  onClose: () => void;
  /** Read-only mode (query results): no Save button, and JSON shows the tree
   * viewer only (no raw text pane). Copy + Search are still available. */
  readOnly?: boolean;
}

export function ExpandedPanel({
  column,
  value,
  rowOrdinal,
  editable,
  onSave,
  onClose,
  readOnly = false,
}: Props) {
  const storedHeight = useUi((s) => s.expandedPanelHeight);
  const setStoredHeight = useUi((s) => s.setExpandedPanelHeight);
  /**
   * Display height vs. stored height: the persisted height is shared by every
   * window (localStorage), so a tall Inspector resized on a big main window
   * would fill a small secondary window entirely. On open, clamp the display
   * to half the window's height — but don't write that back, so the big
   * window's preference survives. Dragging past 50% afterwards is still
   * allowed (deliberate, in THIS window) and persists as before.
   */
  const [height, setDisplayHeight] = useState(() =>
    Math.min(storedHeight, Math.round(window.innerHeight / 2))
  );
  const setHeight = (px: number) => {
    setDisplayHeight(
      Math.max(PANEL_BOUNDS.MIN, Math.min(PANEL_BOUNDS.MAX, Math.round(px)))
    );
    setStoredHeight(px);
  };
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

  /** Reset the editor text whenever the inspected value changes. */
  useEffect(() => {
    setText(initialText);
  }, [initialText]);

  /** Clear the search only on a real column change. Navigating to a new row in
   * the same column keeps the term applied. The transient null that row clicks
   * produce (active cell is cleared on mousedown, then re-set by the cell click)
   * is ignored, so clicking another row in the same column preserves the term. */
  const lastColumnRef = useRef<string | null>(null);
  useEffect(() => {
    const name = column?.name ?? null;
    if (name === null) return;
    if (name !== lastColumnRef.current) {
      setSearch("");
      lastColumnRef.current = name;
    }
  }, [column?.name]);

  /** Focus the search box each time the Inspector is toggled open from closed.
   * The panel is conditionally mounted (`{expanded && <ExpandedPanel/>}`), so a
   * mount-only effect fires exactly on each open — and crucially NOT on value
   * changes, which would steal focus from the grid and break arrow-key row
   * navigation while the Inspector stays open. */
  useEffect(() => {
    searchInputRef.current?.focus();
  }, []);

  const isNull = value === null || value === undefined;
  const isJsonColumn = isJsonType(column);
  /* Read-only JSON shows the tree only (no raw text pane). */
  const treeOnly = readOnly && isJsonColumn;
  const showRaw = !treeOnly;
  const canEdit = editable && column != null && onSave != null;
  const dirty = canEdit && text !== initialText;

  /** Parsed view of the (live) text for the tree column — `undefined` when the
   * column isn't JSON or the current text isn't parseable. */
  const treeData = useMemo(() => {
    if (!isJsonColumn) return undefined;
    try {
      return JSON.parse(text) as unknown;
    } catch {
      return undefined;
    }
  }, [text, isJsonColumn]);

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
      <div className="dbs-toolbar h-7 shrink-0 px-3 flex items-center gap-3 border-b border-zinc-800/60 text-[11px] text-zinc-400">
        <span className="inline-flex items-center gap-1.5 text-[10px] font-semibold uppercase tracking-[0.12em] text-emerald-300">
          <Binoculars size={13} weight="fill" className="shrink-0" />
          Inspector
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
              className="inline-flex items-center gap-1 px-2 py-0.5 rounded text-[11px] text-zinc-400 hover:bg-zinc-800 hover:text-zinc-100"
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
            aria-label="Close Inspector panel"
            title="Close (Esc)"
          >
            <X size={13} />
          </button>
        </div>
      </div>

      <div className="flex-1 min-h-0 flex">
        {showRaw && (
          <div
            className={clsx(
              "relative flex-1 min-h-0 min-w-0",
              /* Lighter gray marks an editable area (matches the edit-table form
                 bg). Only the editable Table Inspector — not the read-only Query
                 Inspector — gets it. */
              !readOnly && "bg-[#2c303c]",
              column && isJsonColumn && "border-r border-zinc-800"
            )}
          >
            <div
              ref={backdropRef}
              aria-hidden="true"
              className={clsx(
                "absolute inset-0 overflow-hidden text-zinc-200 select-none pointer-events-none",
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
                /* Text is transparent so the visible glyphs come from the
                   backdrop layer (which colors search matches black on green);
                   the caret stays visible for editing. */
                "absolute inset-0 h-full w-full resize-none overflow-auto border-0 bg-transparent outline-none text-transparent caret-zinc-200",
                layerClass,
                !canEdit && "cursor-default"
              )}
            />
          </div>
        )}

        {column && isJsonColumn && (
          <div className="relative flex-1 min-h-0 min-w-0 bg-zinc-950">
            {treeData !== undefined ? (
              <JsonTreeView
                key={`${column?.name ?? ""}:${rowOrdinal ?? ""}`}
                data={treeData}
                search={search}
                activeIndex={activeIndex}
              />
            ) : (
              <div className="px-3 py-2 text-[11px] text-zinc-600 font-mono">
                {text.trim() ? "Not valid JSON" : ""}
              </div>
            )}
          </div>
        )}
      </div>

      <div
        data-el="expanded-footer"
        className="h-9 shrink-0 px-1 flex items-center gap-2 border-t border-zinc-800/60"
      >
        <div className="relative w-64 max-w-[55%]">
          <Search
            size={13}
            className={clsx(
              "absolute left-2 top-1/2 -translate-y-1/2 pointer-events-none",
              search ? "text-zinc-700" : "text-zinc-500"
            )}
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
            className={clsx(
              "w-full border rounded pl-7 pr-7 py-1 text-[11px] font-bold outline-none",
              search
                ? "bg-lime-400 border-lime-400 text-black placeholder:text-black/60 focus:border-lime-300"
                : "bg-zinc-900 border-zinc-800 text-zinc-200 placeholder:text-zinc-600 focus:border-accent-500"
            )}
          />
          {search && (
            <button
              data-el="expanded-search-clear-btn"
              onClick={() => {
                setSearch("");
                searchInputRef.current?.focus();
              }}
              className="absolute right-1.5 top-1/2 -translate-y-1/2 text-zinc-700 hover:text-black"
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

        {!readOnly && (
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
              className="px-2 py-1 rounded text-[11px] font-semibold bg-accent-500 text-[#042f2e] hover:bg-accent-400 transition-colors disabled:bg-zinc-800 disabled:text-zinc-500 disabled:cursor-not-allowed"
            >
              {saving ? "Saving…" : "Save"}
            </button>
          </div>
        )}
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
          "rounded-[1px] bg-lime-400 text-black",
          isActive && "ring-2 ring-black"
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
