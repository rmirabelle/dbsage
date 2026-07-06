import { useEffect, useState } from "react";
import { GitDiff, X } from "@phosphor-icons/react";
import { useStore } from "../state/store";
import { ipc } from "../ipc";
import { StyledSelect } from "./StyledSelect";
import type { SchemaDiffSide } from "../types";

/**
 * Picker for the other side of a schema comparison. Seeded with the
 * right-clicked table as the fixed left side; defaults the right side to the
 * first other connected profile that has a same-named database + table (the
 * overwhelmingly common dev-vs-prod case), falling back to the source
 * connection for a same-connection compare.
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
  const connectProfile = useStore((s) => s.connectProfile);

  const [profileId, setProfileId] = useState<string | null>(null);
  const [databases, setDatabases] = useState<string[]>([]);
  const [database, setDatabase] = useState("");
  const [tables, setTables] = useState<string[]>([]);
  const [table, setTable] = useState("");
  const [connecting, setConnecting] = useState(false);
  const [connectError, setConnectError] = useState<string | null>(null);

  /** Find the default target: first other *connected* profile holding the
   * same-named database + table; otherwise the first other profile of any
   * state (it gets connected on demand below). */
  useEffect(() => {
    let cancelled = false;
    (async () => {
      const others = profiles.filter((p) => p.id !== left.profileId);
      const conns = useStore.getState().connections;
      for (const p of others.filter((p) => conns[p.id]?.connected)) {
        try {
          const dbs = await ipc.listDatabases(p.id);
          if (!dbs.includes(left.database)) continue;
          const tbls = await ipc.listTables(p.id, left.database);
          if (!tbls.some((t) => t.name === left.table)) continue;
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

  /** Load tables whenever the target database changes; prefer the left
   * side's table name when it exists there. */
  useEffect(() => {
    if (!profileId || !database) {
      setTables([]);
      setTable("");
      return;
    }
    let cancelled = false;
    ipc
      .listTables(profileId, database)
      .then((infos) => {
        if (cancelled) return;
        const names = infos.map((t) => t.name);
        setTables(names);
        setTable(names.includes(left.table) ? left.table : names[0] ?? "");
      })
      .catch(() => {
        if (!cancelled) {
          setTables([]);
          setTable("");
        }
      });
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [profileId, database]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  const sameAsLeft =
    profileId === left.profileId &&
    database === left.database &&
    table === left.table;
  const ready =
    !!profileId && !!database && !!table && !sameAsLeft && !connecting;

  const compare = () => {
    if (!ready || !profileId) return;
    const profile = profiles.find((p) => p.id === profileId);
    openSchemaDiff(left, {
      profileId,
      profileName: profile?.name ?? profileId,
      database,
      table,
    });
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
        className="relative w-[440px] rounded-lg border border-zinc-800 bg-zinc-900 shadow-2xl"
      >
        <div className="flex items-center gap-2.5 px-4 py-3 border-b border-zinc-800">
          <GitDiff size={18} className="text-amber-400" />
          <div className="min-w-0">
            <div className="text-[14px] font-semibold text-zinc-100">
              Compare Schema
            </div>
            <div className="truncate text-[12px] text-zinc-400">
              {left.profileName} • {left.database}.{left.table}
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
              dataEl="compare-connection"
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
              dataEl="compare-database"
              value={database}
              options={databases.map((d) => ({ value: d, label: d }))}
              onChange={setDatabase}
              disabled={!databases.length}
              className={selectClass}
            />
          </label>
          <label className="flex items-center gap-3">
            <span className="w-24 shrink-0 text-[12px] text-zinc-400">
              Table
            </span>
            <StyledSelect
              dataEl="compare-table"
              value={table}
              options={tables.map((t) => ({ value: t, label: t }))}
              onChange={setTable}
              disabled={!tables.length}
              className={selectClass}
            />
          </label>
          {sameAsLeft && (
            <div className="text-[12px] text-amber-400">
              Pick a different table — this is the same table as the left side.
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
      </div>
    </div>
  );
}
