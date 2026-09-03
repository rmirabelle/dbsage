import { save } from "@tauri-apps/plugin-dialog";
import { ipc } from "../ipc";
import { notifyError, notifySuccess } from "../state/notify";
import {
  columnSummary,
  computeDatabaseDiff,
  computeSchemaDiff,
  indexSummary,
  summarizeTableDiff,
  tableSummary,
} from "./schemaDiff";
import type { FieldChange, NamedChange, SchemaDiff } from "./schemaDiff";
import type {
  DatabaseDiffSide,
  SchemaDiffSide,
  TableSchemaEntry,
} from "../types";

/**
 * Plain-English text export of the schema comparison tabs. The report reads
 * source → destination, mirroring the on-screen cards: "added" means present
 * only on the destination (right), "removed" only on the source (left).
 */

function timestamp(): string {
  const d = new Date();
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(
    d.getHours()
  )}:${pad(d.getMinutes())}`;
}

function plural(n: number, word: string): string {
  return `${n} ${word}${n === 1 ? "" : "s"}`;
}

function tableLabel(side: SchemaDiffSide): string {
  return `${side.database}.${side.table} on ${side.profileName}`;
}

function dbLabel(side: DatabaseDiffSide): string {
  return `${side.database} on ${side.profileName}`;
}

/** "Type: varchar(100) in the source, varchar(255) in the destination." */
function changeLine(ch: FieldChange): string {
  return `${ch.field}: ${ch.left} in the source, ${ch.right} in the destination.`;
}

function namedChangeLines(kind: string, items: NamedChange[]): string[] {
  const out: string[] = [];
  for (const it of items) {
    out.push(`  ${kind} '${it.name}' differs:`);
    for (const ch of it.changes) out.push(`    - ${changeLine(ch)}`);
  }
  return out;
}

/** Body lines for one table pair. `indent` prefixes every line so the same
 * renderer serves both the table report and each table inside a database
 * report. */
function tableDiffLines(
  leftLabel: string,
  rightLabel: string,
  diff: SchemaDiff,
  indent = ""
): string[] {
  const lines: string[] = [];
  const section = (title: string, body: string[]) => {
    if (!body.length) return;
    if (lines.length) lines.push("");
    lines.push(title);
    lines.push(...body);
  };

  section(
    `Columns only in the source (${leftLabel}): ${diff.columnsOnlyLeft.length}`,
    diff.columnsOnlyLeft.map((c) => `  - ${c.name}: ${columnSummary(c)}`)
  );
  section(
    `Columns only in the destination (${rightLabel}): ${diff.columnsOnlyRight.length}`,
    diff.columnsOnlyRight.map((c) => `  - ${c.name}: ${columnSummary(c)}`)
  );
  section(
    `Changed columns: ${diff.changedColumns.length}`,
    namedChangeLines("Column", diff.changedColumns)
  );
  section(
    `Indexes only in the source (${leftLabel}): ${diff.indexesOnlyLeft.length}`,
    diff.indexesOnlyLeft.map((i) => `  - ${i.name}: ${indexSummary(i)}`)
  );
  section(
    `Indexes only in the destination (${rightLabel}): ${diff.indexesOnlyRight.length}`,
    diff.indexesOnlyRight.map((i) => `  - ${i.name}: ${indexSummary(i)}`)
  );
  section(
    `Changed indexes: ${diff.changedIndexes.length}`,
    namedChangeLines("Index", diff.changedIndexes)
  );
  section(
    `Table options: ${diff.tableChanges.length}`,
    diff.tableChanges.map((ch) => `  - ${changeLine(ch)}`)
  );
  if (diff.columnOrderDiffers) {
    if (lines.length) lines.push("");
    lines.push("Note: the columns both tables share appear in a different order.");
  }
  return lines.map((l) => (l ? indent + l : l));
}

function header(title: string, source: string, destination: string): string[] {
  return [
    title,
    `Generated: ${timestamp()}`,
    `Source: ${source}`,
    `Destination: ${destination}`,
    "",
  ];
}

export function renderSchemaDiffText(
  left: SchemaDiffSide,
  right: SchemaDiffSide,
  diff: SchemaDiff
): string {
  const l = tableLabel(left);
  const r = tableLabel(right);
  const lines = header(`Table comparison: ${left.table}`, l, r);
  if (diff.identical) {
    lines.push("Result: the two table schemas are identical.");
  } else {
    lines.push(`Summary: ${summarizeTableDiff(diff)}`);
    lines.push("");
    lines.push(...tableDiffLines(l, r, diff));
  }
  return lines.join("\n") + "\n";
}

export function renderDatabaseDiffText(
  left: DatabaseDiffSide,
  right: DatabaseDiffSide,
  leftSchemas: TableSchemaEntry[],
  rightSchemas: TableSchemaEntry[],
  tables: string[] | null
): string {
  const sel = tables ? new Set(tables) : null;
  const scoped = (arr: TableSchemaEntry[]) =>
    sel ? arr.filter((t) => sel.has(t.name)) : arr;
  const ls = scoped(leftSchemas);
  const rs = scoped(rightSchemas);
  const diff = computeDatabaseDiff(ls, rs);
  const l = dbLabel(left);
  const r = dbLabel(right);

  const lines = header(`Database comparison: ${left.database}`, l, r);
  if (tables) lines.splice(4, 0, `Scope: ${plural(tables.length, "selected table")}`);

  if (diff.identical) {
    lines.push(
      diff.identicalTables.length === 0
        ? "Result: both databases have no tables."
        : `Result: the databases are identical. All ${plural(
            diff.identicalTables.length,
            "table"
          )} match on both sides.`
    );
    return lines.join("\n") + "\n";
  }

  const summary: string[] = [];
  if (diff.tablesOnlyRight.length)
    summary.push(`${plural(diff.tablesOnlyRight.length, "table")} added`);
  if (diff.tablesOnlyLeft.length)
    summary.push(`${plural(diff.tablesOnlyLeft.length, "table")} removed`);
  if (diff.changedTables.length)
    summary.push(`${plural(diff.changedTables.length, "table")} changed`);
  if (diff.identicalTables.length)
    summary.push(`${plural(diff.identicalTables.length, "table")} identical`);
  lines.push(`Summary: ${summary.join(", ")}`);

  const section = (title: string, body: string[]) => {
    if (!body.length) return;
    lines.push("", title, ...body);
  };
  section(
    `Tables only in the source (${l}): ${diff.tablesOnlyLeft.length}`,
    diff.tablesOnlyLeft.map((t) => `  - ${t.name}: ${tableSummary(t)}`)
  );
  section(
    `Tables only in the destination (${r}): ${diff.tablesOnlyRight.length}`,
    diff.tablesOnlyRight.map((t) => `  - ${t.name}: ${tableSummary(t)}`)
  );

  if (diff.changedTables.length) {
    const rightMap = new Map(rs.map((t) => [t.name, t]));
    const leftMap = new Map(ls.map((t) => [t.name, t]));
    lines.push("", `Tables with schema differences: ${diff.changedTables.length}`);
    for (const t of diff.changedTables) {
      const d = computeSchemaDiff(leftMap.get(t.name)!, rightMap.get(t.name)!);
      lines.push("", `${t.name}: ${t.summary}`);
      lines.push(...tableDiffLines(l, r, d, "  "));
    }
  }

  section(
    `Identical tables: ${diff.identicalTables.length}`,
    diff.identicalTables.map((n) => `  - ${n}`)
  );
  return lines.join("\n") + "\n";
}

async function saveText(defaultName: string, content: string): Promise<void> {
  const path = await save({
    defaultPath: defaultName,
    filters: [{ name: "Text", extensions: ["txt"] }],
  });
  if (!path) return;
  try {
    await ipc.writeTextFile(path, content);
    notifySuccess(`Saved comparison to ${path}`);
  } catch (e) {
    notifyError(`Export failed: ${e}`);
  }
}

const safe = (s: string) => s.replace(/[^\w.-]+/g, "_");
const today = () => new Date().toISOString().slice(0, 10);

export async function exportSchemaDiffText(
  left: SchemaDiffSide,
  right: SchemaDiffSide,
  diff: SchemaDiff | null
): Promise<void> {
  if (!diff) return;
  await saveText(
    `${safe(left.table)}-schema-diff-${today()}.txt`,
    renderSchemaDiffText(left, right, diff)
  );
}

export async function exportDatabaseDiffText(
  left: DatabaseDiffSide,
  right: DatabaseDiffSide,
  leftSchemas: TableSchemaEntry[] | null,
  rightSchemas: TableSchemaEntry[] | null,
  tables: string[] | null
): Promise<void> {
  if (!leftSchemas || !rightSchemas) return;
  await saveText(
    `${safe(left.database)}-database-diff-${today()}.txt`,
    renderDatabaseDiffText(left, right, leftSchemas, rightSchemas, tables)
  );
}
