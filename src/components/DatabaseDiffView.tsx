import { useMemo, useState } from "react";
import {
  ArrowsClockwise,
  ArrowsLeftRight,
  CaretDown,
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
import {
  computeDatabaseDiff,
  computeSchemaDiff,
  tableSummary,
} from "../lib/schemaDiff";
import { exportDatabaseDiffText } from "../lib/schemaDiffText";
import {
  DiffSection,
  OnlySection,
  SchemaDiffReport,
  useSectionFold,
} from "./SchemaDiffView";
import type {
  DatabaseDiffSide,
  DatabaseDiffTab,
  SchemaDiffSide,
  TableSchemaEntry,
} from "../types";

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

  /* Changed tables expand in place to show their own column/index diff,
     computed from the schemas already fetched for the database compare. */
  const [expanded, setExpanded] = useState<Set<string>>(() => new Set());
  const toggleTable = (name: string) =>
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(name)) next.delete(name);
      else next.add(name);
      return next;
    });
  const tableDiff = (name: string) => {
    const l = tab.leftSchemas?.find((t) => t.name === name);
    const r = tab.rightSchemas?.find((t) => t.name === name);
    return l && r ? computeSchemaDiff(l, r) : null;
  };

  const fold = useSectionFold(tab.id, tab.folded);
  /** Section folds inside one table's inline diff, keyed by table name so
   * each table folds independently. */
  const tableFold = (name: string) => (key: string) => fold(`${name}:${key}`);

  return (
    <div className="schema-diff flex h-full min-h-0 flex-col">
      <div className="dbs-toolbar sd-header flex items-center gap-1 pl-1 pr-3 py-1.5 border-b border-zinc-800">
        <SideChip side={left} />
        <button
          className="sd-swap"
          onClick={() => swapDatabaseDiff(tab.id)}
          {...helpHandlers("Swap source and destination")}
        >
          <ArrowsLeftRight size={26} weight="bold" />
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
                {diff.changedTables.map((t) => {
                  const open = expanded.has(t.name);
                  const inline = open ? tableDiff(t.name) : null;
                  const leftT: SchemaDiffSide = { ...left, table: t.name };
                  const rightT: SchemaDiffSide = { ...right, table: t.name };
                  return (
                    <div
                      key={t.name}
                      className={open ? "sd-table-row sd-expanded" : "sd-table-row"}
                    >
                      <button
                        className="sd-item sd-item-btn"
                        onClick={() => toggleTable(t.name)}
                        {...helpHandlers(
                          open
                            ? "Collapse this table's comparison"
                            : "Expand this table's comparison here"
                        )}
                      >
                        {open ? (
                          <CaretDown size={13} className="sd-fold" />
                        ) : (
                          <CaretRight size={13} className="sd-fold" />
                        )}
                        <span className="sd-name">{t.name}</span>
                        <span className="sd-summary">{t.summary}</span>
                      </button>
                      {inline && (
                        <SchemaDiffReport
                          nested
                          diff={inline}
                          left={leftT}
                          right={rightT}
                          fold={tableFold(t.name)}
                        />
                      )}
                    </div>
                  );
                })}
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
