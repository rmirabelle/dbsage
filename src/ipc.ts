import { invoke } from "@tauri-apps/api/core";
import type {
  ColumnFilter,
  Folder,
  ProfileInput,
  ProfileView,
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
  fetchRows: (args: {
    profileId: string;
    database: string;
    table: string;
    limit: number;
    offset: number;
    sort: SortSpec | null;
    filters: ColumnFilter[];
  }) => invoke<RowsResult>("fetch_rows", args),

  updateCell: (args: {
    profileId: string;
    database: string;
    table: string;
    pk: { column: string; value: string | null }[];
    column: string;
    value: string | null;
  }) => invoke<number>("update_cell", args),

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
};
