import { useEffect, useState } from "react";
import {
  X,
  CircleNotch as Loader2,
  CheckCircle as CheckCircle2,
  WarningCircle as AlertCircle,
} from "@phosphor-icons/react";
import { ipc } from "../ipc";
import type { ProfileView } from "../types";

interface Props {
  profile: ProfileView | null;
  onClose: () => void;
  onSaved: () => void;
}

type TestState =
  | { kind: "idle" }
  | { kind: "testing" }
  | { kind: "ok" }
  | { kind: "err"; message: string };

export function ProfileDialog({ profile, onClose, onSaved }: Props) {
  const editing = profile !== null;
  const [name, setName] = useState(profile?.name ?? "");
  const [host, setHost] = useState(profile?.host ?? "127.0.0.1");
  const [port, setPort] = useState<number>(profile?.port ?? 3306);
  const [username, setUsername] = useState(profile?.username ?? "root");
  const [password, setPassword] = useState("");
  const [defaultDatabase, setDefaultDatabase] = useState(
    profile?.defaultDatabase ?? ""
  );
  const [useSsl, setUseSsl] = useState(profile?.useSsl ?? true);

  const [test, setTest] = useState<TestState>({ kind: "idle" });
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  const passwordToUse = (): string | null => {
    if (password) return password;
    if (editing && profile?.hasPassword) return null;
    return "";
  };

  const handleTest = async () => {
    setTest({ kind: "testing" });
    setError(null);
    try {
      const pw = passwordToUse();
      if (pw === null) {
        setTest({
          kind: "err",
          message: "Enter the password to test the connection.",
        });
        return;
      }
      await ipc.testConnection({
        host,
        port,
        username,
        password: pw,
        defaultDatabase: defaultDatabase || null,
        useSsl,
      });
      setTest({ kind: "ok" });
    } catch (e) {
      setTest({ kind: "err", message: String(e) });
    }
  };

  const handleSave = async () => {
    setError(null);
    setSaving(true);
    try {
      await ipc.saveProfile({
        id: profile?.id,
        name: name.trim() || `${username}@${host}`,
        host: host.trim(),
        port,
        username: username.trim(),
        password: password || undefined,
        defaultDatabase: defaultDatabase.trim() || null,
        useSsl,
      });
      onSaved();
    } catch (e) {
      setError(String(e));
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm">
      <div
        data-el="profile-dialog"
        role="dialog"
        aria-modal="true"
        className="flex max-h-[calc(100vh-32px)] w-[440px] flex-col overflow-hidden rounded-lg border border-zinc-800 bg-zinc-900 shadow-2xl shadow-black/60"
      >
        <div className="flex shrink-0 items-center justify-between px-4 py-3 border-b border-zinc-800">
          <h2 className="text-sm font-medium text-zinc-100">
            {editing ? "Edit connection" : "New connection"}
          </h2>
          <button
            data-el="profile-dialog-close-btn"
            onClick={onClose}
            className="text-zinc-500 hover:text-zinc-200"
            aria-label="Close"
          >
            <X size={18} />
          </button>
        </div>

        <div className="min-h-0 overflow-y-auto px-4 py-4 space-y-3">
          <Field label="Name">
            <input
              autoFocus
              data-el="profile-name-input"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="Local MySQL"
              className="dbs-input"
            />
          </Field>

          <div className="grid grid-cols-[1fr_88px] gap-2">
            <Field label="Host">
              <input
                data-el="profile-host-input"
                value={host}
                onChange={(e) => setHost(e.target.value)}
                placeholder="127.0.0.1"
                className="dbs-input"
              />
            </Field>
            <Field label="Port">
              <input
                type="number"
                data-el="profile-port-input"
                value={port}
                onChange={(e) => setPort(parseInt(e.target.value || "0") || 0)}
                className="dbs-input"
              />
            </Field>
          </div>

          <Field label="Username">
            <input
              data-el="profile-username-input"
              value={username}
              onChange={(e) => setUsername(e.target.value)}
              placeholder="root"
              className="dbs-input"
            />
          </Field>

          <Field
            label="Password"
            hint={
              editing && profile?.hasPassword && !password
                ? "Leave blank to keep the saved password"
                : undefined
            }
          >
            <input
              type="password"
              data-el="profile-password-input"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder={editing && profile?.hasPassword ? "••••••••" : ""}
              className="dbs-input"
            />
          </Field>

          <Field label="Default database (optional)">
            <input
              data-el="profile-database-input"
              value={defaultDatabase}
              onChange={(e) => setDefaultDatabase(e.target.value)}
              placeholder="optional"
              className="dbs-input"
            />
          </Field>

          <label className="flex items-center gap-2 select-none cursor-pointer">
            <input
              type="checkbox"
              data-el="profile-ssl-checkbox"
              checked={useSsl}
              onChange={(e) => setUseSsl(e.target.checked)}
              className="accent-cyan-500"
            />
            <span className="text-[12px] text-zinc-300">
              Use SSL when the server supports it
            </span>
          </label>
        </div>

        <div className="flex max-h-[45vh] shrink-0 flex-col gap-3 overflow-y-auto border-t border-zinc-800 px-4 py-3">
          <div className="min-w-0 text-[11px]">
            {test.kind === "testing" && (
              <span className="flex items-center gap-1.5 text-zinc-400">
                <Loader2 size={14} className="animate-spin" /> Testing…
              </span>
            )}
            {test.kind === "ok" && (
              <span className="flex items-center gap-1.5 text-emerald-400">
                <CheckCircle2 size={14} /> Connection OK
              </span>
            )}
            {test.kind === "err" && (
              <div
                role="alert"
                data-el="connection-test-error"
                className="flex items-start gap-1.5 text-rose-400"
              >
                <AlertCircle size={14} className="mt-0.5 shrink-0" />
                <span className="min-w-0 select-text whitespace-pre-wrap break-words [overflow-wrap:anywhere]">
                  {test.message}
                </span>
              </div>
            )}
            {error && (
              <div
                role="alert"
                data-el="connection-save-error"
                className="flex items-start gap-1.5 text-rose-400"
              >
                <AlertCircle size={14} className="mt-0.5 shrink-0" />
                <span className="min-w-0 select-text whitespace-pre-wrap break-words [overflow-wrap:anywhere]">
                  {error}
                </span>
              </div>
            )}
          </div>
          <div className="flex shrink-0 items-center justify-end gap-2">
            <button
              data-el="test-connection-btn"
              onClick={handleTest}
              disabled={test.kind === "testing" || saving}
              className="dbs-btn-secondary"
            >
              Test
            </button>
            <button
              data-el="save-profile-btn"
              onClick={handleSave}
              disabled={saving}
              className="dbs-btn-primary"
            >
              {saving ? (
                <Loader2 size={14} className="animate-spin" />
              ) : editing ? (
                "Save"
              ) : (
                "Add"
              )}
            </button>
          </div>
        </div>
      </div>

      <style>{`
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
        .dbs-btn-secondary:disabled { opacity: 0.5; cursor: not-allowed; }
      `}</style>
    </div>
  );
}

function Field({
  label,
  hint,
  children,
}: {
  label: string;
  hint?: string;
  children: React.ReactNode;
}) {
  return (
    <label className="block">
      <span className="block text-[10px] font-semibold uppercase tracking-[0.12em] text-zinc-500 mb-1">
        {label}
      </span>
      {children}
      {hint && <span className="block mt-1 text-[10px] text-zinc-500">{hint}</span>}
    </label>
  );
}
