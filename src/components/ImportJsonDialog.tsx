import { useEffect, useMemo, useState } from "react";
import {
  BracketsCurly,
  CircleNotch as Loader2,
  Key,
  ArrowLeft,
  X,
} from "@phosphor-icons/react";
import clsx from "clsx";
import { open } from "@tauri-apps/plugin-dialog";
import { listen } from "@tauri-apps/api/event";
import { ipc } from "../ipc";
import { useBackdropDismiss } from "../lib/useBackdropDismiss";
import { notifyInfo, notifySuccess } from "../state/notify";
import type { ColumnDef, JsonColumnMapping, JsonImportPreview } from "../types";

type Step = "file" | "map" | "running";

/** Skip sentinel for a column's source dropdown (column falls back to its DB
 * default / auto-increment). */
const SKIP = "";

interface ColMeta {
  def: ColumnDef;
  isAuto: boolean;
  /** NOT NULL, no default, not auto-increment — must be mapped to import. */
  required: boolean;
}

/**
 * Multi-step wizard for importing rows from a JSON file into one table:
 * pick a `.json` file, map its properties onto columns, then insert. The backend
 * reads and parses the file from its path (it never enters the webview); the
 * whole import runs in a single transaction, so any error rolls it all back.
 */
export function ImportJsonDialog({
  profileId,
  database,
  table,
  onClose,
  onImported,
}: {
  profileId: string;
  database: string;
  table: string;
  onClose: () => void;
  /** Called once after a successful import so the caller can refresh its rows. */
  onImported: () => void;
}) {
  const [step, setStep] = useState<Step>("file");

  const [path, setPath] = useState<string | null>(null);
  const [preview, setPreview] = useState<JsonImportPreview | null>(null);
  const [previewing, setPreviewing] = useState(false);
  const [previewError, setPreviewError] = useState<string | null>(null);

  const [defs, setDefs] = useState<ColumnDef[] | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [mapping, setMapping] = useState<Record<string, string>>({});

  const [error, setError] = useState<string | null>(null);
  const [progress, setProgress] = useState<{ done: number; total: number } | null>(null);
  const [cancelling, setCancelling] = useState(false);

  const busy = step === "running";
  const backdrop = useBackdropDismiss(onClose, !busy);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape" && !busy) onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [busy, onClose]);

  /* Load the table's columns once, up front — needed for the mapping step and
     for auto-matching against the JSON keys. */
  useEffect(() => {
    let cancelled = false;
    ipc
      .columnDefinitions(profileId, database, table)
      .then((cols) => {
        if (!cancelled) setDefs(cols);
      })
      .catch((e) => {
        if (!cancelled) setLoadError(String(e));
      });
    return () => {
      cancelled = true;
    };
  }, [profileId, database, table]);

  const meta = useMemo<ColMeta[]>(
    () =>
      (defs ?? []).map((def) => {
        const isAuto = /auto_increment/i.test(def.extra ?? "");
        return {
          def,
          isAuto,
          required: !def.nullable && def.defaultValue == null && !isAuto,
        };
      }),
    [defs]
  );

  /** Auto-match columns to JSON keys. An exact case-insensitive name match wins;
   * failing that, a canonical match ignores separators and case so naming-convention
   * differences line up (e.g. `num_login_attempts` ↔ `numLoginAttempts`). */
  const buildAutoMapping = (cols: ColumnDef[], keys: string[]) => {
    const canon = (s: string) => s.toLowerCase().replace(/[^a-z0-9]/g, "");
    const byLower = new Map<string, string>();
    const byCanon = new Map<string, string>();
    for (const k of keys) {
      const lower = k.toLowerCase();
      if (!byLower.has(lower)) byLower.set(lower, k);
      const c = canon(k);
      if (!byCanon.has(c)) byCanon.set(c, k);
    }
    const next: Record<string, string> = {};
    for (const col of cols) {
      next[col.name] =
        byLower.get(col.name.toLowerCase()) ?? byCanon.get(canon(col.name)) ?? SKIP;
    }
    return next;
  };

  const chooseFile = async () => {
    setPreviewError(null);
    const picked = await open({
      multiple: false,
      filters: [{ name: "JSON", extensions: ["json"] }],
    });
    if (typeof picked !== "string") return;
    setPath(picked);
    setPreview(null);
    setPreviewing(true);
    try {
      const p = await ipc.jsonImportPreview(picked);
      setPreview(p);
      if (defs) setMapping(buildAutoMapping(defs, p.keys));
    } catch (e) {
      setPreviewError(String(e));
    } finally {
      setPreviewing(false);
    }
  };

  const goToMap = () => {
    if (defs && preview) setMapping(buildAutoMapping(defs, preview.keys));
    setError(null);
    setStep("map");
  };

  const mappings: JsonColumnMapping[] = useMemo(
    () =>
      Object.entries(mapping)
        .filter(([, key]) => key !== SKIP)
        .map(([column, jsonKey]) => ({ column, jsonKey })),
    [mapping]
  );

  /** Required columns the user left unmapped — block the import until resolved. */
  const missingRequired = useMemo(
    () => meta.filter((m) => m.required && (mapping[m.def.name] ?? SKIP) === SKIP).map((m) => m.def.name),
    [meta, mapping]
  );

  const canImport = mappings.length > 0 && missingRequired.length === 0 && !!path;

  const startImport = async () => {
    if (!canImport || !path) return;
    setStep("running");
    setError(null);
    setCancelling(false);
    setProgress({ done: 0, total: preview?.rowCount ?? 0 });
    const unlisten = await listen<{ done: number; total: number }>(
      "json-import-progress",
      (e) => setProgress({ done: e.payload.done, total: e.payload.total })
    );
    try {
      const res = await ipc.importJsonRows({ profileId, database, table, path, mappings });
      if (res.cancelled) {
        notifyInfo("Import cancelled — no rows were added.");
        onClose();
      } else {
        notifySuccess(
          `Imported ${res.inserted.toLocaleString()} row${
            res.inserted === 1 ? "" : "s"
          } into "${table}".`
        );
        onImported();
        onClose();
      }
    } catch (e) {
      /* Surface the (row-pinpointed) error and drop back to mapping so the user
         can unmap a column or fix the data without restarting the wizard. */
      setError(String(e));
      setStep("map");
    } finally {
      unlisten();
      setProgress(null);
    }
  };

  const cancelImport = () => {
    setCancelling(true);
    ipc.cancelJsonImport().catch(() => {});
  };

  const pct =
    progress && progress.total > 0
      ? Math.min(100, Math.round((progress.done / progress.total) * 100))
      : null;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm"
      {...backdrop}
    >
      <div
        data-el="import-json-dialog"
        role="dialog"
        aria-modal="true"
        onClick={(e) => e.stopPropagation()}
        className="flex flex-col w-[620px] max-w-[92vw] max-h-[72vh] rounded-lg border border-zinc-700 bg-zinc-900 shadow-2xl shadow-black/60"
      >
        <div className="flex items-center justify-between px-4 py-3 border-b border-zinc-800 shrink-0">
          <div className="flex items-center gap-2">
            <BracketsCurly size={18} className="text-sky-400" />
            <h2 className="text-sm font-semibold text-zinc-100">
              Import JSON <span className="font-normal text-zinc-500">— {table}</span>
            </h2>
          </div>
          {!busy && (
            <button onClick={onClose} className="text-zinc-500 hover:text-zinc-200" aria-label="Close">
              <X size={18} />
            </button>
          )}
        </div>

        {error && (
          <div className="shrink-0 mx-4 mt-3 rounded border border-rose-900/60 bg-rose-950/40 px-3 py-2 text-[11px] text-rose-200 break-words">
            {error}
          </div>
        )}

        <div className="flex-1 min-h-0 overflow-auto px-4 py-4">
          {step === "file" && (
            <FileStep
              path={path}
              preview={preview}
              previewing={previewing}
              previewError={previewError}
              onChoose={chooseFile}
            />
          )}

          {step === "map" && (
            <MapStep
              meta={meta}
              keys={preview?.keys ?? []}
              mapping={mapping}
              setMapping={setMapping}
              loadError={loadError}
              defsLoaded={!!defs}
              missingRequired={missingRequired}
            />
          )}

          {step === "running" && (
            <div className="flex flex-col items-center justify-center gap-4 py-10">
              <div className="flex items-center gap-2 text-[13px] text-zinc-100">
                <Loader2 size={16} className="animate-spin text-sky-400 shrink-0" />
                <span>
                  Importing into <span className="font-semibold">{table}</span>
                </span>
              </div>
              <div className="h-1.5 w-[320px] overflow-hidden rounded bg-zinc-800">
                <div
                  className={
                    pct !== null
                      ? "h-full bg-sky-500 transition-[width] duration-150"
                      : "h-full w-1/3 bg-sky-500 animate-pulse"
                  }
                  style={pct !== null ? { width: `${pct}%` } : undefined}
                />
              </div>
              <span className="text-[11px] tabular-nums text-zinc-500">
                {cancelling
                  ? "Cancelling…"
                  : progress && progress.total > 0
                    ? `${progress.done.toLocaleString()} / ${progress.total.toLocaleString()} rows${
                        pct !== null ? ` (${pct}%)` : ""
                      }`
                    : "Working…"}
              </span>
            </div>
          )}
        </div>

        <div className="flex items-center justify-end gap-2 border-t border-zinc-800 px-4 py-3 shrink-0">
          {step === "map" && (
            <button
              onClick={() => {
                setError(null);
                setStep("file");
              }}
              className="mr-auto inline-flex items-center gap-1.5 px-3 py-1.5 rounded text-[12px] text-zinc-300 bg-zinc-800 hover:bg-zinc-700"
            >
              <ArrowLeft size={14} /> Back
            </button>
          )}

          {step === "running" ? (
            <button
              data-el="import-json-cancel-btn"
              onClick={cancelImport}
              disabled={cancelling}
              className="rounded bg-zinc-800 px-3 py-1.5 text-[12px] font-semibold text-zinc-200 hover:bg-zinc-700 disabled:opacity-40"
            >
              Cancel
            </button>
          ) : (
            <button
              onClick={onClose}
              className="px-3 py-1.5 rounded text-[12px] text-zinc-200 bg-zinc-800 hover:bg-zinc-700"
            >
              Cancel
            </button>
          )}

          {step === "file" && (
            <button
              data-el="import-json-next-btn"
              onClick={goToMap}
              disabled={!preview || preview.rowCount === 0 || !defs}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded text-[12px] font-semibold bg-sky-500 text-sky-950 hover:bg-sky-400 transition-colors disabled:bg-zinc-800 disabled:text-zinc-500 disabled:cursor-not-allowed"
            >
              Next: map fields
            </button>
          )}

          {step === "map" && (
            <button
              data-el="import-json-run-btn"
              onClick={startImport}
              disabled={!canImport}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded text-[12px] font-semibold bg-sky-500 text-sky-950 hover:bg-sky-400 transition-colors disabled:bg-zinc-800 disabled:text-zinc-500 disabled:cursor-not-allowed"
              title={
                missingRequired.length > 0
                  ? `Map required column(s): ${missingRequired.join(", ")}`
                  : undefined
              }
            >
              Import {preview ? preview.rowCount.toLocaleString() : ""} rows
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

function FileStep({
  path,
  preview,
  previewing,
  previewError,
  onChoose,
}: {
  path: string | null;
  preview: JsonImportPreview | null;
  previewing: boolean;
  previewError: string | null;
  onChoose: () => void;
}) {
  const fileName = path ? path.replace(/^.*[\\/]/, "") : null;
  const sample = preview?.sampleRows?.[0];
  return (
    <div className="space-y-4">
      <div className="flex items-center gap-3">
        <button
          onClick={onChoose}
          className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded text-[12px] font-semibold bg-sky-500 text-sky-950 hover:bg-sky-400 transition-colors"
        >
          <BracketsCurly size={15} /> Choose JSON file…
        </button>
        {fileName && (
          <span className="font-mono text-[12px] text-zinc-300 truncate" title={path ?? undefined}>
            {fileName}
          </span>
        )}
      </div>

      <p className="text-[11px] text-zinc-500">
        Expects a JSON array of objects, e.g.{" "}
        <span className="font-mono text-zinc-400">{`[{ "name": "Ada" }, …]`}</span>.
      </p>

      {previewing && (
        <div className="flex items-center gap-2 text-zinc-500 text-xs">
          <Loader2 size={14} className="animate-spin" /> Reading file…
        </div>
      )}

      {previewError && (
        <div className="rounded border border-rose-900/60 bg-rose-950/40 px-3 py-2 text-[11px] text-rose-300 break-words">
          {previewError}
        </div>
      )}

      {preview && !previewing && (
        <div className="space-y-3">
          <div className="flex items-center gap-4 text-[12px] text-zinc-300">
            <span>
              <span className="font-semibold text-zinc-100">
                {preview.rowCount.toLocaleString()}
              </span>{" "}
              record{preview.rowCount === 1 ? "" : "s"}
            </span>
            <span>
              <span className="font-semibold text-zinc-100">{preview.keys.length}</span>{" "}
              propert{preview.keys.length === 1 ? "y" : "ies"}
            </span>
          </div>
          {preview.rowCount === 0 && (
            <div className="rounded border border-amber-900/60 bg-amber-950/40 px-3 py-2 text-[11px] text-amber-200">
              The file contains no records to import.
            </div>
          )}
          {sample !== undefined && (
            <div>
              <div className="text-[11px] text-zinc-500 mb-1">First record</div>
              <pre className="max-h-44 overflow-auto rounded border border-zinc-800 bg-zinc-950 px-3 py-2 text-[11px] font-mono text-zinc-300 leading-snug">
                {JSON.stringify(sample, null, 2)}
              </pre>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function MapStep({
  meta,
  keys,
  mapping,
  setMapping,
  loadError,
  defsLoaded,
  missingRequired,
}: {
  meta: ColMeta[];
  keys: string[];
  mapping: Record<string, string>;
  setMapping: (next: Record<string, string>) => void;
  loadError: string | null;
  defsLoaded: boolean;
  missingRequired: string[];
}) {
  if (loadError) {
    return (
      <div className="rounded border border-rose-900/60 bg-rose-950/40 px-3 py-2 text-[11px] text-rose-300 break-words">
        {loadError}
      </div>
    );
  }
  if (!defsLoaded) {
    return (
      <div className="flex items-center justify-center gap-2 py-8 text-zinc-500 text-xs">
        <Loader2 size={16} className="animate-spin" /> Loading columns…
      </div>
    );
  }

  return (
    <div className="space-y-3">
      <p className="text-[11px] text-zinc-500">
        Pick the JSON property feeding each column. Leave a column{" "}
        <span className="text-zinc-400">— skip —</span> to use its default or
        auto-increment (e.g. unmap <span className="font-mono text-zinc-400">id</span> to let new ids
        be assigned).
      </p>

      {missingRequired.length > 0 && (
        <div className="rounded border border-amber-900/60 bg-amber-950/40 px-3 py-2 text-[11px] text-amber-200">
          Map these required column{missingRequired.length === 1 ? "" : "s"} to continue:{" "}
          <span className="font-mono">{missingRequired.join(", ")}</span>
        </div>
      )}

      <div className="space-y-1">
        {meta.map((m) => {
          const isPk = m.def.key === "PRI";
          const unmappedRequired = m.required && (mapping[m.def.name] ?? SKIP) === SKIP;
          return (
            <div
              key={m.def.name}
              className={clsx(
                "flex items-center gap-2 rounded border px-2 py-1.5",
                unmappedRequired ? "border-amber-700/70" : "border-zinc-800"
              )}
            >
              <div className="flex w-52 shrink-0 items-center gap-1.5">
                {isPk && <Key size={12} weight="fill" className="text-emerald-400 shrink-0" />}
                <span className="font-mono text-[12px] text-zinc-200 truncate">{m.def.name}</span>
                {m.required && (
                  <span className="text-rose-500 shrink-0 text-[15px] leading-none" title="required">
                    *
                  </span>
                )}
                {m.isAuto && (
                  <span className="text-[9px] font-semibold text-sky-300/80 shrink-0" title="auto-increment">
                    AI
                  </span>
                )}
              </div>
              <span className="font-mono text-[10px] text-zinc-600 truncate w-28 shrink-0">
                {m.def.columnType}
              </span>
              <select
                value={mapping[m.def.name] ?? SKIP}
                onChange={(e) => setMapping({ ...mapping, [m.def.name]: e.target.value })}
                className="flex-1 min-w-0 bg-zinc-950 border border-zinc-700 rounded px-2 py-1 text-[12px] text-zinc-200 outline-none focus:border-accent-500"
              >
                <option value={SKIP}>— skip (use default) —</option>
                {keys.map((k) => (
                  <option key={k} value={k}>
                    {k}
                  </option>
                ))}
              </select>
            </div>
          );
        })}
      </div>
    </div>
  );
}
