export interface ConnectionProfile {
  id: string;
  name: string;
  host: string;
  port: number;
  username: string;
  defaultDatabase: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface ProfileView extends ConnectionProfile {
  hasPassword: boolean;
}

export interface ProfileInput {
  id?: string;
  name: string;
  host: string;
  port: number;
  username: string;
  password?: string;
  defaultDatabase?: string | null;
}

export interface TableInfo {
  name: string;
  kind: string;
  estimatedRows: number | null;
}

export interface ColumnInfo {
  name: string;
  dataType: string;
  nullable: boolean;
  key: string;
}

export type RelationKind = "has_one" | "has_many";

/** A virtual, app-defined relationship between two tables (no MySQL FK involved). */
export interface Relation {
  id: string;
  fromTable: string;
  fromColumn: string;
  toTable: string;
  toColumn: string;
  kind: RelationKind;
  name: string;
  createdAt: string;
  updatedAt: string;
}

/** Per-category item counts — used both for an import result and for previewing
 * what an encrypted state file contains. */
export interface StateCounts {
  profiles: number;
  relations: number;
  folders: number;
  columnSetups: number;
  tableViewPresets: number;
  savedQueries: number;
}

export type ImportSummary = StateCounts;

/** Which state categories an export or import should include. */
export interface StateSelection {
  profiles: boolean;
  relations: boolean;
  folders: boolean;
  columnSetups: boolean;
  tableViewPresets: boolean;
  savedQueries: boolean;
}

/** The selectable state categories, in display order, with friendly labels. */
export const STATE_CATEGORIES: { key: keyof StateSelection; label: string }[] = [
  { key: "profiles", label: "Connections" },
  { key: "relations", label: "Relations" },
  { key: "folders", label: "Table folders" },
  { key: "columnSetups", label: "Column setups" },
  { key: "tableViewPresets", label: "Table view presets" },
  { key: "savedQueries", label: "Saved queries" },
];

/** Per-table column configuration, persisted backend-side and included in
 * state export/import. */
export interface ColumnSetup {
  hiddenColumns: string[];
  filters: ColumnFilter[];
  jsonDisplay: Record<string, string>;
  /** Manual column-width overrides in pixels, keyed by column name. Absent in
   * setups saved before width persistence existed. */
  columnWidths?: Record<string, number>;
}

/** A full, reusable table-view snapshot: everything a named preset captures and
 * restores. Like {@link ColumnSetup} but also carries the sort. */
export interface TableViewSetup {
  hiddenColumns: string[];
  columnWidths: Record<string, number>;
  sort: SortSpec | null;
  filters: ColumnFilter[];
  jsonDisplay: Record<string, string>;
}

/** A named, saved table-view preset (scoped to one table). */
export interface TableViewPreset {
  name: string;
  setup: TableViewSetup;
}

/** A named, saved SQL query (scoped to one database). */
export interface SavedQuery {
  name: string;
  sql: string;
}

/** One entry in the silent per-database query history. `executedAt` is a
 * unix-millisecond timestamp; the list is stored most-recent-first. */
export interface QueryHistoryItem {
  sql: string;
  executedAt: number;
}

export type CellValue = string | number | boolean | null;
export type RowRecord = Record<string, CellValue>;

export interface RowsResult {
  columns: ColumnInfo[];
  rows: RowRecord[];
  total: number | null;
  limit: number;
  offset: number;
}

/** Result of an ad-hoc query. For result-set statements (SELECT/SHOW/…),
 * `columns`/`rows` carry the data and `rowsAffected` is null. For statements
 * with no result set (INSERT/UPDATE/DELETE/DDL), `rowsAffected` is set. */
export interface QueryResult {
  columns: ColumnInfo[];
  rows: RowRecord[];
  rowsAffected: number | null;
  /** Server-side execution time (statement run only), milliseconds. */
  elapsedMs: number;
  /** True when the result was capped at the requested max and more rows existed. */
  truncated: boolean;
}

interface BaseTab {
  id: string;
  profileId: string;
  profileName: string;
  database: string;
}

export type SortDirection = "asc" | "desc";

export interface SortSpec {
  column: string;
  direction: SortDirection;
}

export type FilterOp = "equals" | "like";

export interface ColumnFilter {
  column: string;
  op: FilterOp;
  value: string;
  /** JSON columns only: a dotted property path (e.g. "address.city"). When set,
   * the filter targets that JSON property instead of the whole column —
   * `equals` becomes a JSON_CONTAINS match, `like` a JSON_SEARCH match, both
   * shape-agnostic (object or array of objects). */
  jsonPath?: string;
}

export interface RowsTab extends BaseTab {
  kind: "rows";
  table: string;
  page: number;
  pageSize: number;
  data: RowsResult | null;
  /** Exact COUNT(*) result, set on demand; null means show the cheap estimate. */
  exactTotal: number | null;
  loading: boolean;
  error: string | null;
  sort: SortSpec | null;
  filters: ColumnFilter[];
  hiddenColumns: string[];
  /** JSON columns only: per-column dotted property path. When set, that
   * column's cells display the extracted property (truncated) instead of the
   * full JSON. Keyed by column name. */
  jsonDisplay: Record<string, string>;
  /** Manual column-width overrides in pixels, keyed by column name. */
  columnWidths: Record<string, number>;
  /** Named view presets saved for this table. */
  presets: TableViewPreset[];
  /** Name of the currently-applied preset, shown on the Views button. Null when
   * no named view is active (defaults or ad-hoc changes). */
  activePreset: string | null;
  /** The selected cell, persisted so switching tabs doesn't lose the user's
   * place. Cleared when the row set actually changes (page/sort/filter). */
  activeCell: { rowIndex: number; column: string } | null;
}

export interface Folder {
  id: string;
  name: string;
  tables: string[];
  createdAt: string;
  updatedAt: string;
}

export interface DatabaseTab extends BaseTab {
  kind: "database";
  loading: boolean;
  error: string | null;
  tables: TableInfo[];
  folders: Folder[];
  filter: string;
  currentFolderId: string | null;
}

export interface RelationsTab extends BaseTab {
  kind: "relations";
}

/** A server thread/connection row in the Monitoring → Activity view. */
export interface ProcessRow {
  id: number;
  user: string | null;
  host: string | null;
  db: string | null;
  command: string | null;
  /** Seconds in the current state. */
  time: number;
  state: string | null;
  /** The statement the thread is running, or null when idle. */
  info: string | null;
}

/** `SHOW GLOBAL STATUS` as a name→value map (values are numeric strings). */
export type ServerStatus = Record<string, string>;

/** One persisted history sample: raw cumulative counters + unix-second timestamp.
 * Rates (QPS, etc.) are derived by diffing consecutive samples. */
export interface MonitorSample {
  ts: number;
  queries: number | null;
  slowQueries: number | null;
  bytesSent: number | null;
  bytesReceived: number | null;
  threadsRunning: number | null;
  threadsConnected: number | null;
  bpReadRequests: number | null;
  bpReads: number | null;
  uptime: number | null;
}

export interface QueryTab extends BaseTab {
  kind: "query";
  /** The SQL the user is editing. */
  sql: string;
  /** Max rows to fetch; null = no limit (user opted out of the safety cap). */
  maxRows: number | null;
  /** Last execution's result; null until the first run. */
  result: QueryResult | null;
  loading: boolean;
  error: string | null;
  /** True between a Stop request and the query settling, so the UI can show a
   * "stopped" state rather than an error when the kill interrupts it. */
  stopping: boolean;
  /** Wall-clock start (Date.now) of the current run; null when idle. Drives the
   * live round-trip timer. */
  runStartedAt: number | null;
  /** Live server-side elapsed (ms) from progress events during a run. */
  liveServerMs: number;
  /** Final wall-clock round-trip (ms) of the last completed run; null until one. */
  roundTripMs: number | null;
  /** Named queries saved for this tab's database (alphabetized in the UI). */
  savedQueries: SavedQuery[];
  /** The saved query whose SQL is currently loaded, or null. */
  activeSavedQuery: string | null;
  /** Silent execution history for this tab's database, most-recent-first. */
  queryHistory: QueryHistoryItem[];
}

/** One column row in the table designer. Numeric fields are kept as strings
 * (raw input) and parsed only when DDL is generated. */
export interface ColumnDraft {
  id: string;
  name: string;
  type: string;
  length: string;
  decimals: string;
  notNull: boolean;
  key: boolean;
  comment: string;
  /** Extended / advanced options, surfaced in a collapsible per-column panel. */
  autoIncrement: boolean;
  defaultValue: string;
  unsigned: boolean;
  zerofill: boolean;
  /** The column's name as loaded (edit mode only); absent for newly-added columns.
   * Used to diff against the live edits when generating ALTER TABLE. */
  originalName?: string;
}

/** Full column metadata from the backend, used to seed the editor in edit mode. */
export interface ColumnDef {
  name: string;
  columnType: string;
  nullable: boolean;
  key: string;
  defaultValue: string | null;
  extra: string;
  comment: string;
}

export type IndexDirection = "ASC" | "DESC";
export type IndexType = "NORMAL" | "UNIQUE" | "FULLTEXT" | "SPATIAL";
export type IndexMethod = "BTREE" | "HASH";

/** One column participating in an index, with its sort direction. */
export interface IndexColumnRef {
  column: string;
  direction: IndexDirection;
}

/** One index row in the table designer. */
export interface IndexDraft {
  id: string;
  name: string;
  columns: IndexColumnRef[];
  indexType: IndexType;
  method: IndexMethod;
  comment: string;
  /** The index's name as loaded (edit mode only); absent for newly-added
   * indexes. Used to diff against the live edits when generating ALTER TABLE. */
  originalName?: string;
}

/** Index metadata from the backend, used to seed the editor in edit mode. */
export interface IndexDef {
  name: string;
  columns: IndexColumnRef[];
  indexType: IndexType;
  method: IndexMethod;
  comment: string;
}

export interface CreateTableTab extends BaseTab {
  kind: "create-table";
  mode: "create" | "edit";
  tableName: string;
  /** Edit mode: the table's name when opened (ALTER target + rename detection). */
  originalName: string;
  /** Table-level COMMENT. */
  tableComment: string;
  /** Edit mode: the table's comment when opened, for change detection. */
  originalTableComment: string;
  columns: ColumnDraft[];
  /** Edit mode: snapshot of the loaded columns, for diffing into ALTER clauses. */
  originalColumns: ColumnDraft[];
  /** Secondary indexes (PRIMARY KEY is driven by per-column `key`). */
  indexes: IndexDraft[];
  /** Edit mode: snapshot of the loaded indexes, for diffing into ALTER clauses. */
  originalIndexes: IndexDraft[];
  /** Edit mode: the table's next AUTO_INCREMENT value (raw input string). */
  autoIncrementValue: string;
  /** Edit mode: the loaded AUTO_INCREMENT, for change detection. Empty when the
   * table has no auto-increment column. */
  originalAutoIncrementValue: string;
  /** Create mode: folder the new table should join once created (when the
   * designer was opened from inside a folder). */
  targetFolderId?: string | null;
}

export type Tab =
  | RowsTab
  | DatabaseTab
  | RelationsTab
  | CreateTableTab
  | QueryTab;
