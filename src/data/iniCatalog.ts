/**
 * Curated catalog of common MySQL option-file settings for the structured
 * editor. Intentionally small (~10) for v1 — settings not listed here are still
 * fully editable in the Raw view. Grow this over time; descriptions are written
 * to be a plain-English orientation, not a substitute for the manual.
 */

export type IniSettingType = "int" | "bool" | "enum" | "string";

export interface IniSetting {
  key: string;
  /** Option-file section the setting belongs in (almost always "mysqld"). */
  section: string;
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
    type: "int",
    default: "151",
    description:
      "Maximum number of simultaneous client connections the server allows.",
  },
  {
    key: "innodb_buffer_pool_size",
    section: "mysqld",
    type: "string",
    default: "134217728",
    description:
      "Memory (bytes; suffixes like 512M / 2G allowed) InnoDB uses to cache table and index data. The single most impactful InnoDB tuning setting — often 50–75% of RAM on a dedicated server.",
  },
  {
    key: "innodb_log_file_size",
    section: "mysqld",
    type: "string",
    default: "50331648",
    description:
      "Size of each InnoDB redo log file. Larger values raise write throughput but lengthen crash recovery.",
  },
  {
    key: "innodb_flush_log_at_trx_commit",
    section: "mysqld",
    type: "enum",
    options: ["0", "1", "2"],
    default: "1",
    description:
      "Durability vs. throughput trade-off. 1 = full ACID (flush at every commit); 2 = write to OS cache each commit, flush ~1/sec; 0 = flush ~1/sec regardless of commits.",
  },
  {
    key: "max_allowed_packet",
    section: "mysqld",
    type: "string",
    default: "67108864",
    description:
      "Largest single packet, row, or parameter the server will send or accept (bytes; suffixes allowed). Raise it for large BLOBs.",
  },
  {
    key: "slow_query_log",
    section: "mysqld",
    type: "bool",
    default: "OFF",
    description:
      "Whether queries slower than long_query_time are recorded to the slow query log.",
  },
  {
    key: "long_query_time",
    section: "mysqld",
    type: "string",
    default: "10",
    description:
      "Threshold in seconds (fractions allowed) above which a query is considered slow.",
  },
  {
    key: "general_log",
    section: "mysqld",
    type: "bool",
    default: "OFF",
    description:
      "Logs every statement the server receives. Very verbose — leave off except when debugging.",
  },
  {
    key: "log_output",
    section: "mysqld",
    type: "enum",
    options: ["FILE", "TABLE", "NONE"],
    default: "FILE",
    description:
      "Destination for the general and slow query logs: files on disk, the mysql.*_log tables, or nowhere.",
  },
  {
    key: "character_set_server",
    section: "mysqld",
    type: "string",
    default: "utf8mb4",
    description:
      "Default character set applied to new schemas. utf8mb4 is the modern, full-Unicode choice.",
  },
];
