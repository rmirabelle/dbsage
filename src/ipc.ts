import { invoke } from "@tauri-apps/api/core";
import type {
  BackupManifest,
  CellValue,
  ColumnDef,
  ColumnFilter,
  ColumnInfo,
  ColumnSetup,
  Folder,
  ImportSummary,
  IndexDef,
  IniResolution,
  JsonColumnMapping,
  JsonImportPreview,
  JsonImportResult,
  LogConfig,
  LogTail,
  ProfileInput,
  MonitorSample,
  ProcessRow,
  ProfileView,
  QueryHistoryItem,
  QueryResult,
  Relation,
  RestoreOptions,
  RowsResult,
  SavedQuery,
  ServerResources,
  ServerStatus,
  ServiceInfo,
  SortSpec,
  StateCounts,
  StateSelection,
  TableInfo,
  TableSchemaEntry,
  TableSchemaMeta,
  TableViewPreset,
} from "./types";
import type { QueryAnalysisInput } from "./lib/queryAnalysis/types";

export const ipc = {
  listProfiles: () => invoke<ProfileView[]>("list_profiles"),
  saveProfile: (input: ProfileInput) =>
    invoke<ProfileView>("save_profile", { input }),
  reorderProfiles: (ids: string[]) =>
    invoke<void>("reorder_profiles", { ids }),
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

  analyzeQuery: (args: {
    profileId: string;
    database: string;
    sql: string;
    runAnalyze: boolean;
  }) => invoke<QueryAnalysisInput>("analyze_query", args),

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

  insertRow: (args: {
    profileId: string;
    database: string;
    table: string;
    values: { column: string; value: string | null }[];
  }) => invoke<number>("insert_row", args),

  deleteRow: (args: {
    profileId: string;
    database: string;
    table: string;
    pk: { column: string; value: string | null }[];
  }) => invoke<number>("delete_row", args),

  /** Server-side row copy: re-inserts the row identified by `pk`, skipping
   * auto-increment/generated columns. Returns a structured outcome — "conflict"
   * means a unique/PK violation the caller can offer to edit-and-retry. */
  duplicateRow: (args: {
    profileId: string;
    database: string;
    table: string;
    pk: { column: string; value: string | null }[];
  }) =>
    invoke<{ status: "ok" | "conflict" | "error"; message: string | null }>(
      "duplicate_row",
      args
    ),

  /** Check a candidate row against every unique index; returns the indexes that
   * already have a matching row, so the duplicate-edit dialog can highlight all
   * colliding columns at once. */
  checkRowConflicts: (args: {
    profileId: string;
    database: string;
    table: string;
    values: { column: string; value: string | null }[];
  }) =>
    invoke<{ indexName: string; columns: string[] }[]>(
      "check_row_conflicts",
      args
    ),

  listQueryHistory: (profileId: string, database: string) =>
    invoke<QueryHistoryItem[]>("list_query_history", { profileId, database }),
  addQueryHistory: (profileId: string, database: string, sql: string) =>
    invoke<QueryHistoryItem[]>("add_query_history", { profileId, database, sql }),
  deleteQueryHistory: (profileId: string, database: string, sql: string) =>
    invoke<void>("delete_query_history", { profileId, database, sql }),
  clearQueryHistory: (profileId: string, database: string) =>
    invoke<void>("clear_query_history", { profileId, database }),

  tableExists: (profileId: string, database: string, table: string) =>
    invoke<boolean>("table_exists", { profileId, database, table }),
  createTable: (args: {
    profileId: string;
    database: string;
    tableName: string;
    sql: string;
    overwrite: boolean;
  }) => invoke<void>("create_table", args),
  /** Resolves true when the copy completed, false when the user cancelled it. */
  copyTable: (args: {
    profileId: string;
    sourceDatabase: string;
    sourceTable: string;
    targetProfileId?: string;
    targetDatabase: string;
    /** New table name; omit to keep the source name (cross-database copy). */
    targetTable?: string;
    includeData: boolean;
  }) => invoke<boolean>("copy_table", args),
  cancelTableCopy: () => invoke<void>("cancel_table_copy"),
  /** Inspect a JSON file (row count, property keys, sample) for the import wizard. */
  jsonImportPreview: (path: string) =>
    invoke<JsonImportPreview>("json_import_preview", { path }),
  /** Import rows from a JSON file using a property→column mapping. Resolves with
   * the inserted count, or `cancelled: true` when stopped mid-run. */
  importJsonRows: (args: {
    profileId: string;
    database: string;
    table: string;
    path: string;
    mappings: JsonColumnMapping[];
    /** Skip rows that fail to insert instead of rolling the whole import back. */
    continueOnError: boolean;
  }) => invoke<JsonImportResult>("import_json_rows", args),
  cancelJsonImport: () => invoke<void>("cancel_json_import"),
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
  tableSchemaMeta: (profileId: string, database: string, table: string) =>
    invoke<TableSchemaMeta>("table_schema_meta", { profileId, database, table }),
  databaseSchema: (profileId: string, database: string) =>
    invoke<TableSchemaEntry[]>("database_schema", { profileId, database }),
  exportTableSql: (
    profileId: string,
    database: string,
    tables: string[],
    path: string,
    includeData: boolean
  ) =>
    invoke<boolean>("export_table_sql", {
      profileId,
      database,
      tables,
      path,
      includeData,
    }),
  cancelTableSqlExport: () => invoke<void>("cancel_table_sql_export"),
  runDdl: (profileId: string, database: string, sql: string) =>
    invoke<void>("run_ddl", { profileId, database, sql }),

  backupDatabase: (profileId: string, database: string, path: string) =>
    invoke<boolean>("backup_database", { profileId, database, path }),
  cancelBackup: () => invoke<void>("cancel_backup"),
  inspectBackup: (path: string) =>
    invoke<BackupManifest>("inspect_backup", { path }),
  restoreDatabase: (
    profileId: string,
    targetDatabase: string,
    path: string,
    options: RestoreOptions
  ) =>
    invoke<boolean>("restore_database", {
      profileId,
      targetDatabase,
      path,
      options,
    }),
  cancelRestore: () => invoke<void>("cancel_restore"),
  swapDatabase: (
    profileId: string,
    liveDatabase: string,
    restoredDatabase: string
  ) =>
    invoke<string>("swap_database", {
      profileId,
      liveDatabase,
      restoredDatabase,
    }),

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
  tablesWithPresets: (profileId: string, database: string) =>
    invoke<string[]>("tables_with_presets", { profileId, database }),
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
  listProcesses: (profileId: string) =>
    invoke<ProcessRow[]>("list_processes", { profileId }),
  serverResources: (profileId: string) =>
    invoke<ServerResources>("server_resources", { profileId }),
  globalStatus: (profileId: string) =>
    invoke<ServerStatus>("global_status", { profileId }),
  globalVariables: (profileId: string) =>
    invoke<ServerStatus>("global_variables", { profileId }),
  monitorHistory: (profileId: string, sinceSecs: number) =>
    invoke<MonitorSample[]>("monitor_history", { profileId, sinceSecs }),
  killProcess: (profileId: string, id: number, queryOnly: boolean) =>
    invoke<void>("kill_process", { profileId, id, queryOnly }),
  openMonitorWindow: (profileId: string) =>
    invoke<void>("open_monitor_window", { profileId }),
  readWindowSeed: <T>(label: string) =>
    invoke<T | null>("read_window_seed", { label }),
  openTabWindow: (
    seed: unknown,
    title: string,
    x: number,
    y: number,
    width: number,
    height: number
  ) =>
    invoke<void>("open_tab_window", { seed, title, x, y, width, height }),
  openPeekWindow: (
    seed: unknown,
    x: number,
    y: number,
    width: number,
    height: number
  ) => invoke<void>("open_peek_window", { seed, x, y, width, height }),
  listOpenPeeks: <T>() => invoke<T[]>("list_open_peeks"),
  setPeekColumns: (label: string, hiddenColumns: string[]) =>
    invoke<void>("set_peek_columns", { label, hiddenColumns }),
  setPeekInspector: (label: string, open: boolean) =>
    invoke<void>("set_peek_inspector", { label, open }),
  closeAllPeeks: () => invoke<void>("close_all_peeks"),
  setTabstripRect: (rect: unknown | null) =>
    invoke<void>("set_tabstrip_rect", { rect }),
  getTabstripRect: <T>() => invoke<T | null>("get_tabstrip_rect"),
  mouseLeftButtonDown: () => invoke<boolean>("mouse_left_button_down"),
  cursorPosition: () => invoke<[number, number]>("cursor_position"),
  mysqlServiceStatus: (profileId: string) =>
    invoke<ServiceInfo | null>("mysql_service_status", { profileId }),
  serviceControl: (profileId: string, action: "start" | "stop" | "restart") =>
    invoke<void>("service_control", { profileId, action }),
  setServiceStartMode: (
    profileId: string,
    mode: "auto" | "manual" | "disabled"
  ) => invoke<void>("set_service_start_mode", { profileId, mode }),
  openAdminWindow: (profileId: string) =>
    invoke<void>("open_admin_window", { profileId }),
  logConfig: (profileId: string) =>
    invoke<LogConfig>("log_config", { profileId }),
  readLogTail: (
    profileId: string,
    kind: "error" | "slow" | "general",
    maxBytes: number
  ) => invoke<LogTail>("read_log_tail", { profileId, kind, maxBytes }),
  resolveMyIni: (profileId: string) =>
    invoke<IniResolution>("resolve_my_ini", { profileId }),
  readMyIni: (path: string) => invoke<string>("read_my_ini", { path }),
  saveMyIni: (path: string, content: string) =>
    invoke<void>("save_my_ini", { path, content }),
  listSavedQueries: (profileId: string, database: string) =>
    invoke<SavedQuery[]>("list_saved_queries", { profileId, database }),
  saveSavedQuery: (profileId: string, database: string, query: SavedQuery) =>
    invoke<void>("save_saved_query", { profileId, database, query }),
  deleteSavedQuery: (profileId: string, database: string, name: string) =>
    invoke<void>("delete_saved_query", { profileId, database, name }),
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
