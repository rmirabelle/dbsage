import { pluralize, singularize } from "./inflector";
import type { Relation, RelationKind } from "../types";

/**
 * The editable shape of a relation, shared by the Relations tab's side panel
 * and the grid's right-click relation dialog so both suggest the same things.
 */
export interface RelationForm {
  /** Non-null when editing an existing relation. */
  editingId: string | null;
  fromTable: string;
  fromColumn: string;
  kind: RelationKind;
  toTable: string;
  toColumn: string;
  name: string;
}

export const BLANK_RELATION: RelationForm = {
  editingId: null,
  fromTable: "",
  fromColumn: "",
  kind: "has_one",
  toTable: "",
  toColumn: "",
  name: "",
};

/** Load an existing relation into the form for editing. */
export function formFromRelation(r: Relation): RelationForm {
  return {
    editingId: r.id,
    fromTable: r.fromTable,
    fromColumn: r.fromColumn,
    kind: r.kind,
    toTable: r.toTable,
    toColumn: r.toColumn,
    name: r.name,
  };
}

/**
 * Point the form at a target table, suggesting the accessor name. toColumn is
 * cleared here; {@link withSuggestedToColumn} fills it once that table's real
 * columns are known, so we never suggest a column that doesn't exist.
 */
export function withToTable(f: RelationForm, toTable: string): RelationForm {
  return {
    ...f,
    toTable,
    toColumn: "",
    name: toTable ? (f.kind === "has_one" ? singularize(toTable) : toTable) : "",
  };
}

/**
 * Choosing the from-column implies the kind ("id" → has many, anything else →
 * has one) and, for has-one, a guess at the target table from the column name
 * ("author_id" → "authors"), taken only when such a table actually exists.
 */
export function withFromColumn(
  f: RelationForm,
  fromColumn: string,
  tables: string[]
): RelationForm {
  const kind: RelationKind = fromColumn === "id" ? "has_many" : "has_one";
  const next = { ...f, fromColumn, kind };
  if (kind !== "has_one") return withToTable(next, "");
  const guess = pluralize(fromColumn.replace(/_id$/, ""));
  return withToTable(next, tables.includes(guess) ? guess : "");
}

/**
 * Fill/validate the to-column against the target table's real columns: keep an
 * already-valid choice, otherwise take the convention column ("id" or
 * "{fromTable}_id") when it exists, and never propose one that doesn't.
 */
export function withSuggestedToColumn(
  f: RelationForm,
  toColumns: string[]
): RelationForm {
  if (!f.toTable || toColumns.length === 0) return f;
  if (f.toColumn && toColumns.includes(f.toColumn)) return f;
  const desired =
    f.kind === "has_one" ? "id" : `${singularize(f.fromTable)}_id`;
  const next = toColumns.includes(desired) ? desired : "";
  return next === f.toColumn ? f : { ...f, toColumn: next };
}
