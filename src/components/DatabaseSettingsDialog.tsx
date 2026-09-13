import { useEffect, useState } from "react";
import { open, save } from "@tauri-apps/plugin-dialog";
import { CircleNotch, DownloadSimple, UploadSimple, X } from "@phosphor-icons/react";
import { ipc } from "../ipc";
import { flushColumnSetups, useStore } from "../state/store";
import { notifyError, notifySuccess } from "../state/notify";
import { STATE_CATEGORIES, type DatabaseTab, type RowsTab, type StateMappingPreview } from "../types";
import { CategoryList } from "./stateCategoryIcons";

const filters = [{ name: "DB Sage database setup", extensions: ["dbsage"] }];
const databaseSelection = { profiles: false, relations: true, folders: true, columnSetups: true, tableViewPresets: true, savedQueries: true };

/** Everything a database setup file carries: every workspace category except connections. */
const SETUP_CATEGORIES = STATE_CATEGORIES.filter((category) => category.key !== "profiles").map((category) => category.key);

/** What a database setup file carries. Shown before an export and before an import. */
export function DatabaseSetupContents({ lead }: { lead: string }) {
  return <div className="space-y-2 text-[12px] text-zinc-400">
    <p>{lead}</p>
    <CategoryList keys={SETUP_CATEGORIES} />
  </div>;
}

function useEscape(onClose: () => void, busy: boolean) {
  useEffect(() => {
    const escape = (event: KeyboardEvent) => { if (event.key === "Escape" && !busy) onClose(); };
    window.addEventListener("keydown", escape);
    return () => window.removeEventListener("keydown", escape);
  }, [busy, onClose]);
}

export function ExportDatabaseSetupDialog({ tab, onClose }: { tab: DatabaseTab; onClose: () => void }) {
  const [busy, setBusy] = useState(false);
  useEscape(onClose, busy);

  const run = async () => {
    if (busy) return;
    const name = tab.database.replace(/[<>:"/\\|?*]/g, "_");
    const path = await save({ defaultPath: `${name}-setup.dbsage`, filters });
    if (!path) return;
    setBusy(true);
    try {
      await flushColumnSetups();
      await ipc.exportState(path, "", databaseSelection, { profileId: tab.profileId, database: tab.database });
      notifySuccess(`Exported database setup for ${tab.database}.`);
      onClose();
    } catch (e) { notifyError(String(e)); }
    finally { setBusy(false); }
  };

  return <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm">
    <div role="dialog" aria-modal="true" aria-labelledby="export-database-setup-title" data-el="export-database-setup-dialog"
      className="w-[440px] max-w-[95vw] rounded-lg border border-zinc-700 bg-zinc-900 text-zinc-200 shadow-2xl">
      <div className="flex items-center justify-between border-b border-zinc-800 px-4 py-3">
        <h2 id="export-database-setup-title" className="text-sm font-semibold">Export database setup for <span className="text-accent-400">{tab.database}</span></h2>
        <button type="button" disabled={busy} onClick={onClose} aria-label="Close" className="p-1 text-zinc-400 hover:text-white disabled:opacity-40"><X size={16} /></button>
      </div>
      <div className="space-y-3 p-4">
        <DatabaseSetupContents lead="The file will contain:" />
        <p className="text-[11px] text-zinc-400">Connections, passwords, and other databases are not included. The file is not encrypted.</p>
      </div>
      <div className="flex items-center justify-end gap-2 border-t border-zinc-800 p-3 text-[12px]">
        <button disabled={busy} onClick={onClose} className="rounded px-3 py-1.5 text-zinc-400 hover:bg-zinc-800 disabled:opacity-40">Cancel</button>
        <button data-el="export-database-setup-submit" disabled={busy} onClick={() => void run()}
          className="inline-flex items-center gap-2 rounded bg-accent-500 px-3 py-1.5 font-semibold text-zinc-950 disabled:opacity-40">
          {busy ? <CircleNotch size={14} className="animate-spin" /> : <DownloadSimple size={14} />} Export
        </button>
      </div>
    </div>
  </div>;
}

export function DatabaseSettingsDialog({ tab, onClose }: { tab: DatabaseTab; onClose: () => void }) {
  const [path, setPath] = useState("");
  const [busy, setBusy] = useState(false);
  const [preview, setPreview] = useState<StateMappingPreview | null>(null);
  const [done, setDone] = useState(false);
  const [error, setError] = useState<string | null>(null);
  useEscape(onClose, busy);

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
        await ipc.importDatabaseSettings(path, "", tab.profileId, tab.database, true);
        for (const current of useStore.getState().tabs) {
          if (current.kind === "rows" && current.database === tab.database && matchingProfile(current.profileId)) {
            reopen.push(current);
            state.closeTab(current.id);
          }
        }
        await flushColumnSetups();
      }
      const result = await ipc.importDatabaseSettings(path, "", tab.profileId, tab.database, previewOnly);
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
        <h2 id="database-settings-title" className="text-sm font-semibold">Import database setup into <span className="text-accent-400">{tab.database}</span></h2>
        <button type="button" disabled={busy} onClick={onClose} aria-label="Close" className="p-1 text-zinc-400 hover:text-white disabled:opacity-40"><X size={16} /></button>
      </div>
      <fieldset disabled={busy || done} className="min-w-0 space-y-3 p-4">
        <DatabaseSetupContents lead="Import a database setup file. The file replaces these items for this database:" />
        <p className="text-[11px] text-zinc-400">The source database name can be different.</p>
        <button type="button" onClick={choose} className="flex w-full items-center gap-2 rounded bg-accent-500 p-2 text-left text-[12px] font-semibold text-zinc-950 hover:bg-accent-400">
          <UploadSimple size={16} /><span className="truncate">{path.split(/[\\/]/).pop() || "Choose database setup file…"}</span>
        </button>
        <p className="text-[11px] text-zinc-400">Matching items will be replaced. Folders are merged: tables already in a folder stay there. Open table tabs reload with their integrated peeks. Database tables and data are unchanged.</p>
      </fieldset>
      {preview && <div className="mx-4 mb-4 rounded border border-zinc-700 p-3 text-[12px]" role="status">
        <p className="font-semibold">{done ? "Import complete" : "Compatibility summary"}</p>
        <p className="mt-1 text-zinc-400">{STATE_CATEGORIES.filter((category) => preview.counts[category.key] > 0)
          .map((category) => `${preview.counts[category.key]} ${category.label}`).join(", ") || "No compatible setup data in this file."}</p>
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
