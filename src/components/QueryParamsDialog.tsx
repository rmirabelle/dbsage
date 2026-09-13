import { useEffect, useState } from "react";
import { CircleNotch, Play, X } from "@phosphor-icons/react";
import { ipc } from "../ipc";
import { SearchableSelect } from "./SearchableSelect";
import { substituteQueryParams, type QueryParam, type QueryParamOption } from "../lib/queryParams";

/** Options fetched for a query-fed placeholder: loading, a list, or a failure. */
type Fetched = { status: "loading" } | { status: "ok"; options: QueryParamOption[] } | { status: "error"; message: string };

const OPTION_ROW_CAP = 1000;

/** Rows → options. One column: label and value alike. Two or more: value, label. */
function rowsToOptions(columns: string[], rows: Record<string, unknown>[]): QueryParamOption[] {
  const out: QueryParamOption[] = [];
  const seen = new Set<string>();
  for (const row of rows) {
    const raw = row[columns[0]];
    if (raw === null || raw === undefined) continue;
    const value = String(raw);
    const labelRaw = columns.length > 1 ? row[columns[1]] : raw;
    const label = labelRaw === null || labelRaw === undefined ? value : String(labelRaw);
    if (seen.has(value)) continue;
    seen.add(value);
    out.push({ label, value });
  }
  return out;
}

/** Display text per option, made unique so the searchable list maps back to one value. */
function displayLabels(options: QueryParamOption[]): Map<string, string> {
  const counts = new Map<string, number>();
  for (const o of options) counts.set(o.label, (counts.get(o.label) ?? 0) + 1);
  const map = new Map<string, string>();
  for (const o of options) {
    map.set(o.value, (counts.get(o.label) ?? 0) > 1 && o.label !== o.value ? `${o.label} (${o.value})` : o.label);
  }
  return map;
}

interface Props {
  profileId: string;
  database: string;
  /** Owning tab id; the option queries run under a derived token. */
  tabId: string;
  /** In dependency order: a field's inner placeholders come before it. */
  params: QueryParam[];
  /** Values from the last run, keyed by parameter name, to pre-fill. */
  initialValues: Record<string, string>;
  /** "Execute" or "Explain": names the confirm button. */
  action: string;
  onSubmit: (values: Record<string, string>) => void;
  onClose: () => void;
}

/** Asks for every {{placeholder}} value before a query runs. */
export function QueryParamsDialog({ profileId, database, tabId, params, initialValues, action, onSubmit, onClose }: Props) {
  const [values, setValues] = useState<Record<string, string>>(() => {
    const next: Record<string, string> = {};
    for (const p of params) {
      const remembered = initialValues[p.name];
      next[p.name] = p.options
        ? p.options.some((o) => o.value === remembered) ? remembered! : p.options[0]?.value ?? ""
        : remembered ?? "";
    }
    return next;
  });

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  const setValue = (name: string, value: string) => setValues((v) => ({ ...v, [name]: value }));

  /** The option query with inner values filled in, or null while one is still empty. */
  const resolvedSql = (p: QueryParam): string | null => {
    if (!p.optionsSql) return null;
    const missing = (p.dependsOn ?? []).filter((d) => !values[d]);
    return missing.length ? null : substituteQueryParams(p.optionsSql, values);
  };
  const waitingOn = (p: QueryParam) => (p.dependsOn ?? []).filter((d) => !values[d]);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm">
      <div
        data-el="query-params-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby="query-params-title"
        className="w-[440px] max-w-[95vw] max-h-[90vh] overflow-y-auto rounded-lg border border-zinc-700 bg-zinc-900 text-zinc-200 shadow-2xl shadow-black/60"
      >
        <div className="flex items-center justify-between border-b border-zinc-800 px-4 py-3">
          <h2 id="query-params-title" className="text-sm font-semibold">Query parameters</h2>
          <button type="button" onClick={onClose} aria-label="Close" className="p-1 text-zinc-400 hover:text-white">
            <X size={16} />
          </button>
        </div>
        <form
          className="space-y-3 p-4"
          onSubmit={(e) => { e.preventDefault(); onSubmit(values); }}
        >
          {params.map((p, i) => (
            <label key={p.name} className="block text-[11px] text-zinc-400">
              {p.name}
              {p.optionsSql ? (
                <QueryFedField
                  profileId={profileId}
                  database={database}
                  token={`${tabId}:param`}
                  sql={resolvedSql(p)}
                  waitingOn={waitingOn(p)}
                  value={values[p.name]}
                  autoFocus={i === 0}
                  onChange={(value) => setValue(p.name, value)}
                />
              ) : p.options ? (
                <select
                  data-el="query-param-select"
                  value={values[p.name]}
                  onChange={(e) => setValue(p.name, e.target.value)}
                  autoFocus={i === 0}
                  className="mt-1 w-full rounded border border-zinc-700 bg-zinc-950 px-2 py-1 text-[12px] text-zinc-200 outline-none focus:border-accent-500"
                >
                  {p.options.map((o) => (
                    <option key={o.label} value={o.value}>{o.label}</option>
                  ))}
                </select>
              ) : (
                <input
                  data-el="query-param-input"
                  type="text"
                  value={values[p.name]}
                  onChange={(e) => setValue(p.name, e.target.value)}
                  autoFocus={i === 0}
                  spellCheck={false}
                  className="mt-1 w-full rounded border border-zinc-700 bg-zinc-950 px-2 py-1 font-mono text-[12px] text-zinc-200 outline-none focus:border-accent-500"
                />
              )}
            </label>
          ))}
          <div className="flex items-center justify-end gap-2 border-t border-zinc-800 pt-3 text-[12px]">
            <button type="button" onClick={onClose} className="rounded px-3 py-1.5 text-zinc-400 hover:bg-zinc-800">
              Cancel
            </button>
            <button
              type="submit"
              data-el="query-params-submit"
              className="inline-flex items-center gap-1.5 rounded bg-emerald-500 px-3 py-1.5 font-semibold text-emerald-950 hover:bg-emerald-400"
            >
              <Play size={14} weight="fill" /> {action}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

/**
 * A searchable menu fed by a query. Runs the query whenever its resolved text
 * changes (so an inner value change refreshes the list), waits while an inner
 * field is still empty, and falls back to a text input with the error when
 * the query fails.
 */
function QueryFedField({ profileId, database, token, sql, waitingOn, value, autoFocus, onChange }: {
  profileId: string;
  database: string;
  token: string;
  /** The option query with inner values filled in; null while one is missing. */
  sql: string | null;
  /** Names of the inner fields still empty. */
  waitingOn: string[];
  value: string;
  autoFocus: boolean;
  onChange: (value: string) => void;
}) {
  const [state, setState] = useState<Fetched>({ status: "loading" });

  useEffect(() => {
    if (sql === null) return;
    let cancelled = false;
    setState({ status: "loading" });
    ipc.executeQuery({ profileId, database, sql, token, maxRows: OPTION_ROW_CAP })
      .then((result) => {
        if (cancelled) return;
        const set = result.results.find((r) => r.rowsAffected == null);
        const columns = set?.columns.map((c) => c.name) ?? [];
        const options = set ? rowsToOptions(columns, set.rows) : [];
        if (options.length === 0) {
          setState({ status: "error", message: "The option query returned no rows." });
          return;
        }
        setState({ status: "ok", options });
        if (!options.some((o) => o.value === value)) onChange(options[0].value);
      })
      .catch((e) => { if (!cancelled) setState({ status: "error", message: String(e) }); });
    return () => { cancelled = true; };
    /* `value` is read once per fetch on purpose: a fetch must not re-run when the pick changes. */
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sql, profileId, database, token]);

  if (sql === null) {
    return (
      <div className="mt-1 rounded border border-dashed border-zinc-700 bg-zinc-950 px-2 py-1 text-[12px] text-zinc-500">
        Waiting for {waitingOn.join(", ")}…
      </div>
    );
  }
  if (state.status === "loading") {
    return (
      <div className="mt-1 flex items-center gap-2 rounded border border-zinc-700 bg-zinc-950 px-2 py-1 text-[12px] text-zinc-500">
        <CircleNotch size={14} className="animate-spin" /> Loading options…
      </div>
    );
  }
  if (state.status === "error") {
    return (
      <>
        <input
          data-el="query-param-input"
          type="text"
          value={value}
          onChange={(e) => onChange(e.target.value)}
          autoFocus={autoFocus}
          spellCheck={false}
          className="mt-1 w-full rounded border border-zinc-700 bg-zinc-950 px-2 py-1 font-mono text-[12px] text-zinc-200 outline-none focus:border-accent-500"
        />
        <span className="mt-1 block text-[11px] text-rose-300">{state.message}</span>
      </>
    );
  }
  const labels = displayLabels(state.options);
  const valueByLabel = new Map([...labels].map(([v, l]) => [l, v]));
  return (
    <SearchableSelect
      dataEl="query-param-select"
      value={labels.get(value) ?? ""}
      options={[...labels.values()]}
      placeholder="Choose…"
      onChange={(label) => { const v = valueByLabel.get(label); if (v !== undefined) onChange(v); }}
      className="mt-1"
    />
  );
}
