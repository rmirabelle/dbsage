import type { ReactNode } from "react";

/**
 * MySQL keywords highlighted in the query editor. Curated set of clause/operator
 * keywords and data types — extend freely; this and {@link FUNCTIONS} are the
 * sources the editor colors purple.
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

/**
 * MySQL built-in functions, colored like keywords but only when actually called
 * (immediately followed by `(`), so a column named `count`, `year`, or `date`
 * isn't mistaken for the function. Extend freely. Names already in KEYWORDS
 * (IF, CAST, CONVERT, CHAR, DATE, …) are colored by the keyword rule regardless
 * and needn't be repeated here. The JSON_* family is matched by prefix instead
 * (see {@link isJsonFunctionName}), so those aren't listed either.
 */
const FUNCTIONS = new Set<string>([
  /* aggregate & window */
  "COUNT", "SUM", "AVG", "MIN", "MAX", "GROUP_CONCAT", "STD", "STDDEV",
  "STDDEV_POP", "STDDEV_SAMP", "VAR_POP", "VAR_SAMP", "VARIANCE", "BIT_AND",
  "BIT_OR", "BIT_XOR", "ROW_NUMBER", "RANK", "DENSE_RANK", "PERCENT_RANK",
  "CUME_DIST", "NTILE", "LAG", "LEAD", "FIRST_VALUE", "LAST_VALUE", "NTH_VALUE",
  /* string */
  "CONCAT", "CONCAT_WS", "LENGTH", "CHAR_LENGTH", "CHARACTER_LENGTH",
  "OCTET_LENGTH", "LOWER", "UPPER", "LCASE", "UCASE", "SUBSTRING", "SUBSTR",
  "SUBSTRING_INDEX", "LEFT", "RIGHT", "TRIM", "LTRIM", "RTRIM", "REVERSE",
  "LOCATE", "INSTR", "POSITION", "LPAD", "RPAD", "REPEAT", "SPACE", "FORMAT",
  "ELT", "FIELD", "FIND_IN_SET", "MID", "ORD", "ASCII", "HEX", "UNHEX", "BIN",
  "OCT", "QUOTE", "SOUNDEX", "MAKE_SET", "EXPORT_SET", "REGEXP_REPLACE",
  "REGEXP_SUBSTR", "REGEXP_INSTR", "REGEXP_LIKE", "STRCMP",
  /* numeric */
  "ABS", "CEIL", "CEILING", "FLOOR", "ROUND", "POW", "POWER", "SQRT", "EXP",
  "LOG", "LOG2", "LOG10", "LN", "SIN", "COS", "TAN", "ASIN", "ACOS", "ATAN",
  "ATAN2", "COT", "DEGREES", "RADIANS", "PI", "RAND", "SIGN", "GREATEST",
  "LEAST", "CRC32", "CONV",
  /* date & time */
  "NOW", "CURDATE", "CURTIME", "CURRENT_DATE", "CURRENT_TIME",
  "CURRENT_TIMESTAMP", "SYSDATE", "MONTH", "DAY", "HOUR", "MINUTE", "SECOND",
  "MICROSECOND", "WEEK", "WEEKDAY", "WEEKOFYEAR", "DAYNAME", "MONTHNAME",
  "DAYOFMONTH", "DAYOFWEEK", "DAYOFYEAR", "QUARTER", "DATE_ADD", "DATE_SUB",
  "DATE_FORMAT", "STR_TO_DATE", "DATEDIFF", "TIMEDIFF", "TIMESTAMPDIFF",
  "TIMESTAMPADD", "UNIX_TIMESTAMP", "FROM_UNIXTIME", "LAST_DAY", "MAKEDATE",
  "MAKETIME", "PERIOD_ADD", "PERIOD_DIFF", "TO_DAYS", "FROM_DAYS", "TIME_TO_SEC",
  "SEC_TO_TIME", "ADDDATE", "SUBDATE", "ADDTIME", "SUBTIME", "CONVERT_TZ",
  "GET_FORMAT", "TIME_FORMAT", "UTC_DATE", "UTC_TIME", "UTC_TIMESTAMP",
  /* control flow & null handling */
  "IFNULL", "NULLIF", "COALESCE", "ISNULL",
  /* hashing, uuid, network, misc */
  "MD5", "SHA", "SHA1", "SHA2", "UUID", "UUID_SHORT", "LAST_INSERT_ID",
  "CONNECTION_ID", "ROW_COUNT", "FOUND_ROWS", "VERSION", "BENCHMARK", "SLEEP",
  "INET_ATON", "INET_NTOA", "INET6_ATON", "INET6_NTOA", "COMPRESS",
  "UNCOMPRESS", "AES_ENCRYPT", "AES_DECRYPT",
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

/** A word that looks like a MySQL JSON function — the `JSON_*` family
 * (JSON_EXTRACT, JSON_ARRAYAGG, JSON_TABLE, …). Matched by prefix rather than an
 * explicit list so every current and future JSON_ function is covered. */
function isJsonFunctionName(tok: string): boolean {
  return /^JSON_/i.test(tok);
}

/** Whether the next non-space character at or after `from` in `sql` is `(`, i.e.
 * the preceding word is being *called* — so a column named `count` or `json_data`
 * isn't mistaken for the function (only `count(...)` / `json_data(...)` would be). */
function callFollows(sql: string, from: number): boolean {
  let i = from;
  while (i < sql.length && (sql[i] === " " || sql[i] === "\t")) i++;
  return sql[i] === "(";
}

/**
 * Whether the word `tok` (starting at `index` in `sql`) should be colored: a
 * keyword anywhere, or a built-in function — the `JSON_*` family or a name in
 * FUNCTIONS — but only when it's actually being called, so function-named
 * columns stay plain.
 */
function isKeywordOrCall(tok: string, sql: string, index: number): boolean {
  const upper = tok.toUpperCase();
  if (KEYWORDS.has(upper)) return true;
  const isFunction = isJsonFunctionName(tok) || FUNCTIONS.has(upper);
  return isFunction && callFollows(sql, index + tok.length);
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
    } else if (/^[A-Za-z_]/.test(tok) && isKeywordOrCall(tok, sql, m.index)) {
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
