import { invoke } from "@tauri-apps/api/core";
import type {
  ColumnDef,
  ColumnFilter,
  ColumnInfo,
  Folder,
  ImportSummary,
  ProfileInput,
  ProfileView,
  Relation,
  RowsResult,
  SortSpec,
  TableInfo,
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
  tableAutoIncrement: (profileId: string, database: string, table: string) =>
    invoke<number | null>("table_auto_increment", { profileId, database, table }),
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

  exportState: (path: string, passphrase: string) =>
    invoke<void>("export_state", { path, passphrase }),
  importState: (path: string, passphrase: string) =>
    invoke<ImportSummary>("import_state", { path, passphrase }),
};
