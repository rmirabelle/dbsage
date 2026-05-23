import type { ColumnDef, ColumnDraft } from "../types";

interface ParsedType {
  type: string;
  length: string;
  decimals: string;
  unsigned: boolean;
  zerofill: boolean;
}

/** Split a stored COLUMN_TYPE (e.g. "int(11) unsigned", "decimal(10,2)",
 * "enum('a','b')") into the editor's fields. */
export function parseColumnType(columnType: string): ParsedType {
  const lower = columnType.toLowerCase();
  const unsigned = /\bunsigned\b/.test(lower);
  const zerofill = /\bzerofill\b/.test(lower);
  const m = columnType.match(/^\s*([A-Za-z]+)\s*(?:\(([^)]*)\))?/);
  const type = m ? m[1].toUpperCase() : columnType.trim().toUpperCase();

  let length = "";
  let decimals = "";
  const inner = m?.[2];
  if (inner !== undefined && inner !== "") {
    if (type === "ENUM" || type === "SET") {
      /* The parens hold the value list, not a length — keep it verbatim. */
      length = inner.trim();
    } else {
      const parts = inner.split(",").map((s) => s.trim());
      length = parts[0] ?? "";
      decimals = parts[1] ?? "";
    }
  }
  return { type, length, decimals, unsigned, zerofill };
}

/** Convert backend column metadata into an editor draft (edit mode seed). */
export function columnDefToDraft(def: ColumnDef): ColumnDraft {
  const p = parseColumnType(def.columnType);
  return {
    id: crypto.randomUUID(),
    name: def.name,
    originalName: def.name,
    type: p.type,
    length: p.length,
    decimals: p.decimals,
    notNull: !def.nullable,
    key: def.key === "PRI",
    comment: def.comment ?? "",
    autoIncrement: /auto_increment/i.test(def.extra ?? ""),
    defaultValue: def.defaultValue ?? "",
    unsigned: p.unsigned,
    zerofill: p.zerofill,
  };
}

function quoteString(s: string): string {
  return `'${s.replace(/\\/g, "\\\\").replace(/'/g, "\\'")}'`;
}

/** Render a DEFAULT value: pass through numbers, NULL, booleans, and common
 * functions verbatim; quote everything else as a string literal. */
function defaultLiteral(value: string): string {
  const v = value.trim();
  const upper = v.toUpperCase();
  if (
    upper === "NULL" ||
    upper === "TRUE" ||
    upper === "FALSE" ||
    upper === "CURRENT_TIMESTAMP" ||
    upper === "CURRENT_TIMESTAMP()" ||
    upper === "NOW()" ||
    /^-?\d+(\.\d+)?$/.test(v)
  ) {
    return v;
  }
  return quoteString(v);
}

/** The type + modifiers portion of a column definition (no name, no key). */
export function columnSpec(col: ColumnDraft): string {
  let typePart = col.type;
  const len = col.length.trim();
  const dec = col.decimals.trim();
  if (len && dec) typePart += `(${len}, ${dec})`;
  else if (len) typePart += `(${len})`;
  if (col.unsigned) typePart += " UNSIGNED";
  if (col.zerofill) typePart += " ZEROFILL";

  let def = typePart;
  if (col.notNull) def += " NOT NULL";
  if (col.defaultValue.trim()) def += ` DEFAULT ${defaultLiteral(col.defaultValue)}`;
  if (col.autoIncrement) def += " AUTO_INCREMENT";
  if (col.comment.trim()) def += ` COMMENT ${quoteString(col.comment.trim())}`;
  return def;
}

const id = (name: string) => `\`${name.replace(/`/g, "``")}\``;

export function buildCreateTableSql(
  tableName: string,
  columns: ColumnDraft[]
): string {
  const defs: string[] = [];
  for (const col of columns) {
    const name = col.name.trim();
    if (!name) continue;
    defs.push(`  ${id(name)} ${columnSpec(col)}`);
  }
  const pk = columns
    .filter((c) => c.key && c.name.trim())
    .map((c) => id(c.name.trim()));
  if (pk.length > 0) defs.push(`  PRIMARY KEY (${pk.join(", ")})`);

  const body = defs.length > 0 ? defs.join(",\n") : "  /* no columns yet */";
  return `CREATE TABLE ${id(tableName)} (\n${body}\n);`;
}

/** Diff the original (loaded) columns against the live edits into an ALTER TABLE
 * statement: DROP/ADD/CHANGE columns, primary-key changes, and a table rename. */
export function buildAlterTableSql(
  originalName: string,
  originalColumns: ColumnDraft[],
  tableName: string,
  currentColumns: ColumnDraft[],
  originalAutoIncrement = "",
  autoIncrement = ""
): string {
  const clauses: string[] = [];
  const origByName = new Map(
    originalColumns.map((c) => [c.originalName ?? c.name, c])
  );
  const keptOriginalNames = new Set(
    currentColumns
      .filter((c) => c.originalName)
      .map((c) => c.originalName as string)
  );

  /* Dropped columns: in the original, absent from the current set. */
  for (const oc of originalColumns) {
    const on = oc.originalName ?? oc.name;
    if (!keptOriginalNames.has(on)) clauses.push(`  DROP COLUMN ${id(on)}`);
  }

  /* Added + changed columns, in display order. */
  for (const col of currentColumns) {
    const name = col.name.trim();
    if (!name) continue;
    if (!col.originalName) {
      clauses.push(`  ADD COLUMN ${id(name)} ${columnSpec(col)}`);
      continue;
    }
    const orig = origByName.get(col.originalName);
    const changed =
      !orig ||
      col.originalName !== name ||
      columnSpec(orig) !== columnSpec(col);
    if (changed) {
      clauses.push(
        `  CHANGE COLUMN ${id(col.originalName)} ${id(name)} ${columnSpec(col)}`
      );
    }
  }

  /* Primary key diff (compare ordered column lists). */
  const origPk = originalColumns
    .filter((c) => c.key)
    .map((c) => c.originalName ?? c.name);
  const curPk = currentColumns
    .filter((c) => c.key && c.name.trim())
    .map((c) => c.name.trim());
  const pkChanged =
    origPk.length !== curPk.length || origPk.some((v, i) => v !== curPk[i]);
  if (pkChanged) {
    if (origPk.length > 0) clauses.push("  DROP PRIMARY KEY");
    if (curPk.length > 0)
      clauses.push(`  ADD PRIMARY KEY (${curPk.map(id).join(", ")})`);
  }

  /* AUTO_INCREMENT counter. */
  const ai = autoIncrement.trim();
  if (ai !== originalAutoIncrement.trim() && /^\d+$/.test(ai)) {
    clauses.push(`  AUTO_INCREMENT = ${ai}`);
  }

  /* Table rename. */
  const newName = tableName.trim();
  if (newName && newName !== originalName) {
    clauses.push(`  RENAME TO ${id(newName)}`);
  }

  if (clauses.length === 0) {
    return `-- No changes to apply to ${id(originalName)}.`;
  }
  return `ALTER TABLE ${id(originalName)}\n${clauses.join(",\n")};`;
}

/** Names of columns that the current edits will drop (for a data-loss warning). */
export function droppedColumnNames(
  originalColumns: ColumnDraft[],
  currentColumns: ColumnDraft[]
): string[] {
  const kept = new Set(
    currentColumns
      .filter((c) => c.originalName)
      .map((c) => c.originalName as string)
  );
  return originalColumns
    .map((c) => c.originalName ?? c.name)
    .filter((n) => !kept.has(n));
}
