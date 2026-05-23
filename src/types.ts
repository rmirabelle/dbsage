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

export interface ImportSummary {
  profiles: number;
  relations: number;
  folders: number;
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

export interface CreateTableTab extends BaseTab {
  kind: "create-table";
  mode: "create" | "edit";
  tableName: string;
  /** Edit mode: the table's name when opened (ALTER target + rename detection). */
  originalName: string;
  columns: ColumnDraft[];
  /** Edit mode: snapshot of the loaded columns, for diffing into ALTER clauses. */
  originalColumns: ColumnDraft[];
  /** Edit mode: the table's next AUTO_INCREMENT value (raw input string). */
  autoIncrementValue: string;
  /** Edit mode: the loaded AUTO_INCREMENT, for change detection. Empty when the
   * table has no auto-increment column. */
  originalAutoIncrementValue: string;
}

export type Tab = RowsTab | DatabaseTab | RelationsTab | CreateTableTab;
