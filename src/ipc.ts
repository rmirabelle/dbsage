import { invoke } from "@tauri-apps/api/core";
import type {
  CellValue,
  ColumnDef,
  ColumnFilter,
  ColumnInfo,
  ColumnSetup,
  Folder,
  ImportSummary,
  IndexDef,
  ProfileInput,
  ProfileView,
  QueryResult,
  Relation,
  RowsResult,
  SortSpec,
  StateCounts,
  StateSelection,
  TableInfo,
  TableViewPreset,
} from "./types";

export const ipc = {
  listProfiles: () => invoke<ProfileView[]>("list_profiles"),
  saveProfile: (input: ProfileInput) =>
    invoke<ProfileView>("save_profile", { input }),
  deleteProfile: (id: string) => invoke<void>("delete_profile", { id }),

  testConnection: (input: {
    host: string;
    port: number;
    username: string;
    password: string;
    defaultDatabase?: string | null;
  }) => invoke<void>("test_connection", { input }),

  openConnection: (profileId: string) =>
    invoke<void>("open_connection", { profileId }),
  closeConnection: (profileId: string) =>
    invoke<void>("close_connection", { profileId }),
  isConnected: (profileId: string) =>
    invoke<boolean>("is_connected", { profileId }),

  listDatabases: (profileId: string) =>
    invoke<string[]>("list_databases", { profileId }),
  createDatabase: (profileId: string, name: string) =>
    invoke<void>("create_database", { profileId, name }),
  dropDatabase: (profileId: string, name: string) =>
    invoke<void>("drop_database", { profileId, name }),
  listTables: (profileId: string, database: string) =>
    invoke<TableInfo[]>("list_tables", { profileId, database }),
  listColumns: (profileId: string, database: string, table: string) =>
    invoke<ColumnInfo[]>("list_columns", { profileId, database, table }),
  fetchRows: (args: {
    profileId: string;
    database: string;
    table: string;
    limit: number;
    offset: number;
    sort: SortSpec | null;
    filters: ColumnFilter[];
  }) => invoke<RowsResult>("fetch_rows", args),

  countRows: (args: {
    profileId: string;
    database: string;
    table: string;
    filters: ColumnFilter[];
  }) => invoke<number>("count_rows", args),

  executeQuery: (args: {
    profileId: string;
    database: string;
    sql: string;
    token: string;
    maxRows: number | null;
  }) => invoke<QueryResult>("execute_query", args),

  cancelQuery: (profileId: string, token: string) =>
    invoke<void>("cancel_query", { profileId, token }),

  updateCell: (args: {
    profileId: string;
    database: string;
    table: string;
    pk: { column: string; value: string | null }[];
    column: string;
    value: string | null;
  }) => invoke<number>("update_cell", args),

  tableExists: (profileId: string, database: string, table: string) =>
    invoke<boolean>("table_exists", { profileId, database, table }),
  createTable: (args: {
    profileId: string;
    database: string;
    tableName: string;
    sql: string;
    overwrite: boolean;
  }) => invoke<void>("create_table", args),
  copyTable: (args: {
    profileId: string;
    sourceDatabase: string;
    sourceTable: string;
    targetDatabase: string;
    includeData: boolean;
  }) => invoke<void>("copy_table", args),
  truncateTable: (profileId: string, database: string, table: string) =>
    invoke<void>("truncate_table", { profileId, database, table }),
  dropTable: (profileId: string, database: string, table: string) =>
    invoke<void>("drop_table", { profileId, database, table }),
  renameTable: (
    profileId: string,
    database: string,
    oldName: string,
    newName: string
  ) => invoke<void>("rename_table", { profileId, database, oldName, newName }),
  columnDefinitions: (profileId: string, database: string, table: string) =>
    invoke<ColumnDef[]>("column_definitions", { profileId, database, table }),
  indexDefinitions: (profileId: string, database: string, table: string) =>
    invoke<IndexDef[]>("index_definitions", { profileId, database, table }),
  tableAutoIncrement: (profileId: string, database: string, table: string) =>
    invoke<number | null>("table_auto_increment", { profileId, database, table }),
  tableComment: (profileId: string, database: string, table: string) =>
    invoke<string>("table_comment", { profileId, database, table }),
  exportTableSql: (
    profileId: string,
    database: string,
    table: string,
    path: string,
    includeData: boolean
  ) =>
    invoke<boolean>("export_table_sql", {
      profileId,
      database,
      table,
      path,
      includeData,
    }),
  cancelTableSqlExport: () => invoke<void>("cancel_table_sql_export"),
  runDdl: (profileId: string, database: string, sql: string) =>
    invoke<void>("run_ddl", { profileId, database, sql }),

  listRelations: (profileId: string, database: string) =>
    invoke<Relation[]>("list_relations", { profileId, database }),
  saveRelation: (args: {
    profileId: string;
    database: string;
    id?: string | null;
    fromTable: string;
    fromColumn: string;
    toTable: string;
    toColumn: string;
    kind: string;
    name?: string;
  }) => invoke<Relation>("save_relation", args),
  deleteRelation: (profileId: string, database: string, id: string) =>
    invoke<void>("delete_relation", { profileId, database, id }),

  listFolders: (profileId: string, database: string) =>
    invoke<Folder[]>("list_folders", { profileId, database }),
  createFolder: (profileId: string, database: string, name: string) =>
    invoke<Folder>("create_folder", { profileId, database, name }),
  renameFolder: (
    profileId: string,
    database: string,
    folderId: string,
    name: string
  ) => invoke<Folder>("rename_folder", { profileId, database, folderId, name }),
  deleteFolder: (profileId: string, database: string, folderId: string) =>
    invoke<void>("delete_folder", { profileId, database, folderId }),
  setTableFolder: (
    profileId: string,
    database: string,
    table: string,
    folderId: string | null
  ) =>
    invoke<void>("set_table_folder", {
      profileId,
      database,
      table,
      folderId,
    }),

  getColumnSetup: (profileId: string, database: string, table: string) =>
    invoke<ColumnSetup | null>("get_column_setup", {
      profileId,
      database,
      table,
    }),
  listTablePresets: (profileId: string, database: string, table: string) =>
    invoke<TableViewPreset[]>("list_table_presets", { profileId, database, table }),
  saveTablePreset: (
    profileId: string,
    database: string,
    table: string,
    preset: TableViewPreset
  ) => invoke<void>("save_table_preset", { profileId, database, table, preset }),
  deleteTablePreset: (
    profileId: string,
    database: string,
    table: string,
    name: string
  ) => invoke<void>("delete_table_preset", { profileId, database, table, name }),
  saveColumnSetup: (
    profileId: string,
    database: string,
    table: string,
    setup: ColumnSetup
  ) => invoke<void>("save_column_setup", { profileId, database, table, setup }),

  exportState: (path: string, passphrase: string, selection: StateSelection) =>
    invoke<void>("export_state", { path, passphrase, selection }),
  previewState: (path: string, passphrase: string) =>
    invoke<StateCounts>("preview_state", { path, passphrase }),
  importState: (path: string, passphrase: string, selection: StateSelection) =>
    invoke<ImportSummary>("import_state", { path, passphrase, selection }),

  exportQuery: (args: {
    path: string;
    format: "csv" | "json" | "xlsx";
    columns: string[];
    rows: CellValue[][];
  }) => invoke<void>("export_query", args),
};
