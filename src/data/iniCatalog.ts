/**
 * Curated catalog of common MySQL option-file settings for the structured
 * editor. Intentionally small (~10) for v1 — settings not listed here are still
 * fully editable in the Raw view. Grow this over time; descriptions are written
 * to be a plain-English orientation, not a substitute for the manual.
 */

export type IniSettingType = "int" | "bool" | "enum" | "string" | "set";

export interface IniSetting {
  key: string;
  /** Option-file section the setting belongs in (almost always "mysqld"). */
  section: string;
  /** Display group heading for the structured form (e.g. "InnoDB"). */
  group: string;
  type: IniSettingType;
  /** Allowed values for `type: "enum"`. */
  options?: string[];
  /** Per-option detail (for `set`/`enum`), keyed by option value. Rendered in
   * the help panel so each individual choice is explained, not just the setting. */
  optionDetails?: Record<string, string>;
  /** The server's default, shown as a hint when the key isn't set. */
  default?: string;
  description: string;
}

export const INI_CATALOG: IniSetting[] = [
  {
    key: "max_connections",
    section: "mysqld",
    group: "General",
    type: "int",
    default: "151",
    description:
      "Maximum number of simultaneous client connections the server allows.",
  },
  {
    key: "max_allowed_packet",
    section: "mysqld",
    group: "General",
    type: "string",
    default: "67108864",
    description:
      "Largest single packet, row, or parameter the server will send or accept (bytes; suffixes allowed). Raise it for large BLOBs.",
  },
  {
    key: "character_set_server",
    section: "mysqld",
    group: "General",
    type: "string",
    default: "utf8mb4",
    description:
      "Default character set applied to new schemas. utf8mb4 is the modern, full-Unicode choice.",
  },
  {
    key: "port",
    section: "mysqld",
    group: "General",
    type: "int",
    default: "3306",
    description: "TCP port the server listens on for client connections.",
  },
  {
    key: "group_concat_max_len",
    section: "mysqld",
    group: "General",
    type: "int",
    default: "1024",
    description:
      "Maximum length in bytes of the result returned by GROUP_CONCAT(). Raise it when concatenated results are being silently truncated.",
  },
  {
    key: "datadir",
    section: "mysqld",
    group: "General",
    type: "string",
    description:
      "Filesystem path to the server's data directory, where databases and InnoDB system files live. Installation-specific; changing it requires relocating the data and a restart.",
  },
  {
    key: "sql_mode",
    section: "mysqld",
    group: "General",
    type: "set",
    options: [
      "ALLOW_INVALID_DATES",
      "ANSI_QUOTES",
      "ERROR_FOR_DIVISION_BY_ZERO",
      "HIGH_NOT_PRECEDENCE",
      "IGNORE_SPACE",
      "NO_AUTO_VALUE_ON_ZERO",
      "NO_BACKSLASH_ESCAPES",
      "NO_DIR_IN_CREATE",
      "NO_ENGINE_SUBSTITUTION",
      "NO_UNSIGNED_SUBTRACTION",
      "NO_ZERO_DATE",
      "NO_ZERO_IN_DATE",
      "ONLY_FULL_GROUP_BY",
      "PAD_CHAR_TO_FULL_LENGTH",
      "PIPES_AS_CONCAT",
      "REAL_AS_FLOAT",
      "STRICT_ALL_TABLES",
      "STRICT_TRANS_TABLES",
      "TIME_TRUNCATE_FRACTIONAL",
    ],
    default:
      "ONLY_FULL_GROUP_BY,STRICT_TRANS_TABLES,NO_ZERO_IN_DATE,NO_ZERO_DATE,ERROR_FOR_DIVISION_BY_ZERO,NO_ENGINE_SUBSTITUTION",
    description:
      "Set of SQL modes controlling syntax and data-validation strictness. Modes combine; STRICT_TRANS_TABLES and ONLY_FULL_GROUP_BY are part of the modern default. Stored as a comma-separated list.",
    optionDetails: {
      ALLOW_INVALID_DATES:
        "Permits dates whose day/month are out of the normal range (e.g. 2024-02-30) as long as the month is 1–12 and the day 1–31; only that coarse check is applied. Without it, strict mode rejects such dates.",
      ANSI_QUOTES:
        "Treats the double quote \" as an identifier quote (like backticks) rather than a string delimiter, so \"x\" means column/table x, not the literal 'x'. Backtick quoting still works.",
      ERROR_FOR_DIVISION_BY_ZERO:
        "In strict mode, makes division or MOD by zero during INSERT/UPDATE raise an error instead of inserting NULL with a warning. Now folded into general strict behaviour (deprecated as a separate mode) but still in the default set.",
      HIGH_NOT_PRECEDENCE:
        "Raises the precedence of NOT so that NOT a BETWEEN b AND c parses as (NOT a) BETWEEN b AND c. Off by default; only for compatibility with older/other SQL dialects.",
      IGNORE_SPACE:
        "Allows a space between a built-in function name and its opening parenthesis, e.g. COUNT (x). As a side effect those function names become reserved words. Mainly a compatibility option.",
      NO_AUTO_VALUE_ON_ZERO:
        "Stops AUTO_INCREMENT from treating an inserted 0 as 'generate the next value' — a literal 0 is stored as 0. Useful when reloading dumps that contain explicit 0 key values.",
      NO_BACKSLASH_ESCAPES:
        "Disables the backslash as an escape character in string literals, so \\n is a literal backslash-n. Makes string handling match standard SQL.",
      NO_DIR_IN_CREATE:
        "Ignores DATA DIRECTORY and INDEX DIRECTORY clauses in CREATE TABLE, forcing tables into the default location. Often set on replicas to keep file layout consistent with the source.",
      NO_ENGINE_SUBSTITUTION:
        "When a CREATE/ALTER names a storage engine that's disabled or absent, raise an error instead of silently substituting the default engine. Part of the default set; prevents surprise engine swaps.",
      NO_UNSIGNED_SUBTRACTION:
        "Makes subtraction between unsigned integers yield a signed result, so 0 - 1 gives -1 instead of erroring or wrapping to a huge positive value. Off by default.",
      NO_ZERO_DATE:
        "In strict mode, rejects the all-zero date '0000-00-00'. Now folded into general strict behaviour (deprecated as a separate mode) but still in the default set.",
      NO_ZERO_IN_DATE:
        "In strict mode, rejects dates with a zero month or day (e.g. '2024-00-10'); the all-zero date is governed separately by NO_ZERO_DATE. Also deprecated/folded into strict, and part of the default set.",
      ONLY_FULL_GROUP_BY:
        "Rejects queries whose SELECT/HAVING/ORDER BY reference nonaggregated columns that aren't named in GROUP BY (and aren't functionally dependent on it). Enforces deterministic, standard grouping; part of the default set.",
      PAD_CHAR_TO_FULL_LENGTH:
        "Stops trimming trailing spaces from CHAR columns on retrieval, returning the full declared width instead. Off by default, and deprecated.",
      PIPES_AS_CONCAT:
        "Treats || as the string-concatenation operator (as in Oracle/standard SQL) instead of logical OR.",
      REAL_AS_FLOAT:
        "Makes REAL a synonym for FLOAT (single precision) rather than its default meaning of DOUBLE.",
      STRICT_ALL_TABLES:
        "Enables strict mode for all storage engines. Because a non-transactional table can't roll back a partially-applied statement, a bad row partway through may leave earlier rows already inserted — STRICT_TRANS_TABLES is usually preferred.",
      STRICT_TRANS_TABLES:
        "Enables strict mode for transactional engines (InnoDB): invalid or missing values raise an error and roll back the statement. For non-transactional tables an adjustable value becomes a warning instead. The modern default.",
      TIME_TRUNCATE_FRACTIONAL:
        "Truncates rather than rounds fractional seconds when a TIME/DATETIME/TIMESTAMP value has more digits than the column allows — e.g. inserting 1.999 into TIME(1) stores 1.9, not 2.0.",
    },
  },
  {
    key: "innodb_buffer_pool_size",
    section: "mysqld",
    group: "InnoDB",
    type: "string",
    default: "134217728",
    description:
      "Memory (bytes; suffixes like 512M / 2G allowed) InnoDB uses to cache table and index data. The single most impactful InnoDB tuning setting — often 50–75% of RAM on a dedicated server.",
  },
  {
    key: "innodb_log_file_size",
    section: "mysqld",
    group: "InnoDB",
    type: "string",
    default: "50331648",
    description:
      "Size of each InnoDB redo log file. Larger values raise write throughput but lengthen crash recovery. Deprecated in MySQL 8.0.30+ in favour of innodb_redo_log_capacity — set that instead on modern servers.",
  },
  {
    key: "innodb_redo_log_capacity",
    section: "mysqld",
    group: "InnoDB",
    type: "string",
    default: "104857600",
    description:
      "Total size of the InnoDB redo log (bytes; suffixes like 512M / 4G allowed). MySQL 8.0.30+ uses this instead of innodb_log_file_size × innodb_log_files_in_group. Too small for the write rate and threads stall waiting for checkpoint space (MY-014084); larger values smooth out write bursts but lengthen crash recovery. Default 100M; busy write-heavy servers often run several GB.",
  },
  {
    key: "innodb_io_capacity",
    section: "mysqld",
    group: "InnoDB",
    type: "int",
    default: "200",
    description:
      "Baseline number of I/O operations per second InnoDB budgets for background work — chiefly flushing dirty pages and merging the change buffer. Set it near your storage's real write IOPS so the checkpointer can keep up: ~200 suits a single HDD, but SSDs/NVMe handle thousands. Too low and dirty pages accumulate faster than they drain (a cause of redo-log checkpoint lag).",
  },
  {
    key: "innodb_io_capacity_max",
    section: "mysqld",
    group: "InnoDB",
    type: "int",
    default: "2000",
    description:
      "Ceiling on background I/O per second when InnoDB is falling behind and must flush harder to catch up (e.g. during write bursts). Must be ≥ innodb_io_capacity; defaults to max(2000, 2× innodb_io_capacity). Raise it on fast storage to let InnoDB drain a backlog of dirty pages quickly instead of stalling foreground writes.",
  },
  {
    key: "innodb_max_dirty_pages_pct",
    section: "mysqld",
    group: "InnoDB",
    type: "string",
    default: "90",
    description:
      "Target maximum share of the buffer pool that may hold unflushed (dirty) pages, as a percentage (decimals allowed, 0–99.99). InnoDB increases flushing as it approaches this figure. Lower it to keep fewer dirty pages outstanding — smaller, more frequent flushes and shorter checkpoint lag, at the cost of more steady I/O.",
  },
  {
    key: "innodb_flush_log_at_trx_commit",
    section: "mysqld",
    group: "InnoDB",
    type: "enum",
    options: ["0", "1", "2"],
    default: "1",
    description:
      "Durability vs. throughput trade-off. 1 = full ACID (flush at every commit); 2 = write to OS cache each commit, flush ~1/sec; 0 = flush ~1/sec regardless of commits.",
  },
  {
    key: "slow_query_log",
    section: "mysqld",
    group: "Logging",
    type: "bool",
    default: "OFF",
    description:
      "Whether queries slower than long_query_time are recorded to the slow query log.",
  },
  {
    key: "long_query_time",
    section: "mysqld",
    group: "Logging",
    type: "string",
    default: "10",
    description:
      "Threshold in seconds (fractions allowed) above which a query is considered slow.",
  },
  {
    key: "general_log",
    section: "mysqld",
    group: "Logging",
    type: "bool",
    default: "OFF",
    description:
      "Logs every statement the server receives. Very verbose — leave off except when debugging.",
  },
  {
    key: "log_output",
    section: "mysqld",
    group: "Logging",
    type: "enum",
    options: ["FILE", "TABLE", "NONE"],
    default: "FILE",
    description:
      "Destination for the general and slow query logs: files on disk, the mysql.*_log tables, or nowhere.",
  },
];
