/**
 * Client-side "DSL" macros that generate plain SQL for insertion into the query
 * editor. Each builder is pure — it takes columns the caller has already fetched
 * from the DB, so it stays unit-testable and only ever emits real SQL. (The
 * schema fetch and the picker UI live in the dialog, not here.)
 */

import { SQL_KEYWORDS } from "./sqlHighlight";

/** Keyword set used to decide whether an identifier needs backticks — a column
 * named `order`/`key`/`date` must be quoted even though it's a simple word. */
const RESERVED = new Set(SQL_KEYWORDS);

/** MySQL string literal for a JSON key (single-quote-escaped). */
function jsonKey(name: string): string {
  return "'" + name.replace(/'/g, "''") + "'";
}

/** An identifier reference: left bare when it's a simple, non-reserved word;
 * backticked when it isn't a simple word or collides with a keyword. */
function ident(name: string): string {
  const simple = /^[A-Za-z_$][A-Za-z0-9_$]*$/.test(name);
  if (simple && !RESERVED.has(name.toUpperCase())) return name;
  return "`" + name.replace(/`/g, "``") + "`";
}

/**
 * Build a `JSON_OBJECT('col', qualifier.col, …)` expression that bundles the
 * given columns of a table into one JSON object. `qualifier` is the alias (or
 * table name) the columns are referenced by in the query; keys are the column
 * names verbatim.
 */
export function buildJsonObject(qualifier: string, columns: string[]): string {
  const q = ident(qualifier);
  const pairs = columns.map((c) => `${jsonKey(c)}, ${q}.${ident(c)}`);
  return `JSON_OBJECT(${pairs.join(", ")})`;
}

/**
 * Build a correlated-subquery expression that gathers a child table's matching
 * rows (a one-to-many relation) into a JSON array of objects:
 *
 *   (SELECT JSON_ARRAYAGG(JSON_OBJECT(…))
 *    FROM child c WHERE c.fk = parent.key)
 *
 * Self-contained — it filters by the relation and needs no GROUP BY — so it
 * stays correct and efficient when the outer query limits the parent rows.
 * `parentRef` is the raw `alias.column` the foreign key points at.
 */
export function buildJsonArraySubquery(opts: {
  childTable: string;
  childAlias: string;
  columns: string[];
  fkColumn: string;
  parentRef: string;
}): string {
  const { childTable, childAlias, columns, fkColumn, parentRef } = opts;
  const obj = buildJsonObject(childAlias, columns);
  return (
    `(SELECT JSON_ARRAYAGG(${obj}) ` +
    `FROM ${ident(childTable)} ${ident(childAlias)} ` +
    `WHERE ${ident(childAlias)}.${ident(fkColumn)} = ${parentRef.trim()})`
  );
}

/** One macro shown in the query editor's Insert menu. */
export interface SqlSnippet {
  id: string;
  label: string;
  description: string;
}

/** The macros offered in the Insert menu (data-driven so more can be added). */
export const SQL_SNIPPETS: SqlSnippet[] = [
  {
    id: "as_json",
    label: "AS_JSON",
    description: "Bundle a related table's columns into a JSON object",
  },
  {
    id: "as_json_array",
    label: "AS_JSON_ARRAY",
    description: "Aggregate a child table's rows into a JSON array",
  },
];
