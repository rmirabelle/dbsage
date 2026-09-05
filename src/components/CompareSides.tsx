import { useEffect, useState, type ReactNode } from "react";
import { ArrowsLeftRight } from "@phosphor-icons/react";
import clsx from "clsx";
import { useStore } from "../state/store";
import { ipc } from "../ipc";
import { StyledSelect } from "./StyledSelect";

/**
 * Two cards — source on the left, target on the right — with a double arrow
 * between them, so it is obvious which two things a compare dialog will
 * compare. Each card holds its own stacked picker controls.
 */
export function CompareSides({
  source,
  target,
}: {
  source: ReactNode;
  target: ReactNode;
}) {
  return (
    <div data-el="compare-sides" className="flex items-stretch gap-2">
      <SideCard label="Source">{source}</SideCard>
      <div className="flex shrink-0 items-center text-lime-400">
        <ArrowsLeftRight size={26} weight="bold" />
      </div>
      <SideCard label="Target">{target}</SideCard>
    </div>
  );
}

function SideCard({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div
      data-el={`compare-side-${label.toLowerCase()}`}
      className="flex min-w-0 flex-1 flex-col gap-1.5 rounded-md border border-zinc-800 bg-zinc-950 px-3 py-2"
    >
      <div className="text-[10px] font-semibold uppercase tracking-[0.13em] text-zinc-500">
        {label}
      </div>
      {children}
    </div>
  );
}

/** What one side of a comparison currently points at. `table` is only
 * meaningful for table-level compares. */
export interface CompareSideValue {
  profileId: string;
  database: string;
  table: string;
}

export interface CompareSideState extends CompareSideValue {
  databases: string[];
  tables: string[];
  connecting: boolean;
  connectError: string | null;
  setProfileId: (id: string) => void;
  setDatabase: (db: string) => void;
  setTable: (t: string) => void;
}

/**
 * State for one side of a compare dialog: a connection (connected on demand),
 * the databases it holds, the chosen database, and — when `withTables` — the
 * chosen table. `initial` is applied on the first load only; later connection
 * changes clear the database so the user picks one. `preferredTable` is
 * selected automatically when the chosen database holds it (so the target
 * side lands on the source's table name).
 */
export function useCompareSide(
  initial: { profileId: string; database: string; table?: string },
  withTables: boolean,
  preferredTable?: string
): CompareSideState {
  const connectProfile = useStore((s) => s.connectProfile);
  const [profileId, setProfileId] = useState(initial.profileId);
  const [databases, setDatabases] = useState<string[]>([]);
  const [database, setDatabase] = useState("");
  const [tables, setTables] = useState<string[]>([]);
  const [table, setTable] = useState("");
  const [connecting, setConnecting] = useState(false);
  const [connectError, setConnectError] = useState<string | null>(null);
  const [firstLoad, setFirstLoad] = useState(true);

  useEffect(() => {
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
        setDatabase(firstLoad && dbs.includes(initial.database) ? initial.database : "");
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

  useEffect(() => {
    if (!withTables || !database) {
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
        const want = (firstLoad && initial.table) || preferredTable;
        setTable(want && names.includes(want) ? want : "");
        setFirstLoad(false);
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

  /* Without tables, the first load ends once the databases have arrived. */
  useEffect(() => {
    if (!withTables && databases.length > 0) setFirstLoad(false);
  }, [withTables, databases]);

  return {
    profileId,
    database,
    table,
    databases,
    tables,
    connecting,
    connectError,
    setProfileId,
    setDatabase,
    setTable,
  };
}

const SELECT_BASE =
  "w-full justify-between bg-zinc-950 border border-zinc-700 rounded px-2 py-1";

/**
 * The stacked selects for one side: connection (green), database (blue), and
 * optionally table (white) — the same color language as a table tab. Each
 * required control carries a red asterisk.
 */
export function SidePicker({
  side,
  dataEl,
  withTables,
}: {
  side: CompareSideState;
  /** Prefix for the selects' data-el attributes, e.g. `compare-source`. */
  dataEl: string;
  withTables?: boolean;
}) {
  const profiles = useStore((s) => s.profiles);
  return (
    <>
      <Row>
        <StyledSelect
          dataEl={`${dataEl}-connection`}
          value={side.profileId}
          options={profiles.map((p) => ({ value: p.id, label: p.name }))}
          onChange={side.setProfileId}
          className={clsx(SELECT_BASE, "font-semibold text-lime-400")}
        />
      </Row>
      <Row>
        <StyledSelect
          dataEl={`${dataEl}-database`}
          placeholder="Choose a database"
          value={side.database}
          options={side.databases.map((d) => ({ value: d, label: d }))}
          onChange={side.setDatabase}
          disabled={!side.databases.length}
          className={clsx(SELECT_BASE, "text-accent-400")}
        />
      </Row>
      {withTables && (
        <Row>
          <StyledSelect
            dataEl={`${dataEl}-table`}
            placeholder="Choose a table"
            value={side.table}
            options={side.tables.map((t) => ({ value: t, label: t }))}
            onChange={side.setTable}
            disabled={!side.tables.length}
            className={clsx(SELECT_BASE, "text-zinc-100")}
          />
        </Row>
      )}
      {side.connecting && (
        <div className="text-[11px] text-zinc-400">Connecting…</div>
      )}
      {side.connectError && (
        <div className="text-[11px] text-rose-400">
          Could not connect: {side.connectError}
        </div>
      )}
    </>
  );
}

function Row({ children }: { children: ReactNode }) {
  return (
    <div className="flex items-center gap-1.5">
      {children}
      <span className="shrink-0 text-rose-400" aria-label="required">
        *
      </span>
    </div>
  );
}

/** True when both sides point at the same thing (nothing to compare). */
export function sameSide(a: CompareSideValue, b: CompareSideValue, withTables: boolean) {
  return (
    a.profileId === b.profileId &&
    a.database === b.database &&
    (!withTables || a.table === b.table)
  );
}
