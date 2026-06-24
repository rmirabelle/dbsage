/**
 * Query-rewrite detectors. These spot patterns where the *shape* of the SQL —
 * not a missing index — is the problem, and propose a corrected query.
 *
 * The flagship case: a filter on the right (optional) table of a LEFT JOIN
 * placed in WHERE. It silently turns the LEFT JOIN into an inner join and lets
 * the optimizer drive from that table, which defeats an ORDER BY on the left
 * table. Moving the predicate into the ON clause restores the true LEFT JOIN and
 * lets the left table drive.
 */

export interface LeftJoinFilter {
  /** How the right table is referenced (alias if any, else its name). */
  ref: string;
  base: string;
  /** The WHERE predicate that belongs in the ON clause. */
  predicate: string;
  /** The existing ON expression text (trimmed). */
  onClause: string;
}

function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/** Detect a non-NULL-preserving WHERE predicate on a LEFT JOIN'd table. Returns
 * the first such case, or null. Skips OR'd WHEREs (moving a predicate out of an
 * OR would change logic) and `IS NULL` (the legitimate anti-join pattern). */
export function detectLeftJoinWhereFilter(sql: string): LeftJoinFilter | null {
  const whereM = sql.match(
    /\bwhere\b([\s\S]*?)(?=\border\s+by\b|\bgroup\s+by\b|\blimit\b|\bhaving\b|\bunion\b|;|$)/i
  );
  if (!whereM) return null;
  const whereText = whereM[1];
  if (/\bor\b/i.test(whereText)) return null;

  const joinRe =
    /\bleft\s+(?:outer\s+)?join\s+([A-Za-z_]\w*)(?:\s+(?:as\s+)?([A-Za-z_]\w*))?\s+on\b([\s\S]*?)(?=\b(?:left|right|inner|cross|straight_join|join|where|group\s+by|order\s+by|limit|having|union|for)\b|;|$)/gi;
  let m: RegExpExecArray | null;
  while ((m = joinRe.exec(sql)) !== null) {
    const base = m[1];
    const alias = m[2];
    const onClause = m[3].trim();
    const ref = alias || base;

    const isNotNull = whereText.match(
      new RegExp(`\\b${escapeRegExp(ref)}\\.(\\w+)\\s+is\\s+not\\s+null`, "i")
    );
    if (isNotNull) {
      return { ref, base, predicate: `${ref}.${isNotNull[1]} IS NOT NULL`, onClause };
    }

    /* A general AND-safe comparison predicate on the right table. */
    const cmp = whereText.match(
      new RegExp(
        `(${escapeRegExp(ref)}\\.\\w+\\s*(?:<=>|>=|<=|<>|!=|=|>|<|\\blike\\b|\\bin\\b)\\s*[\\s\\S]*?)(?=\\band\\b|\\border\\s+by\\b|\\bgroup\\s+by\\b|\\blimit\\b|\\bhaving\\b|;|$)`,
        "i"
      )
    );
    if (cmp) {
      return { ref, base, predicate: cmp[1].trim(), onClause };
    }
  }
  return null;
}

/** Build the corrected query: remove the predicate from WHERE and append it to
 * the LEFT JOIN's ON clause. Returns null if it can't do so cleanly. */
export function buildLeftJoinRewrite(
  sql: string,
  jf: LeftJoinFilter
): string | null {
  const p = escapeRegExp(jf.predicate);
  const first = new RegExp(`\\bwhere\\s+${p}\\s+and\\s+`, "i");
  const middle = new RegExp(`\\s+and\\s+${p}(?=\\s|;|$)`, "i");
  const sole = new RegExp(
    `\\bwhere\\s+${p}\\s*(?=order\\s+by|group\\s+by|limit|having|union|;|$)`,
    "i"
  );

  let removed: string;
  if (first.test(sql)) removed = sql.replace(first, "WHERE ");
  else if (middle.test(sql)) removed = sql.replace(middle, "");
  else if (sole.test(sql)) removed = sql.replace(sole, " ");
  else return null;

  const onIdx = removed.indexOf(jf.onClause);
  if (onIdx < 0) return null;
  const onEnd = onIdx + jf.onClause.length;
  const out =
    removed.slice(0, onEnd) + ` AND ${jf.predicate}` + removed.slice(onEnd);

  /* Tidy trailing whitespace left on lines by the removal. */
  return out.replace(/[ \t]+(\r?\n)/g, "$1").replace(/\n{3,}/g, "\n\n").trim();
}
