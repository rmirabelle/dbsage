import { useMemo, useRef, useState } from "react";
import { Copy, X, Check } from "@phosphor-icons/react";
import clsx from "clsx";
import { useUi } from "../state/ui";
import type { ColumnInfo } from "../types";

interface Props {
  column: ColumnInfo | null;
  value: unknown;
  rowOrdinal: number | null;
  onClose: () => void;
}

export function ExpandedPanel({ column, value, rowOrdinal, onClose }: Props) {
  const height = useUi((s) => s.expandedPanelHeight);
  const setHeight = useUi((s) => s.setExpandedPanelHeight);
  const dragStateRef = useRef<{ startY: number; startHeight: number } | null>(
    null
  );
  const { display, isJson } = useMemo(() => formatValue(value, column), [
    value,
    column,
  ]);

  const [copied, setCopied] = useState(false);
  const onCopy = async () => {
    try {
      await navigator.clipboard.writeText(display);
      setCopied(true);
      setTimeout(() => setCopied(false), 1200);
    } catch {
      /* no-op */
    }
  };

  return (
    <div
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
              onClick={onCopy}
              className="inline-flex items-center gap-1 px-2 py-0.5 rounded hover:bg-zinc-800 text-zinc-400 hover:text-zinc-100"
              title="Copy to clipboard"
            >
              {copied ? (
                <>
                  <Check size={11} className="text-emerald-400" />
                  <span>Copied</span>
                </>
              ) : (
                <>
                  <Copy size={11} />
                  <span>Copy</span>
                </>
              )}
            </button>
          )}
          <button
            onClick={onClose}
            className="p-1 rounded hover:bg-zinc-800 text-zinc-400 hover:text-zinc-100"
            aria-label="Close expanded panel"
            title="Close (Esc)"
          >
            <X size={11} />
          </button>
        </div>
      </div>

      <div className="flex-1 min-h-0 overflow-auto">
        <pre
          className={clsx(
            "px-3 py-2 text-[12px] font-mono whitespace-pre-wrap break-words",
            value === null || value === undefined
              ? "text-zinc-500 italic"
              : "text-zinc-200"
          )}
        >
          {column ? display : ""}
        </pre>
      </div>
    </div>
  );
}

function formatValue(
  value: unknown,
  column: ColumnInfo | null
): { display: string; isJson: boolean } {
  if (value === null || value === undefined) {
    return { display: "NULL", isJson: false };
  }
  const dataType = (column?.dataType ?? "").toLowerCase();
  const looksJson = dataType === "json" || dataType.startsWith("json");

  if (looksJson) {
    const parsed = typeof value === "string" ? safeParseJson(value) : value;
    try {
      return { display: JSON.stringify(parsed, null, 2), isJson: true };
    } catch {
      /* fall through */
    }
  }

  if (typeof value === "string") return { display: value, isJson: false };
  if (typeof value === "number" || typeof value === "boolean") {
    return { display: String(value), isJson: false };
  }
  try {
    return { display: JSON.stringify(value, null, 2), isJson: false };
  } catch {
    return { display: String(value), isJson: false };
  }
}

function safeParseJson(s: string): unknown {
  try {
    return JSON.parse(s);
  } catch {
    return s;
  }
}
