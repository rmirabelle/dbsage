import { useCallback, useEffect, useRef, useState } from "react";
import {
  GearSix,
  Play,
  Stop,
  ArrowsClockwise,
  CircleNotch,
  FloppyDisk,
  Power,
  FileText,
  SlidersHorizontal,
  type Icon,
} from "@phosphor-icons/react";
import clsx from "clsx";
import { Toaster } from "./Toaster";
import { WindowControls } from "./WindowControls";
import { notifyError, notifySuccess } from "../state/notify";
import { ipc } from "../ipc";
import { UAC_CANCELLED } from "../lib/local";
import { getIniValue, setIniValue, iniValueIsOn } from "../lib/iniEdit";
import { INI_CATALOG } from "../data/iniCatalog";
import type { IniResolution, LogTail, ServiceInfo } from "../types";

/**
 * Standalone window host for the local-server Admin view (label `admin-<id>`).
 * Like the Monitor window it renders its own titlebar (decorations: false) and
 * Toaster, and reuses the shared backend. Windows-only features; the entry point
 * that opens this window is gated on a local host + win32 in the main window.
 */
type AdminTab = "service" | "logs" | "config";

const ADMIN_TABS: { value: AdminTab; label: string; Icon: Icon }[] = [
  { value: "service", label: "Service", Icon: Power },
  { value: "logs", label: "Logs", Icon: FileText },
  { value: "config", label: "Configuration", Icon: SlidersHorizontal },
];

export function AdminWindow({ profileId }: { profileId: string }) {
  const [name, setName] = useState("");
  const [tab, setTab] = useState<AdminTab>("service");

  useEffect(() => {
    ipc
      .listProfiles()
      .then((ps) => {
        const p = ps.find((x) => x.id === profileId);
        if (p) setName(p.name);
      })
      .catch(() => {});
  }, [profileId]);

  return (
    <div className="h-screen flex flex-col bg-zinc-950 text-zinc-200 overflow-hidden">
      <AdminTitleBar title={name} />
      <nav className="dbs-toolbar flex items-center gap-1 h-9 px-2 border-b border-zinc-800/60 select-none">
        {ADMIN_TABS.map((t) => (
          <button
            key={t.value}
            onClick={() => setTab(t.value)}
            className={clsx(
              "inline-flex items-center gap-1.5 rounded px-2.5 py-1 text-[12px] font-semibold transition-colors",
              tab === t.value
                ? "bg-zinc-700 text-zinc-100"
                : "text-zinc-400 hover:bg-zinc-800"
            )}
          >
            <t.Icon size={14} weight={tab === t.value ? "fill" : "regular"} />
            {t.label}
          </button>
        ))}
      </nav>
      <div className="flex-1 min-h-0 flex flex-col p-4">
        {tab === "service" && <ServicePanel profileId={profileId} />}
        {tab === "logs" && <LogsPanel profileId={profileId} />}
        {tab === "config" && <ConfigPanel profileId={profileId} />}
      </div>
      <Toaster />
    </div>
  );
}

function AdminTitleBar({ title }: { title: string }) {
  return (
    <div
      data-el="admin-titlebar"
      data-tauri-drag-region
      className="h-9 shrink-0 flex items-center justify-between bg-zinc-950 border-b border-zinc-800/80 pl-3 select-none"
    >
      <div
        data-tauri-drag-region
        className="flex items-center gap-2 text-zinc-300 pointer-events-none"
      >
        <GearSix size={16} className="text-zinc-400" />
        {title && (
          <span className="text-[15px] font-bold tracking-wide text-lime-400">
            {title}
          </span>
        )}
        <span className="text-[10px] font-semibold uppercase tracking-[0.14em] text-zinc-500">
          Server Admin
        </span>
      </div>
      <WindowControls />
    </div>
  );
}

const START_MODES = [
  { value: "auto", label: "Automatic" },
  { value: "manual", label: "Manual" },
  { value: "disabled", label: "Disabled" },
] as const;

function ServicePanel({ profileId }: { profileId: string }) {
  const [svc, setSvc] = useState<ServiceInfo | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    try {
      const info = await ipc.mysqlServiceStatus(profileId);
      setSvc(info);
      setError(null);
    } catch (e) {
      setError(String(e));
    } finally {
      setLoading(false);
    }
  }, [profileId]);

  useEffect(() => {
    refresh();
    /* Poll so changes made elsewhere (services.msc, another tool) show up. */
    const id = setInterval(refresh, 4000);
    return () => clearInterval(id);
  }, [refresh]);

  /** Run an elevated op, staying silent if the user dismisses the UAC prompt. */
  const run = async (label: string, op: () => Promise<void>) => {
    setBusy(true);
    try {
      await op();
      notifySuccess(`${label} succeeded.`);
      await refresh();
    } catch (e) {
      if (String(e).includes(UAC_CANCELLED)) return;
      notifyError(`${label} failed: ${String(e)}`);
    } finally {
      setBusy(false);
    }
  };

  if (loading) {
    return (
      <div className="flex items-center gap-2 text-zinc-500 text-sm">
        <CircleNotch size={16} className="animate-spin" /> Checking service…
      </div>
    );
  }

  if (error) {
    return (
      <div className="text-rose-400 text-sm leading-relaxed">{error}</div>
    );
  }

  if (!svc) {
    return (
      <div className="text-zinc-400 text-sm leading-relaxed">
        No MySQL Windows service was found on this machine. The server may be
        running as a portable install (e.g. XAMPP) rather than a registered
        service.
      </div>
    );
  }

  const running = svc.state.toLowerCase() === "running";
  const currentMode = svc.startMode.toLowerCase();

  return (
    <div className="max-w-2xl space-y-4">
      <section className="rounded-lg border border-zinc-800/80 bg-zinc-900/40">
        <header className="flex items-center justify-between px-4 py-3 border-b border-zinc-800/60">
          <div className="flex items-center gap-2.5 min-w-0">
            <StatusDot running={running} />
            <div className="min-w-0">
              <div className="font-semibold text-zinc-100 truncate">
                {svc.displayName ?? svc.name}
              </div>
              <div className="text-[11px] text-zinc-500 truncate">
                {svc.name}
              </div>
            </div>
          </div>
          <span
            className={clsx(
              "text-[11px] font-semibold uppercase tracking-wide px-2 py-0.5 rounded",
              running
                ? "bg-lime-500/15 text-lime-400"
                : "bg-zinc-700/40 text-zinc-400"
            )}
          >
            {svc.state}
          </span>
        </header>

        <div className="flex items-center gap-2 px-4 py-3">
          {busy && (
            <CircleNotch size={16} className="animate-spin text-zinc-400" />
          )}
          <button
            disabled={busy || running}
            onClick={() =>
              run("Start service", () => ipc.serviceControl(profileId, "start"))
            }
            className="inline-flex items-center gap-1.5 rounded bg-lime-500 px-2.5 py-1 text-[13px] font-semibold text-black transition-colors hover:bg-lime-400 disabled:cursor-not-allowed disabled:opacity-30 disabled:hover:bg-lime-500"
          >
            <Play size={14} weight="fill" /> Start
          </button>
          <button
            disabled={busy || !running}
            onClick={() =>
              run("Stop service", () => ipc.serviceControl(profileId, "stop"))
            }
            className="inline-flex items-center gap-1.5 rounded bg-rose-500 px-2.5 py-1 text-[13px] font-semibold text-rose-950 transition-colors hover:bg-rose-400 disabled:cursor-not-allowed disabled:opacity-30 disabled:hover:bg-rose-500"
          >
            <Stop size={14} weight="fill" /> Stop
          </button>
          <button
            disabled={busy || !running}
            onClick={() =>
              run("Restart service", () =>
                ipc.serviceControl(profileId, "restart")
              )
            }
            className="inline-flex items-center gap-1.5 rounded bg-amber-500 px-2.5 py-1 text-[13px] font-semibold text-amber-950 transition-colors hover:bg-amber-400 disabled:cursor-not-allowed disabled:opacity-30 disabled:hover:bg-amber-500"
          >
            <ArrowsClockwise size={14} weight="bold" /> Restart
          </button>

          <label className="ml-auto flex items-center gap-2 text-[12px] text-zinc-400">
            Startup
            <select
              disabled={busy}
              value={
                START_MODES.some((m) => m.value === currentMode)
                  ? currentMode
                  : "manual"
              }
              onChange={(e) =>
                run("Change startup type", () =>
                  ipc.setServiceStartMode(
                    profileId,
                    e.target.value as "auto" | "manual" | "disabled"
                  )
                )
              }
              className="rounded bg-zinc-800 border border-zinc-700 px-2 py-1 text-zinc-200 disabled:opacity-50"
            >
              {START_MODES.map((m) => (
                <option key={m.value} value={m.value}>
                  {m.label}
                </option>
              ))}
            </select>
          </label>
        </div>
      </section>

      {(svc.binPath || svc.defaultsFile) && (
        <section className="rounded-lg border border-zinc-800/80 bg-zinc-900/40 px-4 py-3 space-y-2 text-[12px]">
          {svc.binPath && (
            <Detail label="Executable" value={svc.binPath} />
          )}
          {svc.defaultsFile && (
            <Detail label="Defaults file" value={svc.defaultsFile} />
          )}
        </section>
      )}
    </div>
  );
}

function StatusDot({ running }: { running: boolean }) {
  return (
    <span
      className={clsx(
        "h-2.5 w-2.5 rounded-full shrink-0",
        running ? "bg-lime-400" : "bg-zinc-600"
      )}
    />
  );
}

function Detail({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex gap-3">
      <span className="w-24 shrink-0 text-zinc-500">{label}</span>
      <span className="text-zinc-300 break-all font-mono">{value}</span>
    </div>
  );
}

const LOG_TABS = [
  { value: "error", label: "Error" },
  { value: "slow", label: "Slow Query" },
  { value: "general", label: "General" },
] as const;

const LOG_MAX_BYTES = 64 * 1024;
const LOG_POLL_MS = 2000;

function LogsPanel({ profileId }: { profileId: string }) {
  const [kind, setKind] = useState<"error" | "slow" | "general">("error");
  const [tail, setTail] = useState<LogTail | null>(null);
  const [loading, setLoading] = useState(false);
  const [live, setLive] = useState(false);
  const [wrap, setWrap] = useState(false);
  const preRef = useRef<HTMLPreElement>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      setTail(await ipc.readLogTail(profileId, kind, LOG_MAX_BYTES));
    } catch (e) {
      setTail({ source: "denied", path: null, content: String(e) });
    } finally {
      setLoading(false);
    }
  }, [profileId, kind]);

  useEffect(() => {
    setTail(null);
    load();
  }, [load]);

  useEffect(() => {
    if (!live) return;
    const id = setInterval(load, LOG_POLL_MS);
    return () => clearInterval(id);
  }, [live, load]);

  /* Keep the newest lines in view as content streams in. */
  useEffect(() => {
    const el = preRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [tail]);

  const note = tail ? sourceNote(tail) : null;

  return (
    <section className="flex-1 min-h-0 flex flex-col rounded-lg border border-zinc-800/80 bg-zinc-900/40">
      <header className="flex items-center gap-2 px-3 py-2 border-b border-zinc-800/60">
        <div className="flex items-center gap-1">
          {LOG_TABS.map((t) => (
            <button
              key={t.value}
              onClick={() => setKind(t.value)}
              className={clsx(
                "rounded px-2 py-1 text-[12px] font-semibold transition-colors",
                kind === t.value
                  ? "bg-zinc-700 text-zinc-100"
                  : "text-zinc-400 hover:bg-zinc-800"
              )}
            >
              {t.label}
            </button>
          ))}
        </div>
        <label className="ml-auto flex items-center gap-1.5 text-[12px] text-zinc-400 cursor-pointer select-none">
          <input
            type="checkbox"
            checked={wrap}
            onChange={(e) => setWrap(e.target.checked)}
            className="accent-lime-500"
          />
          Wrap
        </label>
        <label className="flex items-center gap-1.5 text-[12px] text-zinc-400 cursor-pointer select-none">
          <input
            type="checkbox"
            checked={live}
            onChange={(e) => setLive(e.target.checked)}
            className="accent-lime-500"
          />
          Live
        </label>
        <button
          onClick={load}
          disabled={loading}
          className="inline-flex items-center gap-1 rounded bg-zinc-800 px-2 py-1 text-[12px] font-semibold text-zinc-200 transition-colors hover:bg-zinc-700 disabled:opacity-50"
        >
          {loading ? (
            <CircleNotch size={13} className="animate-spin" />
          ) : (
            <ArrowsClockwise size={13} />
          )}
          Refresh
        </button>
      </header>

      {note && (
        <div className="px-3 py-1.5 text-[11px] text-zinc-500 border-b border-zinc-800/40 break-all">
          {note}
        </div>
      )}

      <pre
        ref={preRef}
        className={clsx(
          "flex-1 min-h-0 overflow-auto m-0 p-3 text-[12px] leading-relaxed font-mono text-zinc-300",
          wrap ? "whitespace-pre-wrap break-words" : "whitespace-pre"
        )}
      >
        {tail?.content || (loading ? "" : "—")}
      </pre>
    </section>
  );
}

function ConfigPanel({ profileId }: { profileId: string }) {
  const [resolution, setResolution] = useState<IniResolution | null>(null);
  const [path, setPath] = useState<string | null>(null);
  const [content, setContent] = useState("");
  const [original, setOriginal] = useState("");
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [mode, setMode] = useState<"form" | "raw">("form");

  const loadFile = useCallback(async (p: string) => {
    setLoading(true);
    setError(null);
    setPath(p);
    try {
      const text = await ipc.readMyIni(p);
      setContent(text);
      setOriginal(text);
    } catch (e) {
      setError(String(e));
      setContent("");
      setOriginal("");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      setLoading(true);
      try {
        const res = await ipc.resolveMyIni(profileId);
        if (cancelled) return;
        setResolution(res);
        const target =
          res.resolved ?? res.candidates.find((c) => c.exists)?.path ?? null;
        if (target) {
          await loadFile(target);
        } else {
          setLoading(false);
        }
      } catch (e) {
        if (!cancelled) {
          setError(String(e));
          setLoading(false);
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [profileId, loadFile]);

  const dirty = content !== original;

  const save = async () => {
    if (!path) return;
    setSaving(true);
    try {
      await ipc.saveMyIni(path, content);
      setOriginal(content);
      notifySuccess(
        "Saved. Restart the MySQL service for changes to take effect."
      );
    } catch (e) {
      if (String(e).includes(UAC_CANCELLED)) return;
      notifyError(`Save failed: ${String(e)}`);
    } finally {
      setSaving(false);
    }
  };

  return (
    <section className="flex-1 min-h-0 flex flex-col rounded-lg border border-zinc-800/80 bg-zinc-900/40">
      <header className="flex items-center gap-2 px-3 py-2 border-b border-zinc-800/60">
        <span className="text-[11px] uppercase tracking-wide font-semibold text-zinc-500 shrink-0">
          Option file
        </span>
        <select
          value={path ?? ""}
          onChange={(e) => loadFile(e.target.value)}
          disabled={!resolution || saving}
          className="rounded bg-zinc-800 border border-zinc-700 px-2 py-1 text-zinc-200 min-w-0 flex-1 max-w-[60%]"
        >
          {!path && <option value="">—</option>}
          {resolution?.candidates.map((c) => (
            <option key={c.path} value={c.path} disabled={!c.exists}>
              {c.path}
              {c.path === resolution.resolved ? "  (applied)" : ""}
              {!c.exists ? "  (missing)" : ""}
            </option>
          ))}
        </select>
        <div className="ml-auto flex items-center rounded bg-zinc-800 p-0.5">
          {(["form", "raw"] as const).map((m) => (
            <button
              key={m}
              onClick={() => setMode(m)}
              className={clsx(
                "rounded px-2 py-0.5 text-[12px] font-semibold capitalize transition-colors",
                mode === m
                  ? "bg-zinc-600 text-zinc-100"
                  : "text-zinc-400 hover:text-zinc-200"
              )}
            >
              {m}
            </button>
          ))}
        </div>
        <button
          onClick={save}
          disabled={!path || saving || !dirty || loading}
          className="inline-flex items-center gap-1.5 rounded bg-lime-500 px-2.5 py-1 text-[13px] font-semibold text-black transition-colors hover:bg-lime-400 disabled:cursor-not-allowed disabled:opacity-30 disabled:hover:bg-lime-500"
        >
          {saving ? (
            <CircleNotch size={13} className="animate-spin" />
          ) : (
            <FloppyDisk size={13} weight="fill" />
          )}
          Save
        </button>
      </header>

      {dirty && (
        <div className="px-3 py-1.5 text-[11px] text-amber-400 border-b border-zinc-800/40">
          Unsaved changes — saving needs administrator approval (UAC) and a
          service restart to apply.
        </div>
      )}

      {loading ? (
        <div className="flex items-center gap-2 p-3 text-zinc-500 text-sm">
          <CircleNotch size={16} className="animate-spin" /> Loading…
        </div>
      ) : error ? (
        <div className="p-3 text-rose-400 text-sm">{error}</div>
      ) : !path ? (
        <div className="p-3 text-zinc-400 text-sm">
          No my.ini option file was found on this machine.
        </div>
      ) : mode === "form" ? (
        <StructuredForm content={content} onChange={setContent} />
      ) : (
        <textarea
          value={content}
          onChange={(e) => setContent(e.target.value)}
          spellCheck={false}
          className="flex-1 min-h-0 resize-none bg-transparent p-3 font-mono text-[12px] leading-relaxed text-zinc-200 outline-none"
        />
      )}
    </section>
  );
}

/**
 * Renders the curated catalog as labelled controls bound to the raw INI text.
 * Each edit rewrites just the matching line via `setIniValue`, so toggling back
 * to Raw shows exactly what will be saved and unknown keys are never disturbed.
 */
function StructuredForm({
  content,
  onChange,
}: {
  content: string;
  onChange: (next: string) => void;
}) {
  return (
    <div className="flex-1 min-h-0 overflow-y-auto p-3 space-y-3">
      {INI_CATALOG.map((s) => {
        const raw = getIniValue(content, s.section, s.key);
        const set = (v: string) =>
          onChange(setIniValue(content, s.section, s.key, v));

        return (
          <div
            key={s.key}
            className="rounded border border-zinc-800/70 bg-zinc-900/40 px-3 py-2"
          >
            <div className="flex items-center gap-3">
              <code className="text-[12px] font-semibold text-lime-400">
                {s.key}
              </code>
              {s.type === "enum" ? (
                <select
                  value={raw ?? s.default ?? s.options?.[0] ?? ""}
                  onChange={(e) => set(e.target.value)}
                  className="rounded bg-zinc-800 border border-zinc-700 px-2 py-1 text-zinc-200"
                >
                  {s.options?.map((o) => (
                    <option key={o} value={o}>
                      {o}
                    </option>
                  ))}
                </select>
              ) : s.type === "bool" ? (
                <select
                  value={iniValueIsOn(raw) ? "ON" : "OFF"}
                  onChange={(e) => set(e.target.value)}
                  className="rounded bg-zinc-800 border border-zinc-700 px-2 py-1 text-zinc-200"
                >
                  <option value="ON">ON</option>
                  <option value="OFF">OFF</option>
                </select>
              ) : (
                <input
                  type={s.type === "int" ? "number" : "text"}
                  value={raw ?? ""}
                  placeholder={s.default ? `default: ${s.default}` : ""}
                  onChange={(e) => set(e.target.value)}
                  className="rounded bg-zinc-800 border border-zinc-700 px-2 py-1 text-zinc-200 w-48"
                />
              )}
              {raw === undefined && (
                <span className="text-[11px] text-zinc-600">
                  not set{s.default ? ` · default ${s.default}` : ""}
                </span>
              )}
            </div>
            <p className="mt-1.5 text-[11px] text-zinc-500 leading-relaxed">
              {s.description}
            </p>
          </div>
        );
      })}
    </div>
  );
}

/** Short caption describing where a log's content came from. */
function sourceNote(t: LogTail): string | null {
  switch (t.source) {
    case "file":
      return t.path ? `File: ${t.path}` : null;
    case "table":
      return "Reading from log table (log_output = TABLE).";
    case "eventlog":
      return "Windows Event Log.";
    case "missing":
      return t.path ? `Log file not created yet: ${t.path}` : "Log file not found.";
    case "denied":
      return t.path ? `Permission denied: ${t.path}` : null;
    default:
      return null;
  }
}
