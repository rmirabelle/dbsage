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
import type { ImportSummary } from "../types";

export type TransferMode = "export" | "import";

interface Props {
  mode: TransferMode;
  onClose: () => void;
}

const FILTERS = [{ name: "DB Sage State", extensions: ["dbsage"] }];

export function StateTransferDialog({ mode, onClose }: Props) {
  return mode === "export" ? (
    <DialogShell title="Export state" onClose={onClose}>
      <ExportBody onClose={onClose} />
    </DialogShell>
  ) : (
    <DialogShell title="Import state" onClose={onClose}>
      <ImportBody onClose={onClose} />
    </DialogShell>
  );
}

function ExportBody({ onClose }: { onClose: () => void }) {
  const [passphrase, setPassphrase] = useState("");
  const [confirm, setConfirm] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<string | null>(null);

  const canSubmit =
    passphrase.length > 0 && passphrase === confirm && !busy;

  const handleExport = async () => {
    setError(null);
    if (passphrase !== confirm) {
      setError("Passphrases do not match.");
      return;
    }
    const defaultName = `dbsage-state-${new Date()
      .toISOString()
      .slice(0, 10)}.dbsage`;
    const path = await save({ defaultPath: defaultName, filters: FILTERS });
    if (!path) return;

    setBusy(true);
    try {
      await ipc.exportState(path, passphrase);
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
            <div>State exported successfully.</div>
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
          Exports your connections (including passwords), relationships, and
          table folders into a single encrypted file. You&apos;ll need the
          passphrase below to import it again, so store it somewhere safe — it
          cannot be recovered.
        </p>
        <Field label="Passphrase">
          <input
            autoFocus
            type="password"
            data-el="export-passphrase-input"
            value={passphrase}
            onChange={(e) => setPassphrase(e.target.value)}
            className="dbs-input"
          />
        </Field>
        <Field label="Confirm passphrase">
          <input
            type="password"
            data-el="export-confirm-input"
            value={confirm}
            onChange={(e) => setConfirm(e.target.value)}
            className="dbs-input"
          />
        </Field>
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
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [summary, setSummary] = useState<ImportSummary | null>(null);

  const fileName = path ? path.split(/[\\/]/).pop() : null;
  const canSubmit = path !== null && passphrase.length > 0 && !busy;

  const handleChoose = async () => {
    const picked = await open({ multiple: false, filters: FILTERS });
    if (typeof picked === "string") setPath(picked);
  };

  const handleImport = async () => {
    if (!path) return;
    setError(null);
    setBusy(true);
    try {
      const result = await ipc.importState(path, passphrase);
      await reloadAfterImport();
      setSummary(result);
    } catch (e) {
      setError(String(e));
    } finally {
      setBusy(false);
    }
  };

  if (summary) {
    return (
      <Result onClose={onClose}>
        <div className="flex items-start gap-2 text-[12px] text-zinc-200">
          <CheckCircle2 size={18} className="mt-0.5 shrink-0 text-emerald-400" weight="fill" />
          <div>
            <div>Import complete.</div>
            <div className="mt-1 text-[11px] text-zinc-400">
              {summary.profiles} connection{summary.profiles === 1 ? "" : "s"},{" "}
              {summary.relations} relationship{summary.relations === 1 ? "" : "s"},{" "}
              {summary.folders} folder{summary.folders === 1 ? "" : "s"} merged.
            </div>
          </div>
        </div>
      </Result>
    );
  }

  return (
    <>
      <div className="px-4 py-4 space-y-3">
        <p className="text-[11px] leading-relaxed text-zinc-400">
          Imports an encrypted DB Sage state file. Items are merged into your
          existing state — anything with a matching id is updated, everything
          else is added.
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
        <Field label="Passphrase">
          <input
            type="password"
            data-el="import-passphrase-input"
            value={passphrase}
            onChange={(e) => setPassphrase(e.target.value)}
            className="dbs-input"
          />
        </Field>
      </div>
      <Footer error={error} onClose={onClose}>
        <button
          data-el="import-submit-btn"
          onClick={handleImport}
          disabled={!canSubmit}
          className="dbs-btn-primary"
        >
          {busy ? <Loader2 size={14} className="animate-spin" /> : <UploadSimple size={16} />}
          Import
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
    <div className="px-4 py-3 border-t border-zinc-800 flex items-center justify-between gap-3">
      <div className="flex items-center gap-1.5 min-w-0 text-[11px]">
        {error && (
          <span className="flex items-center gap-1.5 text-rose-400 truncate">
            <AlertCircle size={14} className="shrink-0" />
            <span className="truncate">{error}</span>
          </span>
        )}
      </div>
      <div className="flex items-center gap-2 shrink-0">
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
