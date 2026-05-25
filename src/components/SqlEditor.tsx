import {
  forwardRef,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type MutableRefObject,
} from "react";
import { createPortal } from "react-dom";
import clsx from "clsx";
import { highlightSql } from "../lib/sqlHighlight";
import {
  analyzeCompletion,
  filterByPrefix,
  resolveQualifierTable,
  type CompletionKind,
  type CompletionSource,
} from "../lib/sqlCompletion";

/** Shared text metrics — MUST be identical on the textarea, the highlight
 * backdrop, and the caret-measure layer so everything lines up. */
const TEXT_STYLE: CSSProperties = {
  fontSize: 13,
  lineHeight: 1.6,
  tabSize: 2,
};

interface Props {
  value: string;
  onChange: (value: string) => void;
  /** Ctrl/Cmd+Enter. */
  onSubmit?: () => void;
  placeholder?: string;
  /** Enables table/column/keyword autocompletion when provided. */
  completion?: CompletionSource;
}

interface Suggestion {
  label: string;
  kind: CompletionKind;
}

/**
 * Syntax-highlighting SQL editor (transparent textarea over a highlighted
 * backdrop) with lightweight autocompletion. A third, invisible "measure" layer
 * — sharing the textarea's exact metrics — places a marker at the caret so the
 * completion popup can be anchored to it without a separate mirror hack.
 */
export const SqlEditor = forwardRef<HTMLTextAreaElement, Props>(function SqlEditor(
  { value, onChange, onSubmit, placeholder, completion },
  forwardedRef
) {
  const innerRef = useRef<HTMLTextAreaElement | null>(null);
  const backdropRef = useRef<HTMLPreElement>(null);
  const measureRef = useRef<HTMLDivElement>(null);
  const markerRef = useRef<HTMLSpanElement>(null);

  const [caret, setCaret] = useState(0);
  const [open, setOpen] = useState(false);
  const [selIndex, setSelIndex] = useState(0);
  const [pos, setPos] = useState<{ left: number; top: number } | null>(null);
  /** True while a Ctrl+Space-opened (keyword) popup should persist. */
  const manualRef = useRef(false);
  /** Caret to apply after a controlled value change (accepting a suggestion). */
  const pendingCaretRef = useRef<number | null>(null);
  /** Suppress auto-open for exactly this value (just accepted a suggestion). */
  const suppressValueRef = useRef<string | null>(null);

  const setRefs = (node: HTMLTextAreaElement | null) => {
    innerRef.current = node;
    if (typeof forwardedRef === "function") forwardedRef(node);
    else if (forwardedRef)
      (forwardedRef as MutableRefObject<HTMLTextAreaElement | null>).current = node;
  };

  const query = useMemo(
    () => (completion ? analyzeCompletion(value, caret) : null),
    [completion, value, caret]
  );

  const suggestions = useMemo<Suggestion[]>(() => {
    if (!completion || !query) return [];
    if (query.kind === "table")
      return filterByPrefix(completion.tables, query.prefix).map((label) => ({
        label,
        kind: "table" as const,
      }));
    if (query.kind === "keyword")
      return filterByPrefix(completion.keywords, query.prefix).map((label) => ({
        label,
        kind: "keyword" as const,
      }));
    if (query.kind === "column" && query.qualifier) {
      const table = resolveQualifierTable(value, query.qualifier, completion.tables);
      const cols = table ? completion.columnsByTable[table.toLowerCase()] ?? [] : [];
      return filterByPrefix(cols, query.prefix).map((label) => ({
        label,
        kind: "column" as const,
      }));
    }
    return [];
  }, [completion, query, value]);

  /* Auto-open for table/column contexts; keyword context is Ctrl+Space only. */
  useEffect(() => {
    if (suggestions.length === 0) {
      setOpen(false);
      manualRef.current = false;
      return;
    }
    if (value === suppressValueRef.current) {
      setOpen(false);
      return;
    }
    if (query?.auto || manualRef.current) {
      setOpen(true);
      setSelIndex(0);
      return;
    }
    setOpen(false);
  }, [suggestions, query, value]);

  /* Anchor the popup at the caret via the aligned measure layer. */
  useLayoutEffect(() => {
    if (!open) {
      setPos(null);
      return;
    }
    const ta = innerRef.current;
    const mz = measureRef.current;
    const mk = markerRef.current;
    if (!ta || !mz || !mk) return;
    mz.scrollTop = ta.scrollTop;
    mz.scrollLeft = ta.scrollLeft;
    const r = mk.getBoundingClientRect();
    setPos({
      left: Math.max(8, Math.min(r.left, window.innerWidth - 252)),
      top: Math.min(r.bottom + 2, window.innerHeight - 8),
    });
  }, [open, caret, value, suggestions]);

  /* Apply the caret position queued by accept(), after value committed. */
  useLayoutEffect(() => {
    const pc = pendingCaretRef.current;
    if (pc == null) return;
    pendingCaretRef.current = null;
    const ta = innerRef.current;
    if (ta) {
      ta.selectionStart = ta.selectionEnd = pc;
      setCaret(pc);
    }
  });

  const accept = (s: Suggestion) => {
    if (!query) return;
    const next = value.slice(0, query.from) + s.label + value.slice(caret);
    suppressValueRef.current = next;
    pendingCaretRef.current = query.from + s.label.length;
    setOpen(false);
    manualRef.current = false;
    onChange(next);
  };

  const closePopup = () => {
    setOpen(false);
    manualRef.current = false;
  };

  return (
    <div className="relative h-full overflow-hidden bg-[#2c303c]">
      <pre
        ref={backdropRef}
        aria-hidden="true"
        className="absolute inset-0 m-0 overflow-auto px-3 py-2 font-mono whitespace-pre-wrap break-words pointer-events-none text-zinc-100"
        style={TEXT_STYLE}
      >
        {highlightSql(value)}
        {"\n"}
      </pre>

      <div
        ref={measureRef}
        aria-hidden="true"
        className="absolute inset-0 m-0 overflow-hidden px-3 py-2 font-mono whitespace-pre-wrap break-words invisible"
        style={TEXT_STYLE}
      >
        {value.slice(0, caret)}
        <span ref={markerRef} />
      </div>

      <textarea
        ref={setRefs}
        data-el="query-editor"
        value={value}
        spellCheck={false}
        placeholder={placeholder}
        onChange={(e) => {
          onChange(e.target.value);
          setCaret(e.target.selectionStart);
        }}
        onSelect={(e) => setCaret(e.currentTarget.selectionStart)}
        onBlur={closePopup}
        onScroll={(e) => {
          const ta = e.currentTarget;
          const bd = backdropRef.current;
          if (bd) {
            bd.scrollTop = ta.scrollTop;
            bd.scrollLeft = ta.scrollLeft;
          }
        }}
        onKeyDown={(e) => {
          if (open && suggestions.length > 0) {
            if (e.key === "ArrowDown") {
              e.preventDefault();
              setSelIndex((i) => (i + 1) % suggestions.length);
              return;
            }
            if (e.key === "ArrowUp") {
              e.preventDefault();
              setSelIndex((i) => (i - 1 + suggestions.length) % suggestions.length);
              return;
            }
            if (e.key === "Tab" || (e.key === "Enter" && !e.ctrlKey && !e.metaKey)) {
              e.preventDefault();
              accept(suggestions[selIndex]);
              return;
            }
            if (e.key === "Escape") {
              e.preventDefault();
              closePopup();
              return;
            }
          }
          if (e.key === " " && (e.ctrlKey || e.metaKey)) {
            e.preventDefault();
            manualRef.current = true;
            suppressValueRef.current = null;
            if (suggestions.length > 0) {
              setOpen(true);
              setSelIndex(0);
            }
            return;
          }
          if (e.key === "Enter" && (e.ctrlKey || e.metaKey)) {
            e.preventDefault();
            closePopup();
            onSubmit?.();
          }
        }}
        className="absolute inset-0 resize-none overflow-auto px-3 py-2 font-mono whitespace-pre-wrap break-words bg-transparent text-transparent caret-zinc-100 outline-none placeholder:text-zinc-600"
        style={TEXT_STYLE}
      />

      {open &&
        pos &&
        suggestions.length > 0 &&
        createPortal(
          <div
            data-el="sql-completion-popup"
            style={{ position: "fixed", left: pos.left, top: pos.top, width: 240 }}
            className="z-50 max-h-60 overflow-auto rounded border border-zinc-700 bg-zinc-900/95 backdrop-blur-sm py-1 shadow-xl shadow-black/60 text-[12px]"
          >
            {suggestions.map((s, i) => (
              <div
                key={`${s.kind}:${s.label}`}
                ref={
                  i === selIndex
                    ? (el) => el?.scrollIntoView({ block: "nearest" })
                    : undefined
                }
                onMouseDown={(e) => {
                  e.preventDefault();
                  accept(s);
                }}
                className={clsx(
                  "px-2 py-1 flex items-center gap-2 cursor-pointer font-mono",
                  i === selIndex
                    ? "bg-accent-500/20 text-accent-100"
                    : "text-zinc-200 hover:bg-zinc-800"
                )}
              >
                <span
                  className={clsx(
                    "text-[9px] uppercase w-8 shrink-0",
                    s.kind === "table"
                      ? "text-emerald-400"
                      : s.kind === "column"
                      ? "text-accent-400"
                      : "text-purple-400"
                  )}
                >
                  {s.kind === "table" ? "tbl" : s.kind === "column" ? "col" : "kw"}
                </span>
                <span className="truncate">{s.label}</span>
              </div>
            ))}
          </div>,
          document.body
        )}
    </div>
  );
});
