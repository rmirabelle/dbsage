import type { ReactNode } from "react";

/**
 * MySQL keywords highlighted in the query editor. Curated set of clause/operator
 * keywords and data types — extend freely; this is the single source the editor
 * colors purple. (Functions like COUNT/SUM are intentionally omitted for now.)
 */
const KEYWORDS = new Set<string>([
  "SELECT", "FROM", "WHERE", "AND", "OR", "NOT", "NULL", "IS", "IN", "LIKE",
  "RLIKE", "REGEXP", "BETWEEN", "EXISTS", "ANY", "SOME", "GROUP", "BY", "ORDER",
  "HAVING", "LIMIT", "OFFSET", "JOIN", "INNER", "LEFT", "RIGHT", "FULL",
  "OUTER", "CROSS", "STRAIGHT_JOIN", "NATURAL", "ON", "USING", "AS", "DISTINCT",
  "DISTINCTROW", "UNION", "INTERSECT", "EXCEPT", "ALL", "INSERT", "INTO",
  "VALUES", "VALUE", "UPDATE", "SET", "DELETE", "REPLACE", "CREATE", "TABLE",
  "DATABASE", "SCHEMA", "INDEX", "VIEW", "TRIGGER", "PROCEDURE", "FUNCTION",
  "DROP", "ALTER", "ADD", "COLUMN", "MODIFY", "CHANGE", "RENAME",
  "TO", "PRIMARY", "KEY", "FOREIGN", "REFERENCES", "UNIQUE", "FULLTEXT",
  "SPATIAL", "CONSTRAINT", "CHECK", "DEFAULT", "AUTO_INCREMENT", "UNSIGNED",
  "SIGNED", "ZEROFILL", "COMMENT", "CASCADE", "RESTRICT", "TRUNCATE", "IGNORE",
  "DUPLICATE", "ON", "CASE", "WHEN", "THEN", "ELSE", "END", "IF", "ELSEIF",
  "CAST", "CONVERT", "COLLATE", "CHARACTER", "CHARSET", "USE", "SHOW",
  "DESCRIBE", "DESC", "ASC", "EXPLAIN", "ANALYZE", "OPTIMIZE", "GRANT",
  "REVOKE", "FLUSH", "BEGIN", "COMMIT", "ROLLBACK", "TRANSACTION", "START",
  "SAVEPOINT", "LOCK", "UNLOCK", "TABLES", "WITH", "RECURSIVE", "OVER",
  "PARTITION", "WINDOW", "ROW", "ROWS", "RANGE", "GENERATED", "STORED",
  "VIRTUAL", "TEMPORARY", "DIV", "MOD", "XOR", "TRUE", "FALSE", "UNKNOWN",
  "INT", "INTEGER", "TINYINT", "SMALLINT", "MEDIUMINT", "BIGINT", "DECIMAL",
  "NUMERIC", "FLOAT", "DOUBLE", "REAL", "BIT", "BOOLEAN", "BOOL", "DATE",
  "DATETIME", "TIMESTAMP", "TIME", "YEAR", "CHAR", "VARCHAR", "BINARY",
  "VARBINARY", "BLOB", "TINYBLOB", "MEDIUMBLOB", "LONGBLOB", "TEXT",
  "TINYTEXT", "MEDIUMTEXT", "LONGTEXT", "ENUM", "JSON", "GEOMETRY",
]);

/** Keyword list (for autocompletion), sorted. */
export const SQL_KEYWORDS: string[] = Array.from(KEYWORDS).sort();

/**
 * Single-pass tokenizer: string literals, comments and backtick-quoted
 * identifiers are matched as whole tokens (so keywords inside them are NOT
 * highlighted); bare words are matched and tested against KEYWORDS; anything
 * else is consumed one char at a time and passed through.
 */
const TOKEN_RE =
  /'(?:\\.|[^'])*'|"(?:\\.|[^"])*"|`(?:[^`]|``)*`|\/\*[\s\S]*?\*\/|--[^\n]*|#[^\n]*|[A-Za-z_][A-Za-z0-9_$]*|[\s\S]/g;

/** True when a whole token (per TOKEN_RE) is a comment: block `/* … *​/`, or a
 * `--` / `#` line comment. */
function isComment(tok: string): boolean {
  return tok.startsWith("/*") || tok.startsWith("--") || tok.startsWith("#");
}

/** Render SQL as React nodes with MySQL keywords in purple and comments in a
 * muted italic gray. */
export function highlightSql(sql: string): ReactNode[] {
  const out: ReactNode[] = [];
  let buffer = "";
  let key = 0;
  const flush = () => {
    if (buffer) {
      out.push(buffer);
      buffer = "";
    }
  };
  TOKEN_RE.lastIndex = 0;
  let m: RegExpExecArray | null;
  while ((m = TOKEN_RE.exec(sql)) !== null) {
    const tok = m[0];
    if (isComment(tok)) {
      flush();
      out.push(
        <span key={key++} className="text-zinc-500 italic">
          {tok}
        </span>
      );
    } else if (/^[A-Za-z_]/.test(tok) && KEYWORDS.has(tok.toUpperCase())) {
      flush();
      out.push(
        <span key={key++} className="text-purple-400">
          {tok}
        </span>
      );
    } else {
      buffer += tok;
    }
  }
  flush();
  return out;
}
