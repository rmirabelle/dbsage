import { useEffect, useMemo, useState } from "react";
import {
  Archive,
  CircleNotch as Loader2,
  ArrowLeft,
  X,
  Warning,
} from "@phosphor-icons/react";
import { open } from "@tauri-apps/plugin-dialog";
import { listen } from "@tauri-apps/api/event";
import { ipc } from "../ipc";
import { useStore } from "../state/store";
import { useBackdropDismiss } from "../lib/useBackdropDismiss";
import { notifyError, notifyInfo, notifySuccess } from "../state/notify";
import type { BackupManifest, RestoreOptions } from "../types";

type Step = "file" | "options" | "running" | "done";
type Mode = "copy" | "overwrite";

/** A compact, filename-safe timestamp for the default copy name. */
function stamp(): string {
  const d = new Date();
  const p = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}_${p(
    d.getHours()
  )}${p(d.getMinutes())}${p(d.getSeconds())}`;
}

/**
 * Multi-step wizard for restoring a `.dbbak` archive. Defaults to restoring into
 * a fresh copy database (the original is never touched), with an optional "make
 * live" swap afterwards. The backend reads the archive from its path.
 */
export function RestoreWizard({
  profileId,
  onClose,
}: {
  profileId: string;
  onClose: () => void;
}) {
  const profiles = useStore((s) => s.profiles);
  const connections = useStore((s) => s.connections);
  const refreshDatabases = useStore((s) => s.refreshDatabases);
  const dropDatabase = useStore((s) => s.dropDatabase);
  const setPendingSwap = useStore((s) => s.setPendingSwap);
  const clearPendingSwap = useStore((s) => s.clearPendingSwap);

  const [step, setStep] = useState<Step>("file");
  const [path, setPath] = useState<string | null>(null);
  const [manifest, setManifest] = useState<BackupManifest | null>(null);
  const [inspecting, setInspecting] = useState(false);
  const [inspectError, setInspectError] = useState<string | null>(null);

  const [targetProfileId, setTargetProfileId] = useState(profileId);
  const [mode, setMode] = useState<Mode>("copy");
  const [targetName, setTargetName] = useState("");
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [includeSchema, setIncludeSchema] = useState(true);
  const [includeData, setIncludeData] = useState(true);
  const [includeObjects, setIncludeObjects] = useState(true);
  const [includeMetadata, setIncludeMetadata] = useState(true);

  const [progress, setProgress] = useState<{
    table: string;
    done: number;
    total: number;
  } | null>(null);
  const [cancelling, setCancelling] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [stash, setStash] = useState<string | null>(null);
  const [swapping, setSwapping] = useState(false);

  const busy = step === "running" || swapping;
  const backdrop = useBackdropDismiss(onClose, !busy);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape" && !busy) onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [busy, onClose]);

  const connectedProfiles = useMemo(
    () => profiles.filter((p) => connections[p.id]?.connected),
    [profiles, connections]
  );

  const liveName = manifest?.database ?? "";

  const chooseFile = async () => {
    setInspectError(null);
    const picked = await open({
      multiple: false,
      filters: [{ name: "DB Sage Backup", extensions: ["dbbak"] }],
    });
    if (typeof picked !== "string") return;
    setPath(picked);
    setManifest(null);
    setInspecting(true);
    try {
      const m = await ipc.inspectBackup(picked);
      setManifest(m);
      setSelected(new Set(m.tables.map((t) => t.name)));
      setMode("copy");
      setTargetName(`${m.database}_restore_${stamp()}`);
    } catch (e) {
      setInspectError(String(e));
    } finally {
      setInspecting(false);
    }
  };

  const setModeAndName = (m: Mode) => {
    setMode(m);
    if (!manifest) return;
    setTargetName(
      m === "overwrite" ? manifest.database : `${manifest.database}_restore_${stamp()}`
    );
  };

  const toggleTable = (name: string) =>
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(name)) next.delete(name);
      else next.add(name);
      return next;
    });

  const canRestore =
    !!path &&
    !!manifest &&
    targetName.trim().length > 0 &&
    selected.size > 0 &&
    (includeSchema || includeData);

  const startRestore = async () => {
    if (!canRestore || !path) return;
    setStep("running");
    setError(null);
    setCancelling(false);
    setProgress({ table: "", done: 0, total: 0 });
    const unlisten = await listen<{ table: string; done: number; total: number }>(
      "db-restore-progress",
      (e) =>
        setProgress({
          table: e.payload.table,
          done: e.payload.done,
          total: e.payload.total,
        })
    );
    const options: RestoreOptions = {
      tables: [...selected],
      includeSchema,
      includeData,
      dropExisting: mode === "overwrite",
      includeObjects,
      includeMetadata,
    };
    try {
      const completed = await ipc.restoreDatabase(
        targetProfileId,
        targetName.trim(),
        path,
        options
      );
      await refreshDatabases(targetProfileId);
      if (completed) {
        /* Remember the copy so the swap can still be finished after the wizard is
           closed (e.g. once the user has reviewed the restored copy). */
        if (canSwap) {
          setPendingSwap({
            profileId,
            liveName,
            restoredName: targetName.trim(),
          });
        }
        setStep("done");
      } else {
        notifyInfo("Restore cancelled.");
        onClose();
      }
    } catch (e) {
      setError(String(e));
      setStep("options");
    } finally {
      unlisten();
      setProgress(null);
    }
  };

  const cancelRestore = () => {
    setCancelling(true);
    ipc.cancelRestore().catch(() => {});
  };

  /** Swap is only possible into the original connection, when the restored copy
   * has a different name than the live database. */
  const canSwap =
    mode === "copy" &&
    targetProfileId === profileId &&
    !!liveName &&
    targetName.trim() !== liveName;

  const makeLive = async () => {
    if (!liveName) return;
    setSwapping(true);
    try {
      const s = await ipc.swapDatabase(profileId, liveName, targetName.trim());
      setStash(s);
      await refreshDatabases(profileId);
      clearPendingSwap();
      notifySuccess(`"${liveName}" is now live.`);
    } catch (e) {
      notifyError(`Swap failed: ${String(e)}`);
    } finally {
      setSwapping(false);
    }
  };

  const discardOld = async () => {
    if (!stash) return;
    setSwapping(true);
    try {
      await dropDatabase(profileId, stash);
      onClose();
    } catch (e) {
      notifyError(`Could not discard "${stash}": ${String(e)}`);
    } finally {
      setSwapping(false);
    }
  };

  const revert = async () => {
    if (!stash || !liveName) return;
    setSwapping(true);
    try {
      await ipc.swapDatabase(profileId, liveName, stash);
      await refreshDatabases(profileId);
      notifyInfo(`Reverted "${liveName}" to the previous version.`);
      onClose();
    } catch (e) {
      notifyError(`Revert failed: ${String(e)}`);
    } finally {
      setSwapping(false);
    }
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
        data-el="restore-wizard"
        role="dialog"
        aria-modal="true"
        onClick={(e) => e.stopPropagation()}
        className="flex flex-col w-[640px] max-w-[92vw] max-h-[78vh] rounded-lg border border-zinc-700 bg-zinc-900 shadow-2xl shadow-black/60"
      >
        <div className="flex items-center justify-between px-4 py-3 border-b border-zinc-800 shrink-0">
          <div className="flex items-center gap-2">
            <Archive size={18} className="text-accent-400" />
            <h2 className="text-sm font-semibold text-zinc-100">
              Restore Database
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

        {error && (
          <div className="shrink-0 mx-4 mt-3 rounded border border-rose-900/60 bg-rose-950/40 px-3 py-2 text-[11px] text-rose-200 break-words">
            {error}
          </div>
        )}

        <div className="flex-1 min-h-0 overflow-auto px-4 py-4">
          {step === "file" && (
            <FileStep
              path={path}
              manifest={manifest}
              inspecting={inspecting}
              inspectError={inspectError}
              onChoose={chooseFile}
            />
          )}

          {step === "options" && manifest && (
            <OptionsStep
              manifest={manifest}
              connectedProfiles={connectedProfiles}
              targetProfileId={targetProfileId}
              setTargetProfileId={setTargetProfileId}
              mode={mode}
              setMode={setModeAndName}
              targetName={targetName}
              setTargetName={setTargetName}
              selected={selected}
              toggleTable={toggleTable}
              setSelected={setSelected}
              includeSchema={includeSchema}
              setIncludeSchema={setIncludeSchema}
              includeData={includeData}
              setIncludeData={setIncludeData}
              includeObjects={includeObjects}
              setIncludeObjects={setIncludeObjects}
              includeMetadata={includeMetadata}
              setIncludeMetadata={setIncludeMetadata}
            />
          )}

          {step === "running" && (
            <div className="flex flex-col items-center justify-center gap-4 py-10">
              <div className="flex items-center gap-2 text-[13px] text-zinc-100">
                <Loader2 size={16} className="animate-spin text-accent-400 shrink-0" />
                <span>
                  Restoring into <span className="font-semibold">{targetName}</span>
                </span>
              </div>
              <div className="h-1.5 w-[320px] overflow-hidden rounded bg-zinc-800">
                <div
                  className={
                    pct !== null
                      ? "h-full bg-accent-500 transition-[width] duration-150"
                      : "h-full w-1/3 bg-accent-500 animate-pulse"
                  }
                  style={pct !== null ? { width: `${pct}%` } : undefined}
                />
              </div>
              <span className="text-[11px] tabular-nums text-zinc-500 truncate max-w-[420px]">
                {cancelling
                  ? "Cancelling…"
                  : progress && progress.total > 0
                  ? `${progress.table} (${progress.done}/${progress.total})`
                  : "Working…"}
              </span>
            </div>
          )}

          {step === "done" && manifest && (
            <DoneStep
              liveName={liveName}
              targetName={targetName.trim()}
              canSwap={canSwap}
              stash={stash}
            />
          )}
        </div>

        <div className="flex items-center justify-end gap-2 border-t border-zinc-800 px-4 py-3 shrink-0">
          {step === "options" && (
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
              onClick={cancelRestore}
              disabled={cancelling}
              className="rounded bg-zinc-800 px-3 py-1.5 text-[12px] font-semibold text-zinc-200 hover:bg-zinc-700 disabled:opacity-40"
            >
              Cancel
            </button>
          ) : step === "done" ? (
            <DoneActions
              canSwap={canSwap}
              stash={stash}
              swapping={swapping}
              onMakeLive={makeLive}
              onDiscard={discardOld}
              onRevert={revert}
              onClose={onClose}
            />
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
              onClick={() => {
                setError(null);
                setStep("options");
              }}
              disabled={!manifest}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded text-[12px] font-semibold bg-accent-500 text-[#042f2e] hover:bg-accent-400 transition-colors disabled:bg-zinc-800 disabled:text-zinc-500 disabled:cursor-not-allowed"
            >
              Next: options
            </button>
          )}

          {step === "options" && (
            <button
              onClick={startRestore}
              disabled={!canRestore}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded text-[12px] font-semibold bg-accent-500 text-[#042f2e] hover:bg-accent-400 transition-colors disabled:bg-zinc-800 disabled:text-zinc-500 disabled:cursor-not-allowed"
            >
              Restore
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

function FileStep({
  path,
  manifest,
  inspecting,
  inspectError,
  onChoose,
}: {
  path: string | null;
  manifest: BackupManifest | null;
  inspecting: boolean;
  inspectError: string | null;
  onChoose: () => void;
}) {
  const fileName = path ? path.replace(/^.*[\\/]/, "") : null;
  return (
    <div className="space-y-4">
      <div className="flex items-center gap-3">
        <button
          onClick={onChoose}
          className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded text-[12px] font-semibold bg-accent-500 text-[#042f2e] hover:bg-accent-400 transition-colors"
        >
          <Archive size={15} /> Choose backup file…
        </button>
        {fileName && (
          <span
            className="font-mono text-[12px] text-zinc-300 truncate"
            title={path ?? undefined}
          >
            {fileName}
          </span>
        )}
      </div>

      {inspecting && (
        <div className="flex items-center gap-2 text-zinc-500 text-xs">
          <Loader2 size={14} className="animate-spin" /> Reading backup…
        </div>
      )}

      {inspectError && (
        <div className="rounded border border-rose-900/60 bg-rose-950/40 px-3 py-2 text-[11px] text-rose-300 break-words">
          {inspectError}
        </div>
      )}

      {manifest && !inspecting && (
        <div className="space-y-2 text-[12px] text-zinc-300">
          <div>
            Database{" "}
            <span className="font-semibold text-zinc-100">
              {manifest.database}
            </span>
          </div>
          <div className="flex flex-wrap gap-x-4 gap-y-1 text-[11px] text-zinc-400">
            <span>{manifest.tables.length} tables</span>
            <span>{manifest.views.length} views</span>
            <span>{manifest.routines.length} routines</span>
            <span>{manifest.triggers.length} triggers</span>
            <span>{manifest.events.length} events</span>
          </div>
          <div className="flex flex-wrap gap-x-4 gap-y-1 text-[11px] text-zinc-500">
            <span>{manifest.metadata.relations} relations</span>
            <span>{manifest.metadata.savedQueries} saved queries</span>
            <span>{manifest.metadata.viewPresets} saved views</span>
          </div>
          <div className="text-[11px] text-zinc-500">
            MySQL {manifest.serverVersion} · created{" "}
            {new Date(manifest.createdAt).toLocaleString()}
          </div>
        </div>
      )}
    </div>
  );
}

function OptionsStep({
  manifest,
  connectedProfiles,
  targetProfileId,
  setTargetProfileId,
  mode,
  setMode,
  targetName,
  setTargetName,
  selected,
  toggleTable,
  setSelected,
  includeSchema,
  setIncludeSchema,
  includeData,
  setIncludeData,
  includeObjects,
  setIncludeObjects,
  includeMetadata,
  setIncludeMetadata,
}: {
  manifest: BackupManifest;
  connectedProfiles: { id: string; name: string }[];
  targetProfileId: string;
  setTargetProfileId: (id: string) => void;
  mode: Mode;
  setMode: (m: Mode) => void;
  targetName: string;
  setTargetName: (s: string) => void;
  selected: Set<string>;
  toggleTable: (name: string) => void;
  setSelected: (s: Set<string>) => void;
  includeSchema: boolean;
  setIncludeSchema: (b: boolean) => void;
  includeData: boolean;
  setIncludeData: (b: boolean) => void;
  includeObjects: boolean;
  setIncludeObjects: (b: boolean) => void;
  includeMetadata: boolean;
  setIncludeMetadata: (b: boolean) => void;
}) {
  const allSelected = selected.size === manifest.tables.length;
  const hasMetadata =
    manifest.metadata.relations +
      manifest.metadata.savedQueries +
      manifest.metadata.viewPresets >
    0;
  return (
    <div className="space-y-4 text-[12px] text-zinc-300">
      {connectedProfiles.length > 1 && (
        <label className="flex items-center gap-2">
          <span className="w-28 shrink-0 text-zinc-400">Connection</span>
          <select
            value={targetProfileId}
            onChange={(e) => setTargetProfileId(e.target.value)}
            className="flex-1 min-w-0 bg-zinc-950 border border-zinc-700 rounded px-2 py-1 text-[12px] text-zinc-200 outline-none focus:border-accent-500"
          >
            {connectedProfiles.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name}
              </option>
            ))}
          </select>
        </label>
      )}

      <div className="space-y-2">
        <div className="flex items-center gap-4">
          <label className="flex items-center gap-1.5">
            <input
              type="radio"
              checked={mode === "copy"}
              onChange={() => setMode("copy")}
              className="accent-accent-500"
            />
            Restore into a copy
          </label>
          <label className="flex items-center gap-1.5">
            <input
              type="radio"
              checked={mode === "overwrite"}
              onChange={() => setMode("overwrite")}
              className="accent-accent-500"
            />
            Overwrite original
          </label>
        </div>
        <label className="flex items-center gap-2">
          <span className="w-28 shrink-0 text-zinc-400">Target database</span>
          <input
            value={targetName}
            onChange={(e) => setTargetName(e.target.value)}
            disabled={mode === "overwrite"}
            className="flex-1 min-w-0 bg-zinc-950 border border-zinc-700 rounded px-2 py-1 font-mono text-[12px] text-zinc-200 outline-none focus:border-accent-500 disabled:opacity-60"
          />
        </label>
        {mode === "overwrite" && (
          <div className="flex items-start gap-2 rounded border border-amber-900/60 bg-amber-950/40 px-3 py-2 text-[11px] text-amber-200">
            <Warning size={14} className="mt-0.5 shrink-0" />
            <span>
              Tables in <span className="font-mono">{manifest.database}</span> will
              be dropped and recreated. The original data is not kept.
            </span>
          </div>
        )}
      </div>

      <div className="space-y-2">
        <div className="flex items-center justify-between">
          <span className="text-zinc-400">Tables</span>
          <button
            onClick={() =>
              setSelected(
                allSelected
                  ? new Set()
                  : new Set(manifest.tables.map((t) => t.name))
              )
            }
            className="text-[11px] text-accent-400 hover:text-accent-300"
          >
            {allSelected ? "Clear all" : "Select all"}
          </button>
        </div>
        <div className="max-h-44 overflow-auto rounded border border-zinc-800 divide-y divide-zinc-800/70">
          {manifest.tables.map((t) => (
            <label
              key={t.name}
              className="flex items-center gap-2 px-2 py-1 hover:bg-zinc-800/40"
            >
              <input
                type="checkbox"
                checked={selected.has(t.name)}
                onChange={() => toggleTable(t.name)}
                className="accent-accent-500"
              />
              <span className="font-mono text-[12px] text-zinc-200 truncate flex-1">
                {t.name}
              </span>
              <span className="text-[10px] tabular-nums text-zinc-500">
                {t.rowCount.toLocaleString()} rows
              </span>
            </label>
          ))}
          {manifest.tables.length === 0 && (
            <div className="px-2 py-2 text-[11px] text-zinc-500">
              No tables in this backup.
            </div>
          )}
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
        <label className="flex items-center gap-1.5">
          <input
            type="checkbox"
            checked={includeSchema}
            onChange={(e) => setIncludeSchema(e.target.checked)}
            className="accent-accent-500"
          />
          Schema
        </label>
        <label className="flex items-center gap-1.5">
          <input
            type="checkbox"
            checked={includeData}
            onChange={(e) => setIncludeData(e.target.checked)}
            className="accent-accent-500"
          />
          Data
        </label>
        <label className="flex items-center gap-1.5">
          <input
            type="checkbox"
            checked={includeObjects}
            onChange={(e) => setIncludeObjects(e.target.checked)}
            className="accent-accent-500"
          />
          Views, routines, triggers, events
        </label>
        {hasMetadata && (
          <label className="flex items-center gap-1.5">
            <input
              type="checkbox"
              checked={includeMetadata}
              onChange={(e) => setIncludeMetadata(e.target.checked)}
              className="accent-accent-500"
            />
            App metadata (saved views, relations, queries)
          </label>
        )}
      </div>
    </div>
  );
}

function DoneStep({
  liveName,
  targetName,
  canSwap,
  stash,
}: {
  liveName: string;
  targetName: string;
  canSwap: boolean;
  stash: string | null;
}) {
  if (stash) {
    return (
      <div className="space-y-2 text-[12px] text-zinc-300 py-4">
        <div>
          <span className="font-mono text-zinc-100">{liveName}</span> is now live
          with the restored data.
        </div>
        <div className="text-[11px] text-zinc-500">
          The previous version was saved as{" "}
          <span className="font-mono">{stash}</span>. Discard it once you've
          confirmed the restore, or revert to roll back.
        </div>
      </div>
    );
  }
  return (
    <div className="space-y-2 text-[12px] text-zinc-300 py-4">
      <div>
        Restored into <span className="font-mono text-zinc-100">{targetName}</span>.
      </div>
      {canSwap && (
        <div className="text-[11px] text-zinc-500">
          "Make live" swaps it into <span className="font-mono">{liveName}</span>{" "}
          (the current version is kept for rollback). Or close this — you can
          review the copy and finish the swap later by right-clicking{" "}
          <span className="font-mono">{targetName}</span> in the tree.
        </div>
      )}
    </div>
  );
}

function DoneActions({
  canSwap,
  stash,
  swapping,
  onMakeLive,
  onDiscard,
  onRevert,
  onClose,
}: {
  canSwap: boolean;
  stash: string | null;
  swapping: boolean;
  onMakeLive: () => void;
  onDiscard: () => void;
  onRevert: () => void;
  onClose: () => void;
}) {
  if (stash) {
    return (
      <>
        <button
          onClick={onRevert}
          disabled={swapping}
          className="mr-auto rounded bg-zinc-800 px-3 py-1.5 text-[12px] font-semibold text-zinc-200 hover:bg-zinc-700 disabled:opacity-40"
        >
          Revert
        </button>
        <button
          onClick={onClose}
          disabled={swapping}
          className="rounded bg-zinc-800 px-3 py-1.5 text-[12px] text-zinc-200 hover:bg-zinc-700 disabled:opacity-40"
        >
          Keep both
        </button>
        <button
          onClick={onDiscard}
          disabled={swapping}
          className="rounded bg-rose-500 px-3 py-1.5 text-[12px] font-semibold text-white hover:bg-rose-400 disabled:opacity-40"
        >
          Discard previous version
        </button>
      </>
    );
  }
  return (
    <>
      <button
        onClick={onClose}
        disabled={swapping}
        className="rounded bg-zinc-800 px-3 py-1.5 text-[12px] text-zinc-200 hover:bg-zinc-700 disabled:opacity-40"
      >
        Close
      </button>
      {canSwap && (
        <button
          onClick={onMakeLive}
          disabled={swapping}
          className="inline-flex items-center gap-1.5 rounded bg-accent-500 px-3 py-1.5 text-[12px] font-semibold text-[#042f2e] hover:bg-accent-400 disabled:opacity-40"
        >
          {swapping && <Loader2 size={13} className="animate-spin" />}
          Make live
        </button>
      )}
    </>
  );
}
