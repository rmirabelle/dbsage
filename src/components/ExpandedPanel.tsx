import { helpHandlers } from "../state/help";
import { useEffect, useMemo, useRef, useState } from "react";
import {
  Copy,
  X,
  Check,
  CaretUp,
  CaretDown,
  Binoculars,
  BracketsCurly,
  PencilSimple,
  TreeStructure,
  ArrowsOutSimple,
  ArrowsInSimple,
  MagnifyingGlass as Search,
} from "@phosphor-icons/react";
import clsx from "clsx";
import { useUi, PANEL_BOUNDS } from "../state/ui";
import { ConfirmDialog } from "./ConfirmDialog";
import { JsonTreeView, type JsonTreeViewHandle } from "./JsonTreeView";
import { InspectorTextBackdrop } from "./InspectorTextBackdrop";
import { matchOffsets } from "../lib/jsonTreeModel";

const jsonToolbarButton = "h-5 inline-flex items-center gap-1 px-1.5 rounded hover:bg-zinc-800 hover:text-zinc-100";
import type { ColumnInfo } from "../types";

interface Props {
  /** Resize an already-open Inspector without remounting its editor. */
  requestedHeight?: number;
  /** A nested host can reserve room for its own grid. */
  heightLimit?: number;
  column: ColumnInfo | null;
  value: unknown;
  rowOrdinal: number | null;
  editable: boolean;
  onSave?: (value: string | null) => Promise<void>;
  onClose: () => void;
  /** Read-only mode (query results): no Save button, and JSON shows the tree
   * viewer only (no raw text pane). Copy + Search are still available. */
  readOnly?: boolean;
  /** A host-owned height (a peek restoring a saved view) that overrides the
   * shared stored height on open; `onHeightChange` reports every resize so
   * the host can persist it. */
  initialHeight?: number;
  onHeightChange?: (px: number) => void;
  /** Search term to start with (a peek restoring its state after a reload)
   * and where to report edits so the host can keep it. */
  initialSearch?: string;
  onSearchChange?: (search: string) => void;
  /** Whether the JSON tree starts fully expanded, and where to report the
   * Expand all / Collapse all buttons. */
  initialExpandAll?: boolean;
  onExpandAllChange?: (expandAll: boolean) => void;
}

export function ExpandedPanel({
  requestedHeight,
  heightLimit,
  column,
  value,
  rowOrdinal,
  editable,
  onSave,
  onClose,
  readOnly = false,
  initialHeight,
  onHeightChange,
  initialSearch,
  onSearchChange,
  initialExpandAll,
  onExpandAllChange,
}: Props) {
  const [expandAll, setExpandAll] = useState(initialExpandAll ?? false);
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
  /** The tallest the panel may be right now: the window minus room for the
   * chrome and a slice of grid (matches the CSS max-height below). */
  const maxHeightNow = () =>
    Math.max(PANEL_BOUNDS.MIN, Math.min(PANEL_BOUNDS.MAX, window.innerHeight - 120, heightLimit ?? Infinity));
  const [height, setDisplayHeight] = useState(() =>
    Math.min(
      maxHeightNow(),
      initialHeight != null
        ? Math.max(PANEL_BOUNDS.MIN, initialHeight)
        : Math.min(storedHeight, Math.round(window.innerHeight / 2))
    )
  );
  const setHeight = (px: number) => {
    const clamped = Math.max(PANEL_BOUNDS.MIN, Math.min(maxHeightNow(), Math.round(px)));
    setDisplayHeight(clamped);
    setStoredHeight(px);
    onHeightChange?.(clamped);
  };
  useEffect(() => {
    if (requestedHeight != null) {
      setDisplayHeight(Math.max(PANEL_BOUNDS.MIN, Math.min(maxHeightNow(), requestedHeight)));
    }
  }, [requestedHeight, heightLimit]);
  /* Keep the state within the cap when the window shrinks, so a drag always
     starts from the height actually on screen. */
  useEffect(() => {
    const onResize = () => setDisplayHeight((h) => Math.min(h, maxHeightNow()));
    onResize();
    window.addEventListener("resize", onResize);
    return () => window.removeEventListener("resize", onResize);
  }, [heightLimit]);
  const dragStateRef = useRef<{ startY: number; startHeight: number } | null>(
    null
  );

  const { text: initialText, isJson } = useMemo(
    () => formatValue(value, column),
    [value, column]
  );

  const [text, setText] = useState(initialText);
  const [search, setSearch] = useState(initialSearch ?? "");
  const [appliedSearch, setAppliedSearch] = useState(initialSearch ?? "");
  const searchPending = search !== appliedSearch;
  useEffect(() => {
    onSearchChange?.(search);
    /* Report only on edits; the callback identity may change every render. */
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [search]);
  useEffect(() => {
    const timer = setTimeout(() => {
      setAppliedSearch(search);
      setActiveMatch(0);
    }, search ? 140 : 0);
    return () => clearTimeout(timer);
  }, [search]);
  const [activeMatch, setActiveMatch] = useState(0);
  const [copied, setCopied] = useState(false);
  const [saving, setSaving] = useState(false);
  /** Save is waiting on the user's OK to edit a primary-key column. */
  const [pkSaveConfirm, setPkSaveConfirm] = useState(false);
  const [saved, setSaved] = useState(false);

  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const backdropRef = useRef<HTMLDivElement>(null);
  const searchInputRef = useRef<HTMLInputElement>(null);

  /** JSON columns show the tree by default; the tree's Edit button swaps in
   * the raw editor, and a successful Save swaps the tree back. */
  const [jsonEditing, setJsonEditing] = useState(false);
  const treeRef = useRef<JsonTreeViewHandle>(null);

  /** Reset the editor text whenever the inspected value changes. */
  useEffect(() => {
    setText(initialText);
    setJsonEditing(false);
  }, [initialText]);

  /** Clear the search only on a real column change. Navigating to a new row in
   * the same column keeps the term applied. The transient null that row clicks
   * produce (active cell is cleared on mousedown, then re-set by the cell click)
   * is ignored, so clicking another row in the same column preserves the term. */
  const lastColumnRef = useRef<string | null>(column?.name ?? null);
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
    /* A peek's Inspector remounts for every parent row; when the user is
       arrow-keying through a grid, leave focus there. */
    if (document.activeElement?.closest('[data-el="data-grid"]')) return;
    searchInputRef.current?.focus();
  }, []);

  const isNull = value === null || value === undefined;
  const isJsonColumn = isJsonType(column);
  const canEdit = editable && column != null && onSave != null;
  /* JSON shows either the tree or the raw editor, never both. */
  const jsonEdit = isJsonColumn && canEdit && jsonEditing;
  const showRaw = !isJsonColumn || jsonEdit;
  const showTree = isJsonColumn && !jsonEdit;
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

  /** Text columns (text/mediumtext/varchar…) sometimes hold JSON. Offer a
   * pretty-print button when the value looks like JSON and actually parses.
   * Real JSON columns already pretty-print on load, so they're excluded. */
  const canFormatJson = useMemo(() => {
    if (isJsonColumn) return false;
    const t = text.trim();
    if (!t.startsWith("{") && !t.startsWith("[")) return false;
    try {
      JSON.parse(t);
      return true;
    } catch {
      return false;
    }
  }, [text, isJsonColumn]);

  const formatJson = () => {
    try {
      setText(JSON.stringify(JSON.parse(text), null, 2));
      setSaved(false);
    } catch {
      /* guarded by canFormatJson, so this shouldn't happen */
    }
  };

  const lowerText = useMemo(() => text.toLowerCase(), [text]);
  const matches = useMemo(() => matchOffsets(lowerText, appliedSearch.toLowerCase()), [lowerText, appliedSearch]);
  const matchCount = matches.length;
  const activeIndex =
    matchCount > 0 ? ((activeMatch % matchCount) + matchCount) % matchCount : 0;

  const gotoMatch = (delta: number) => {
    if (matchCount === 0 || searchPending) return;
    setActiveMatch((m) => m + delta);
  };

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

  const handleSave = async (pkConfirmed = false) => {
    if (!onSave || !dirty || saving) return;
    if (column?.key === "PRI" && !pkConfirmed) {
      setPkSaveConfirm(true);
      return;
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
      setJsonEditing(false);
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
      /* Never taller than the window: a restored or shared height that no
         longer fits would push the grid (and the chrome above it) out of view. */
      style={{ height, maxHeight: heightLimit ?? "calc(100vh - 120px)" }}
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
        {...helpHandlers("Drag to resize · double-click to reset")}
      />
      {pkSaveConfirm && column && (
        <ConfirmDialog
          title="Edit a primary key?"
          confirmLabel="Save"
          danger={false}
          message={
            <p>
              <span className="font-mono text-zinc-100">{column.name}</span>{" "}
              is a primary-key column. Editing it can break foreign-key
              references and changes the row's identity. Continue?
            </p>
          }
          onConfirm={() => {
            setPkSaveConfirm(false);
            void handleSave(true);
          }}
          onCancel={() => setPkSaveConfirm(false)}
        />
      )}
      <div className="dbs-toolbar h-7 shrink-0 px-3 flex items-center gap-3 border-b border-zinc-800/60 text-[11px] text-zinc-400">
        <Binoculars size={13} weight="fill" className="shrink-0 text-emerald-300" aria-label="Inspector" />
        {column ? (
          <span className="min-w-0 inline-flex items-center gap-1.5 truncate">
            <span className="text-[10px] font-semibold uppercase tracking-[0.12em] text-zinc-500">Column:</span>
            <span className="font-mono text-zinc-200 truncate">{column.name}</span>
            <span className="font-mono text-zinc-500 truncate">
              ({column.dataType}{isJson && showRaw && ", pretty"})
            </span>
          </span>
        ) : (
          <span className="text-zinc-600">Click a cell to view its value</span>
        )}
        {column && !isJsonColumn && (
          <button
            data-el="expanded-copy-btn"
            onClick={onCopy}
            className="inline-flex shrink-0 items-center gap-1 px-1.5 py-0.5 rounded text-zinc-400 hover:bg-zinc-800 hover:text-zinc-100"
            aria-label={copied ? "Copied" : "Copy to clipboard"}
            {...helpHandlers("Copy to clipboard")}
          >
            {copied ? <Check size={13} className="text-emerald-400" /> : <Copy size={13} />}
          </button>
        )}

        <div className="ml-auto flex items-center gap-1">
          {column && rowOrdinal != null && (
            <span className="mr-1 font-mono text-zinc-500">row {rowOrdinal}</span>
          )}
          {column && canFormatJson && (
            <button
              data-el="expanded-format-json-btn"
              onClick={formatJson}
              className="inline-flex items-center gap-1 px-2 py-0.5 rounded text-[11px] text-zinc-400 hover:bg-zinc-800 hover:text-zinc-100"
              {...helpHandlers("Pretty-print this JSON value")}
            >
              <BracketsCurly size={13} className="text-sky-400" />
              <span>Format JSON</span>
            </button>
          )}
          <button
            data-el="expanded-close-btn"
            onClick={onClose}
            className="p-1 rounded hover:bg-zinc-800 text-zinc-400 hover:text-zinc-100"
            aria-label="Close Inspector panel"
            {...helpHandlers("Close (Esc)")}
          >
            <X size={13} />
          </button>
        </div>
      </div>

      {/* JSON toolbar: Copy plus the tree/editor controls; stays put across
          the tree and raw-editor views. */}
      {column && isJsonColumn && (
        <div data-el="json-toolbar" className="shrink-0 h-7 pl-1 pr-2 bg-[#262a34] flex items-center gap-1 border-b border-zinc-800/40 text-[11px] text-zinc-400">
          <button data-el="expanded-copy-btn" onClick={onCopy} aria-label={copied ? "Copied" : "Copy to clipboard"} {...helpHandlers("Copy to clipboard")} className={jsonToolbarButton}>
            {copied ? <Check size={13} className="text-emerald-400" /> : <Copy size={13} />}Copy
          </button>
          {canEdit && (jsonEdit ? (
            <button data-el="json-tree-back" onClick={() => setJsonEditing(false)} {...helpHandlers("Back to the tree view (keeps unsaved edits)")} className={jsonToolbarButton}><TreeStructure size={13} />Tree</button>
          ) : (
            <button data-el="json-tree-edit" onClick={() => setJsonEditing(true)} {...helpHandlers("Edit JSON")} className={jsonToolbarButton}><PencilSimple size={13} />Edit</button>
          ))}
          {showTree && treeData !== undefined && (
            <span className="ml-auto inline-flex items-center gap-1">
              <button data-el="json-tree-expand-all" onClick={() => { treeRef.current?.expandAll(); setExpandAll(true); onExpandAllChange?.(true); }} {...helpHandlers("Expand all")} className={jsonToolbarButton}><ArrowsOutSimple size={13} />Expand</button>
              <button data-el="json-tree-collapse-all" onClick={() => { treeRef.current?.collapseAll(); setExpandAll(false); onExpandAllChange?.(false); }} {...helpHandlers("Collapse all")} className={jsonToolbarButton}><ArrowsInSimple size={13} />Collapse</button>
            </span>
          )}
        </div>
      )}

      <div className="flex-1 min-h-0 flex">
        {showRaw && (
          <div
            className="relative flex-1 min-h-0 min-w-0 bg-zinc-950"
          >
            <InspectorTextBackdrop
              backdropRef={backdropRef}
              textareaRef={textareaRef}
              text={column ? text : ""}
              matches={matches}
              queryLength={appliedSearch.length}
              activeIndex={activeIndex}
              className={clsx(
                "absolute inset-0 overflow-hidden text-zinc-200 select-none pointer-events-none",
                layerClass
              )}
            />
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

        {column && showTree && (
          <div className="relative flex-1 min-h-0 min-w-0 bg-zinc-950">
            {treeData !== undefined ? (
              <JsonTreeView
                ref={treeRef}
                key={`${column?.name ?? ""}:${rowOrdinal ?? ""}`}
                data={treeData}
                search={appliedSearch}
                activeIndex={activeIndex}
                expandAll={expandAll}
              />
            ) : (
              <div className="px-3 py-2 text-[11px] text-zinc-600 font-mono">
                {text.trim() ? "Not valid JSON" : isNull ? "NULL" : ""}
              </div>
            )}
          </div>
        )}
      </div>

      <div
        data-el="expanded-footer"
        className="h-[38px] shrink-0 px-1 py-px flex items-center gap-2 border-t border-zinc-800/60"
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
            placeholder={column ? `Search ${column.name}…` : "Search value…"}
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
          (searchPending ? <span className="text-[10px] text-zinc-500" role="status">Searching…</span> : matchCount > 0 ? (
            <div className="flex items-center gap-0.5 shrink-0 text-zinc-400">
              <button
                data-el="search-prev-btn"
                onClick={() => gotoMatch(-1)}
                disabled={matchCount <= 1}
                aria-label="Previous match"
                {...helpHandlers("Previous match (Shift+Enter)")}
                className="h-5 w-5 inline-flex items-center justify-center rounded hover:bg-zinc-800 hover:text-zinc-100 disabled:opacity-30 disabled:hover:bg-transparent"
              >
                <CaretUp size={12} />
              </button>
              <button
                data-el="search-next-btn"
                onClick={() => gotoMatch(1)}
                disabled={matchCount <= 1}
                aria-label="Next match"
                {...helpHandlers("Next match (Enter)")}
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
              onClick={() => void handleSave()}
              disabled={!dirty || saving}
              {...helpHandlers(!editable
                  ? "Editing requires a primary key on this table"
                  : undefined)}
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
