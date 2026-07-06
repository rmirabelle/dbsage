import { useMemo, useState } from "react";
import {
  ArrowCounterClockwise,
  ArrowsClockwise,
  ArrowsLeftRight,
  ArrowRight,
  CaretDown,
  CaretRight,
  CheckCircle,
  CircleNotch,
  Columns as ColumnsIcon,
  Database,
  ListNumbers,
  PlugsConnected,
  Table as TableIcon,
  WarningCircle,
} from "@phosphor-icons/react";
import { useStore } from "../state/store";
import { helpHandlers } from "../state/help";
import { computeSchemaDiff, fmtIndexColumns } from "../lib/schemaDiff";
import { SyncSchemaDialog, UndoSyncDialog } from "./SyncSchemaDialog";
import type { NamedChange } from "../lib/schemaDiff";
import type { ColumnDef, IndexDef, SchemaDiffSide, SchemaDiffTab } from "../types";

/** "connection • database.table" label for one side of the comparison. */
function sideLabel(side: SchemaDiffSide): string {
  return `${side.profileName} • ${side.database}.${side.table}`;
}

/** Toolbar chip for one side — icon + name per segment, in the app's identity
 * colors: lime connection, cyan database, table-green table. */
function SideChip({ side }: { side: SchemaDiffSide }) {
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
      <span className="sd-side-table">
        <TableIcon size={14} />
        {side.table}
      </span>
    </span>
  );
}

/** One-line summary of a column, shown in the only-in-X sections: its type
 * (COLUMN_TYPE carries the length, e.g. "varchar(255)") plus the comment. */
function columnSummary(c: ColumnDef): string {
  return c.comment ? `${c.columnType} — '${c.comment}'` : c.columnType;
}

/** One-line summary of an index, e.g. "UNIQUE (email)". */
function indexSummary(i: IndexDef): string {
  const kind = i.indexType === "NORMAL" ? "INDEX" : i.indexType;
  const method = i.method === "HASH" ? " HASH" : "";
  return `${kind} ${fmtIndexColumns(i)}${method}`;
}

export function SchemaDiffView({ tab }: { tab: SchemaDiffTab }) {
  const refreshSchemaDiff = useStore((s) => s.refreshSchemaDiff);
  const swapSchemaDiff = useStore((s) => s.swapSchemaDiff);

  const left: SchemaDiffSide = {
    profileId: tab.profileId,
    profileName: tab.profileName,
    database: tab.database,
    table: tab.table,
  };
  const right = tab.right;

  const diff = useMemo(
    () =>
      tab.leftSchema && tab.rightSchema
        ? computeSchemaDiff(tab.leftSchema, tab.rightSchema)
        : null,
    [tab.leftSchema, tab.rightSchema]
  );

  const fold = useSectionFold(tab.id, tab.folded);
  const [syncOpen, setSyncOpen] = useState(false);
  const [undoOpen, setUndoOpen] = useState(false);

  return (
    <div className="schema-diff flex h-full min-h-0 flex-col">
      <div className="dbs-toolbar sd-header flex items-center gap-1 pl-1 pr-3 py-1.5 border-b border-zinc-800">
        <SideChip side={left} />
        <button
          className="sd-swap"
          onClick={() => swapSchemaDiff(tab.id)}
          {...helpHandlers("Swap source and destination")}
        >
          <ArrowsLeftRight size={14} />
        </button>
        <SideChip side={right} />
        <div className="ml-auto flex items-center gap-1.5">
          {tab.undoSync && (
            <button
              className="sd-undo"
              onClick={() => setUndoOpen(true)}
              {...helpHandlers(
                "Restore the destination structure from before the last sync — structure only, dropped data is not recovered"
              )}
            >
              <ArrowCounterClockwise size={14} />
              Undo Sync
            </button>
          )}
          <button
            className="sd-sync"
            onClick={() => setSyncOpen(true)}
            disabled={!diff || diff.identical}
            {...helpHandlers(
              "Apply the source (left) schema to the destination (right) — pick the changes, preview the SQL, one atomic ALTER"
            )}
          >
            Sync
            <ArrowRight size={14} />
          </button>
          <button
            className="sd-refresh"
            onClick={() => void refreshSchemaDiff(tab.id)}
            disabled={tab.loading}
            {...helpHandlers("Re-read both schemas and refresh the comparison")}
          >
            {tab.loading ? (
              <CircleNotch size={14} className="animate-spin" />
            ) : (
              <ArrowsClockwise size={14} />
            )}
            Refresh
          </button>
        </div>
      </div>

      {syncOpen && (
        <SyncSchemaDialog tab={tab} onClose={() => setSyncOpen(false)} />
      )}
      {undoOpen && (
        <UndoSyncDialog tab={tab} onClose={() => setUndoOpen(false)} />
      )}

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
            <div className="sd-state-title">Schemas are identical</div>
            <div className="sd-state-sub">
              {tab.leftSchema!.columns.length} columns,{" "}
              {tab.leftSchema!.indexes.length} indexes, the primary key and the
              table options all match.
            </div>
          </div>
        ) : (
          <div className="sd-report">
            <OnlySection
              title={`Columns only in ${sideLabel(left)}`}
              tone="removed"
              icon={<ColumnsIcon size={15} />}
              items={diff.columnsOnlyLeft.map((c) => ({
                name: c.name,
                summary: columnSummary(c),
              }))}
              {...fold("cols-left")}
            />
            <OnlySection
              title={`Columns only in ${sideLabel(right)}`}
              tone="added"
              icon={<ColumnsIcon size={15} />}
              items={diff.columnsOnlyRight.map((c) => ({
                name: c.name,
                summary: columnSummary(c),
              }))}
              {...fold("cols-right")}
            />
            <ChangedSection
              title="Changed columns"
              nameHeader="Column"
              icon={<ColumnsIcon size={15} />}
              items={diff.changedColumns}
              {...fold("cols-changed")}
            />
            <OnlySection
              title={`Indexes only in ${sideLabel(left)}`}
              tone="removed"
              icon={<ListNumbers size={15} />}
              items={diff.indexesOnlyLeft.map((i) => ({
                name: i.name,
                summary: indexSummary(i),
              }))}
              {...fold("ix-left")}
            />
            <OnlySection
              title={`Indexes only in ${sideLabel(right)}`}
              tone="added"
              icon={<ListNumbers size={15} />}
              items={diff.indexesOnlyRight.map((i) => ({
                name: i.name,
                summary: indexSummary(i),
              }))}
              {...fold("ix-right")}
            />
            <ChangedSection
              title="Changed indexes"
              nameHeader="Index"
              icon={<ListNumbers size={15} />}
              items={diff.changedIndexes}
              {...fold("ix-changed")}
            />
            {diff.tableChanges.length > 0 && (
              <DiffSection
                title="Table options"
                tone="changed"
                icon={<TableIcon size={15} />}
                count={diff.tableChanges.length}
                {...fold("table-options")}
              >
                <div className="sd-item">
                  {diff.tableChanges.map((ch) => (
                    <div className="sd-change" key={ch.field}>
                      <span className="sd-field">{ch.field}</span>
                      <span className="sd-old">{ch.left}</span>
                      <ArrowRight size={12} className="sd-arrow" />
                      <span className="sd-new">{ch.right}</span>
                    </div>
                  ))}
                </div>
              </DiffSection>
            )}
            {diff.columnOrderDiffers && (
              <div className="sd-note">
                <WarningCircle size={14} />
                The columns both tables share appear in a different order.
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

/** Fold state + toggle for a report section, persisted on the tab so it
 * survives tab switches. Sections default to open. */
export function useSectionFold(
  tabId: string,
  folded: Record<string, boolean> | undefined
) {
  const toggleDiffSection = useStore((s) => s.toggleDiffSection);
  return (key: string) => ({
    open: !folded?.[key],
    onToggle: () => toggleDiffSection(tabId, key),
  });
}

/** Collapsible report card: the header row toggles the body. Shared by all
 * sections in both diff views. */
export function DiffSection({
  title,
  tone,
  icon,
  count,
  open,
  onToggle,
  children,
}: {
  title: string;
  tone: "added" | "removed" | "changed";
  icon: React.ReactNode;
  count: number;
  open: boolean;
  onToggle: () => void;
  children: React.ReactNode;
}) {
  return (
    <section
      className={`sd-section sd-${tone}${open ? "" : " sd-collapsed"}`}
    >
      <button
        className="sd-section-title"
        onClick={onToggle}
        title={open ? "Collapse" : "Expand"}
      >
        {open ? (
          <CaretDown size={12} className="sd-fold" />
        ) : (
          <CaretRight size={12} className="sd-fold" />
        )}
        {icon}
        {title}
        <span className="sd-count">{count}</span>
      </button>
      {open && children}
    </section>
  );
}

/** Section listing columns/indexes/tables present on only one side. Shared
 * with DatabaseDiffView. */
export function OnlySection({
  title,
  tone,
  icon,
  items,
  open,
  onToggle,
}: {
  title: string;
  tone: "added" | "removed";
  icon: React.ReactNode;
  items: { name: string; summary: string }[];
  open: boolean;
  onToggle: () => void;
}) {
  if (!items.length) return null;
  return (
    <DiffSection
      title={title}
      tone={tone}
      icon={icon}
      count={items.length}
      open={open}
      onToggle={onToggle}
    >
      {items.map((it) => (
        <div className="sd-item" key={it.name}>
          <span className="sd-name">{it.name}</span>
          <span className="sd-summary">{it.summary}</span>
        </div>
      ))}
    </DiffSection>
  );
}

/** Section listing same-named columns/indexes whose definitions differ,
 * rendered as a table: the name cell spans that item's attribute rows. */
function ChangedSection({
  title,
  nameHeader,
  icon,
  items,
  open,
  onToggle,
}: {
  title: string;
  /** Header for the first column, e.g. "Column" or "Index". */
  nameHeader: string;
  icon: React.ReactNode;
  items: NamedChange[];
  open: boolean;
  onToggle: () => void;
}) {
  if (!items.length) return null;
  return (
    <DiffSection
      title={title}
      tone="changed"
      icon={icon}
      count={items.length}
      open={open}
      onToggle={onToggle}
    >
      <table className="sd-table">
        <thead>
          <tr>
            <th>{nameHeader}</th>
            <th>Attribute</th>
            <th>Source</th>
            <th>Destination</th>
          </tr>
        </thead>
        <tbody>
          {items.map((it) =>
            it.changes.map((ch, i) => (
              <tr
                key={`${it.name}::${ch.field}`}
                className={i === 0 ? "sd-row-group" : undefined}
              >
                {i === 0 && (
                  <td className="sd-cell-name" rowSpan={it.changes.length}>
                    {it.name}
                  </td>
                )}
                <td className="sd-cell-field">{ch.field}</td>
                <td className="sd-cell-old">{ch.left}</td>
                <td className="sd-cell-new">{ch.right}</td>
              </tr>
            ))
          )}
        </tbody>
      </table>
    </DiffSection>
  );
}
