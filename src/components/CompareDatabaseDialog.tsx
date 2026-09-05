import { useEffect, useMemo, useRef, useState } from "react";
import { GitDiff, X } from "@phosphor-icons/react";
import { useStore } from "../state/store";
import { ipc } from "../ipc";
import {
  CompareSides,
  SidePicker,
  sameSide,
  useCompareSide,
} from "./CompareSides";
import type { DatabaseDiffSide } from "../types";

/**
 * Picker for a whole-database comparison. Seeded with the right-clicked
 * database as the source, but both sides are editable, so any two databases
 * on any two connections can be compared. The target starts on the source
 * connection with no database chosen.
 */
export function CompareDatabaseDialog({
  left,
  onClose,
}: {
  left: DatabaseDiffSide;
  onClose: () => void;
}) {
  const profiles = useStore((s) => s.profiles);
  const openDatabaseDiff = useStore((s) => s.openDatabaseDiff);

  const source = useCompareSide(left, false);
  const target = useCompareSide({ profileId: left.profileId, database: "" }, false);
  const [pickTables, setPickTables] = useState(false);
  /** Union of both sides' table names; null until loaded. */
  const [allTables, setAllTables] = useState<string[] | null>(null);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [filter, setFilter] = useState("");

  /** When picking tables, load the union of both sides' table names (a table
   * that exists on only one side is still a meaningful diff row). Everything
   * starts selected; the user prunes with the filter + bulk buttons. */
  useEffect(() => {
    if (!pickTables || !source.database || !target.database) return;
    let cancelled = false;
    setAllTables(null);
    (async () => {
      try {
        const [l, r] = await Promise.all([
          ipc.listTables(source.profileId, source.database),
          ipc.listTables(target.profileId, target.database),
        ]);
        if (cancelled) return;
        const names = Array.from(
          new Set([...l.map((t) => t.name), ...r.map((t) => t.name)])
        ).sort();
        setAllTables(names);
        setSelected(new Set(names));
      } catch {
        if (!cancelled) setAllTables([]);
      }
    })();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pickTables, source.profileId, source.database, target.profileId, target.database]);

  const shown = useMemo(() => {
    if (!allTables) return [];
    const q = filter.trim().toLowerCase();
    return q ? allTables.filter((n) => n.toLowerCase().includes(q)) : allTables;
  }, [allTables, filter]);

  const setShownSelected = (on: boolean) => {
    setSelected((prev) => {
      const next = new Set(prev);
      for (const n of shown) {
        if (on) next.add(n);
        else next.delete(n);
      }
      return next;
    });
  };

  const setTable = (name: string, on: boolean) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (on) next.add(name);
      else next.delete(name);
      return next;
    });
  };

  /** Drag-to-select: mousedown on a row toggles it and starts "painting" that
   * state; dragging over further rows applies the same state to them. */
  const dragPaint = useRef<boolean | null>(null);
  useEffect(() => {
    const end = () => {
      dragPaint.current = null;
    };
    window.addEventListener("mouseup", end);
    return () => window.removeEventListener("mouseup", end);
  }, []);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  const same = sameSide(source, target, false);
  const filled = (s: typeof source) =>
    !!s.profileId && !!s.database && !s.connecting;
  const ready =
    filled(source) &&
    filled(target) &&
    !same &&
    (!pickTables || (allTables !== null && selected.size > 0));

  const compare = () => {
    if (!ready) return;
    const name = (id: string) => profiles.find((p) => p.id === id)?.name ?? id;
    openDatabaseDiff(
      {
        profileId: source.profileId,
        profileName: name(source.profileId),
        database: source.database,
      },
      {
        profileId: target.profileId,
        profileName: name(target.profileId),
        database: target.database,
      },
      /* A full selection is the same as "all tables" — don't pin the tab to a
         list that would silently exclude tables created later. */
      pickTables && selected.size < (allTables?.length ?? 0)
        ? Array.from(selected).sort()
        : null
    );
    onClose();
  };


  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm"
    >
      <div
        data-el="compare-database-dialog"
        role="dialog"
        aria-modal="true"
        style={{
          resize: "both",
          height: pickTables ? "min(650px, calc(100vh - 32px))" : undefined,
        }}
        className="relative flex w-[720px] min-h-[300px] min-w-[560px] max-h-[calc(100vh-32px)] max-w-[calc(100vw-32px)] flex-col overflow-hidden rounded-lg border border-zinc-800 bg-zinc-900 shadow-2xl"
      >
        <div className="flex items-center gap-2.5 px-4 py-3 border-b border-zinc-800">
          <GitDiff size={18} className="text-amber-400" />
          <div className="min-w-0">
            <div className="text-[14px] font-semibold text-zinc-100">
              Compare Database Schema
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
            source={<SidePicker side={source} dataEl="compare-db-source" />}
            target={<SidePicker side={target} dataEl="compare-db-target" />}
          />
          {same && filled(source) && (
            <div className="text-[12px] text-amber-400">
              Pick a different database — both sides point at the same database.
            </div>
          )}

          <label className="flex items-center gap-2 cursor-pointer select-none">
            <input
              type="checkbox"
              className="dbs-check"
              checked={pickTables}
              onChange={(e) => setPickTables(e.target.checked)}
              disabled={!source.database || !target.database}
            />
            <span className="text-[12px] text-zinc-300">
              Select specific tables
            </span>
          </label>

          {pickTables && (
            <div className="flex min-h-[220px] flex-1 flex-col gap-2">
              <div className="flex items-center gap-2">
                <input
                  data-el="compare-table-filter"
                  placeholder="Filter tables…"
                  value={filter}
                  onChange={(e) => setFilter(e.target.value)}
                  className="min-w-0 flex-1 bg-zinc-950 border border-zinc-700 rounded px-2 py-1 text-zinc-200 focus:border-accent-500"
                />
                <button
                  className="shrink-0 rounded px-2 py-1 text-zinc-300 border border-zinc-700 hover:bg-zinc-800 disabled:opacity-40"
                  onClick={() => setShownSelected(true)}
                  disabled={!shown.length}
                  title="Check every table currently shown by the filter"
                >
                  Select shown
                </button>
                <button
                  className="shrink-0 rounded px-2 py-1 text-zinc-300 border border-zinc-700 hover:bg-zinc-800 disabled:opacity-40"
                  onClick={() => setShownSelected(false)}
                  disabled={!shown.length}
                  title="Uncheck every table currently shown by the filter"
                >
                  Clear shown
                </button>
              </div>
              <div className="min-h-[160px] flex-1 overflow-y-auto rounded border border-zinc-800 bg-zinc-950">
                {allTables === null ? (
                  <div className="px-3 py-4 text-[12px] text-zinc-500">
                    Loading tables…
                  </div>
                ) : !shown.length ? (
                  <div className="px-3 py-4 text-[12px] text-zinc-500">
                    {allTables.length
                      ? "No tables match the filter."
                      : "No tables found."}
                  </div>
                ) : (
                  shown.map((name) => (
                    <div
                      key={name}
                      className="flex items-center gap-2.5 px-2.5 py-[3px] cursor-pointer select-none hover:bg-zinc-900"
                      onMouseDown={(e) => {
                        e.preventDefault();
                        const on = !selected.has(name);
                        dragPaint.current = on;
                        setTable(name, on);
                      }}
                      onMouseEnter={() => {
                        if (dragPaint.current !== null)
                          setTable(name, dragPaint.current);
                      }}
                    >
                      <input
                        type="checkbox"
                        className="dbs-check pointer-events-none"
                        checked={selected.has(name)}
                        readOnly
                        tabIndex={-1}
                      />
                      <span className="truncate text-[12px] text-zinc-200">
                        {name}
                      </span>
                    </div>
                  ))
                )}
              </div>
              <div className="text-[12px] text-zinc-500">
                {selected.size} of {allTables?.length ?? 0} tables selected
                {filter.trim() && ` · ${shown.length} shown`}
              </div>
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
            data-el="compare-database-go"
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
