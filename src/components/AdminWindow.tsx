import { useCallback, useEffect, useMemo, useRef, useState } from "react";
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
  CaretDown,
  MagnifyingGlass,
  X,
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
                ? "bg-lime-500 text-black hover:bg-lime-400"
                : "text-zinc-400 hover:bg-zinc-800"
            )}
          >
            <t.Icon size={14} weight={tab === t.value ? "fill" : "regular"} />
            {t.label}
          </button>
        ))}
      </nav>
      <div data-el="admin-body" className="flex-1 min-h-0 flex flex-col p-4 bg-zinc-900">
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
    <div className="space-y-4">
      <section className="rounded-lg border border-zinc-800/80 bg-zinc-950">
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
        <section className="rounded-lg border border-zinc-800/80 bg-zinc-950 px-4 py-3 space-y-2 text-[12px]">
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
  const [query, setQuery] = useState("");
  const scrollRef = useRef<HTMLDivElement>(null);

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
    const el = scrollRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [tail]);

  const note = tail ? sourceNote(tail) : null;

  /* The slow-query file uses MySQL's structured `# Time:` block format; parse
   * it into readable entries. Other sources/tabs keep the raw tail. */
  const slowItems = useMemo(
    () =>
      kind === "slow" && tail?.source === "file" && tail.content.trim()
        ? parseSlowLog(tail.content)
        : null,
    [kind, tail]
  );
  const structured = !!slowItems && slowItems.length > 0;

  /* The search box filters the visible log to matching lines (raw view) or
   * matching slow-query entries (structured view). */
  const q = query.trim().toLowerCase();
  const rawContent = tail?.content ?? "";
  const shownContent =
    q && !structured
      ? rawContent
          .split("\n")
          .filter((l) => l.toLowerCase().includes(q))
          .join("\n")
      : rawContent;
  const shownItems =
    structured && q
      ? slowItems!.filter(
          (it) => it.kind === "entry" && slowEntryMatches(it, q)
        )
      : slowItems;
  const matchCount = structured
    ? shownItems!.reduce((n, it) => (it.kind === "entry" ? n + 1 : n), 0)
    : shownContent
      ? shownContent.split("\n").filter((l) => l.length > 0).length
      : 0;

  return (
    <section className="flex-1 min-h-0 flex flex-col rounded-lg border border-zinc-800/80 bg-zinc-950">
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

      <div ref={scrollRef} className="flex-1 min-h-0 overflow-auto">
        {structured ? (
          <SlowLogView items={shownItems!} wrap={wrap} />
        ) : (
          <pre
            className={clsx(
              "m-0 p-3 text-[12px] leading-relaxed font-mono text-zinc-300",
              wrap ? "whitespace-pre-wrap break-words" : "whitespace-pre"
            )}
          >
            {shownContent || (loading ? "" : q ? "No matching lines." : "—")}
          </pre>
        )}
      </div>

      <div className="flex items-center gap-2 px-3 py-2 border-t border-zinc-800/60">
        <MagnifyingGlass size={13} className="shrink-0 text-zinc-500" />
        <input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Filter log…"
          spellCheck={false}
          className="flex-1 bg-transparent text-[12px] text-zinc-200 outline-none placeholder:text-zinc-600"
        />
        {q && (
          <>
            <span className="text-[11px] tabular-nums text-zinc-500">
              {matchCount} match{matchCount === 1 ? "" : "es"}
            </span>
            <button
              onClick={() => setQuery("")}
              className="rounded p-0.5 text-zinc-500 transition-colors hover:bg-zinc-800 hover:text-zinc-300"
              aria-label="Clear filter"
            >
              <X size={13} />
            </button>
          </>
        )}
      </div>
    </section>
  );
}

/** True if a slow-query entry matches the lowercased filter term. */
function slowEntryMatches(e: SlowEntry, q: string): boolean {
  return [e.sql, e.userHost, e.time, e.schema].some((f) =>
    f ? f.toLowerCase().includes(q) : false
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
    <section className="flex-1 min-h-0 flex flex-col rounded-lg border border-zinc-800/80 bg-zinc-950">
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
  const [activeKey, setActiveKey] = useState<string | null>(null);
  const active = INI_CATALOG.find((s) => s.key === activeKey) ?? null;

  const groups = useMemo(() => {
    const out: { name: string; items: typeof INI_CATALOG }[] = [];
    for (const s of INI_CATALOG) {
      const g = out.find((x) => x.name === s.group);
      if (g) g.items.push(s);
      else out.push({ name: s.group, items: [s] });
    }
    return out;
  }, []);

  return (
    <div className="flex-1 min-h-0 flex">
      <div className="flex-1 min-h-0 overflow-y-auto px-3 pb-3">
        {groups.map((group) => (
          <div key={group.name}>
            <h3 className="sticky top-0 z-10 bg-zinc-950 pt-3 pb-1 text-[11px] font-semibold uppercase tracking-wide text-lime-400/90">
              {group.name}
            </h3>
            <div className="divide-y divide-zinc-800/70">
              {group.items.map((s) => {
                const raw = getIniValue(content, s.section, s.key);
                const set = (v: string) =>
                  onChange(setIniValue(content, s.section, s.key, v));

                return (
                  <div
                    key={s.key}
                    data-el={`setting-${s.key}`}
                    onMouseEnter={() => setActiveKey(s.key)}
                    onClick={() => setActiveKey(s.key)}
                    className={clsx(
                      "flex items-center gap-3 -mx-3 px-3 py-3 cursor-pointer transition-colors",
                      activeKey === s.key && "bg-zinc-800/40"
                    )}
                  >
                    <code className="text-[12px] font-semibold text-white">
                      {s.key}
                    </code>
                    <div className="ml-auto flex items-center gap-2">
                      {raw === undefined && (
                        <span className="text-[11px] text-zinc-600">
                          not set
                          {s.default && s.type !== "set"
                            ? ` · default ${s.default}`
                            : ""}
                        </span>
                      )}
                      {s.type === "set" ? (
                        <SetDropdown
                          value={raw}
                          defaultValue={s.default}
                          options={s.options ?? []}
                          onChange={set}
                        />
                      ) : s.type === "enum" ? (
                        <select
                          value={raw ?? s.default ?? s.options?.[0] ?? ""}
                          onChange={(e) => set(e.target.value)}
                          className="w-44 rounded bg-zinc-800 border border-zinc-700 px-2 py-1 text-zinc-200"
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
                          className="w-44 rounded bg-zinc-800 border border-zinc-700 px-2 py-1 text-zinc-200"
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
                          className="w-44 rounded bg-zinc-800 border border-zinc-700 px-2 py-1 text-zinc-200"
                        />
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        ))}
      </div>

      <aside className="w-72 shrink-0 border-l border-zinc-800/70 overflow-y-auto p-4">
        {active ? (
          <>
            <code className="text-[12px] font-semibold text-white">
              {active.key}
            </code>
            <p className="mt-2 text-[12px] text-zinc-400 leading-relaxed">
              {active.description}
            </p>
            {active.default && (
              <div className="mt-3 text-[11px] text-zinc-600">
                Default:
                {active.type === "set" ? (
                  <ul className="mt-1 space-y-0.5">
                    {active.default.split(",").map((m) => (
                      <li key={m} className="font-mono text-zinc-500">
                        {m}
                      </li>
                    ))}
                  </ul>
                ) : (
                  <span className="text-zinc-500 break-words"> {active.default}</span>
                )}
              </div>
            )}
          </>
        ) : (
          <p className="text-[12px] text-zinc-600 leading-relaxed">
            Hover or click a setting to see its description.
          </p>
        )}
      </aside>
    </div>
  );
}

/**
 * Multi-select control for `type: "set"` settings (e.g. `sql_mode`). The value
 * is a comma-separated list; the button shows the selected count and opens a
 * checkbox popover. Selections are written back in catalog-option order so the
 * saved line is stable regardless of click sequence.
 */
function SetDropdown({
  value,
  defaultValue,
  options,
  onChange,
}: {
  value: string | undefined;
  defaultValue: string | undefined;
  options: string[];
  onChange: (next: string) => void;
}) {
  const [open, setOpen] = useState(false);
  /**
   * When the key isn't in the file the server still applies its default set,
   * so seed from the default — otherwise nothing shows checked and there's no
   * way to *remove* a default mode. The first toggle writes an explicit line.
   */
  const selected = useMemo(() => {
    const raw = (value ?? defaultValue ?? "").replace(/^["']|["']$/g, "").trim();
    return new Set(
      raw
        ? raw
            .split(",")
            .map((x) => x.trim())
            .filter(Boolean)
        : []
    );
  }, [value, defaultValue]);

  const toggle = (opt: string) => {
    const next = new Set(selected);
    if (next.has(opt)) next.delete(opt);
    else next.add(opt);
    onChange(options.filter((o) => next.has(o)).join(","));
  };

  return (
    <div className="relative">
      <button
        type="button"
        onClick={(e) => {
          e.stopPropagation();
          setOpen((v) => !v);
        }}
        className="w-44 flex items-center justify-between rounded bg-zinc-800 border border-zinc-700 px-2 py-1 text-left text-zinc-200"
      >
        <span className="truncate">
          {selected.size === 0 ? "none" : `${selected.size} selected`}
        </span>
        <CaretDown size={12} className="ml-1 shrink-0 text-zinc-500" />
      </button>
      {open && (
        <>
          <div
            className="fixed inset-0 z-20"
            onClick={(e) => {
              e.stopPropagation();
              setOpen(false);
            }}
          />
          <div
            className="absolute right-0 z-30 mt-1 max-h-72 w-64 overflow-y-auto rounded border border-zinc-700 bg-zinc-900 p-1 shadow-xl"
            onClick={(e) => e.stopPropagation()}
          >
            {options.map((o) => (
              <label
                key={o}
                className="flex items-center gap-2 rounded px-2 py-1 text-[12px] text-zinc-200 hover:bg-zinc-800 cursor-pointer"
              >
                <input
                  type="checkbox"
                  checked={selected.has(o)}
                  onChange={() => toggle(o)}
                  className="accent-lime-500"
                />
                <span className="font-mono">{o}</span>
              </label>
            ))}
          </div>
        </>
      )}
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

/* ------------------------------------------------------------------ */
/* Slow-query log parsing + structured rendering                       */
/* ------------------------------------------------------------------ */

interface SlowEntry {
  kind: "entry";
  time: string | null;
  userHost: string | null;
  queryTime: string | null;
  lockTime: string | null;
  rowsSent: string | null;
  rowsExamined: string | null;
  schema: string | null;
  sql: string;
}

interface RestartMarker {
  kind: "restart";
  count: number;
  port: string | null;
  version: string | null;
}

type SlowItem = SlowEntry | RestartMarker;

const VERSION_BANNER = /,\s*Version:.*started with/i;

/**
 * Parse a MySQL slow-query log file into an ordered list of entries and
 * server-restart markers. Each restart writes a 3-line banner (version,
 * port, column header); consecutive banners collapse into one marker. Real
 * slow queries are `# Time:` blocks followed by `# User@Host` / `# Query_time`
 * comment lines and the executed statement(s).
 */
function parseSlowLog(content: string): SlowItem[] {
  const lines = content.split(/\r?\n/);
  const items: SlowItem[] = [];
  let version: string | null = null;
  let port: string | null = null;
  let i = 0;

  const pushRestart = () => {
    const last = items[items.length - 1];
    if (last && last.kind === "restart") {
      last.count++;
      last.port = port ?? last.port;
      last.version = version ?? last.version;
    } else {
      items.push({ kind: "restart", count: 1, port, version });
    }
  };

  while (i < lines.length) {
    const line = lines[i];

    if (VERSION_BANNER.test(line)) {
      version = line.match(/Version:\s*(\S+)/)?.[1] ?? version;
      i++;
      while (i < lines.length) {
        const l = lines[i];
        if (/^\s*(?:Tcp port|TCP Port):/i.test(l)) {
          port = l.match(/(?:Tcp port|TCP Port):\s*(\d+)/i)?.[1] ?? port;
          i++;
        } else if (/^\s*Time\s+Id\s+Command\s+Argument/i.test(l)) {
          i++;
        } else {
          break;
        }
      }
      pushRestart();
      continue;
    }

    if (/^#\s*Time:/i.test(line)) {
      const entry: SlowEntry = {
        kind: "entry",
        time: line.match(/#\s*Time:\s*(.+)$/i)?.[1].trim() ?? null,
        userHost: null,
        queryTime: null,
        lockTime: null,
        rowsSent: null,
        rowsExamined: null,
        schema: null,
        sql: "",
      };
      i++;
      while (i < lines.length && /^#/.test(lines[i])) {
        const h = lines[i];
        const uh = h.match(/#\s*User@Host:\s*(.+?)(?:\s+Id:\s*\d+)?\s*$/i);
        if (uh) entry.userHost = uh[1].trim();
        entry.queryTime = h.match(/Query_time:\s*([\d.]+)/i)?.[1] ?? entry.queryTime;
        entry.lockTime = h.match(/Lock_time:\s*([\d.]+)/i)?.[1] ?? entry.lockTime;
        entry.rowsSent = h.match(/Rows_sent:\s*(\d+)/i)?.[1] ?? entry.rowsSent;
        entry.rowsExamined =
          h.match(/Rows_examined:\s*(\d+)/i)?.[1] ?? entry.rowsExamined;
        entry.schema = h.match(/Schema:\s*(\S+)/i)?.[1] ?? entry.schema;
        i++;
      }
      const body: string[] = [];
      while (i < lines.length) {
        const l = lines[i];
        if (/^#\s*Time:/i.test(l) || VERSION_BANNER.test(l)) break;
        body.push(l);
        i++;
      }
      const sql = body.filter((l) => {
        const t = l.trim();
        if (/^use\s+\S+;$/i.test(t)) {
          if (!entry.schema) entry.schema = t.replace(/^use\s+/i, "").replace(/;$/, "");
          return false;
        }
        return !/^SET\s+timestamp\s*=/i.test(t);
      });
      entry.sql = sql.join("\n").trim();
      items.push(entry);
      continue;
    }

    i++;
  }

  return items;
}

function formatSeconds(s: number): string {
  if (Number.isNaN(s)) return "";
  return s < 1 ? `${Math.round(s * 1000)} ms` : `${s.toFixed(2)} s`;
}

function prettyTime(t: string | null): string | null {
  if (!t) return null;
  const m = t.match(/^(\d{4}-\d{2}-\d{2})T(\d{2}:\d{2}:\d{2})/);
  return m ? `${m[1]} ${m[2]}` : t;
}

function SlowLogView({ items, wrap }: { items: SlowItem[]; wrap: boolean }) {
  const entryCount = items.reduce((n, it) => (it.kind === "entry" ? n + 1 : n), 0);
  return (
    <div className="p-3 space-y-2">
      {entryCount === 0 && (
        <div className="px-1 py-2 text-[12px] text-zinc-500">
          No slow queries recorded yet — the log only contains server-start markers.
        </div>
      )}
      {items.map((it, idx) =>
        it.kind === "restart" ? (
          <RestartDivider key={idx} m={it} />
        ) : (
          <SlowEntryCard key={idx} e={it} wrap={wrap} />
        )
      )}
    </div>
  );
}

function RestartDivider({ m }: { m: RestartMarker }) {
  const label = m.count > 1 ? `Server restarted ×${m.count}` : "Server started";
  const detail = [
    m.version && `v${m.version}`,
    m.port && m.port !== "0" && `port ${m.port}`,
  ]
    .filter(Boolean)
    .join(" · ");
  return (
    <div className="flex select-none items-center gap-3 py-1">
      <span className="h-px flex-1 bg-zinc-800" />
      <span className="text-[11px] font-semibold uppercase tracking-wide text-zinc-500">
        {label}
        {detail && (
          <span className="ml-2 font-normal normal-case text-zinc-600">{detail}</span>
        )}
      </span>
      <span className="h-px flex-1 bg-zinc-800" />
    </div>
  );
}

function SlowEntryCard({ e, wrap }: { e: SlowEntry; wrap: boolean }) {
  const qt = e.queryTime != null ? parseFloat(e.queryTime) : null;
  const qtClass =
    qt == null
      ? "border-zinc-700 text-zinc-300"
      : qt >= 10
        ? "border-rose-500/30 bg-rose-500/10 text-rose-300"
        : qt >= 1
          ? "border-amber-500/30 bg-amber-500/10 text-amber-300"
          : "border-emerald-500/30 bg-emerald-500/10 text-emerald-300";
  return (
    <div className="overflow-hidden rounded-lg border border-zinc-800/80 bg-zinc-900/60">
      <div className="flex flex-wrap items-center gap-2 border-b border-zinc-800/60 bg-zinc-900/40 px-3 py-2">
        {qt != null && (
          <span
            className={clsx(
              "rounded border px-1.5 py-0.5 text-[11px] font-semibold tabular-nums",
              qtClass
            )}
          >
            {formatSeconds(qt)}
          </span>
        )}
        {prettyTime(e.time) && (
          <span className="text-[12px] tabular-nums text-zinc-300">
            {prettyTime(e.time)}
          </span>
        )}
        <span className="ml-auto flex flex-wrap items-center gap-x-3 gap-y-1 text-[11px] text-zinc-500">
          {e.lockTime != null && (
            <SlowMeta label="Lock" value={formatSeconds(parseFloat(e.lockTime))} />
          )}
          {e.rowsSent != null && <SlowMeta label="Sent" value={e.rowsSent} />}
          {e.rowsExamined != null && (
            <SlowMeta label="Examined" value={e.rowsExamined} />
          )}
          {e.schema && <SlowMeta label="DB" value={e.schema} />}
          {e.userHost && <SlowMeta label="User" value={e.userHost} />}
        </span>
      </div>
      <pre
        className={clsx(
          "m-0 px-3 py-2 text-[12px] leading-relaxed font-mono text-zinc-200",
          wrap ? "whitespace-pre-wrap break-words" : "overflow-x-auto whitespace-pre"
        )}
      >
        {e.sql || "(no statement captured)"}
      </pre>
    </div>
  );
}

function SlowMeta({ label, value }: { label: string; value: string }) {
  return (
    <span>
      <span className="text-zinc-600">{label}:</span>{" "}
      <span className="tabular-nums text-zinc-400">{value}</span>
    </span>
  );
}
