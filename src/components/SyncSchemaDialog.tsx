import { useMemo, useState } from "react";
import { Warning, X } from "@phosphor-icons/react";
import { useStore } from "../state/store";
import { buildAlterSql, buildSyncPlan } from "../lib/schemaSync";
import type { SyncItem } from "../lib/schemaSync";
import type { SchemaDiffTab } from "../types";

const GROUPS: { key: SyncItem["group"]; title: string }[] = [
  { key: "columns", title: "Columns" },
  { key: "primary-key", title: "Primary key" },
  { key: "indexes", title: "Indexes" },
  { key: "options", title: "Table options" },
];

/** Modal shell shared by the sync and undo dialogs. */
function SyncShell({
  title,
  subtitle,
  onClose,
  children,
  footer,
}: {
  title: string;
  subtitle: React.ReactNode;
  onClose: () => void;
  children: React.ReactNode;
  footer: React.ReactNode;
}) {
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
        className="relative flex max-h-[85vh] w-[640px] flex-col rounded-lg border border-zinc-800 bg-zinc-900 shadow-2xl"
      >
        <div className="flex items-center gap-2.5 px-4 py-3 border-b border-zinc-800">
          <Warning size={18} className="text-orange-400" />
          <div className="min-w-0">
            <div className="text-[14px] font-semibold text-zinc-100">
              {title}
            </div>
            <div className="truncate text-[12px] text-zinc-400">{subtitle}</div>
          </div>
          <button
            className="ml-auto rounded p-1 text-zinc-400 hover:bg-zinc-800 hover:text-zinc-100"
            onClick={onClose}
            title="Close"
          >
            <X size={16} />
          </button>
        </div>
        <div className="flex min-h-0 flex-1 flex-col gap-3 overflow-y-auto px-4 py-4">
          {children}
        </div>
        <div className="flex items-center gap-2 px-4 py-3 border-t border-zinc-800">
          {footer}
        </div>
      </div>
    </div>
  );
}

function SqlPreview({ sql }: { sql: string }) {
  return (
    <pre
      className="max-h-[220px] overflow-auto rounded border border-zinc-800 bg-zinc-950 px-3 py-2 text-[11.5px] leading-relaxed text-zinc-300 whitespace-pre"
      style={{ fontFamily: "var(--font-mono)" }}
    >
      {sql}
    </pre>
  );
}

/** Cherry-pick + confirm dialog for syncing the left table's schema onto the
 * right one. Emits ONE combined ALTER TABLE so MySQL applies it atomically. */
export function SyncSchemaDialog({
  tab,
  onClose,
}: {
  tab: SchemaDiffTab;
  onClose: () => void;
}) {
  const executeSchemaSync = useStore((s) => s.executeSchemaSync);
  const [busy, setBusy] = useState(false);

  const plan = useMemo(
    () =>
      tab.leftSchema && tab.rightSchema
        ? buildSyncPlan(tab.leftSchema, tab.rightSchema)
        : [],
    [tab.leftSchema, tab.rightSchema]
  );
  const [checked, setChecked] = useState<Set<string>>(
    () => new Set(plan.map((i) => i.key))
  );

  const active = plan.filter((i) => checked.has(i.key));
  const destructiveCount = active.filter((i) => i.destructive).length;
  const sql = useMemo(
    () =>
      active.length
        ? buildAlterSql(tab.right.table, active.flatMap((i) => i.clauses))
        : "",
    [active, tab.right.table]
  );

  const toggle = (key: string) =>
    setChecked((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });

  const execute = async () => {
    if (!active.length || busy) return;
    const undoSql = buildAlterSql(
      tab.right.table,
      active.flatMap((i) => i.undoClauses)
    );
    setBusy(true);
    const ok = await executeSchemaSync(tab.id, sql, undoSql);
    setBusy(false);
    if (ok) onClose();
  };

  return (
    <SyncShell
      title="Synchronize Schema"
      subtitle={
        <>
          {tab.profileName} • {tab.database}.{tab.table}
          {"  →  "}
          {tab.right.profileName} • {tab.right.database}.{tab.right.table}
        </>
      }
      onClose={onClose}
      footer={
        <>
          {destructiveCount > 0 && (
            <span className="flex items-center gap-1.5 text-[12px] text-rose-400">
              <Warning size={14} />
              {destructiveCount} destructive change
              {destructiveCount === 1 ? "" : "s"} — lost column data cannot be
              recovered.
            </span>
          )}
          <button
            className="ml-auto rounded px-3 py-1 text-zinc-300 hover:bg-zinc-800"
            onClick={onClose}
          >
            Cancel
          </button>
          <button
            data-el="sync-execute"
            className="rounded px-3 py-1 font-semibold bg-orange-400 text-orange-950 hover:bg-orange-300 disabled:opacity-50"
            disabled={!active.length || busy}
            onClick={() => void execute()}
          >
            {busy ? "Executing…" : "Execute"}
          </button>
        </>
      }
    >
      <div className="text-[12px] text-zinc-400">
        Apply the source schema to the destination. Uncheck anything you don't
        want to sync — everything runs as a single atomic ALTER TABLE, so a
        failure leaves the destination unchanged.
      </div>

      {GROUPS.map(({ key, title }) => {
        const items = plan.filter((i) => i.group === key);
        if (!items.length) return null;
        return (
          <div key={key} className="flex flex-col">
            <div className="pb-1 text-[11px] font-semibold uppercase tracking-wide text-zinc-500">
              {title}
            </div>
            {items.map((it) => (
              <label
                key={it.key}
                className="flex cursor-pointer items-baseline gap-2.5 rounded px-1.5 py-[3px] hover:bg-zinc-800/50"
              >
                <input
                  type="checkbox"
                  className="dbs-check translate-y-[2px]"
                  checked={checked.has(it.key)}
                  onChange={() => toggle(it.key)}
                />
                <span
                  className={`flex items-center gap-1.5 whitespace-nowrap text-[12.5px] ${
                    it.destructive ? "text-rose-400" : "text-zinc-200"
                  }`}
                >
                  {it.destructive && <Warning size={13} />}
                  {it.label}
                </span>
                <span
                  className="min-w-0 truncate text-[11.5px] text-zinc-500"
                  style={{ fontFamily: "var(--font-mono)" }}
                  title={it.detail}
                >
                  {it.detail}
                </span>
              </label>
            ))}
          </div>
        );
      })}

      {active.length > 0 && (
        <div className="flex flex-col gap-1">
          <div className="text-[11px] font-semibold uppercase tracking-wide text-zinc-500">
            SQL
          </div>
          <SqlPreview sql={sql} />
        </div>
      )}
    </SyncShell>
  );
}

/** Confirm dialog for the one-click undo: shows the stored reverse ALTER. */
export function UndoSyncDialog({
  tab,
  onClose,
}: {
  tab: SchemaDiffTab;
  onClose: () => void;
}) {
  const undoSchemaSync = useStore((s) => s.undoSchemaSync);
  const [busy, setBusy] = useState(false);
  if (!tab.undoSync) return null;

  /* The undo is pinned to a profile+database; the user may have swapped sides
     since the sync, so resolve which side of the tab it points at. */
  const target =
    tab.undoSync.profileId === tab.profileId &&
    tab.undoSync.database === tab.database
      ? { name: tab.profileName, db: tab.database, table: tab.table }
      : {
          name: tab.right.profileName,
          db: tab.right.database,
          table: tab.right.table,
        };

  const execute = async () => {
    if (busy) return;
    setBusy(true);
    const ok = await undoSchemaSync(tab.id);
    setBusy(false);
    if (ok) onClose();
  };

  return (
    <SyncShell
      title="Undo Schema Sync"
      subtitle={
        <>
          Restores the previous structure on {target.name} • {target.db}.
          {target.table}
        </>
      }
      onClose={onClose}
      footer={
        <>
          <button
            className="ml-auto rounded px-3 py-1 text-zinc-300 hover:bg-zinc-800"
            onClick={onClose}
          >
            Cancel
          </button>
          <button
            data-el="undo-sync-execute"
            className="rounded px-3 py-1 font-semibold bg-amber-400 text-amber-950 hover:bg-amber-300 disabled:opacity-50"
            disabled={busy}
            onClick={() => void execute()}
          >
            {busy ? "Executing…" : "Undo Sync"}
          </button>
        </>
      }
    >
      <div className="text-[12px] text-zinc-400">
        This restores the destination's structure from before the sync. Data in
        columns the sync dropped or narrowed is <em>not</em> recovered — a
        re-added column comes back empty.
      </div>
      <SqlPreview sql={tab.undoSync.sql} />
    </SyncShell>
  );
}
