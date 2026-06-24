/**
 * Suggests a composite index for a table the optimizer is scanning badly.
 * Standard index-design order: equality predicates first, then one range
 * predicate. Existing indexes are checked so we extend rather than duplicate.
 */
import type { AnalyzeTableInfo } from "./types";
import type { PlanTable } from "./parsePlan";

export interface IndexSuggestion {
  columns: string[];
  ddl: string;
  /** Name of an existing index this would extend, if any. */
  extendsIndex?: string;
  note: string;
}

interface PredCol {
  column: string;
  kind: "eq" | "range";
}

/* Pull `col <op> …` predicates out of an EXPLAIN `attached_condition`, keeping
   only columns that belong to this table. Qualified names (`db`.`t`.`col`)
   collapse to the trailing identifier. */
function predicatesFromCondition(
  cond: string,
  tableCols: Set<string>
): PredCol[] {
  const out: PredCol[] = [];
  const seen = new Set<string>();
  const re =
    /(?:`?\w+`?\s*\.\s*)*`?(\w+)`?\s*(=|<=>|<>|!=|>=|<=|>|<|between|in|like)\b/gi;
  let m: RegExpExecArray | null;
  while ((m = re.exec(cond)) !== null) {
    const col = m[1];
    const op = m[2].toLowerCase();
    if (!tableCols.has(col) || seen.has(col)) continue;
    if (op === "=" || op === "<=>" || op === "in") {
      seen.add(col);
      out.push({ column: col, kind: "eq" });
    } else if (op === ">" || op === "<" || op === ">=" || op === "<=" || op === "between") {
      seen.add(col);
      out.push({ column: col, kind: "range" });
    }
    /* `!=`, `<>`, `like` aren't usefully sargable as a leading key column. */
  }
  return out;
}

const lower = (s: string) => s.toLowerCase();

export function buildIndexSuggestion(
  planTable: PlanTable,
  info: AnalyzeTableInfo | undefined,
  orderByCols: string[],
  mode: "filter" | "ordering" = "filter"
): IndexSuggestion | null {
  if (!info) return null;
  const tableCols = new Set(info.columns.map((c) => c.name));
  const preds = planTable.attachedCondition
    ? predicatesFromCondition(planTable.attachedCondition, tableCols)
    : [];

  /* When the table is reached by a ref/eq_ref lookup, the equality columns are
     in `used_key_parts` (matched by the chosen index) rather than the leftover
     `attached_condition`. Fold those in so we don't miss the leading column. */
  const keyPartEq = ["ref", "eq_ref", "const", "ref_or_null"].includes(
    planTable.accessType
  )
    ? planTable.usedKeyParts.filter((c) => tableCols.has(c))
    : [];
  const eqCols = [
    ...keyPartEq,
    ...preds.filter((p) => p.kind === "eq").map((p) => p.column),
  ].filter((c, i, a) => a.indexOf(c) === i);
  const rangeCol = preds.find((p) => p.kind === "range")?.column;
  const orderOnThis = orderByCols.filter((c) => tableCols.has(c));

  /* Filter mode: equalities then a single range (the classic shape). Ordering
     mode (filesort fix): equalities then the ORDER BY columns — a range column
     can't combine with an index-served sort, so it's dropped. */
  let columns: string[];
  if (mode === "ordering" && orderOnThis.length > 0) {
    columns = [...eqCols, ...orderOnThis];
  } else {
    columns = [...eqCols];
    if (rangeCol) columns.push(rangeCol);
    if (columns.length === 0) columns = orderOnThis;
  }
  columns = columns.filter((c, i) => columns.indexOf(c) === i);
  if (columns.length === 0) return null;

  /* Already covered? An existing index whose leading columns match ours (or
     start with ours) means no new index is needed. A shorter existing prefix is
     a candidate to extend. */
  let extendsIndex: string | undefined;
  for (const idx of info.indexes) {
    const idxCols = idx.columns.map(lower);
    const want = columns.map(lower);
    const isPrefixOfIdx = want.every((c, i) => idxCols[i] === c);
    if (isPrefixOfIdx) return null; // already served by this index
    const idxIsPrefixOfWant =
      idxCols.length < want.length && idxCols.every((c, i) => want[i] === c);
    if (idxIsPrefixOfWant) extendsIndex = idx.name;
  }

  const colList = columns.map((c) => `\`${c}\``).join(", ");
  const idxName = `idx_${info.realName}_${columns.join("_")}`.slice(0, 64);
  const ddl = extendsIndex
    ? `/* extend ${extendsIndex} */\nALTER TABLE \`${info.realName}\` DROP INDEX \`${extendsIndex}\`, ADD INDEX \`${idxName}\` (${colList});`
    : `CREATE INDEX \`${idxName}\` ON \`${info.realName}\` (${colList});`;

  const note = extendsIndex
    ? `Extends existing index \`${extendsIndex}\` to cover ${columns.join(", ")}.`
    : `Composite index on ${columns.join(", ")} (equality columns first, range last).`;

  return { columns, ddl, extendsIndex, note };
}
