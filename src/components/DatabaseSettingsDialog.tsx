import { useEffect, useState } from "react";
import { open, save } from "@tauri-apps/plugin-dialog";
import { CircleNotch, UploadSimple, X } from "@phosphor-icons/react";
import { ipc } from "../ipc";
import { flushColumnSetups, useStore } from "../state/store";
import { notifyError, notifySuccess } from "../state/notify";
import { STATE_CATEGORIES, type DatabaseTab, type RowsTab, type StateMappingPreview } from "../types";

const filters = [{ name: "DB Sage database settings", extensions: ["dbsage"] }];
const databaseSelection = { profiles: false, relations: true, folders: true, columnSetups: true, tableViewPresets: true, savedQueries: true };

export async function exportDatabaseSettings(tab: DatabaseTab) {
  const name = tab.database.replace(/[<>:"/\\|?*]/g, "_");
  const path = await save({ defaultPath: `${name}-settings.dbsage`, filters });
  if (!path) return;
  await flushColumnSetups();
  await ipc.exportState(path, "", databaseSelection, { profileId: tab.profileId, database: tab.database });
  notifySuccess(`Exported settings for ${tab.database}.`);
}

export function DatabaseSettingsDialog({ tab, onClose }: { tab: DatabaseTab; onClose: () => void }) {
  const [path, setPath] = useState("");
  const [passphrase, setPassphrase] = useState("");
  const [busy, setBusy] = useState(false);
  const [preview, setPreview] = useState<StateMappingPreview | null>(null);
  const [done, setDone] = useState(false);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    const escape = (event: KeyboardEvent) => { if (event.key === "Escape" && !busy) onClose(); };
    window.addEventListener("keydown", escape);
    return () => window.removeEventListener("keydown", escape);
  }, [busy, onClose]);

  const choose = async () => {
    try {
      const picked = await open({ multiple: false, filters });
      if (typeof picked === "string") { setPath(picked); setPreview(null); setError(null); }
    } catch (e) { setError(String(e)); }
  };

  const run = async (previewOnly: boolean) => {
    if (!path || busy) return;
    setBusy(true); setError(null);
    const state = useStore.getState();
    const host = state.profiles.find((profile) => profile.id === tab.profileId)?.host;
    const matchingProfile = (id: string) => state.profiles.some((profile) => profile.id === id && profile.host === host);
    const reopen: RowsTab[] = [];
    const activeTabId = state.activeTabId;
    try {
      await flushColumnSetups();
      if (!state.connections[tab.profileId]?.connected) await state.connectProfile(tab.profileId);
      if (!previewOnly) {
        /** Validate the file before changing the current workspace; displaying this check is optional. */
        await ipc.importDatabaseSettings(path, passphrase, tab.profileId, tab.database, true);
        for (const current of useStore.getState().tabs) {
          if (current.kind === "rows" && current.database === tab.database && matchingProfile(current.profileId)) {
            reopen.push(current);
            state.closeTab(current.id);
          }
        }
        await flushColumnSetups();
      }
      const result = await ipc.importDatabaseSettings(path, passphrase, tab.profileId, tab.database, previewOnly);
      setPreview(result);
      if (!previewOnly) {
        setDone(true);
        await state.reloadAfterImport();
        await state.loadSavedQueryCount(tab.profileId, tab.database);
        await state.refreshTab(tab.id);
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

  return <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm">
    <div role="dialog" aria-modal="true" aria-labelledby="database-settings-title" data-el="database-settings-dialog"
      className="w-[480px] max-w-[95vw] max-h-[90vh] overflow-auto rounded-lg border border-zinc-700 bg-zinc-900 text-zinc-200 shadow-2xl">
      <div className="flex items-center justify-between border-b border-zinc-800 px-4 py-3">
        <h2 id="database-settings-title" className="text-sm font-semibold">Import settings into {tab.database}</h2>
        <button type="button" disabled={busy} onClick={onClose} aria-label="Close" className="p-1 text-zinc-400 hover:text-white disabled:opacity-40"><X size={16} /></button>
      </div>
      <fieldset disabled={busy || done} className="min-w-0 space-y-3 p-4">
        <p className="text-[12px] text-zinc-400">Import a single database’s layouts, relations, folders, saved views, and saved queries. The source database name can be different.</p>
        <button type="button" onClick={choose} className="flex w-full items-center gap-2 rounded border border-zinc-700 bg-zinc-800 p-2 text-left text-[12px]">
          <UploadSimple size={16} /><span className="truncate">{path.split(/[\\/]/).pop() || "Choose database settings file…"}</span>
        </button>
        <details>
          <summary className="cursor-pointer text-[11px] text-zinc-400">Passphrase for an encrypted file</summary>
          <input type="password" aria-label="Passphrase" value={passphrase} onChange={(e) => { setPassphrase(e.target.value); setPreview(null); }}
            className="mt-2 w-full rounded border border-zinc-700 bg-zinc-950 px-2 py-1 text-[12px]" />
        </details>
        <p className="text-[11px] text-zinc-400">Matching settings will be replaced. Folders are replaced completely. Open table tabs reload with their integrated peeks. Database tables and data are unchanged.</p>
      </fieldset>
      {preview && <div className="mx-4 mb-4 rounded border border-zinc-700 p-3 text-[12px]" role="status">
        <p className="font-semibold">{done ? "Import complete" : "Compatibility summary"}</p>
        <p className="mt-1 text-zinc-400">{STATE_CATEGORIES.filter((category) => preview.counts[category.key] > 0)
          .map((category) => `${preview.counts[category.key]} ${category.label.toLowerCase()}`).join(", ") || "No compatible settings in this file."}</p>
        {preview.notices.length > 0 && <details className="mt-2">
          <summary className="cursor-pointer">Details ({preview.notices.length})</summary>
          <ul className="mt-2 max-h-40 overflow-auto list-disc pl-4 text-[11px] text-zinc-400">{preview.notices.map((notice) => <li key={notice}>{notice}</li>)}</ul>
        </details>}
      </div>}
      {error && <p role="alert" className="mx-4 mb-3 text-[12px] text-rose-300">{error}</p>}
      <div className="flex items-center justify-end gap-2 border-t border-zinc-800 p-3 text-[12px]">
        <button disabled={busy} onClick={onClose} className="rounded px-3 py-1.5 text-zinc-400 hover:bg-zinc-800 disabled:opacity-40">{done ? "Close" : "Cancel"}</button>
        {!done && <>
          <button disabled={!path || busy} onClick={() => void run(true)} className="rounded bg-zinc-800 px-3 py-1.5 disabled:opacity-40">Check compatibility</button>
          <button data-el="database-settings-import" disabled={!path || busy} onClick={() => void run(false)} className="inline-flex items-center gap-2 rounded bg-accent-500 px-3 py-1.5 font-semibold text-zinc-950 disabled:opacity-40">
            {busy ? <CircleNotch size={14} className="animate-spin" /> : <UploadSimple size={14} />} Import
          </button>
        </>}
      </div>
    </div>
  </div>;
}
