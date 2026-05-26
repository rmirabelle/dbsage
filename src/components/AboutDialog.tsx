import { useEffect, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { openUrl } from "@tauri-apps/plugin-opener";
import {
  ArrowClockwise,
  ArrowSquareOut,
  CheckCircle,
  CircleNotch,
  Database,
  DownloadSimple,
  X,
} from "@phosphor-icons/react";
import { checkForUpdate, type UpdateInfo } from "../lib/updater";

type Props = {
  open: boolean;
  version: string;
  initialUpdateInfo?: UpdateInfo | null;
  onClose: () => void;
};

type CheckState =
  | { kind: "idle" }
  | { kind: "checking" }
  | { kind: "upToDate" }
  | { kind: "available"; info: UpdateInfo }
  | { kind: "downloading"; info: UpdateInfo; downloaded: number; total: number }
  | { kind: "error"; message: string };

export function AboutDialog({ open, version, initialUpdateInfo, onClose }: Props) {
  const [state, setState] = useState<CheckState>({ kind: "idle" });

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape" && state.kind !== "downloading") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, state.kind, onClose]);

  useEffect(() => {
    if (!open) {
      setState({ kind: "idle" });
      return;
    }
    if (initialUpdateInfo) {
      setState({ kind: "available", info: initialUpdateInfo });
    }
  }, [open, initialUpdateInfo]);

  useEffect(() => {
    if (state.kind !== "downloading") return;
    const unlisten = listen<{ downloaded: number; total: number }>(
      "update-progress",
      (ev) => {
        setState((s) =>
          s.kind === "downloading"
            ? { ...s, downloaded: ev.payload.downloaded, total: ev.payload.total }
            : s
        );
      }
    );
    return () => {
      void unlisten.then((fn) => fn());
    };
  }, [state.kind]);

  if (!open) return null;

  async function handleCheck() {
    setState({ kind: "checking" });
    try {
      const info = await checkForUpdate();
      if (info) setState({ kind: "available", info });
      else setState({ kind: "upToDate" });
    } catch (e) {
      setState({ kind: "error", message: String(e) });
    }
  }

  async function handleDownload() {
    if (state.kind !== "available") return;
    const info = state.info;
    setState({ kind: "downloading", info, downloaded: 0, total: 0 });
    try {
      await invoke("download_and_run_installer", {
        url: info.downloadUrl,
        assetName: info.assetName,
      });
    } catch (e) {
      setState({ kind: "error", message: String(e) });
    }
  }

  const overlayClickable = state.kind !== "downloading";

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm"
      onClick={() => overlayClickable && onClose()}
    >
      <div
        data-el="about-dialog"
        role="dialog"
        aria-modal="true"
        onClick={(e) => e.stopPropagation()}
        className="relative w-[440px] rounded-lg border border-zinc-800 bg-zinc-900 shadow-2xl shadow-black/60"
      >
        {state.kind !== "downloading" && (
          <button
            type="button"
            data-el="about-dialog-close-btn"
            onClick={onClose}
            className="absolute right-3 top-3 text-zinc-500 hover:text-zinc-200"
            aria-label="Close"
          >
            <X size={18} />
          </button>
        )}

        <div className="flex items-center gap-4 px-5 pt-6 pb-4">
          <div className="flex h-16 w-16 shrink-0 items-center justify-center rounded-xl bg-accent-500/10 border border-accent-500/30">
            <Database size={37} weight="duotone" className="text-accent-400" />
          </div>
          <div className="flex flex-col gap-0.5">
            <div className="text-lg font-semibold text-zinc-100">DB Sage</div>
            <div className="text-[11px] text-zinc-500">Version {version || "—"}</div>
            <div className="mt-1 text-xs text-zinc-400">by Robert Mirabelle</div>
            <div className="mt-1.5 text-[11px] leading-relaxed text-zinc-500">
              A focused, opinionated, intelligent and robust MySQL client for
              Windows.
            </div>
          </div>
        </div>

        <div className="border-t border-zinc-800 px-5 py-4">
          <UpdateSection
            state={state}
            onCheck={handleCheck}
            onDownload={handleDownload}
          />
        </div>

        {state.kind !== "downloading" && (
          <div className="flex justify-end border-t border-zinc-800 px-5 py-3">
            <button type="button" data-el="about-close-btn" onClick={onClose} className="dbs-btn-secondary">
              Close
            </button>
          </div>
        )}

        <style>{`
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
        `}</style>
      </div>
    </div>
  );
}

function UpdateSection({
  state,
  onCheck,
  onDownload,
}: {
  state: CheckState;
  onCheck: () => void;
  onDownload: () => void;
}) {
  switch (state.kind) {
    case "idle":
      return (
        <div className="flex items-center justify-between gap-3">
          <span className="text-[11px] text-zinc-500">
            Check GitHub for a newer release.
          </span>
          <button
            type="button"
            data-el="check-update-btn"
            onClick={onCheck}
            className="flex items-center gap-1.5 rounded-md border border-zinc-700 bg-zinc-800 px-3 py-1.5 text-[11px] font-medium text-zinc-200 hover:bg-zinc-700"
          >
            <ArrowClockwise size={15} />
            Check for updates
          </button>
        </div>
      );

    case "checking":
      return (
        <div className="flex items-center gap-2 text-[11px] text-zinc-400">
          <CircleNotch size={15} className="animate-spin" />
          Checking for updates&hellip;
        </div>
      );

    case "upToDate":
      return (
        <div className="flex items-center justify-between gap-3">
          <div className="flex items-center gap-2 text-[11px] text-zinc-300">
            <CheckCircle size={17} className="text-emerald-400" weight="fill" />
            You&apos;re up to date.
          </div>
          <button
            type="button"
            onClick={onCheck}
            className="flex items-center gap-1.5 rounded-md border border-zinc-700 bg-zinc-800 px-2.5 py-1 text-[10px] text-zinc-400 hover:bg-zinc-700 hover:text-zinc-200"
          >
            <ArrowClockwise size={13} />
            Check again
          </button>
        </div>
      );

    case "available":
      return (
        <div className="flex flex-col gap-3">
          <div className="flex flex-wrap items-center gap-2 text-[11px]">
            <span className="font-medium text-zinc-100">
              Update available: v{state.info.latestVersion}
            </span>
            <span className="text-zinc-500">
              (you&apos;re on v{state.info.currentVersion})
            </span>
          </div>
          <div className="flex flex-wrap items-center gap-3">
            <button type="button" data-el="download-update-btn" onClick={onDownload} className="dbs-btn-primary text-[12px]">
              <DownloadSimple size={16} />
              Download &amp; install
            </button>
            <button
              type="button"
              onClick={() => void openUrl(state.info.releaseUrl)}
              className="flex items-center gap-1.5 text-[11px] text-zinc-400 hover:text-zinc-200"
            >
              <ArrowSquareOut size={15} />
              Release notes
            </button>
          </div>
        </div>
      );

    case "downloading": {
      const pct =
        state.total > 0
          ? Math.min(100, Math.round((state.downloaded / state.total) * 100))
          : null;
      return (
        <div className="flex flex-col gap-2">
          <div className="flex items-center gap-2 text-[11px] text-zinc-200">
            <CircleNotch size={15} className="animate-spin" />
            Downloading v{state.info.latestVersion}
            {pct !== null ? ` — ${pct}%` : "…"}
          </div>
          <div className="h-1.5 w-full overflow-hidden rounded bg-zinc-800">
            <div
              className="h-full bg-accent-500 transition-[width] duration-150"
              style={{ width: pct !== null ? `${pct}%` : "10%" }}
            />
          </div>
          <div className="text-[10px] text-zinc-500">
            The installer will launch when the download completes. DB Sage will close
            to apply the update.
          </div>
        </div>
      );
    }

    case "error":
      return (
        <div className="flex flex-col gap-2">
          <div className="text-[11px] text-rose-400">{state.message}</div>
          <button
            type="button"
            onClick={onCheck}
            className="self-start rounded-md border border-zinc-700 bg-zinc-800 px-2.5 py-1 text-[10px] text-zinc-300 hover:bg-zinc-700"
          >
            Try again
          </button>
        </div>
      );
  }
}
