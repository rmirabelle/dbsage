import { useEffect } from "react";
import { FileArrowDown, FileArrowUp, X } from "@phosphor-icons/react";
import { useUi, type AppSettings } from "../state/ui";

interface Props {
  onClose: () => void;
  onImport: () => void;
  onExport: () => void;
  /** An Import/Export dialog is open on top: Escape belongs to it, not to us. */
  childOpen?: boolean;
}

/** One row per setting: label, help text, and the checkbox that changes it. */
const SETTINGS: { key: keyof AppSettings; label: string; help: string }[] = [
  {
    key: "popDownSaved",
    label: "Pop down saved Table Views and Queries on open",
    help: "When a table or query tab opens and it has saved Views or saved Queries, its Saved menu drops open once so you can pick one right away.",
  },
  {
    key: "closeRelationsOnTabClose",
    label: "Always close Relations panel on Table/Query close",
    help: "When you close a table tab with its Relations panel open, the panel is remembered as closed, so the table reopens without it. This can improve performance, because the table opens without loading its peeks.",
  },
];

export function SettingsDialog({ onClose, onImport, onExport, childOpen = false }: Props) {
  const settings = useUi((s) => s.settings);
  const setSetting = useUi((s) => s.setSetting);

  useEffect(() => {
    if (childOpen) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose, childOpen]);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm">
      <div
        data-el="settings-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby="settings-title"
        className="w-[520px] max-w-[95vw] max-h-[90vh] overflow-y-auto rounded-lg border border-zinc-800 bg-zinc-900 text-zinc-200 shadow-2xl shadow-black/60"
      >
        <div className="flex items-center justify-between px-4 py-3 border-b border-zinc-800">
          <h2 id="settings-title" className="text-sm font-medium text-zinc-100">DB Sage Settings</h2>
          <button data-el="settings-close-btn" onClick={onClose} className="text-zinc-500 hover:text-zinc-200" aria-label="Close">
            <X size={18} />
          </button>
        </div>

        <div className="px-4 py-4 space-y-4">
          {SETTINGS.map((item) => (
            <label key={item.key} className="flex items-start gap-3 cursor-pointer">
              <input
                type="checkbox"
                data-el={`setting-${item.key}`}
                checked={settings[item.key]}
                onChange={(e) => setSetting(item.key, e.target.checked)}
                className="dbs-check mt-px"
                style={{ width: "1.25rem", height: "1.25rem", backgroundSize: "15px" }}
              />
              <span className="min-w-0">
                <span className="block text-[13px] text-zinc-100">{item.label}</span>
                <span className="block mt-0.5 text-[11px] leading-relaxed text-zinc-400">{item.help}</span>
              </span>
            </label>
          ))}
        </div>

        <div className="px-4 py-4 border-t border-zinc-800 space-y-3">
          <div className="flex items-center gap-2">
            <button
              data-el="settings-import-btn"
              onClick={onImport}
              className="inline-flex items-center gap-1.5 px-2 py-1 rounded text-[11px] font-semibold bg-accent-500 text-[#042f2e] hover:bg-accent-400 transition-colors"
            >
              <FileArrowDown size={15} />
              Import Settings
            </button>
            <button
              data-el="settings-export-btn"
              onClick={onExport}
              className="inline-flex items-center gap-1.5 px-2 py-1 rounded text-[11px] font-semibold bg-zinc-800 text-zinc-200 hover:bg-zinc-700 transition-colors"
            >
              <FileArrowUp size={15} />
              Export Settings
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
