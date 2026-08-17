import type {
  ColumnDef,
  ColumnDraft,
  ForeignKeyDef,
  ForeignKeyDraft,
  IndexDef,
  IndexDraft,
} from "../types";

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

/** The conventional first column for a brand-new table:
 * `id INT NOT NULL PRIMARY KEY AUTO_INCREMENT`. */
export function defaultIdColumn(): ColumnDraft {
  return {
    id: crypto.randomUUID(),
    name: "id",
    type: "INT",
    length: "",
    decimals: "",
    notNull: true,
    key: true,
    comment: "",
    autoIncrement: true,
    defaultValue: "",
    unsigned: false,
    zerofill: false,
  };
}

/** Convert backend index metadata into an editor draft (edit mode seed). */
export function indexDefToDraft(def: IndexDef): IndexDraft {
  return {
    id: crypto.randomUUID(),
    name: def.name,
    originalName: def.name,
    columns: def.columns.map((c) => ({ ...c })),
    indexType: def.indexType,
    method: def.method,
    comment: def.comment ?? "",
  };
}

/** Convert backend foreign-key metadata into an editor draft (edit mode seed). */
export function foreignKeyDefToDraft(def: ForeignKeyDef): ForeignKeyDraft {
  return {
    ...def,
    id: crypto.randomUUID(),
    originalName: def.name,
    columns: [...def.columns],
    refColumns: [...def.refColumns],
  };
}

/** Deep-copy a foreign-key draft (for the edit-mode baseline snapshot). */
export function cloneForeignKey(fk: ForeignKeyDraft): ForeignKeyDraft {
  return { ...fk, columns: [...fk.columns], refColumns: [...fk.refColumns] };
}

/** Render one foreign-key constraint body (no leading ADD/comma), or null when
 * the key is incomplete (no name, no referenced table, or a column-pair
 * mismatch). The referenced schema is qualified only when it differs from
 * `database`, so same-schema DDL stays portable across renamed databases. */
export function foreignKeyDefinition(
  fk: ForeignKeyDraft,
  database: string
): string | null {
  const name = fk.name.trim();
  const cols = fk.columns.map((c) => c.trim()).filter(Boolean);
  const refCols = fk.refColumns.map((c) => c.trim()).filter(Boolean);
  const refTable = fk.refTable.trim();
  if (!name || !refTable || cols.length === 0 || cols.length !== refCols.length) {
    return null;
  }
  const refSchema = fk.refSchema.trim();
  const target =
    refSchema && refSchema !== database
      ? `${id(refSchema)}.${id(refTable)}`
      : id(refTable);
  return (
    `CONSTRAINT ${id(name)} FOREIGN KEY (${cols.map(id).join(", ")}) ` +
    `REFERENCES ${target} (${refCols.map(id).join(", ")}) ` +
    `ON DELETE ${fk.onDelete} ON UPDATE ${fk.onUpdate}`
  );
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

/** Types whose parenthesized argument is (precision, scale); everything else takes a single length/display-width. */
const SCALE_TYPES = new Set(["DECIMAL", "NUMERIC", "FIXED", "FLOAT", "DOUBLE", "REAL", "DOUBLE PRECISION"]);

/** Whether a column type accepts a second (scale/decimals) argument. */
export const typeSupportsScale = (type: string): boolean =>
  SCALE_TYPES.has(type.trim().toUpperCase());

/** The type + modifiers portion of a column definition (no name, no key). */
export function columnSpec(col: ColumnDraft): string {
  let typePart = col.type;
  const len = col.length.trim();
  const dec = col.decimals.trim();
  if (len && dec && SCALE_TYPES.has(col.type.trim().toUpperCase())) typePart += `(${len}, ${dec})`;
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

/** Shared with the schema-sync builder (src/lib/schemaSync.ts). */
export { id as quoteIdent, quoteString };

/** Render one index definition body (no leading ADD/comma), or null when the
 * index is incomplete (no name or no columns). USING and per-column direction
 * are only emitted for B-tree/hash indexes — FULLTEXT/SPATIAL reject them. */
export function indexDefinition(idx: IndexDraft): string | null {
  const name = idx.name.trim();
  const cols = idx.columns.filter((c) => c.column.trim());
  if (!name || cols.length === 0) return null;

  const directional = idx.indexType === "NORMAL" || idx.indexType === "UNIQUE";
  const keyword =
    idx.indexType === "UNIQUE"
      ? "UNIQUE INDEX"
      : idx.indexType === "FULLTEXT"
        ? "FULLTEXT INDEX"
        : idx.indexType === "SPATIAL"
          ? "SPATIAL INDEX"
          : "INDEX";

  const colList = cols
    .map((c) =>
      directional ? `${id(c.column.trim())} ${c.direction}` : id(c.column.trim())
    )
    .join(", ");

  let def = `${keyword} ${id(name)} (${colList})`;
  if (directional) def += ` USING ${idx.method}`;
  if (idx.comment.trim()) def += ` COMMENT ${quoteString(idx.comment.trim())}`;
  return def;
}

export function buildCreateTableSql(
  tableName: string,
  columns: ColumnDraft[],
  indexes: IndexDraft[] = [],
  comment = "",
  foreignKeys: ForeignKeyDraft[] = [],
  database = ""
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

  for (const idx of indexes) {
    const def = indexDefinition(idx);
    if (def) defs.push(`  ${def}`);
  }

  for (const fk of foreignKeys) {
    const def = foreignKeyDefinition(fk, database);
    if (def) defs.push(`  ${def}`);
  }

  const body = defs.length > 0 ? defs.join(",\n") : "  /* no columns yet */";
  const suffix = comment.trim() ? ` COMMENT=${quoteString(comment.trim())}` : "";
  return `CREATE TABLE ${id(tableName)} (\n${body}\n)${suffix};`;
}

/**
 * Given kept columns in display order and their positions in the original
 * order, return the keys forming a longest increasing subsequence of those
 * positions — the columns that can keep their place while the others are
 * repositioned around them with FIRST/AFTER. Minimizes the number of
 * placement clauses a reorder produces. Shared with the schema-sync builder.
 */
export function stableColumnKeys(
  keys: string[],
  origPos: Map<string, number>
): Set<string> {
  const pos = keys.map((k) => origPos.get(k) ?? -1);
  const best = pos.map(() => 1);
  const prev = pos.map(() => -1);
  let end = -1;
  for (let i = 0; i < pos.length; i++) {
    for (let j = 0; j < i; j++) {
      if (pos[j] < pos[i] && best[j] + 1 > best[i]) {
        best[i] = best[j] + 1;
        prev[i] = j;
      }
    }
    if (end === -1 || best[i] > best[end]) end = i;
  }
  const stays = new Set<string>();
  for (let i = end; i !== -1; i = prev[i]) stays.add(keys[i]);
  return stays;
}

/** Diff the original (loaded) columns against the live edits into an ALTER TABLE
 * statement: DROP/ADD/CHANGE columns, primary-key changes, and a table rename. */
export function buildAlterTableSql(
  originalName: string,
  originalColumns: ColumnDraft[],
  tableName: string,
  currentColumns: ColumnDraft[],
  originalAutoIncrement = "",
  autoIncrement = "",
  originalIndexes: IndexDraft[] = [],
  currentIndexes: IndexDraft[] = [],
  originalComment = "",
  comment = "",
  originalForeignKeys: ForeignKeyDraft[] = [],
  currentForeignKeys: ForeignKeyDraft[] = [],
  database = ""
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

  /**
   * Added + changed + reordered columns, in display order. Reordering keeps
   * the columns that are already in relative order (longest such run) in
   * place and emits a FIRST/AFTER placement only for the rest, each anchored
   * to its display-order predecessor. MySQL applies the clauses left to
   * right, and a predecessor's own add/rename/move clause is always emitted
   * before the clause that anchors to it, so every placement resolves
   * against the right neighbor.
   */
  const cur = currentColumns.filter((c) => c.name.trim());
  const keptOrder = originalColumns
    .map((c) => c.originalName ?? c.name)
    .filter((n) => keptOriginalNames.has(n));
  const origPos = new Map(keptOrder.map((n, i) => [n, i] as const));
  const stays = stableColumnKeys(
    cur.filter((c) => c.originalName).map((c) => c.originalName as string),
    origPos
  );
  const lastExistingIdx = cur.reduce(
    (last, c, i) => (c.originalName ? i : last),
    -1
  );

  cur.forEach((col, i) => {
    const name = col.name.trim();
    const placement =
      i === 0 ? " FIRST" : ` AFTER ${id(cur[i - 1].name.trim())}`;
    if (!col.originalName) {
      /* Adds past the last existing column just append — no placement. */
      const pos = i > lastExistingIdx ? "" : placement;
      clauses.push(`  ADD COLUMN ${id(name)} ${columnSpec(col)}${pos}`);
      return;
    }
    const moved = !stays.has(col.originalName);
    const orig = origByName.get(col.originalName);
    const changed =
      !orig || col.originalName !== name || columnSpec(orig) !== columnSpec(col);
    if (changed) {
      clauses.push(
        `  CHANGE COLUMN ${id(col.originalName)} ${id(name)} ${columnSpec(col)}${moved ? placement : ""}`
      );
    } else if (moved) {
      clauses.push(
        `  MODIFY COLUMN ${id(name)} ${columnSpec(col)}${placement}`
      );
    }
  });

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

  /* Secondary index diff: changed indexes are dropped and re-added (mirrors the
     primary-key handling above). Comparison is by rendered definition. */
  const keptIndexNames = new Set(
    currentIndexes
      .filter((i) => i.originalName)
      .map((i) => i.originalName as string)
  );
  for (const oi of originalIndexes) {
    const on = oi.originalName ?? oi.name;
    if (!keptIndexNames.has(on)) clauses.push(`  DROP INDEX ${id(on)}`);
  }
  const origIndexByName = new Map(
    originalIndexes.map((i) => [i.originalName ?? i.name, i])
  );
  for (const idx of currentIndexes) {
    const def = indexDefinition(idx);
    if (!idx.originalName) {
      if (def) clauses.push(`  ADD ${def}`);
      continue;
    }
    if (!def) {
      /* An existing index emptied of columns/name → drop it. */
      clauses.push(`  DROP INDEX ${id(idx.originalName)}`);
      continue;
    }
    const orig = origIndexByName.get(idx.originalName);
    const origDef = orig ? indexDefinition(orig) : null;
    if (origDef !== def) {
      clauses.push(`  DROP INDEX ${id(idx.originalName)}`);
      clauses.push(`  ADD ${def}`);
    }
  }

  /**
   * Foreign-key diff. Drops go into the main ALTER (so a key can be released
   * before the columns it covers are changed); adds — new keys and the
   * re-add half of a changed key — go into a second ALTER TABLE, because
   * MySQL rejects dropping and adding a constraint of the same name in one
   * statement, and the adds must see the final columns anyway.
   */
  const fkAdds: string[] = [];
  const keptFkNames = new Set(
    currentForeignKeys
      .filter((f) => f.originalName)
      .map((f) => f.originalName as string)
  );
  for (const of of originalForeignKeys) {
    const on = of.originalName ?? of.name;
    if (!keptFkNames.has(on)) clauses.push(`  DROP FOREIGN KEY ${id(on)}`);
  }
  const origFkByName = new Map(
    originalForeignKeys.map((f) => [f.originalName ?? f.name, f])
  );
  for (const fk of currentForeignKeys) {
    const def = foreignKeyDefinition(fk, database);
    if (!fk.originalName) {
      if (def) fkAdds.push(`  ADD ${def}`);
      continue;
    }
    if (!def) {
      /* An existing key emptied of its columns/target → drop it. */
      clauses.push(`  DROP FOREIGN KEY ${id(fk.originalName)}`);
      continue;
    }
    const orig = origFkByName.get(fk.originalName);
    const origDef = orig ? foreignKeyDefinition(orig, database) : null;
    if (origDef !== def) {
      clauses.push(`  DROP FOREIGN KEY ${id(fk.originalName)}`);
      fkAdds.push(`  ADD ${def}`);
    }
  }

  /* AUTO_INCREMENT counter. */
  const ai = autoIncrement.trim();
  if (ai !== originalAutoIncrement.trim() && /^\d+$/.test(ai)) {
    clauses.push(`  AUTO_INCREMENT = ${ai}`);
  }

  /* Table comment. */
  if (comment.trim() !== originalComment.trim()) {
    clauses.push(`  COMMENT = ${quoteString(comment.trim())}`);
  }

  /* Table rename. */
  const newName = tableName.trim();
  if (newName && newName !== originalName) {
    clauses.push(`  RENAME TO ${id(newName)}`);
  }

  if (clauses.length === 0 && fkAdds.length === 0) {
    return `-- No changes to apply to ${id(originalName)}.`;
  }
  const statements: string[] = [];
  if (clauses.length > 0) {
    statements.push(`ALTER TABLE ${id(originalName)}\n${clauses.join(",\n")};`);
  }
  if (fkAdds.length > 0) {
    const finalName = newName || originalName;
    statements.push(`ALTER TABLE ${id(finalName)}\n${fkAdds.join(",\n")};`);
  }
  return statements.join("\n\n");
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
