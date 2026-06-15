import { useEffect, useMemo, useState } from "react";
import type { KeyboardEvent as ReactKeyboardEvent } from "react";
import {
  RowsPlusBottom,
  CircleNotch as Loader2,
  Key,
  X,
} from "@phosphor-icons/react";
import clsx from "clsx";
import { ipc } from "../ipc";
import { useBackdropDismiss } from "../lib/useBackdropDismiss";
import { Tooltip } from "./Tooltip";
import type { ColumnDef } from "../types";

interface ColumnMeta {
  def: ColumnDef;
  isAuto: boolean;
  hasDefault: boolean;
  /** NOT NULL with no default and not auto-increment — must be supplied. */
  required: boolean;
}

/** A value the user supplied for one column (omitted columns aren't sent). */
export interface InsertValue {
  column: string;
  value: string | null;
}

type ControlKind = "textarea" | "date" | "datetime" | "number" | "text";

/** Choose an input control from a column's SQL type. The base type is the
 * leading word of `columnType` (e.g. "int(11) unsigned" → "int"). */
function controlKind(columnType: string): ControlKind {
  const base = columnType.toLowerCase().split(/[ (]/)[0];
  switch (base) {
    case "text":
    case "tinytext":
    case "mediumtext":
    case "longtext":
    case "json":
      return "textarea";
    case "date":
      return "date";
    case "datetime":
    case "timestamp":
      return "datetime";
    case "tinyint":
    case "smallint":
    case "mediumint":
    case "int":
    case "bigint":
      return "number";
    default:
      return "text";
  }
}

export function InsertRowDialog({
  profileId,
  database,
  table,
  onSubmit,
  onClose,
  onAbort,
  seed,
  notice,
  validate,
  heading = "Insert row",
  submitText = "Insert row",
}: {
  profileId: string;
  database: string;
  table: string;
  onSubmit: (values: InsertValue[]) => Promise<void>;
  onClose: () => void;
  /** When set, an "Abort" button appears that dismisses the whole flow at once
   * (vs. Cancel, which skips only the current item). Used by the duplicate-row
   * conflict queue so a long run of failures isn't dismissed one click at a time. */
  onAbort?: () => void;
  /** Pre-fill each column's input (auto-increment/generated columns are always
   * left blank). Used by "Duplicate row" to seed a conflicting row for editing. */
  seed?: Record<string, string | null>;
  /** A static message shown in a banner above the fields. */
  notice?: string;
  /** Called on open and before each submit to surface unique-constraint
   * conflicts. Returns the colliding columns (highlighted) plus a message, or
   * null when the row is clear to insert. When it returns conflicts, the submit
   * is held back so the user can fix every flagged field first. */
  validate?: (
    values: InsertValue[]
  ) => Promise<{ columns: string[]; message: string } | null>;
  /** Dialog title (defaults to "Insert row"). */
  heading?: string;
  /** Submit-button label (defaults to "Insert row"). */
  submitText?: string;
}) {
  const [defs, setDefs] = useState<ColumnDef[] | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [fields, setFields] = useState<Record<string, string>>({});
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  /** Columns flagged by `validate` — their inputs are highlighted. */
  const [errored, setErrored] = useState<Set<string>>(new Set());
  const [conflictMsg, setConflictMsg] = useState<string | null>(null);
  const backdrop = useBackdropDismiss(onClose, !busy);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape" && !busy) onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [busy, onClose]);

  useEffect(() => {
    let cancelled = false;
    ipc
      .columnDefinitions(profileId, database, table)
      .then((cols) => {
        if (cancelled) return;
        setDefs(cols);
        const init: Record<string, string> = {};
        for (const c of cols) {
          /* Never seed auto-increment or generated columns — the server fills
             those, and supplying a value would re-trigger the same conflict. */
          const filled =
            /auto_increment|generated/i.test(c.extra ?? "")
              ? ""
              : seed?.[c.name] ?? "";
          init[c.name] = filled;
        }
        setFields(init);
      })
      .catch((e) => {
        if (!cancelled) setLoadError(String(e));
      });
    return () => {
      cancelled = true;
    };
  }, [profileId, database, table]);

  const meta = useMemo<ColumnMeta[]>(
    () =>
      (defs ?? []).map((def) => {
        const isAuto = /auto_increment/i.test(def.extra ?? "");
        const hasDefault = def.defaultValue != null;
        return {
          def,
          isAuto,
          hasDefault,
          required: !def.nullable && !isAuto && !hasDefault,
        };
      }),
    [defs]
  );

  /** Collapse the form fields into the values an INSERT would send: blank
   * auto-increment columns are skipped, blank nullable columns become NULL, and
   * NOT NULL columns with no default and no value are reported as `missing`. */
  const buildValues = (): { values: InsertValue[]; missing: string[] } => {
    const values: InsertValue[] = [];
    const missing: string[] = [];
    for (const m of meta) {
      const value = fields[m.def.name] ?? "";
      if (value !== "") {
        values.push({ column: m.def.name, value });
        continue;
      }
      if (m.isAuto) continue;
      if (m.def.nullable) values.push({ column: m.def.name, value: null });
      else if (m.hasDefault) continue;
      else missing.push(m.def.name);
    }
    return { values, missing };
  };

  /* On open, surface every conflicting column up front (not one per submit). */
  useEffect(() => {
    if (!defs || !validate) return;
    let cancelled = false;
    validate(buildValues().values).then((conflict) => {
      if (cancelled || !conflict) return;
      setErrored(new Set(conflict.columns));
      setConflictMsg(conflict.message);
    });
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [defs]);

  /** Editing a flagged field clears its highlight until the next validation. */
  const setField = (name: string, value: string) => {
    setFields((prev) => ({ ...prev, [name]: value }));
    setErrored((prev) => {
      if (!prev.has(name)) return prev;
      const next = new Set(prev);
      next.delete(name);
      return next;
    });
  };

  const submit = async () => {
    if (busy || !defs) return;
    const { values, missing } = buildValues();
    if (missing.length > 0) {
      setError(`Required: ${missing.join(", ")}`);
      return;
    }
    if (values.length === 0) {
      setError("Enter at least one value.");
      return;
    }
    setBusy(true);
    setError(null);
    try {
      if (validate) {
        const conflict = await validate(values);
        if (conflict) {
          setErrored(new Set(conflict.columns));
          setConflictMsg(conflict.message);
          setBusy(false);
          return;
        }
        setErrored(new Set());
        setConflictMsg(null);
      }
      await onSubmit(values);
      onClose();
    } catch (e) {
      setError(String(e));
      setBusy(false);
    }
  };

  const placeholderFor = (m: ColumnMeta): string => {
    if (m.isAuto) return "auto-increment";
    if (m.hasDefault) return `default: ${m.def.defaultValue}`;
    if (m.def.nullable) return "NULL";
    return "";
  };

  /** Render the editor for a column, sniffing its SQL type. The control is
   * borderless — the input-group container owns the border and focus ring. */
  const renderControl = (m: ColumnMeta) => {
    const name = m.def.name;
    const value = fields[name] ?? "";
    const cls =
      "flex-1 min-w-0 bg-zinc-950 px-2 py-1 font-mono text-zinc-100 outline-none border-0 disabled:opacity-50";
    const onEnter = (e: ReactKeyboardEvent) => {
      if (e.key === "Enter") {
        e.preventDefault();
        submit();
      }
    };

    switch (controlKind(m.def.columnType)) {
      case "textarea":
        return (
          <textarea
            value={value}
            disabled={busy}
            onChange={(e) => setField(name, e.target.value)}
            placeholder={placeholderFor(m)}
            rows={5}
            className={clsx(cls, "resize-y leading-snug")}
          />
        );
      case "number":
        return (
          <input
            type="number"
            value={value}
            disabled={busy}
            onChange={(e) => setField(name, e.target.value)}
            onKeyDown={onEnter}
            placeholder={placeholderFor(m)}
            style={{ colorScheme: "dark" }}
            className={cls}
          />
        );
      case "date":
        return (
          <input
            type="date"
            value={value}
            disabled={busy}
            onChange={(e) => setField(name, e.target.value)}
            onKeyDown={onEnter}
            style={{ colorScheme: "dark" }}
            className={clsx(cls, value === "" && "dbs-date-empty")}
          />
        );
      case "datetime":
        /* MySQL DATETIME/TIMESTAMP are stored "YYYY-MM-DD HH:MM:SS"; the native
           control wants a "T" separator. Keep the space form in state (what the
           INSERT sends) and translate only for display. */
        return (
          <input
            type="datetime-local"
            step="1"
            value={value ? value.replace(" ", "T") : ""}
            disabled={busy}
            onChange={(e) => setField(name, e.target.value.replace("T", " "))}
            onKeyDown={onEnter}
            style={{ colorScheme: "dark" }}
            className={clsx(cls, value === "" && "dbs-date-empty")}
          />
        );
      default:
        return (
          <input
            type="text"
            value={value}
            disabled={busy}
            onChange={(e) => setField(name, e.target.value)}
            onKeyDown={onEnter}
            placeholder={placeholderFor(m)}
            className={cls}
          />
        );
    }
  };

  const banner = conflictMsg ?? notice;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm"
      {...backdrop}
    >
      <div
        data-el="insert-row-dialog"
        role="dialog"
        aria-modal="true"
        onClick={(e) => e.stopPropagation()}
        className="flex flex-col w-[560px] max-w-[92vw] max-h-[65vh] rounded-lg border border-zinc-700 bg-zinc-900 shadow-2xl shadow-black/60"
      >
        <div className="flex items-center justify-between px-4 py-3 border-b border-zinc-800 shrink-0">
          <div className="flex items-center gap-2">
            <RowsPlusBottom size={18} className="text-emerald-400" />
            <h2 className="text-sm font-semibold text-zinc-100">
              {heading}{" "}
              <span className="font-normal text-zinc-500">— {table}</span>
            </h2>
          </div>
          {!busy && (
            <button
              onClick={onClose}
              className="text-zinc-500 hover:text-zinc-200"
              aria-label="Close"
            >
              <X size={18} />
            </button>
          )}
        </div>

        {banner && (
          <div
            className={clsx(
              "shrink-0 mx-4 mt-3 rounded border px-3 py-2 text-[11px] break-words",
              conflictMsg
                ? "bg-rose-950/40 border-rose-900/60 text-rose-200"
                : "bg-amber-950/40 border-amber-900/60 text-amber-200"
            )}
          >
            {banner}
          </div>
        )}

        <div className="flex-1 min-h-0 overflow-auto px-4 py-4">
          {loadError ? (
            <div className="rounded bg-rose-950/40 border border-rose-900/60 px-3 py-2 text-[11px] text-rose-300 break-words">
              {loadError}
            </div>
          ) : !defs ? (
            <div className="flex items-center justify-center gap-2 py-8 text-zinc-500 text-xs">
              <Loader2 size={16} className="animate-spin" /> Loading columns…
            </div>
          ) : (
            <div className="space-y-1">
              {meta.map((m) => {
                const isPk = m.def.key === "PRI";
                return (
                  <div
                    key={m.def.name}
                    className={clsx(
                      "flex items-stretch rounded border overflow-hidden",
                      errored.has(m.def.name)
                        ? "border-rose-500 focus-within:border-rose-400"
                        : "border-zinc-700 focus-within:border-accent-500"
                    )}
                  >
                    <Tooltip
                      className="w-40 shrink-0 cursor-help flex items-center justify-end gap-1.5 pl-2 pr-3 bg-zinc-800 border-r border-zinc-700"
                      label={<ColumnDefTip def={m.def} required={m.required} />}
                    >
                      {isPk && (
                        <Key
                          size={12}
                          weight="fill"
                          className="text-emerald-400 shrink-0"
                        />
                      )}
                      <span className="min-w-0 flex items-baseline gap-0.5">
                        <span className="font-mono text-[12px] text-zinc-300 truncate">
                          {m.def.name}
                        </span>
                        {m.required && (
                          <span
                            className="text-rose-500 shrink-0 text-[16px] leading-none"
                            title="required"
                          >
                            *
                          </span>
                        )}
                      </span>
                    </Tooltip>
                    {renderControl(m)}
                  </div>
                );
              })}
            </div>
          )}
        </div>

        {error && (
          <div className="shrink-0 mx-4 rounded bg-rose-950/40 border border-rose-900/60 px-3 py-2 text-[11px] text-rose-300 break-words">
            {error}
          </div>
        )}

        <div className="flex justify-end gap-2 border-t border-zinc-800 px-4 py-3 shrink-0">
          {onAbort && (
            <button
              onClick={onAbort}
              disabled={busy}
              className="mr-auto px-3 py-1.5 rounded text-[12px] text-rose-300 bg-rose-950/40 hover:bg-rose-950/70 disabled:opacity-50"
            >
              Abort
            </button>
          )}
          <button
            onClick={onClose}
            disabled={busy}
            className="px-3 py-1.5 rounded text-[12px] text-zinc-200 bg-zinc-800 hover:bg-zinc-700 disabled:opacity-50"
          >
            {onAbort ? "Skip" : "Cancel"}
          </button>
          <button
            data-el="insert-row-submit-btn"
            onClick={submit}
            disabled={busy || !defs}
            className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded text-[12px] font-semibold bg-emerald-500 text-emerald-950 hover:bg-emerald-400 transition-colors disabled:bg-zinc-800 disabled:text-zinc-500 disabled:cursor-not-allowed"
          >
            {busy ? (
              <Loader2 size={14} className="animate-spin" />
            ) : (
              <RowsPlusBottom size={14} />
            )}
            {busy ? "Inserting…" : submitText}
          </button>
        </div>
      </div>
    </div>
  );
}

/** Hover-tip body describing a column: its type/length, whether it's required,
 * default, extra (e.g. auto_increment), and comment. */
function ColumnDefTip({ def, required }: { def: ColumnDef; required: boolean }) {
  return (
    <div className="space-y-1.5">
      <div className="flex items-center gap-2">
        <span className="font-mono text-[12px] text-zinc-100 break-all">
          {def.name}
        </span>
        {required && <span className="text-amber-400">required</span>}
      </div>
      <div className="grid grid-cols-[auto_1fr] gap-x-2 gap-y-0.5">
        <span className="text-zinc-500">Type</span>
        <span className="font-mono text-zinc-200 break-all">
          {def.columnType}
        </span>
        {def.defaultValue != null && (
          <>
            <span className="text-zinc-500">Default</span>
            <span className="font-mono text-zinc-200 break-all">
              {def.defaultValue}
            </span>
          </>
        )}
        {def.extra.trim() !== "" && (
          <>
            <span className="text-zinc-500">Extra</span>
            <span className="font-mono text-zinc-200 break-all">
              {def.extra}
            </span>
          </>
        )}
      </div>
      {def.comment.trim() !== "" && (
        <div className="pt-1.5 mt-1.5 border-t border-zinc-700/70 text-zinc-300 break-words">
          {def.comment}
        </div>
      )}
    </div>
  );
}
