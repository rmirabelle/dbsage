import { useEffect, useState } from "react";
import { CircleNotch, UploadSimple, X } from "@phosphor-icons/react";
import { ipc } from "../ipc";
import { flushColumnSetups, useStore } from "../state/store";
import { notifyError } from "../state/notify";
import { STATE_CATEGORIES, type RowsTab, type StateMappingPreview } from "../types";

/**
 * Import a single-database settings file that was opened from Explorer. Unlike
 * the database-toolbar dialog, the destination is not known yet: the user picks
 * a connection and one or more of its databases, and the file is imported into
 * each of them in turn.
 */
export function ImportDatabaseFileDialog({ path, onClose }: { path: string; onClose: () => void }) {
  const profiles = useStore((s) => s.profiles);
  const [profileId, setProfileId] = useState(profiles[0]?.id ?? "");
  const [databases, setDatabases] = useState<string[]>([]);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [loadingDbs, setLoadingDbs] = useState(false);
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [results, setResults] = useState<{ database: string; preview: StateMappingPreview }[]>([]);
  const fileName = path.split(/[\\/]/).pop() ?? path;

  useEffect(() => {
    const escape = (event: KeyboardEvent) => { if (event.key === "Escape" && !busy) onClose(); };
    window.addEventListener("keydown", escape);
    return () => window.removeEventListener("keydown", escape);
  }, [busy, onClose]);

  /** Connect the chosen profile and list its databases. */
  useEffect(() => {
    if (!profileId) return;
    let cancelled = false;
    setDatabases([]); setSelected(new Set()); setError(null); setLoadingDbs(true);
    (async () => {
      try {
        const state = useStore.getState();
        if (!state.connections[profileId]?.connected) await state.connectProfile(profileId);
        const list = await ipc.listDatabases(profileId);
        if (!cancelled) setDatabases(list);
      } catch (e) { if (!cancelled) setError(String(e)); }
      finally { if (!cancelled) setLoadingDbs(false); }
    })();
    return () => { cancelled = true; };
  }, [profileId]);

  const toggle = (database: string, checked: boolean) => setSelected((prev) => {
    const next = new Set(prev);
    if (checked) next.add(database); else next.delete(database);
    return next;
  });

  const run = async () => {
    if (busy || selected.size === 0) return;
    setBusy(true); setError(null);
    const state = useStore.getState();
    const profile = state.profiles.find((p) => p.id === profileId);
    const host = profile?.host;
    const matchingProfile = (id: string) => state.profiles.some((p) => p.id === id && p.host === host);
    const targets = databases.filter((d) => selected.has(d));
    const reopen: RowsTab[] = [];
    const activeTabId = state.activeTabId;
    const imported: { database: string; preview: StateMappingPreview }[] = [];
    try {
      await flushColumnSetups();
      /** Validate against every target before changing anything. */
      for (const database of targets) await ipc.importDatabaseSettings(path, "", profileId, database, true);
      for (const current of useStore.getState().tabs) {
        if (current.kind === "rows" && selected.has(current.database) && matchingProfile(current.profileId)) {
          reopen.push(current);
          state.closeTab(current.id);
        }
      }
      await flushColumnSetups();
      for (const database of targets) {
        imported.push({ database, preview: await ipc.importDatabaseSettings(path, "", profileId, database, false) });
      }
      setResults(imported);
      setDone(true);
      await state.reloadAfterImport();
      for (const database of targets) await state.loadSavedQueryCount(profileId, database);
      for (const tab of useStore.getState().tabs) {
        if (tab.kind === "database" && selected.has(tab.database) && matchingProfile(tab.profileId)) await state.refreshTab(tab.id);
      }
    } catch (e) { setError(String(e)); }
    finally {
      for (const current of reopen) {
        try { await state.openTable(current.profileId, current.profileName, current.database, current.table); }
        catch (e) { notifyError(`Could not reopen ${current.table}: ${String(e)}`); }
      }
      if (reopen.length && activeTabId) state.setActiveTab(activeTabId);
      setBusy(false);
    }
  };

  const summary = (preview: StateMappingPreview) => STATE_CATEGORIES
    .filter((category) => preview.counts[category.key] > 0)
    .map((category) => `${preview.counts[category.key]} ${category.label.toLowerCase()}`)
    .join(", ") || "no compatible settings";

  return <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm">
    <div role="dialog" aria-modal="true" aria-labelledby="import-database-file-title" data-el="import-database-file-dialog"
      className="w-[480px] max-w-[95vw] max-h-[90vh] overflow-auto rounded-lg border border-zinc-700 bg-zinc-900 text-zinc-200 shadow-2xl">
      <div className="flex items-center justify-between border-b border-zinc-800 px-4 py-3">
        <h2 id="import-database-file-title" className="text-sm font-semibold">Import database settings</h2>
        <button type="button" disabled={busy} onClick={onClose} aria-label="Close" className="p-1 text-zinc-400 hover:text-white disabled:opacity-40"><X size={16} /></button>
      </div>
      <fieldset disabled={busy || done} className="min-w-0 space-y-3 p-4">
        <p className="text-[12px] text-zinc-400">
          Import the layouts, relations, folders, saved views, and saved queries in{" "}
          <span className="text-zinc-200">{fileName}</span> into one or more databases.
        </p>
        <label className="block text-[11px] text-zinc-400">
          Connection
          <select value={profileId} onChange={(e) => setProfileId(e.target.value)} aria-label="Connection"
            className="mt-1 w-full rounded border border-zinc-700 bg-zinc-950 px-2 py-1 text-[12px] text-zinc-200">
            {profiles.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
          </select>
        </label>
        <div className="text-[11px] text-zinc-400">
          Target databases
          <div role="group" aria-label="Target databases" className="mt-1 max-h-56 overflow-auto rounded border border-zinc-700 bg-zinc-950 p-1">
            {loadingDbs
              ? <div className="flex items-center gap-2 px-2 py-1 text-zinc-500"><CircleNotch size={14} className="animate-spin" /> Loading databases…</div>
              : databases.length === 0
              ? <div className="px-2 py-1 text-zinc-500">No databases found.</div>
              : databases.map((database) => (
                <label key={database} className="flex cursor-pointer items-center gap-2 rounded px-2 py-1 text-[12px] text-zinc-200 hover:bg-zinc-800">
                  <input type="checkbox" checked={selected.has(database)} onChange={(e) => toggle(database, e.target.checked)} />
                  <span className="truncate">{database}</span>
                </label>
              ))}
          </div>
        </div>
        <p className="text-[11px] text-zinc-400">Matching settings will be replaced. Folders are replaced completely. Open table tabs reload with their integrated peeks. Database tables and data are unchanged.</p>
      </fieldset>
      {results.length > 0 && <div className="mx-4 mb-4 rounded border border-zinc-700 p-3 text-[12px]" role="status">
        <p className="font-semibold">Import complete</p>
        <ul className="mt-1 space-y-1 text-zinc-400">
          {results.map(({ database, preview }) => <li key={database}><span className="text-zinc-200">{database}</span>: {summary(preview)}</li>)}
        </ul>
      </div>}
      {error && <p role="alert" className="mx-4 mb-3 text-[12px] text-rose-300">{error}</p>}
      <div className="flex items-center justify-end gap-2 border-t border-zinc-800 p-3 text-[12px]">
        <button disabled={busy} onClick={onClose} className="rounded px-3 py-1.5 text-zinc-400 hover:bg-zinc-800 disabled:opacity-40">{done ? "Close" : "Cancel"}</button>
        {!done && <button data-el="import-database-file-submit" disabled={selected.size === 0 || busy} onClick={() => void run()}
          className="inline-flex items-center gap-2 rounded bg-accent-500 px-3 py-1.5 font-semibold text-zinc-950 disabled:opacity-40">
          {busy ? <CircleNotch size={14} className="animate-spin" /> : <UploadSimple size={14} />}
          Import into {selected.size || ""} {selected.size === 1 ? "database" : "databases"}
        </button>}
      </div>
    </div>
  </div>;
}
