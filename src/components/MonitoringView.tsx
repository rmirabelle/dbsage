import { useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import {
  Pause,
  Play,
  ArrowsClockwise as RefreshCw,
  Prohibit,
  CircleNotch as Loader2,
  WarningCircle as AlertCircle,
} from "@phosphor-icons/react";
import clsx from "clsx";
import { ipc } from "../ipc";
import { notifyError, notifySuccess } from "../state/notify";
import { StyledSelect } from "./StyledSelect";
import { ExpandedPanel } from "./ExpandedPanel";
import type {
  ColumnInfo,
  MonitorSample,
  ProcessRow,
  ServerStatus,
} from "../types";

const HISTORY_RANGES = [
  { value: "900", label: "15m" },
  { value: "3600", label: "1h" },
  { value: "21600", label: "6h" },
  { value: "86400", label: "24h" },
];

/** Per-interval rate of a cumulative counter across history samples. */
function rateSeries(
  h: MonitorSample[],
  pick: (s: MonitorSample) => number | null
): number[] {
  const out: number[] = [];
  for (let i = 1; i < h.length; i++) {
    const a = pick(h[i - 1]);
    const b = pick(h[i]);
    const dt = h[i].ts - h[i - 1].ts;
    if (a == null || b == null || dt <= 0) continue;
    out.push(Math.max(0, (b - a) / dt));
  }
  return out;
}

/** Raw gauge values across history samples (nulls dropped). */
function gaugeSeries(
  h: MonitorSample[],
  pick: (s: MonitorSample) => number | null
): number[] {
  return h.map(pick).filter((v): v is number => v != null);
}

/** Buffer-pool hit ratio (%) per interval, from read-request/read deltas. */
function bufferHitSeries(h: MonitorSample[]): number[] {
  const out: number[] = [];
  for (let i = 1; i < h.length; i++) {
    const rr = (h[i].bpReadRequests ?? 0) - (h[i - 1].bpReadRequests ?? 0);
    const rd = (h[i].bpReads ?? 0) - (h[i - 1].bpReads ?? 0);
    if (rr > 0) out.push((1 - rd / rr) * 100);
  }
  return out;
}

/** Synthetic column so the Inspector can display a process's SQL as read-only text. */
const QUERY_COLUMN: ColumnInfo = {
  name: "Query",
  dataType: "text",
  nullable: true,
  key: "",
};

const INTERVALS = [
  { value: "1000", label: "1s" },
  { value: "2000", label: "2s" },
  { value: "5000", label: "5s" },
];

/** Derived server vitals shown in the header strip. Rate fields are null until a
 * second sample lets us diff `SHOW GLOBAL STATUS`. */
interface Vitals {
  uptime: number;
  threadsRunning: number;
  threadsConnected: number;
  qps: number | null;
  slowPerSec: number | null;
  netPerSec: number | null;
  bufferHit: number | null;
}

const num = (s: ServerStatus, k: string): number => {
  const v = Number(s[k]);
  return Number.isFinite(v) ? v : 0;
};

function computeVitals(
  prev: ServerStatus | null,
  prevT: number,
  cur: ServerStatus,
  curT: number
): Vitals {
  const base: Vitals = {
    uptime: num(cur, "Uptime"),
    threadsRunning: num(cur, "Threads_running"),
    threadsConnected: num(cur, "Threads_connected"),
    qps: null,
    slowPerSec: null,
    netPerSec: null,
    bufferHit: null,
  };
  if (!prev) return base;
  const dt = (curT - prevT) / 1000;
  if (dt <= 0) return base;
  const queries =
    (num(cur, "Queries") || num(cur, "Questions")) -
    (num(prev, "Queries") || num(prev, "Questions"));
  const slow = num(cur, "Slow_queries") - num(prev, "Slow_queries");
  const net =
    num(cur, "Bytes_sent") +
    num(cur, "Bytes_received") -
    num(prev, "Bytes_sent") -
    num(prev, "Bytes_received");
  const rr =
    num(cur, "Innodb_buffer_pool_read_requests") -
    num(prev, "Innodb_buffer_pool_read_requests");
  const reads =
    num(cur, "Innodb_buffer_pool_reads") - num(prev, "Innodb_buffer_pool_reads");
  return {
    ...base,
    qps: queries / dt,
    slowPerSec: slow / dt,
    netPerSec: net / dt,
    bufferHit: rr > 0 ? (1 - reads / rr) * 100 : null,
  };
}

function fmtCount(n: number | null): string {
  if (n == null) return "—";
  if (n >= 1000) return Math.round(n).toLocaleString();
  if (n >= 10) return n.toFixed(0);
  return n.toFixed(1);
}

function fmtBytes(n: number | null): string {
  if (n == null) return "—";
  const u = ["B", "KB", "MB", "GB"];
  let v = n;
  let i = 0;
  while (v >= 1024 && i < u.length - 1) {
    v /= 1024;
    i++;
  }
  return `${v.toFixed(v >= 100 || i === 0 ? 0 : 1)} ${u[i]}`;
}

function fmtUptime(sec: number): string {
  const d = Math.floor(sec / 86400);
  const h = Math.floor((sec % 86400) / 3600);
  const m = Math.floor((sec % 3600) / 60);
  if (d > 0) return `${d}d ${h}h`;
  if (h > 0) return `${h}h ${m}m`;
  return `${m}m`;
}

/** Color a thread's elapsed time by how long it's been running. */
function durationTone(seconds: number, idle: boolean): string {
  if (idle) return "text-zinc-600";
  if (seconds >= 10) return "text-rose-400 font-semibold";
  if (seconds >= 3) return "text-amber-400";
  if (seconds >= 1) return "text-amber-300";
  return "text-zinc-300";
}

export function MonitoringView({ profileId }: { profileId: string }) {
  const [intervalMs, setIntervalMs] = useState(2000);
  const [paused, setPaused] = useState(false);
  const [processes, setProcesses] = useState<ProcessRow[]>([]);
  const [vitals, setVitals] = useState<Vitals | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [lastUpdated, setLastUpdated] = useState<number | null>(null);
  const [hideSleeping, setHideSleeping] = useState(true);
  const [killing, setKilling] = useState<Set<number>>(new Set());
  /** The process whose full SQL is shown in the Inspector panel, or null. */
  const [inspecting, setInspecting] = useState<ProcessRow | null>(null);
  /** `long_query_time` (the slow-query threshold), formatted; null until read. */
  const [slowThreshold, setSlowThreshold] = useState<string | null>(null);
  /** Persisted history for the trend charts, and the selected window (seconds). */
  const [history, setHistory] = useState<MonitorSample[]>([]);
  const [historyRange, setHistoryRange] = useState(3600);

  const prevRef = useRef<{ status: ServerStatus; t: number } | null>(null);
  /** Bumped to force an immediate out-of-cycle refresh. */
  const [refreshTick, setRefreshTick] = useState(0);

  useEffect(() => {
    let cancelled = false;
    let timer: number | undefined;
    const tick = async () => {
      try {
        const [procs, status] = await Promise.all([
          ipc.listProcesses(profileId),
          ipc.globalStatus(profileId),
        ]);
        if (cancelled) return;
        const now = Date.now();
        const prev = prevRef.current;
        setVitals(computeVitals(prev?.status ?? null, prev?.t ?? 0, status, now));
        prevRef.current = { status, t: now };
        setProcesses(procs);
        setLastUpdated(now);
        setError(null);
      } catch (e) {
        if (!cancelled) setError(String(e));
      } finally {
        if (!cancelled && !paused) timer = window.setTimeout(tick, intervalMs);
      }
    };
    tick();
    return () => {
      cancelled = true;
      if (timer) clearTimeout(timer);
    };
  }, [profileId, intervalMs, paused, refreshTick]);

  /* Server variables rarely change, so read them once per connection (and on a
     manual refresh) rather than every poll — just for the slow-query threshold. */
  useEffect(() => {
    let cancelled = false;
    ipc
      .globalVariables(profileId)
      .then((vars) => {
        if (cancelled) return;
        const raw = vars["long_query_time"];
        const n = Number(raw);
        setSlowThreshold(
          Number.isFinite(n) ? `${n % 1 === 0 ? n : n.toFixed(2)}s` : raw ?? null
        );
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [profileId, refreshTick]);

  /* Trend history is collected by the Rust background sampler (every ~15s, even
     while minimized to tray), so we just re-read it on a matching cadence. */
  useEffect(() => {
    let cancelled = false;
    const load = () =>
      ipc
        .monitorHistory(profileId, historyRange)
        .then((h) => {
          if (!cancelled) setHistory(h);
        })
        .catch(() => {});
    load();
    const id = window.setInterval(load, 15000);
    return () => {
      cancelled = true;
      clearInterval(id);
    };
  }, [profileId, historyRange]);

  const series = useMemo(
    () => ({
      qps: rateSeries(history, (s) => s.queries),
      threads: gaugeSeries(history, (s) => s.threadsRunning),
      net: rateSeries(history, (s) =>
        s.bytesSent == null && s.bytesReceived == null
          ? null
          : (s.bytesSent ?? 0) + (s.bytesReceived ?? 0)
      ),
      bufferHit: bufferHitSeries(history),
    }),
    [history]
  );

  const onKill = async (p: ProcessRow) => {
    const what = p.info?.trim() ? `\n\n${p.info.trim()}` : "";
    if (
      !confirm(
        `Kill connection ${p.id}${p.user ? ` (${p.user})` : ""}?${what}`
      )
    )
      return;
    setKilling((s) => new Set(s).add(p.id));
    try {
      await ipc.killProcess(profileId, p.id, false);
      notifySuccess(`Killed connection ${p.id}.`);
      setRefreshTick((t) => t + 1);
    } catch (e) {
      notifyError(`Could not kill connection ${p.id}: ${String(e)}`);
    } finally {
      setKilling((s) => {
        const n = new Set(s);
        n.delete(p.id);
        return n;
      });
    }
  };

  const visible = hideSleeping
    ? processes.filter((p) => (p.command ?? "") !== "Sleep")
    : processes;

  return (
    <div className="flex-1 flex flex-col min-h-0">
      <div
        data-el="monitoring-toolbar"
        data-toolbar="monitoring"
        className="dbs-toolbar h-9 pl-1 pr-1 border-b border-zinc-800/60 flex items-center gap-1 text-zinc-400"
      >
        <button
          data-el="monitoring-pause-btn"
          onClick={() => setPaused((p) => !p)}
          className="inline-flex items-center gap-1.5 px-2 py-1 rounded text-[11px] font-semibold bg-zinc-800 text-zinc-200 hover:bg-zinc-700 transition-colors"
          title={paused ? "Resume live polling" : "Pause live polling"}
        >
          {paused ? <Play size={15} weight="fill" /> : <Pause size={15} weight="fill" />}
          {paused ? "Resume" : "Pause"}
        </button>
        <button
          data-el="monitoring-refresh-btn"
          onClick={() => setRefreshTick((t) => t + 1)}
          className="inline-flex items-center gap-1.5 px-2 py-1 rounded text-[11px] font-semibold bg-zinc-800 text-zinc-200 hover:bg-zinc-700 transition-colors"
          title="Refresh now"
        >
          <RefreshCw size={14} />
          Refresh
        </button>
        <StyledSelect
          dataEl="monitoring-interval-select"
          value={String(intervalMs)}
          onChange={(v) => setIntervalMs(Number(v))}
          title="Polling interval"
          options={INTERVALS}
        />
        <label className="ml-2 inline-flex items-center gap-1.5 text-[11px] cursor-pointer select-none">
          <input
            type="checkbox"
            checked={hideSleeping}
            onChange={(e) => setHideSleeping(e.target.checked)}
            className="accent-accent-500"
          />
          Hide sleeping
        </label>

        <span className="ml-auto inline-flex items-center gap-1.5 text-[11px] text-zinc-500">
          {!paused && <Loader2 size={12} className="animate-spin text-sky-400" />}
          {paused
            ? "Paused"
            : lastUpdated
            ? `Updated ${new Date(lastUpdated).toLocaleTimeString()}`
            : "Connecting…"}
        </span>
      </div>

      <div
        data-el="monitoring-vitals"
        className="shrink-0 flex flex-wrap gap-2 px-3 py-2 border-b border-zinc-800/60 bg-zinc-950"
      >
        <Stat
          label="Uptime"
          value={vitals ? fmtUptime(vitals.uptime) : "—"}
          tip={{
            what: "How long the MySQL server has been running since its last start.",
            why: "A recent or unexpected reset explains cold caches, dropped sessions, or a crash you didn't know about.",
          }}
        />
        <Stat
          label="Queries/s"
          value={fmtCount(vitals?.qps ?? null)}
          accent
          tip={{
            what: "Statements executed per second (the Queries counter), averaged over the polling interval.",
            why: "The server's overall throughput — sudden spikes or drops flag a load change, a runaway client, or a stall.",
          }}
        />
        <Stat
          label="Threads (run/conn)"
          value={
            vitals ? `${vitals.threadsRunning} / ${vitals.threadsConnected}` : "—"
          }
          tip={{
            what: "Threads actively running a statement, versus total open client connections.",
            why: "Running climbing toward your CPU core count means contention or saturation; connected nearing max_connections risks refused logins.",
          }}
        />
        <Stat
          label="Slow/s"
          value={fmtCount(vitals?.slowPerSec ?? null)}
          tip={{
            what: `Queries per second that exceeded long_query_time, the slow-query threshold${
              slowThreshold ? ` — currently ${slowThreshold}` : ""
            }.`,
            why: "A rising rate usually points at missing indexes or inefficient queries dragging the whole server down.",
          }}
        />
        <Stat
          label="Network/s"
          value={vitals ? fmtBytes(vitals.netPerSec) : "—"}
          tip={{
            what: "Bytes sent plus received per second across all connections.",
            why: "Unusually high traffic often means oversized result sets (missing LIMIT / SELECT *) or overly chatty clients.",
          }}
        />
        <Stat
          label="Buffer hit"
          value={vitals?.bufferHit != null ? `${vitals.bufferHit.toFixed(1)}%` : "—"}
          tip={{
            what: "Share of InnoDB page reads served from the in-memory buffer pool instead of disk.",
            why: "Below ~99% means the working set doesn't fit in memory — reads hit disk and slow down; consider raising innodb_buffer_pool_size.",
          }}
        />
      </div>

      <div
        data-el="monitoring-history"
        className="shrink-0 px-3 py-2 border-b border-zinc-800/60 bg-zinc-950"
      >
        <div className="flex items-center gap-2 mb-2">
          <span className="text-[11px] uppercase tracking-wide text-zinc-500">
            History
          </span>
          <StyledSelect
            dataEl="monitoring-range-select"
            value={String(historyRange)}
            onChange={(v) => setHistoryRange(Number(v))}
            title="History window"
            options={HISTORY_RANGES}
          />
          <span className="text-[10px] text-zinc-600">
            {history.length} sample{history.length === 1 ? "" : "s"}
          </span>
        </div>
        <div className="grid grid-cols-2 md:grid-cols-4 gap-2">
          <MiniChart label="Queries/s" values={series.qps} fmt={fmtCount} color="#38bdf8" />
          <MiniChart
            label="Threads running"
            values={series.threads}
            fmt={(n) => n.toFixed(0)}
            color="#a78bfa"
          />
          <MiniChart label="Network/s" values={series.net} fmt={fmtBytes} color="#34d399" />
          <MiniChart
            label="Buffer hit"
            values={series.bufferHit}
            fmt={(n) => `${n.toFixed(1)}%`}
            color="#fbbf24"
          />
        </div>
      </div>

      {error && (
        <div className="shrink-0 px-3 py-2 bg-rose-950/40 border-b border-rose-900/60 text-rose-300 text-[11px] flex items-start gap-2">
          <AlertCircle size={14} className="mt-0.5 shrink-0" />
          <span className="break-words font-mono">{error}</span>
        </div>
      )}

      <div className="flex-1 min-h-0 overflow-auto">
        <table className="w-full text-[12px] border-collapse [&_th]:border-x [&_th]:border-zinc-800/60 [&_td]:border-x [&_td]:border-zinc-800/40">
          <thead className="sticky top-0 z-10 bg-zinc-900 text-zinc-400">
            <tr className="text-left">
              <Th className="w-16 text-right pr-3">ID</Th>
              <Th>User</Th>
              <Th>Host</Th>
              <Th>DB</Th>
              <Th>Command</Th>
              <Th className="w-20 text-right pr-3">Time</Th>
              <Th>State</Th>
              <Th>Query</Th>
              <Th className="w-10" />
            </tr>
          </thead>
          <tbody>
            {visible.length === 0 ? (
              <tr>
                <td colSpan={9} className="px-3 py-6 text-center text-zinc-600">
                  {processes.length === 0 ? "No active threads." : "Only sleeping connections."}
                </td>
              </tr>
            ) : (
              visible.map((p) => {
                const idle = (p.command ?? "") === "Sleep" || !p.info?.trim();
                /* Executing rows share the Time column's duration color across
                   State + Query, so a long-running statement lights up the row. */
                const tone = durationTone(p.time, idle);
                return (
                  <tr
                    key={p.id}
                    data-el="monitoring-row"
                    className="border-b border-zinc-900 hover:bg-zinc-900/50"
                  >
                    <td className="px-2 py-1 text-right pr-3 font-mono text-zinc-500 tabular-nums">
                      {p.id}
                    </td>
                    <td className="px-2 py-1 text-zinc-300 whitespace-nowrap">{p.user ?? ""}</td>
                    <td className="px-2 py-1 text-zinc-500 whitespace-nowrap font-mono">{p.host ?? ""}</td>
                    <td className="px-2 py-1 text-zinc-400 whitespace-nowrap">{p.db ?? ""}</td>
                    <td className="px-2 py-1 text-zinc-400 whitespace-nowrap">{p.command ?? ""}</td>
                    <td
                      className={clsx(
                        "px-2 py-1 text-right pr-3 font-mono tabular-nums",
                        tone
                      )}
                    >
                      {p.time}s
                    </td>
                    <td className={clsx("px-2 py-1 whitespace-nowrap", tone)}>
                      {p.state ?? ""}
                    </td>
                    <td className="px-2 py-1 max-w-[40vw]">
                      {p.info?.trim() ? (
                        <button
                          onClick={() => setInspecting(p)}
                          title="Click to view the full statement"
                          className={clsx(
                            "block w-full truncate text-left font-mono cursor-pointer hover:underline",
                            tone
                          )}
                        >
                          {p.info}
                        </button>
                      ) : (
                        <span className="block truncate font-mono text-zinc-600">
                          {p.info ?? ""}
                        </span>
                      )}
                    </td>
                    <td className="px-2 py-1 text-right">
                      <button
                        data-el="monitoring-kill-btn"
                        onClick={() => onKill(p)}
                        disabled={killing.has(p.id)}
                        className="inline-flex items-center justify-center p-1 rounded text-zinc-500 hover:text-rose-300 hover:bg-zinc-800 disabled:opacity-40"
                        title="Kill this connection"
                        aria-label={`Kill connection ${p.id}`}
                      >
                        {killing.has(p.id) ? (
                          <Loader2 size={14} className="animate-spin" />
                        ) : (
                          <Prohibit size={14} />
                        )}
                      </button>
                    </td>
                  </tr>
                );
              })
            )}
          </tbody>
        </table>
      </div>

      {inspecting && (
        <ExpandedPanel
          readOnly
          editable={false}
          column={QUERY_COLUMN}
          value={inspecting.info}
          rowOrdinal={null}
          onClose={() => setInspecting(null)}
        />
      )}
    </div>
  );
}

/** A compact, library-free line chart over a value series. */
function MiniChart({
  label,
  values,
  fmt,
  color,
}: {
  label: string;
  values: number[];
  fmt: (n: number) => string;
  color: string;
}) {
  const W = 200;
  const H = 44;
  const latest = values.length ? values[values.length - 1] : null;
  let path = "";
  if (values.length >= 2) {
    const min = Math.min(...values);
    const max = Math.max(...values);
    const range = max - min || 1;
    path = values
      .map((v, i) => {
        const x = (i / (values.length - 1)) * W;
        const y = H - 2 - ((v - min) / range) * (H - 4);
        return `${i === 0 ? "M" : "L"}${x.toFixed(1)},${y.toFixed(1)}`;
      })
      .join(" ");
  }
  return (
    <div className="rounded-lg border border-zinc-700/60 bg-gradient-to-b from-zinc-800/60 to-zinc-950/50 px-3 py-2">
      <div className="flex items-baseline justify-between">
        <span className="text-[10px] uppercase tracking-wide text-zinc-500">{label}</span>
        <span className="text-[13px] font-semibold tabular-nums text-zinc-100">
          {latest != null ? fmt(latest) : "—"}
        </span>
      </div>
      <svg
        className="mt-1 w-full"
        height={H}
        viewBox={`0 0 ${W} ${H}`}
        preserveAspectRatio="none"
      >
        {path ? (
          <path d={path} fill="none" stroke={color} strokeWidth={1.5} vectorEffect="non-scaling-stroke" />
        ) : (
          <line x1="0" y1={H / 2} x2={W} y2={H / 2} stroke="#3f3f46" strokeWidth={1} strokeDasharray="3 3" />
        )}
      </svg>
    </div>
  );
}

function Th({
  children,
  className,
}: {
  children?: React.ReactNode;
  className?: string;
}) {
  return (
    <th
      className={clsx(
        "px-2 py-1.5 font-semibold border-b border-zinc-800 whitespace-nowrap",
        className
      )}
    >
      {children}
    </th>
  );
}

interface StatTip {
  /** What the metric measures. */
  what: string;
  /** Why it's worth watching. */
  why: string;
}

function Stat({
  label,
  value,
  accent,
  tip,
}: {
  label: string;
  value: string;
  accent?: boolean;
  tip?: StatTip;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const [rect, setRect] = useState<DOMRect | null>(null);

  const show = () => {
    if (tip && ref.current) setRect(ref.current.getBoundingClientRect());
  };
  const hide = () => setRect(null);

  const TIP_W = 288;
  const left = rect
    ? Math.max(8, Math.min(rect.left, window.innerWidth - TIP_W - 8))
    : 0;

  return (
    <div
      ref={ref}
      onMouseEnter={show}
      onMouseLeave={hide}
      className={clsx(
        "min-w-[112px] rounded-lg border border-zinc-700/60 bg-gradient-to-b from-zinc-800/60 to-zinc-950/50 px-3 py-2 shadow-sm shadow-black/30",
        tip && "cursor-help"
      )}
    >
      <div className="text-[10px] uppercase tracking-wide text-zinc-500">{label}</div>
      <div
        className={clsx(
          "text-[22px] font-semibold tabular-nums leading-tight mt-0.5",
          accent ? "text-sky-300" : "text-zinc-100"
        )}
      >
        {value}
      </div>
      {tip &&
        rect &&
        createPortal(
          <div
            style={{ position: "fixed", left, top: rect.bottom + 6, width: TIP_W }}
            className="z-[70] pointer-events-none rounded-lg border border-zinc-700 bg-zinc-900/95 backdrop-blur-sm p-3 shadow-xl shadow-black/60"
          >
            <div className="text-[11px] font-semibold uppercase tracking-wide text-sky-300">
              {label}
            </div>
            <p className="mt-1 text-[12px] leading-snug text-zinc-200">{tip.what}</p>
            <p className="mt-2 text-[12px] leading-snug text-zinc-400">
              <span className="font-semibold text-zinc-300">Why it matters: </span>
              {tip.why}
            </p>
          </div>,
          document.body
        )}
    </div>
  );
}
