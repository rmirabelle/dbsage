import { useEffect, useMemo, useRef, useState } from "react";
import { GitDiff, X } from "@phosphor-icons/react";
import { useStore } from "../state/store";
import { ipc } from "../ipc";
import { StyledSelect } from "./StyledSelect";
import type { DatabaseDiffSide } from "../types";

/**
 * Picker for the other side of a whole-database comparison. Seeded with the
 * right-clicked database as the fixed left side; defaults the right side to
 * the first other connected profile that has a same-named database, falling
 * back to the source connection.
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
  const connectProfile = useStore((s) => s.connectProfile);

  const [profileId, setProfileId] = useState<string | null>(null);
  const [databases, setDatabases] = useState<string[]>([]);
  const [database, setDatabase] = useState("");
  const [connecting, setConnecting] = useState(false);
  const [connectError, setConnectError] = useState<string | null>(null);
  const [pickTables, setPickTables] = useState(false);
  /** Union of both sides' table names; null until loaded. */
  const [allTables, setAllTables] = useState<string[] | null>(null);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [filter, setFilter] = useState("");

  /** Find the default target: first other *connected* profile holding a
   * same-named database; otherwise the first other profile of any state
   * (it gets connected on demand below). */
  useEffect(() => {
    let cancelled = false;
    (async () => {
      const others = profiles.filter((p) => p.id !== left.profileId);
      const conns = useStore.getState().connections;
      for (const p of others.filter((p) => conns[p.id]?.connected)) {
        try {
          const dbs = await ipc.listDatabases(p.id);
          if (!dbs.includes(left.database)) continue;
          if (!cancelled) setProfileId(p.id);
          return;
        } catch {
          /* Unreachable connection — try the next candidate. */
        }
      }
      if (!cancelled) setProfileId(others[0]?.id ?? left.profileId);
    })();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  /** Load databases whenever the target connection changes, connecting the
   * profile first when needed; prefer the left side's database name when it
   * exists there. */
  useEffect(() => {
    if (!profileId) return;
    let cancelled = false;
    (async () => {
      setConnectError(null);
      try {
        if (!useStore.getState().connections[profileId]?.connected) {
          setConnecting(true);
          await connectProfile(profileId);
        }
        const dbs = await ipc.listDatabases(profileId);
        if (cancelled) return;
        setDatabases(dbs);
        setDatabase(dbs.includes(left.database) ? left.database : dbs[0] ?? "");
      } catch (e) {
        if (!cancelled) {
          setDatabases([]);
          setDatabase("");
          setConnectError(String(e));
        }
      } finally {
        if (!cancelled) setConnecting(false);
      }
    })();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [profileId]);

  /** When picking tables, load the union of both sides' table names (a table
   * that exists on only one side is still a meaningful diff row). Everything
   * starts selected; the user prunes with the filter + bulk buttons. */
  useEffect(() => {
    if (!pickTables || !profileId || !database) return;
    let cancelled = false;
    setAllTables(null);
    (async () => {
      try {
        const [l, r] = await Promise.all([
          ipc.listTables(left.profileId, left.database),
          ipc.listTables(profileId, database),
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
  }, [pickTables, profileId, database]);

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

  const sameAsLeft =
    profileId === left.profileId && database === left.database;
  const ready =
    !!profileId &&
    !!database &&
    !sameAsLeft &&
    !connecting &&
    (!pickTables || (allTables !== null && selected.size > 0));

  const compare = () => {
    if (!ready || !profileId) return;
    const profile = profiles.find((p) => p.id === profileId);
    openDatabaseDiff(
      left,
      {
        profileId,
        profileName: profile?.name ?? profileId,
        database,
      },
      /* A full selection is the same as "all tables" — don't pin the tab to a
         list that would silently exclude tables created later. */
      pickTables && selected.size < (allTables?.length ?? 0)
        ? Array.from(selected).sort()
        : null
    );
    onClose();
  };

  const selectClass =
    "w-full justify-between bg-zinc-950 border border-zinc-700 rounded px-2 py-1 text-zinc-200";

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div
        role="dialog"
        aria-modal="true"
        className="relative w-[520px] rounded-lg border border-zinc-800 bg-zinc-900 shadow-2xl"
      >
        <div className="flex items-center gap-2.5 px-4 py-3 border-b border-zinc-800">
          <GitDiff size={18} className="text-amber-400" />
          <div className="min-w-0">
            <div className="text-[14px] font-semibold text-zinc-100">
              Compare Database Schema
            </div>
            <div className="truncate text-[12px] text-zinc-400">
              {left.profileName} • {left.database}
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

        <div className="flex flex-col gap-3 px-4 py-4">
          <div className="text-[12px] text-zinc-400">Compare it with:</div>
          <label className="flex items-center gap-3">
            <span className="w-24 shrink-0 text-[12px] text-zinc-400">
              Connection
            </span>
            <StyledSelect
              dataEl="compare-db-connection"
              value={profileId ?? ""}
              options={profiles.map((p) => ({ value: p.id, label: p.name }))}
              onChange={setProfileId}
              disabled={!profileId}
              className={selectClass}
            />
          </label>
          {connecting && (
            <div className="text-[12px] text-zinc-400">Connecting…</div>
          )}
          {connectError && (
            <div className="text-[12px] text-rose-400">
              Could not connect: {connectError}
            </div>
          )}
          <label className="flex items-center gap-3">
            <span className="w-24 shrink-0 text-[12px] text-zinc-400">
              Database
            </span>
            <StyledSelect
              dataEl="compare-db-database"
              value={database}
              options={databases.map((d) => ({ value: d, label: d }))}
              onChange={setDatabase}
              disabled={!databases.length}
              className={selectClass}
            />
          </label>
          {sameAsLeft && (
            <div className="text-[12px] text-amber-400">
              Pick a different database — this is the same database as the left
              side.
            </div>
          )}

          <label className="flex items-center gap-2 cursor-pointer select-none">
            <input
              type="checkbox"
              className="dbs-check"
              checked={pickTables}
              onChange={(e) => setPickTables(e.target.checked)}
              disabled={!database}
            />
            <span className="text-[12px] text-zinc-300">
              Select specific tables
            </span>
          </label>

          {pickTables && (
            <div className="flex flex-col gap-2">
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
              <div className="h-[280px] overflow-y-auto rounded border border-zinc-800 bg-zinc-950">
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
      </div>
    </div>
  );
}
