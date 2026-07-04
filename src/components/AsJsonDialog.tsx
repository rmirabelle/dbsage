import { useEffect, useMemo, useState } from "react";
import { BracketsCurly, CircleNotch as Loader2, X } from "@phosphor-icons/react";
import { ipc } from "../ipc";
import { useBackdropDismiss } from "../lib/useBackdropDismiss";
import { scanFromTables } from "../lib/sqlCompletion";
import { buildJsonObject, buildJsonArraySubquery } from "../lib/sqlSnippets";
import { SearchableSelect } from "./SearchableSelect";
import type { Relation } from "../types";

/** "object" → JSON_OBJECT (one related row); "array" → a correlated subquery
 * gathering a child table's rows into a JSON array. */
export type JsonSnippetMode = "object" | "array";

const MODE_META: Record<JsonSnippetMode, { title: string; blurb: string }> = {
  object: { title: "AS_JSON", blurb: "related table as a JSON object" },
  array: {
    title: "AS_JSON_ARRAY",
    blurb: "child table's rows as a correlated JSON array",
  },
};

/** A short default alias for a table (first letter), used for the subquery. */
function defaultAlias(table: string): string {
  return table.replace(/[^A-Za-z]/g, "")[0]?.toLowerCase() ?? "c";
}

interface Props {
  mode: JsonSnippetMode;
  profileId: string;
  database: string;
  /** Tables offered in the picker (current database). */
  tables: string[];
  /** Authored relations for this database — used (array mode) to auto-detect the
   * child's foreign key and the parent column it references. */
  relations: Relation[];
  /** The current query text — used to auto-detect table aliases in FROM/JOIN. */
  sql: string;
  /** Called with the generated SQL when the user confirms. */
  onInsert: (text: string) => void;
  onClose: () => void;
}

/**
 * The AS_JSON / AS_JSON_ARRAY macro dialog: pick a table, choose which of its
 * columns to include, and insert a `JSON_OBJECT(…)` (object mode) or a
 * self-contained correlated subquery (array mode). Aliases, the child foreign
 * key, and the parent reference are prefilled from the query's FROM/JOIN and the
 * relations metadata; a live preview shows exactly what will be inserted.
 */
export function AsJsonDialog({
  mode,
  profileId,
  database,
  tables,
  relations,
  sql,
  onInsert,
  onClose,
}: Props) {
  const meta = MODE_META[mode];
  const isArray = mode === "array";
  const backdrop = useBackdropDismiss(onClose, true);
  const [table, setTable] = useState("");
  /** The alias the JSON_OBJECT columns are referenced by: the table's alias in
   * the outer query (object mode) or the subquery's own alias (array mode). */
  const [qualifier, setQualifier] = useState("");
  const [alias, setAlias] = useState("");
  const [columns, setColumns] = useState<string[]>([]);
  const [checked, setChecked] = useState<Set<string>>(new Set());
  const [loading, setLoading] = useState(false);
  /** Array mode only: the child's foreign-key column and the parent it points at. */
  const [fkColumn, setFkColumn] = useState("");
  const [parentRef, setParentRef] = useState("");

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  /* On table change: prefill aliases + the correlation, and load the columns. */
  useEffect(() => {
    if (!table) {
      setColumns([]);
      setChecked(new Set());
      setQualifier("");
      setFkColumn("");
      setParentRef("");
      return;
    }
    if (isArray) {
      /* The subquery re-selects the child under its own short alias, and the
         FK/parent reference come from the authored relation for this table. */
      setQualifier(defaultAlias(table));
      const rel = relations.find(
        (r) => r.fromTable.toLowerCase() === table.toLowerCase()
      );
      if (rel) {
        setFkColumn(rel.fromColumn);
        const parent = scanFromTables(sql).find(
          (r) => r.table.toLowerCase() === rel.toTable.toLowerCase()
        );
        setParentRef(`${parent?.alias || rel.toTable}.${rel.toColumn}`);
      } else {
        setFkColumn("");
        setParentRef("");
      }
    } else {
      /* Object mode: reference the table by its alias in the outer query. */
      const ref = scanFromTables(sql).find(
        (r) => r.table.toLowerCase() === table.toLowerCase()
      );
      setQualifier(ref?.alias || table);
    }

    let cancelled = false;
    setLoading(true);
    ipc
      .listColumns(profileId, database, table)
      .then((cols) => {
        if (cancelled) return;
        const names = cols.map((c) => c.name);
        setColumns(names);
        setChecked(new Set(names));
      })
      .catch(() => {
        if (cancelled) return;
        setColumns([]);
        setChecked(new Set());
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [table, mode]);

  const selectedColumns = useMemo(
    () => columns.filter((c) => checked.has(c)),
    [columns, checked]
  );

  const preview = useMemo(() => {
    const q = qualifier.trim();
    if (!q || selectedColumns.length === 0) return "";
    let expr: string;
    if (isArray) {
      if (!fkColumn || !parentRef.trim()) return "";
      expr = buildJsonArraySubquery({
        childTable: table,
        childAlias: q,
        columns: selectedColumns,
        fkColumn,
        parentRef: parentRef.trim(),
      });
    } else {
      expr = buildJsonObject(q, selectedColumns);
    }
    return alias.trim() ? `${expr} AS ${alias.trim()}` : expr;
  }, [isArray, table, qualifier, selectedColumns, fkColumn, parentRef, alias]);

  const toggle = (c: string) =>
    setChecked((prev) => {
      const next = new Set(prev);
      if (next.has(c)) next.delete(c);
      else next.add(c);
      return next;
    });

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm"
      {...backdrop}
    >
      <div
        data-el="as-json-dialog"
        role="dialog"
        aria-modal="true"
        onClick={(e) => e.stopPropagation()}
        className="flex flex-col w-[620px] max-w-[92vw] max-h-[80vh] rounded-lg border border-zinc-700 bg-zinc-900 shadow-2xl shadow-black/60"
      >
        <div className="flex items-center justify-between px-4 py-3 border-b border-zinc-800 shrink-0">
          <div className="flex items-center gap-2">
            <BracketsCurly size={18} className="text-sky-400" />
            <h2 className="text-sm font-semibold text-zinc-100">
              {meta.title}{" "}
              <span className="font-normal text-zinc-500">— {meta.blurb}</span>
            </h2>
          </div>
          <button
            onClick={onClose}
            className="text-zinc-500 hover:text-zinc-200"
            aria-label="Close"
          >
            <X size={18} />
          </button>
        </div>

        <div className="flex-1 min-h-0 overflow-auto px-4 py-3 flex flex-col gap-3">
          <div className="flex gap-3">
            <label className="flex-1 min-w-0">
              <div className="text-[11px] text-zinc-400 mb-1">
                {isArray ? "Child table" : "Table"}
              </div>
              <SearchableSelect
                value={table}
                options={tables}
                placeholder="Choose a table…"
                onChange={setTable}
              />
            </label>
            <label className="w-28 shrink-0">
              <div className="text-[11px] text-zinc-400 mb-1">
                {isArray ? "Child alias" : "Qualifier"}
              </div>
              <input
                value={qualifier}
                onChange={(e) => setQualifier(e.target.value)}
                placeholder="alias"
                spellCheck={false}
                className="w-full bg-zinc-950 border border-zinc-700 rounded px-2 py-1 font-mono text-zinc-200 outline-none focus:border-accent-500"
              />
            </label>
            <label className="w-28 shrink-0">
              <div className="text-[11px] text-zinc-400 mb-1">
                AS alias <span className="text-zinc-600">(opt)</span>
              </div>
              <input
                value={alias}
                onChange={(e) => setAlias(e.target.value)}
                placeholder="—"
                spellCheck={false}
                className="w-full bg-zinc-950 border border-zinc-700 rounded px-2 py-1 font-mono text-zinc-200 outline-none focus:border-accent-500"
              />
            </label>
          </div>

          {isArray && (
            <div>
              <div className="text-[11px] text-zinc-400 mb-1">
                Correlation{" "}
                {!fkColumn && (
                  <span className="text-amber-400/80">
                    — no relation found; set the foreign key and parent below
                  </span>
                )}
              </div>
              <div className="flex items-center gap-2 rounded border border-zinc-800 bg-[#2c303c] px-3 py-2 text-[12px]">
                <span className="text-zinc-500">WHERE</span>
                <span className="font-mono text-zinc-300">
                  {qualifier.trim() || "c"}.
                </span>
                <select
                  value={fkColumn}
                  onChange={(e) => setFkColumn(e.target.value)}
                  disabled={columns.length === 0}
                  className="bg-zinc-950 border border-zinc-700 rounded px-2 py-1 font-mono text-zinc-200 outline-none focus:border-accent-500 disabled:opacity-50"
                >
                  <option value="">fk column…</option>
                  {columns.map((c) => (
                    <option key={c} value={c}>
                      {c}
                    </option>
                  ))}
                </select>
                <span className="font-mono text-zinc-500">=</span>
                <input
                  value={parentRef}
                  onChange={(e) => setParentRef(e.target.value)}
                  placeholder="parent.key"
                  spellCheck={false}
                  className="flex-1 min-w-0 bg-zinc-950 border border-zinc-700 rounded px-2 py-1 font-mono text-zinc-200 outline-none focus:border-accent-500"
                />
              </div>
            </div>
          )}

          <div>
            <div className="flex items-center justify-between mb-1">
              <div className="text-[11px] text-zinc-400">
                Columns
                {selectedColumns.length > 0 && (
                  <span className="text-zinc-600">
                    {" "}
                    ({selectedColumns.length}/{columns.length})
                  </span>
                )}
              </div>
              {columns.length > 0 && (
                <div className="flex items-center gap-3 text-[11px]">
                  <button
                    onClick={() => setChecked(new Set(columns))}
                    className="text-zinc-400 hover:text-zinc-100"
                  >
                    All
                  </button>
                  <button
                    onClick={() => setChecked(new Set())}
                    className="text-zinc-400 hover:text-zinc-100"
                  >
                    None
                  </button>
                </div>
              )}
            </div>
            <div className="rounded border border-zinc-800 bg-[#2c303c] h-40 overflow-auto p-2">
              {loading ? (
                <div className="flex items-center gap-2 text-[12px] text-zinc-500 py-2">
                  <Loader2 size={14} className="animate-spin" /> Loading columns…
                </div>
              ) : columns.length === 0 ? (
                <div className="text-[12px] text-zinc-600 py-2">
                  {table
                    ? "This table has no columns."
                    : "Pick a table to choose columns."}
                </div>
              ) : (
                <div className="grid grid-cols-2 gap-x-4 gap-y-1">
                  {columns.map((c) => (
                    <label
                      key={c}
                      className="flex items-center gap-2 text-[12px] text-zinc-200 cursor-pointer"
                    >
                      <input
                        type="checkbox"
                        checked={checked.has(c)}
                        onChange={() => toggle(c)}
                        className="accent-accent-500"
                      />
                      <span className="font-mono truncate">{c}</span>
                    </label>
                  ))}
                </div>
              )}
            </div>
          </div>

          <div>
            <div className="text-[11px] text-zinc-400 mb-1">Preview</div>
            <pre className="rounded border border-zinc-800 bg-zinc-950 px-3 py-2 text-[12px] font-mono text-sky-200 whitespace-pre-wrap break-words max-h-32 overflow-auto">
              {preview || "—"}
            </pre>
          </div>
        </div>

        <div className="flex justify-end gap-2 border-t border-zinc-800 px-4 py-3 shrink-0">
          <button
            onClick={onClose}
            className="px-3 py-1.5 rounded text-[12px] text-zinc-200 bg-zinc-800 hover:bg-zinc-700"
          >
            Cancel
          </button>
          <button
            data-el="as-json-insert-btn"
            disabled={!preview}
            onClick={() => {
              onInsert(preview);
              onClose();
            }}
            className="px-3 py-1.5 rounded text-[12px] font-semibold bg-accent-500 text-[#042f2e] hover:bg-accent-400 transition-colors disabled:bg-zinc-800 disabled:text-zinc-500 disabled:cursor-not-allowed"
          >
            Insert
          </button>
        </div>
      </div>
    </div>
  );
}
