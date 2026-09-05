import { useEffect } from "react";
import { GitDiff, X } from "@phosphor-icons/react";
import { useStore } from "../state/store";
import {
  CompareSides,
  SidePicker,
  sameSide,
  useCompareSide,
} from "./CompareSides";
import type { SchemaDiffSide } from "../types";

/**
 * Picker for a table-structure comparison. Seeded with the right-clicked
 * table as the source, but both sides are editable, so any two tables on any
 * two connections can be compared. The target starts on the source
 * connection with no database chosen.
 */
export function CompareSchemaDialog({
  left,
  onClose,
}: {
  left: SchemaDiffSide;
  onClose: () => void;
}) {
  const profiles = useStore((s) => s.profiles);
  const openSchemaDiff = useStore((s) => s.openSchemaDiff);

  const source = useCompareSide(left, true);
  const target = useCompareSide(
    { profileId: left.profileId, database: "" },
    true,
    source.table || left.table
  );

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  const same = sameSide(source, target, true);
  const filled = (s: typeof source) =>
    !!s.profileId && !!s.database && !!s.table && !s.connecting;
  const ready = filled(source) && filled(target) && !same;

  const compare = () => {
    if (!ready) return;
    const name = (id: string) => profiles.find((p) => p.id === id)?.name ?? id;
    openSchemaDiff(
      {
        profileId: source.profileId,
        profileName: name(source.profileId),
        database: source.database,
        table: source.table,
      },
      {
        profileId: target.profileId,
        profileName: name(target.profileId),
        database: target.database,
        table: target.table,
      }
    );
    onClose();
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm">
      <div
        data-el="compare-schema-dialog"
        role="dialog"
        aria-modal="true"
        style={{ resize: "both" }}
        className="relative flex h-[320px] w-[720px] min-h-[280px] min-w-[560px] max-h-[calc(100vh-32px)] max-w-[calc(100vw-32px)] flex-col overflow-hidden rounded-lg border border-zinc-800 bg-zinc-900 shadow-2xl"
      >
        <div className="flex items-center gap-2.5 px-4 py-3 border-b border-zinc-800">
          <GitDiff size={18} className="text-amber-400" />
          <div className="min-w-0">
            <div className="text-[14px] font-semibold text-zinc-100">
              Compare Schema
            </div>
            <div className="truncate text-[12px] text-zinc-400">
              Table structure, source against target
            </div>
          </div>
          <button
            className="ml-auto rounded p-1 text-zinc-400 hover:bg-zinc-800 hover:text-zinc-100"
            onClick={onClose}
            title="Close"
          >
            <X size={16} />
          </button>
        </div>

        <div className="flex min-h-0 flex-1 flex-col gap-3 overflow-auto px-4 py-4">
          <CompareSides
            source={<SidePicker side={source} dataEl="compare-source" withTables />}
            target={<SidePicker side={target} dataEl="compare-target" withTables />}
          />
          {same && filled(source) && (
            <div className="text-[12px] text-amber-400">
              Pick a different table — both sides point at the same table.
            </div>
          )}
        </div>

        <div className="flex items-center justify-end gap-2 px-4 py-3 border-t border-zinc-800">
          <button
            className="rounded px-3 py-1 text-zinc-300 hover:bg-zinc-800"
            onClick={onClose}
          >
            Cancel
          </button>
          <button
            data-el="compare-schema-go"
            className="rounded px-3 py-1 font-semibold bg-accent-500 text-[#042f2e] hover:bg-accent-400 disabled:opacity-50"
            disabled={!ready}
            onClick={compare}
          >
            Compare
          </button>
        </div>
        <span
          aria-hidden="true"
          className="pointer-events-none absolute bottom-1 right-1 h-2.5 w-2.5 border-b-2 border-r-2 border-zinc-600"
        />
      </div>
    </div>
  );
}
