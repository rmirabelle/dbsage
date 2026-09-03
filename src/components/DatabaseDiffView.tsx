import { useMemo } from "react";
import {
  ArrowsClockwise,
  ArrowsLeftRight,
  CaretRight,
  CheckCircle,
  CircleNotch,
  Database,
  Export,
  PlugsConnected,
  Table as TableIcon,
  WarningCircle,
} from "@phosphor-icons/react";
import { useStore } from "../state/store";
import { helpHandlers } from "../state/help";
import { computeDatabaseDiff, tableSummary } from "../lib/schemaDiff";
import { exportDatabaseDiffText } from "../lib/schemaDiffText";
import { DiffSection, OnlySection, useSectionFold } from "./SchemaDiffView";
import type { DatabaseDiffSide, DatabaseDiffTab, TableSchemaEntry } from "../types";

/** "connection • database" label for one side of the comparison. */
function sideLabel(side: DatabaseDiffSide): string {
  return `${side.profileName} • ${side.database}`;
}

/** Toolbar chip for one side — icon + name per segment, in the app's identity
 * colors: lime connection, cyan database. */
function SideChip({ side }: { side: DatabaseDiffSide }) {
  return (
    <span className="sd-side">
      <span className="sd-side-conn">
        <PlugsConnected size={14} weight="fill" />
        {side.profileName}
      </span>
      <span className="sd-side-db">
        <Database size={14} />
        {side.database}
      </span>
    </span>
  );
}

export function DatabaseDiffView({ tab }: { tab: DatabaseDiffTab }) {
  const refreshDatabaseDiff = useStore((s) => s.refreshDatabaseDiff);
  const swapDatabaseDiff = useStore((s) => s.swapDatabaseDiff);
  const openSchemaDiff = useStore((s) => s.openSchemaDiff);

  const left: DatabaseDiffSide = {
    profileId: tab.profileId,
    profileName: tab.profileName,
    database: tab.database,
  };
  const right = tab.right;

  const diff = useMemo(() => {
    if (!tab.leftSchemas || !tab.rightSchemas) return null;
    const sel = tab.tables ? new Set(tab.tables) : null;
    const scoped = (arr: TableSchemaEntry[]) =>
      sel ? arr.filter((t) => sel.has(t.name)) : arr;
    return computeDatabaseDiff(scoped(tab.leftSchemas), scoped(tab.rightSchemas));
  }, [tab.leftSchemas, tab.rightSchemas, tab.tables]);

  /** Drill into one table pair, reusing the per-table Schema Diff tab. */
  const openTableDiff = (table: string) =>
    openSchemaDiff({ ...left, table }, { ...right, table });

  const fold = useSectionFold(tab.id, tab.folded);

  return (
    <div className="schema-diff flex h-full min-h-0 flex-col">
      <div className="dbs-toolbar sd-header flex items-center gap-1 pl-1 pr-3 py-1.5 border-b border-zinc-800">
        <SideChip side={left} />
        <button
          className="sd-swap"
          onClick={() => swapDatabaseDiff(tab.id)}
          {...helpHandlers("Swap source and destination")}
        >
          <ArrowsLeftRight size={14} />
        </button>
        <SideChip side={right} />
        {tab.tables && (
          <span className="text-[11.5px] text-zinc-500">
            {tab.tables.length} selected table{tab.tables.length === 1 ? "" : "s"}
          </span>
        )}
        <button
          className="sd-export ml-auto"
          onClick={() =>
            void exportDatabaseDiffText(left, right, tab.leftSchemas, tab.rightSchemas, tab.tables)
          }
          disabled={!diff}
          {...helpHandlers("Save this comparison as a plain-English text file")}
        >
          <Export size={14} />
          Export
        </button>
        <button
          className="sd-refresh"
          onClick={() => void refreshDatabaseDiff(tab.id)}
          disabled={tab.loading}
          {...helpHandlers("Re-read both databases and refresh the comparison")}
        >
          {tab.loading ? (
            <CircleNotch size={14} className="animate-spin" />
          ) : (
            <ArrowsClockwise size={14} />
          )}
          Refresh
        </button>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto">
        {tab.error ? (
          <div className="sd-state">
            <WarningCircle size={28} className="text-rose-400" />
            <div className="sd-state-title">Comparison failed</div>
            <div className="sd-state-sub">{tab.error}</div>
          </div>
        ) : !diff ? (
          <div className="sd-state">
            <CircleNotch size={28} className="animate-spin text-accent-400" />
            <div className="sd-state-sub">Loading schemas…</div>
          </div>
        ) : diff.identical ? (
          <div className="sd-state">
            <CheckCircle size={32} weight="fill" className="text-emerald-400" />
            <div className="sd-state-title">Databases are identical</div>
            <div className="sd-state-sub">
              {diff.identicalTables.length === 0
                ? "Both databases have no tables."
                : `All ${diff.identicalTables.length} tables match on both sides.`}
            </div>
          </div>
        ) : (
          <div className="sd-report">
            <OnlySection
              title={`Tables only in ${sideLabel(left)}`}
              tone="removed"
              icon={<TableIcon size={15} />}
              items={diff.tablesOnlyLeft.map((t) => ({
                name: t.name,
                summary: tableSummary(t),
              }))}
              {...fold("tables-left")}
            />
            <OnlySection
              title={`Tables only in ${sideLabel(right)}`}
              tone="added"
              icon={<TableIcon size={15} />}
              items={diff.tablesOnlyRight.map((t) => ({
                name: t.name,
                summary: tableSummary(t),
              }))}
              {...fold("tables-right")}
            />
            {diff.changedTables.length > 0 && (
              <DiffSection
                title="Tables with schema differences"
                tone="changed"
                icon={<TableIcon size={15} />}
                count={diff.changedTables.length}
                {...fold("tables-changed")}
              >
                {diff.changedTables.map((t) => (
                  <button
                    key={t.name}
                    className="sd-item sd-item-btn"
                    onClick={() => openTableDiff(t.name)}
                    {...helpHandlers(
                      "Open the table comparison for this table"
                    )}
                  >
                    <span className="sd-name">{t.name}</span>
                    <span className="sd-summary">{t.summary}</span>
                    <CaretRight size={13} className="sd-drill" />
                  </button>
                ))}
              </DiffSection>
            )}
            {diff.identicalTables.length > 0 && (
              <div
                className="sd-note sd-note-muted"
                title={diff.identicalTables.join(", ")}
              >
                <CheckCircle size={14} />
                {diff.identicalTables.length} identical table
                {diff.identicalTables.length === 1 ? "" : "s"}
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
