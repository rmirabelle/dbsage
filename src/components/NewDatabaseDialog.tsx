import { useEffect, useState } from "react";
import { Database, CircleNotch as Loader2, X } from "@phosphor-icons/react";

export function NewDatabaseDialog({
  connectionName,
  onCreate,
  onClose,
}: {
  connectionName: string;
  onCreate: (name: string) => Promise<void>;
  onClose: () => void;
}) {
  const [name, setName] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape" && !busy) onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [busy, onClose]);

  const trimmed = name.trim();
  const submit = async () => {
    if (!trimmed || busy) return;
    setBusy(true);
    setError(null);
    try {
      await onCreate(trimmed);
      onClose();
    } catch (e) {
      setError(String(e));
      setBusy(false);
    }
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm"
      onClick={() => !busy && onClose()}
    >
      <div
        data-el="new-database-dialog"
        role="dialog"
        aria-modal="true"
        onClick={(e) => e.stopPropagation()}
        className="w-[420px] max-w-[90vw] rounded-lg border border-zinc-700 bg-zinc-900 shadow-2xl shadow-black/60"
      >
        <div className="flex items-center justify-between px-4 py-3 border-b border-zinc-800">
          <div className="flex items-center gap-2">
            <Database size={18} className="text-accent-400" />
            <h2 className="text-sm font-semibold text-zinc-100">New database</h2>
          </div>
          {!busy && (
            <button
              onClick={onClose}
              className="text-zinc-500 hover:text-zinc-200"
              aria-label="Close"
            >
              <X size={18} />
            </button>
          )}
        </div>

        <div className="px-4 py-4 space-y-3">
          <p className="text-[12px] text-zinc-400">
            Create a new database on{" "}
            <span className="text-zinc-200 font-medium">{connectionName}</span>.
          </p>
          <input
            data-el="new-database-name"
            autoFocus
            value={name}
            onChange={(e) => setName(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                e.preventDefault();
                submit();
              }
            }}
            placeholder="database name"
            disabled={busy}
            className="w-full bg-zinc-950 border border-zinc-700 rounded px-2 py-1.5 text-[13px] text-zinc-100 outline-none focus:border-accent-500 disabled:opacity-50"
          />
          {error && (
            <div className="rounded bg-rose-950/40 border border-rose-900/60 px-3 py-2 text-[11px] text-rose-300 break-words">
              {error}
            </div>
          )}
        </div>

        <div className="flex justify-end gap-2 border-t border-zinc-800 px-4 py-3">
          <button
            onClick={onClose}
            disabled={busy}
            className="px-3 py-1.5 rounded text-[12px] text-zinc-200 bg-zinc-800 hover:bg-zinc-700 disabled:opacity-50"
          >
            Cancel
          </button>
          <button
            data-el="new-database-create-btn"
            onClick={submit}
            disabled={!trimmed || busy}
            className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded text-[12px] font-semibold bg-accent-500 text-[#042f2e] hover:bg-accent-400 transition-colors disabled:bg-zinc-800 disabled:text-zinc-500 disabled:cursor-not-allowed"
          >
            {busy ? (
              <Loader2 size={14} className="animate-spin" />
            ) : (
              <Database size={14} />
            )}
            {busy ? "Creating…" : "Create database"}
          </button>
        </div>
      </div>
    </div>
  );
}
