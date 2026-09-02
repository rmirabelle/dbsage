import { useEffect, useState } from "react";
import { open, save } from "@tauri-apps/plugin-dialog";
import {
  X,
  CircleNotch as Loader2,
  CheckCircle as CheckCircle2,
  WarningCircle as AlertCircle,
  DownloadSimple,
  UploadSimple,
  File as FileIcon,
} from "@phosphor-icons/react";
import { ipc } from "../ipc";
import { useStore } from "../state/store";
import {
  STATE_CATEGORIES,
  type StateCounts,
  type StateSelection,
} from "../types";

export type TransferMode = "export" | "import";

interface Props {
  mode: TransferMode;
  onClose: () => void;
}

const FILTERS = [{ name: "DB Sage State", extensions: ["dbsage"] }];

const allSelected = (): StateSelection => ({
  profiles: true,
  relations: true,
  folders: true,
  columnSetups: true,
  tableViewPresets: true,
  savedQueries: true,
});

const fromCounts = (c: StateCounts): StateSelection => ({
  profiles: c.profiles > 0,
  relations: c.relations > 0,
  folders: c.folders > 0,
  columnSetups: c.columnSetups > 0,
  tableViewPresets: c.tableViewPresets > 0,
  savedQueries: c.savedQueries > 0,
});

const totalCount = (counts: StateCounts) =>
  STATE_CATEGORIES.reduce((sum, c) => sum + counts[c.key], 0);

export function StateTransferDialog({ mode, onClose }: Props) {
  return mode === "export" ? (
    <DialogShell title="Export Settings" onClose={onClose}>
      <ExportBody onClose={onClose} />
    </DialogShell>
  ) : (
    <DialogShell title="Import Settings" onClose={onClose}>
      <ImportBody onClose={onClose} />
    </DialogShell>
  );
}

/** A checklist of state categories. When `counts` is given (import), categories
 * with no items are shown disabled with their count; otherwise all are toggle-able. */
function CategoryChecklist({
  selection,
  counts,
  onToggle,
}: {
  selection: StateSelection;
  counts?: StateCounts | null;
  onToggle: (key: keyof StateSelection, checked: boolean) => void;
}) {
  return (
    <div className="rounded border border-zinc-800 bg-[#1d2029] divide-y divide-zinc-800/70">
      {STATE_CATEGORIES.map(({ key, label }) => {
        const count = counts ? counts[key] : undefined;
        const available = counts ? count! > 0 : true;
        return (
          <label
            key={key}
            className={
              "flex items-center gap-2.5 px-3 py-2 text-[12px] " +
              (available
                ? "text-zinc-200 cursor-pointer hover:bg-zinc-800/40"
                : "text-zinc-600 cursor-not-allowed")
            }
          >
            <input
              type="checkbox"
              checked={selection[key] && available}
              disabled={!available}
              onChange={(e) => onToggle(key, e.target.checked)}
              className="accent-[#06b6d4] h-3.5 w-3.5"
            />
            <span className="flex-1">{label}</span>
            {count !== undefined && (
              <span className="text-[11px] tabular-nums text-zinc-500">{count}</span>
            )}
          </label>
        );
      })}
    </div>
  );
}

function ExportBody({ onClose }: { onClose: () => void }) {
  const [selection, setSelection] = useState<StateSelection>(allSelected);
  const [passphrase, setPassphrase] = useState("");
  const [confirm, setConfirm] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<string | null>(null);

  const anySelected = Object.values(selection).some(Boolean);
  const passphraseRequired = selection.profiles;
  const canSubmit =
    anySelected &&
    (!passphraseRequired || passphrase.length > 0) &&
    passphrase === confirm &&
    !busy;

  const handleExport = async () => {
    setError(null);
    if (passphrase !== confirm) {
      setError("Passphrases do not match.");
      return;
    }
    const defaultName = `dbsage-settings-${new Date()
      .toISOString()
      .slice(0, 10)}.dbsage`;
    const path = await save({ defaultPath: defaultName, filters: FILTERS });
    if (!path) return;

    setBusy(true);
    try {
      await ipc.exportState(path, passphrase, selection);
      setDone(path);
    } catch (e) {
      setError(String(e));
    } finally {
      setBusy(false);
    }
  };

  if (done) {
    return (
      <Result onClose={onClose}>
        <div className="flex items-start gap-2 text-[12px] text-zinc-200">
          <CheckCircle2 size={18} className="mt-0.5 shrink-0 text-emerald-400" weight="fill" />
          <div>
            <div>Settings exported successfully.</div>
            <div className="mt-1 break-all text-[11px] text-zinc-500">{done}</div>
          </div>
        </div>
      </Result>
    );
  }

  return (
    <>
      <div className="px-4 py-4 space-y-3">
        <p className="text-[11px] leading-relaxed text-zinc-400">
          Choose what to include in a single file. A passphrase is required only
          when exporting connections (which contain passwords); other categories
          are saved unencrypted unless you set one. If you set a passphrase, store
          it somewhere safe — it cannot be recovered.
        </p>
        <Field label="Include">
          <CategoryChecklist
            selection={selection}
            onToggle={(key, checked) =>
              setSelection((s) => ({ ...s, [key]: checked }))
            }
          />
        </Field>
        <Field
          label={passphraseRequired ? "Passphrase" : "Passphrase (optional)"}
        >
          <input
            autoFocus
            type="password"
            data-el="export-passphrase-input"
            value={passphrase}
            onChange={(e) => setPassphrase(e.target.value)}
            className="dbs-input"
          />
        </Field>
        {passphrase.length > 0 && (
          <Field label="Confirm passphrase">
            <input
              type="password"
              data-el="export-confirm-input"
              value={confirm}
              onChange={(e) => setConfirm(e.target.value)}
              className="dbs-input"
            />
          </Field>
        )}
        {!passphraseRequired && passphrase.length === 0 && (
          <p className="text-[11px] text-amber-400/90">
            This export will not be encrypted.
          </p>
        )}
      </div>
      <Footer error={error} onClose={onClose}>
        <button
          data-el="export-submit-btn"
          onClick={handleExport}
          disabled={!canSubmit}
          className="dbs-btn-primary"
        >
          {busy ? <Loader2 size={14} className="animate-spin" /> : <DownloadSimple size={16} />}
          Export
        </button>
      </Footer>
    </>
  );
}

function ImportBody({ onClose }: { onClose: () => void }) {
  const reloadAfterImport = useStore((s) => s.reloadAfterImport);
  const [path, setPath] = useState<string | null>(null);
  const [passphrase, setPassphrase] = useState("");
  const [counts, setCounts] = useState<StateCounts | null>(null);
  const [selection, setSelection] = useState<StateSelection>(allSelected);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [summary, setSummary] = useState<StateCounts | null>(null);

  const fileName = path ? path.split(/[\\/]/).pop() : null;
  const canPreview = path !== null && !busy;
  const anySelected = Object.values(selection).some(Boolean);

  const handleChoose = async () => {
    const picked = await open({ multiple: false, filters: FILTERS });
    if (typeof picked === "string") {
      setPath(picked);
      setCounts(null);
      setError(null);
    }
  };

  const handlePreview = async () => {
    if (!path) return;
    setError(null);
    setBusy(true);
    try {
      const result = await ipc.previewState(path, passphrase);
      setCounts(result);
      setSelection(fromCounts(result));
    } catch (e) {
      setError(String(e));
    } finally {
      setBusy(false);
    }
  };

  const handleImport = async () => {
    if (!path) return;
    setError(null);
    setBusy(true);
    try {
      const result = await ipc.importState(path, passphrase, selection);
      await reloadAfterImport();
      setSummary(result);
    } catch (e) {
      setError(String(e));
    } finally {
      setBusy(false);
    }
  };

  if (summary) {
    const parts = STATE_CATEGORIES.map((c) => `${summary[c.key]} ${c.label.toLowerCase()}`);
    return (
      <Result onClose={onClose}>
        <div className="flex items-start gap-2 text-[12px] text-zinc-200">
          <CheckCircle2 size={18} className="mt-0.5 shrink-0 text-emerald-400" weight="fill" />
          <div>
            <div>Import complete.</div>
            <div className="mt-1 text-[11px] text-zinc-400">
              Merged {parts.join(", ")}.
            </div>
          </div>
        </div>
      </Result>
    );
  }

  /* Step 2: file decrypted — choose which categories to merge. */
  if (counts) {
    return (
      <>
        <div className="px-4 py-4 space-y-3">
          <p className="text-[11px] leading-relaxed text-zinc-400">
            Choose what to merge from{" "}
            <span className="text-zinc-300">{fileName}</span>. Items with a
            matching id are updated; everything else is added.
            {totalCount(counts) === 0 && (
              <span className="block mt-1 text-amber-400">
                This file contains no importable settings.
              </span>
            )}
          </p>
          <CategoryChecklist
            selection={selection}
            counts={counts}
            onToggle={(key, checked) =>
              setSelection((s) => ({ ...s, [key]: checked }))
            }
          />
        </div>
        <Footer error={error} onClose={onClose}>
          <button
            data-el="import-submit-btn"
            onClick={handleImport}
            disabled={!anySelected || busy}
            className="dbs-btn-primary"
          >
            {busy ? <Loader2 size={14} className="animate-spin" /> : <UploadSimple size={16} />}
            Import
          </button>
        </Footer>
      </>
    );
  }

  /* Step 1: pick a file and unlock it. */
  return (
    <>
      <div className="px-4 py-4 space-y-3">
        <p className="text-[11px] leading-relaxed text-zinc-400">
          Open an encrypted DB Sage settings file. After unlocking it, you can
          choose which categories to merge into your existing settings.
        </p>
        <Field label="File">
          <button
            data-el="import-choose-btn"
            onClick={handleChoose}
            className="flex w-full items-center gap-2 rounded border border-zinc-700 bg-[#1d2029] px-2 py-1.5 text-left text-[12px] text-zinc-300 hover:border-zinc-600"
          >
            <FileIcon size={15} className="shrink-0 text-zinc-500" />
            <span className="truncate">{fileName ?? "Choose a .dbsage file…"}</span>
          </button>
        </Field>
        <Field label="Passphrase (if encrypted)">
          <input
            type="password"
            data-el="import-passphrase-input"
            value={passphrase}
            onChange={(e) => setPassphrase(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && canPreview) handlePreview();
            }}
            className="dbs-input"
          />
        </Field>
      </div>
      <Footer error={error} onClose={onClose}>
        <button
          data-el="import-unlock-btn"
          onClick={handlePreview}
          disabled={!canPreview}
          className="dbs-btn-primary"
        >
          {busy ? <Loader2 size={14} className="animate-spin" /> : <UploadSimple size={16} />}
          Continue
        </button>
      </Footer>
    </>
  );
}

function DialogShell({
  title,
  onClose,
  children,
}: {
  title: string;
  onClose: () => void;
  children: React.ReactNode;
}) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm">
      <div
        data-el="state-transfer-dialog"
        role="dialog"
        aria-modal="true"
        className="w-[440px] rounded-lg border border-zinc-800 bg-zinc-900 shadow-2xl shadow-black/60"
      >
        <div className="flex items-center justify-between px-4 py-3 border-b border-zinc-800">
          <h2 className="text-sm font-medium text-zinc-100">{title}</h2>
          <button
            data-el="state-transfer-close-btn"
            onClick={onClose}
            className="text-zinc-500 hover:text-zinc-200"
            aria-label="Close"
          >
            <X size={18} />
          </button>
        </div>
        {children}
        <style>{DIALOG_STYLE}</style>
      </div>
    </div>
  );
}

function Footer({
  error,
  onClose,
  children,
}: {
  error: string | null;
  onClose: () => void;
  children: React.ReactNode;
}) {
  return (
    <div className="flex max-h-[45vh] flex-col gap-3 overflow-y-auto border-t border-zinc-800 px-4 py-3">
      {error && (
        <div
          role="alert"
          className="flex min-w-0 items-start gap-1.5 text-[11px] text-rose-400"
        >
          <AlertCircle size={14} className="mt-0.5 shrink-0" />
          <span className="min-w-0 select-text whitespace-pre-wrap break-words [overflow-wrap:anywhere]">
            {error}
          </span>
        </div>
      )}
      <div className="flex shrink-0 items-center justify-end gap-2">
        <button onClick={onClose} className="dbs-btn-secondary">
          Cancel
        </button>
        {children}
      </div>
    </div>
  );
}

function Result({
  onClose,
  children,
}: {
  onClose: () => void;
  children: React.ReactNode;
}) {
  return (
    <>
      <div className="px-4 py-5">{children}</div>
      <div className="px-4 py-3 border-t border-zinc-800 flex justify-end">
        <button data-el="state-transfer-done-btn" onClick={onClose} className="dbs-btn-primary">
          Done
        </button>
      </div>
    </>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="block">
      <span className="block text-[10px] font-semibold uppercase tracking-[0.12em] text-zinc-500 mb-1">
        {label}
      </span>
      {children}
    </label>
  );
}

const DIALOG_STYLE = `
  .dbs-input {
    width: 100%;
    background: #1d2029;
    border: 1px solid #393d4d;
    border-radius: 4px;
    padding: 6px 8px;
    color: #e4e4e7;
    transition: border-color 120ms ease;
  }
  .dbs-input:focus { border-color: #22d3ee; }
  .dbs-btn-primary {
    background: #06b6d4;
    color: #042f2e;
    font-weight: 600;
    padding: 6px 14px;
    border-radius: 4px;
    display: inline-flex;
    align-items: center;
    gap: 6px;
  }
  .dbs-btn-primary:hover:not(:disabled) { background: #22d3ee; }
  .dbs-btn-primary:disabled { opacity: 0.5; cursor: not-allowed; }
  .dbs-btn-secondary {
    background: #393d4d;
    color: #e4e4e7;
    padding: 6px 12px;
    border-radius: 4px;
  }
  .dbs-btn-secondary:hover:not(:disabled) { background: #4a4f63; }
`;
