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
      "Size of each InnoDB redo log file. Larger values raise write throughput but lengthen crash recovery.",
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
