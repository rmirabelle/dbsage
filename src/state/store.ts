import { create } from "zustand";
import { ipc } from "../ipc";
import {
  columnDefToDraft,
  indexDefToDraft,
  buildCreateTableSql,
  buildAlterTableSql,
  droppedColumnNames,
} from "../lib/tableSql";
import { notifyError, notifySuccess, notifyInfo } from "./notify";
import type {
  ColumnFilter,
  CreateTableTab,
  DatabaseTab,
  Folder,
  ProfileView,
  QueryTab,
  Relation,
  RelationsTab,
  RowsTab,
  SortSpec,
  Tab,
  TableInfo,
} from "../types";

/** Default row cap for a new query pane — a safety net against fetching a huge
 * result set into memory. The user can raise it or choose "No limit" per tab. */
const DEFAULT_QUERY_MAX_ROWS = 1000;

/** True when a table-designer tab has changes worth confirming before close. */
export function isDesignerTabDirty(tab: CreateTableTab): boolean {
  if (tab.mode === "edit") {
    const alter = buildAlterTableSql(
      tab.originalName,
      tab.originalColumns,
      tab.tableName,
      tab.columns,
      tab.originalAutoIncrementValue,
      tab.autoIncrementValue,
      tab.originalIndexes,
      tab.indexes
    );
    /* buildAlterTableSql returns a `--` comment when nothing changed. */
    return !alter.startsWith("--");
  }
  return (
    tab.tableName.trim() !== "" ||
    tab.columns.length > 0 ||
    tab.indexes.length > 0
  );
}

/** Persist a rows tab's column setup (visibility, filters, JSON "Show") to the
 * backend store so reopening the table restores it. Best-effort. */
function persistColumnSetup(tab: RowsTab) {
  ipc
    .saveColumnSetup(tab.profileId, tab.database, tab.table, {
      hiddenColumns: tab.hiddenColumns,
      filters: tab.filters,
      jsonDisplay: tab.jsonDisplay,
    })
    .catch(() => {
      /* persistence is best-effort */
    });
}

interface TreeDbState {
  loading: boolean;
  error: string | null;
  items: { name: string; kind: string }[];
  folders: Folder[];
  expandedFolders: Set<string>;
}

interface DbTree {
  loading: boolean;
  error: string | null;
  databases: string[];
  tablesByDb: Record<string, TreeDbState>;
  expandedDbs: Set<string>;
}

interface Store {
  profiles: ProfileView[];
  loadingProfiles: boolean;

  connections: Record<string, { connected: boolean; connecting: boolean; error: string | null }>;
  trees: Record<string, DbTree>;
  expandedProfiles: Set<string>;

  tabs: Tab[];
  activeTabId: string | null;
  /** Tab awaiting an unsaved-changes confirmation before it closes; null when none. */
  pendingCloseTabId: string | null;
  /** Last table opened per `${profileId}::${database}`, for re-selecting in the DB view. */
  lastOpenedTables: Record<string, string>;
  /** Defined relations per `${profileId}::${database}`. */
  relations: Record<string, Relation[]>;

  loadProfiles: () => Promise<void>;
  /** Refresh visible state after a bundle import (profiles, open tabs, tree folders, relations). */
  reloadAfterImport: () => Promise<void>;
  connectProfile: (profileId: string) => Promise<void>;
  disconnectProfile: (profileId: string) => Promise<void>;
  /** Create a new database on the connection (connecting first if needed),
   * then refresh the tree's database list and expand the profile. */
  createDatabase: (profileId: string, name: string) => Promise<void>;
  /** Permanently drop a database: removes it from the tree and closes any of
   * its open tabs. */
  dropDatabase: (profileId: string, database: string) => Promise<void>;
  toggleProfileExpanded: (profileId: string) => Promise<void>;
  toggleDbExpanded: (profileId: string, db: string) => Promise<void>;
  toggleFolderExpandedInTree: (profileId: string, db: string, folderId: string) => void;

  openDatabase: (profileId: string, profileName: string, database: string) => Promise<void>;
  setDatabaseFilter: (tabId: string, filter: string) => void;
  enterFolder: (tabId: string, folderId: string) => void;
  exitFolder: (tabId: string) => void;

  createFolder: (tabId: string, name: string) => Promise<Folder | null>;
  renameFolder: (tabId: string, folderId: string, name: string) => Promise<void>;
  deleteFolder: (tabId: string, folderId: string) => Promise<void>;
  /** Folder rename/delete addressed by (profile, database) — used by the sidebar tree. */
  renameFolderInDb: (
    profileId: string,
    database: string,
    folderId: string,
    name: string
  ) => Promise<void>;
  deleteFolderInDb: (
    profileId: string,
    database: string,
    folderId: string
  ) => Promise<void>;
  setTableFolder: (tabId: string, table: string, folderId: string | null) => Promise<void>;
  setTablesFolder: (tabId: string, tables: string[], folderId: string | null) => Promise<void>;

  openTable: (profileId: string, profileName: string, database: string, table: string) => Promise<void>;
  /** Empty a table (TRUNCATE) and refresh any open views of it. */
  truncateTable: (profileId: string, database: string, table: string) => Promise<void>;
  /** Drop a table, close any open tabs for it, and refresh the DB view + tree. */
  deleteTable: (profileId: string, database: string, table: string) => Promise<void>;
  /** Rename a table (and its folder membership); updates open tabs + refreshes. */
  renameTable: (
    profileId: string,
    database: string,
    oldName: string,
    newName: string
  ) => Promise<void>;
  openRelations: (profileId: string, profileName: string, database: string) => void;
  /** Open a new, empty SQL query pane scoped to a connection + database. */
  openQuery: (profileId: string, profileName: string, database: string) => void;
  setQuerySql: (tabId: string, sql: string) => void;
  /** Set the query pane's row cap (null = no limit). */
  setQueryMaxRows: (tabId: string, maxRows: number | null) => void;
  /** Switch a query pane to another connection (connecting if needed) and
   * default its database to a valid one. */
  setQueryConnection: (tabId: string, profileId: string) => Promise<void>;
  setQueryDatabase: (tabId: string, database: string) => void;
  /** Run the query pane's SQL against its connection + database. */
  executeQuery: (tabId: string) => Promise<void>;
  /** Request cancellation of a running query (KILL QUERY server-side). */
  stopQuery: (tabId: string) => Promise<void>;
  openTableDesigner: (profileId: string, profileName: string, database: string) => void;
  /** Open the designer in edit mode, pre-loaded with an existing table's columns. */
  openTableEditor: (
    profileId: string,
    profileName: string,
    database: string,
    table: string
  ) => Promise<void>;
  updateCreateTable: (
    tabId: string,
    patch: Partial<
      Pick<
        CreateTableTab,
        "tableName" | "columns" | "indexes" | "autoIncrementValue"
      >
    >
  ) => void;
  /** After a table is created: close the designer tab and open the DB view with
   * the new table selected. */
  finishTableCreation: (
    createTabId: string,
    profileId: string,
    profileName: string,
    database: string,
    tableName: string
  ) => Promise<void>;
  loadRelations: (profileId: string, database: string) => Promise<void>;
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
  }) => Promise<void>;
  deleteRelation: (
    profileId: string,
    database: string,
    id: string
  ) => Promise<void>;
  closeTab: (tabId: string) => void;
  /** Close a tab, but first prompt for unsaved changes if it's a dirty designer tab. */
  requestCloseTab: (tabId: string) => void;
  setPendingCloseTabId: (tabId: string | null) => void;
  /** Persist a table-designer tab (create or edit). Returns ok=false with an
   * error message on validation failure, or ok=false silently when the user
   * declines a destructive sub-confirmation. */
  saveDesignerTab: (tabId: string) => Promise<{ ok: boolean; error?: string }>;
  setActiveTab: (tabId: string) => void;
  setTabPage: (tabId: string, page: number) => Promise<void>;
  setPageSize: (tabId: string, pageSize: number) => Promise<void>;
  refreshTab: (tabId: string) => Promise<void>;
  countExactRows: (tabId: string) => Promise<void>;

  setRowsSort: (tabId: string, sort: SortSpec | null) => Promise<void>;
  setRowsFilter: (tabId: string, column: string, filter: ColumnFilter | null) => Promise<void>;
  setHiddenColumns: (tabId: string, hidden: string[]) => void;
  /** Set (or clear, with null) a JSON column's display property path. */
  setJsonDisplay: (tabId: string, column: string, path: string | null) => void;

  updateCell: (
    tabId: string,
    rowIndex: number,
    column: string,
    newValue: string | null
  ) => Promise<void>;
}

const defaultTree = (): DbTree => ({
  loading: false,
  error: null,
  databases: [],
  tablesByDb: {},
  expandedDbs: new Set(),
});

const emptyTreeDbState = (): TreeDbState => ({
  loading: true,
  error: null,
  items: [],
  folders: [],
  expandedFolders: new Set(),
});

export const useStore = create<Store>((set, get) => ({
  profiles: [],
  loadingProfiles: false,
  connections: {},
  trees: {},
  expandedProfiles: new Set(),
  tabs: [],
  activeTabId: null,
  pendingCloseTabId: null,
  lastOpenedTables: {},
  relations: {},

  loadProfiles: async () => {
    set({ loadingProfiles: true });
    try {
      const profiles = await ipc.listProfiles();
      set({ profiles, loadingProfiles: false });
    } catch (e) {
      console.error(e);
      set({ loadingProfiles: false });
    }
  },

  reloadAfterImport: async () => {
    await get().loadProfiles();

    const pairs = new Map<string, { profileId: string; database: string }>();
    for (const t of get().tabs) {
      pairs.set(`${t.profileId}::${t.database}`, {
        profileId: t.profileId,
        database: t.database,
      });
    }
    for (const [profileId, tree] of Object.entries(get().trees)) {
      for (const database of Object.keys(tree.tablesByDb)) {
        pairs.set(`${profileId}::${database}`, { profileId, database });
      }
    }

    for (const { profileId, database } of pairs.values()) {
      await refreshFoldersEverywhere(profileId, database, set, get);
      if (get().relations[`${profileId}::${database}`]) {
        await get().loadRelations(profileId, database);
      }
    }
  },

  connectProfile: async (profileId) => {
    set((s) => ({
      connections: {
        ...s.connections,
        [profileId]: { connected: false, connecting: true, error: null },
      },
    }));
    try {
      await ipc.openConnection(profileId);
      set((s) => ({
        connections: {
          ...s.connections,
          [profileId]: { connected: true, connecting: false, error: null },
        },
      }));
      const databases = await ipc.listDatabases(profileId);
      set((s) => ({
        trees: {
          ...s.trees,
          [profileId]: { ...defaultTree(), databases },
        },
      }));
    } catch (e) {
      const msg = String(e);
      set((s) => ({
        connections: {
          ...s.connections,
          [profileId]: { connected: false, connecting: false, error: msg },
        },
      }));
      throw e;
    }
  },

  createDatabase: async (profileId, name) => {
    const conn = get().connections[profileId];
    if (!conn?.connected) await get().connectProfile(profileId);
    await ipc.createDatabase(profileId, name);
    const databases = await ipc.listDatabases(profileId);
    set((s) => {
      const t = s.trees[profileId] ?? defaultTree();
      const exp = new Set(s.expandedProfiles);
      exp.add(profileId);
      return {
        trees: { ...s.trees, [profileId]: { ...t, databases } },
        expandedProfiles: exp,
      };
    });
    notifySuccess(`Database "${name}" created.`);
  },

  dropDatabase: async (profileId, database) => {
    await ipc.dropDatabase(profileId, database);
    set((s) => {
      let trees = s.trees;
      const t = s.trees[profileId];
      if (t) {
        const tablesByDb = { ...t.tablesByDb };
        delete tablesByDb[database];
        const expandedDbs = new Set(t.expandedDbs);
        expandedDbs.delete(database);
        trees = {
          ...s.trees,
          [profileId]: {
            ...t,
            databases: t.databases.filter((d) => d !== database),
            tablesByDb,
            expandedDbs,
          },
        };
      }
      /* Close every tab belonging to the dropped database. */
      const tabs = s.tabs.filter(
        (tab) => !(tab.profileId === profileId && tab.database === database)
      );
      let activeTabId = s.activeTabId;
      if (!tabs.some((tab) => tab.id === activeTabId)) {
        activeTabId = tabs[tabs.length - 1]?.id ?? null;
      }
      return { trees, tabs, activeTabId };
    });
    notifySuccess(`Database "${database}" dropped.`);
  },

  disconnectProfile: async (profileId) => {
    try {
      await ipc.closeConnection(profileId);
    } catch (e) {
      console.warn(e);
    }
    set((s) => {
      const next = { ...s.trees };
      delete next[profileId];
      const exp = new Set(s.expandedProfiles);
      exp.delete(profileId);
      return {
        trees: next,
        expandedProfiles: exp,
        connections: {
          ...s.connections,
          [profileId]: { connected: false, connecting: false, error: null },
        },
        tabs: s.tabs.filter((t) => t.profileId !== profileId),
      };
    });
  },

  toggleProfileExpanded: async (profileId) => {
    const wasExpanded = get().expandedProfiles.has(profileId);
    set((s) => {
      const next = new Set(s.expandedProfiles);
      if (wasExpanded) next.delete(profileId);
      else next.add(profileId);
      return { expandedProfiles: next };
    });
    if (wasExpanded) return;

    const conn = get().connections[profileId];
    if (!conn?.connected) {
      try {
        await get().connectProfile(profileId);
      } catch {
        /* error already captured */
      }
    }
  },

  toggleDbExpanded: async (profileId, db) => {
    const tree = get().trees[profileId];
    if (!tree) return;
    const wasExpanded = tree.expandedDbs.has(db);

    set((s) => {
      const t = s.trees[profileId];
      if (!t) return {};
      const expandedDbs = new Set(t.expandedDbs);
      if (wasExpanded) expandedDbs.delete(db);
      else expandedDbs.add(db);
      return { trees: { ...s.trees, [profileId]: { ...t, expandedDbs } } };
    });

    if (wasExpanded) return;
    if (tree.tablesByDb[db]?.items.length) return;

    await loadTreeDb(profileId, db, set, get);
  },

  toggleFolderExpandedInTree: (profileId, db, folderId) => {
    set((s) => {
      const t = s.trees[profileId];
      const dbState = t?.tablesByDb[db];
      if (!t || !dbState) return {};
      const expandedFolders = new Set(dbState.expandedFolders);
      if (expandedFolders.has(folderId)) expandedFolders.delete(folderId);
      else expandedFolders.add(folderId);
      return {
        trees: {
          ...s.trees,
          [profileId]: {
            ...t,
            tablesByDb: {
              ...t.tablesByDb,
              [db]: { ...dbState, expandedFolders },
            },
          },
        },
      };
    });
  },

  openDatabase: async (profileId, profileName, database) => {
    const tabId = `db::${profileId}::${database}`;
    const existing = get().tabs.find((t) => t.id === tabId);
    if (existing) {
      set({ activeTabId: tabId });
      return;
    }

    const tab: DatabaseTab = {
      id: tabId,
      kind: "database",
      profileId,
      profileName,
      database,
      loading: true,
      error: null,
      tables: [],
      folders: [],
      filter: "",
      currentFolderId: null,
    };
    /* Only one database view at a time — replace the current one in place,
       keeping any open table tabs. */
    set((s) => {
      const idx = s.tabs.findIndex((t) => t.kind === "database");
      const tabs = s.tabs.slice();
      if (idx >= 0) tabs[idx] = tab;
      else tabs.push(tab);
      return { tabs, activeTabId: tabId };
    });
    await loadDatabaseTab(tabId, set, get);
  },

  setDatabaseFilter: (tabId, filter) => {
    set((s) => ({
      tabs: s.tabs.map((t) =>
        t.id === tabId && t.kind === "database" ? { ...t, filter } : t
      ),
    }));
  },

  enterFolder: (tabId, folderId) => {
    set((s) => ({
      tabs: s.tabs.map((t) =>
        t.id === tabId && t.kind === "database"
          ? { ...t, currentFolderId: folderId, filter: "" }
          : t
      ),
    }));
  },

  exitFolder: (tabId) => {
    set((s) => ({
      tabs: s.tabs.map((t) =>
        t.id === tabId && t.kind === "database"
          ? { ...t, currentFolderId: null, filter: "" }
          : t
      ),
    }));
  },

  createFolder: async (tabId, name) => {
    const tab = get().tabs.find((t) => t.id === tabId);
    if (!tab || tab.kind !== "database") return null;
    try {
      const folder = await ipc.createFolder(tab.profileId, tab.database, name);
      await refreshFoldersEverywhere(tab.profileId, tab.database, set, get);
      return folder;
    } catch (e) {
      console.error(e);
      throw e;
    }
  },

  renameFolder: async (tabId, folderId, name) => {
    const tab = get().tabs.find((t) => t.id === tabId);
    if (!tab || tab.kind !== "database") return;
    await ipc.renameFolder(tab.profileId, tab.database, folderId, name);
    await refreshFoldersEverywhere(tab.profileId, tab.database, set, get);
  },

  deleteFolder: async (tabId, folderId) => {
    const tab = get().tabs.find((t) => t.id === tabId);
    if (!tab || tab.kind !== "database") return;
    await ipc.deleteFolder(tab.profileId, tab.database, folderId);
    set((s) => ({
      tabs: s.tabs.map((t) =>
        t.id === tabId && t.kind === "database" && t.currentFolderId === folderId
          ? { ...t, currentFolderId: null }
          : t
      ),
    }));
    await refreshFoldersEverywhere(tab.profileId, tab.database, set, get);
  },

  renameFolderInDb: async (profileId, database, folderId, name) => {
    const trimmed = name.trim();
    if (!trimmed) return;
    await ipc.renameFolder(profileId, database, folderId, trimmed);
    await refreshFoldersEverywhere(profileId, database, set, get);
  },

  deleteFolderInDb: async (profileId, database, folderId) => {
    await ipc.deleteFolder(profileId, database, folderId);
    /* If a database tab is currently inside this folder, pop it back to root. */
    set((s) => ({
      tabs: s.tabs.map((t) =>
        t.kind === "database" &&
        t.profileId === profileId &&
        t.database === database &&
        t.currentFolderId === folderId
          ? { ...t, currentFolderId: null }
          : t
      ),
    }));
    await refreshFoldersEverywhere(profileId, database, set, get);
  },

  setTableFolder: async (tabId, table, folderId) => {
    const tab = get().tabs.find((t) => t.id === tabId);
    if (!tab || tab.kind !== "database") return;
    await ipc.setTableFolder(tab.profileId, tab.database, table, folderId);
    await refreshFoldersEverywhere(tab.profileId, tab.database, set, get);
  },

  setTablesFolder: async (tabId, tables, folderId) => {
    const tab = get().tabs.find((t) => t.id === tabId);
    if (!tab || tab.kind !== "database") return;
    if (tables.length === 0) return;
    for (const name of tables) {
      await ipc.setTableFolder(tab.profileId, tab.database, name, folderId);
    }
    await refreshFoldersEverywhere(tab.profileId, tab.database, set, get);
  },

  openTable: async (profileId, profileName, database, table) => {
    const tabId = `rows::${profileId}::${database}::${table}`;
    set((s) => ({
      lastOpenedTables: {
        ...s.lastOpenedTables,
        [`${profileId}::${database}`]: table,
      },
    }));
    const existing = get().tabs.find((t) => t.id === tabId);
    if (existing) {
      set({ activeTabId: tabId });
      return;
    }

    const saved = await ipc.getColumnSetup(profileId, database, table);
    const tab: RowsTab = {
      id: tabId,
      kind: "rows",
      profileId,
      profileName,
      database,
      table,
      page: 1,
      pageSize: 500,
      data: null,
      exactTotal: null,
      loading: true,
      error: null,
      sort: null,
      filters: saved?.filters ?? [],
      hiddenColumns: saved?.hiddenColumns ?? [],
      jsonDisplay: saved?.jsonDisplay ?? {},
    };
    set((s) => ({ tabs: [...s.tabs, tab], activeTabId: tabId }));
    await loadTabPage(tabId, 1, set, get);
  },

  truncateTable: async (profileId, database, table) => {
    await ipc.truncateTable(profileId, database, table);
    /* Reload any open rows view of this table (now empty) and refresh the
       table list everywhere (row estimates change). */
    for (const t of get().tabs) {
      if (
        t.kind === "rows" &&
        t.profileId === profileId &&
        t.database === database &&
        t.table === table
      ) {
        await get().refreshTab(t.id);
      }
    }
    await refreshFoldersEverywhere(profileId, database, set, get);
  },

  deleteTable: async (profileId, database, table) => {
    await ipc.dropTable(profileId, database, table);
    /* Close any open rows tab for the now-gone table. */
    set((s) => {
      const tabs = s.tabs.filter(
        (t) =>
          !(
            t.kind === "rows" &&
            t.profileId === profileId &&
            t.database === database &&
            t.table === table
          )
      );
      const activeTabId = tabs.some((t) => t.id === s.activeTabId)
        ? s.activeTabId
        : tabs[tabs.length - 1]?.id ?? null;
      return { tabs, activeTabId };
    });
    await refreshFoldersEverywhere(profileId, database, set, get);
  },

  renameTable: async (profileId, database, oldName, newName) => {
    await ipc.renameTable(profileId, database, oldName, newName);
    /* Repoint any open rows tab (id encodes the table name) and the remembered
       selection at the new name. Folder membership is updated server-side. */
    const oldId = `rows::${profileId}::${database}::${oldName}`;
    const newId = `rows::${profileId}::${database}::${newName}`;
    set((s) => {
      const tabs = s.tabs.map((t) =>
        t.id === oldId && t.kind === "rows"
          ? { ...t, table: newName, id: newId }
          : t
      );
      const activeTabId = s.activeTabId === oldId ? newId : s.activeTabId;
      const key = `${profileId}::${database}`;
      const lastOpenedTables =
        s.lastOpenedTables[key] === oldName
          ? { ...s.lastOpenedTables, [key]: newName }
          : s.lastOpenedTables;
      return { tabs, activeTabId, lastOpenedTables };
    });
    await refreshFoldersEverywhere(profileId, database, set, get);
  },

  closeTab: (tabId) => {
    set((s) => {
      const idx = s.tabs.findIndex((t) => t.id === tabId);
      if (idx < 0) return s;
      const tabs = s.tabs.filter((t) => t.id !== tabId);
      let activeTabId = s.activeTabId;
      if (s.activeTabId === tabId) {
        activeTabId = tabs[Math.min(idx, tabs.length - 1)]?.id ?? null;
      }
      const pendingCloseTabId =
        s.pendingCloseTabId === tabId ? null : s.pendingCloseTabId;
      return { tabs, activeTabId, pendingCloseTabId };
    });
  },

  requestCloseTab: (tabId) => {
    const tab = get().tabs.find((t) => t.id === tabId);
    if (tab && tab.kind === "create-table" && isDesignerTabDirty(tab)) {
      set({ pendingCloseTabId: tabId });
      return;
    }
    get().closeTab(tabId);
  },

  setPendingCloseTabId: (tabId) => set({ pendingCloseTabId: tabId }),

  saveDesignerTab: async (tabId) => {
    const tab = get().tabs.find((t) => t.id === tabId);
    if (!tab || tab.kind !== "create-table") return { ok: false };
    const name = tab.tableName.trim();
    if (!name) return { ok: false, error: "Enter a table name." };
    if (tab.columns.filter((c) => c.name.trim()).length === 0) {
      return { ok: false, error: "Add at least one column with a name." };
    }

    if (tab.mode === "edit") {
      const alterSql = buildAlterTableSql(
        tab.originalName,
        tab.originalColumns,
        name,
        tab.columns,
        tab.originalAutoIncrementValue,
        tab.autoIncrementValue,
        tab.originalIndexes,
        tab.indexes
      );
      if (alterSql.startsWith("--")) {
        notifyInfo("No changes to apply.");
        return { ok: true };
      }
      const dropped = droppedColumnNames(tab.originalColumns, tab.columns);
      if (dropped.length > 0) {
        const ok = window.confirm(
          `This will permanently DROP ${dropped.length} column${
            dropped.length === 1 ? "" : "s"
          } and all of their data:\n\n${dropped.join(", ")}\n\n` +
            `This cannot be undone. Continue?`
        );
        if (!ok) return { ok: false };
      }
      try {
        await ipc.runDdl(tab.profileId, tab.database, alterSql);
        notifySuccess(`Table "${tab.originalName}" updated.`);
        /* Stay in the designer after saving: re-seed the tab from the now-saved
           table so the dirty baseline resets, rather than closing the tab. */
        await reloadDesignerTab(tab.id, name, set, get);
        /* Keep an open DB view in sync (e.g. after a rename) without switching
           away from the editor. */
        const dbTabId = `db::${tab.profileId}::${tab.database}`;
        if (get().tabs.some((t) => t.id === dbTabId)) {
          await loadDatabaseTab(dbTabId, set, get);
        }
        return { ok: true };
      } catch (e) {
        notifyError(`Could not alter table: ${String(e)}`);
        return { ok: false, error: String(e) };
      }
    }

    const sqlText = buildCreateTableSql(name, tab.columns, tab.indexes);
    try {
      const exists = await ipc.tableExists(tab.profileId, tab.database, name);
      if (exists) {
        const ok = window.confirm(
          `A table named "${name}" already exists in "${tab.database}".\n\n` +
            `Saving will DROP the existing table and ALL of its data, then recreate it. ` +
            `This cannot be undone.\n\nContinue?`
        );
        if (!ok) return { ok: false };
      }
      await ipc.createTable({
        profileId: tab.profileId,
        database: tab.database,
        tableName: name,
        sql: sqlText,
        overwrite: exists,
      });
      notifySuccess(
        `Table "${name}" ${exists ? "replaced" : "created"} in ${tab.database}.`
      );
      await get().finishTableCreation(
        tab.id,
        tab.profileId,
        tab.profileName,
        tab.database,
        name
      );
      return { ok: true };
    } catch (e) {
      notifyError(`Could not save table: ${String(e)}`);
      return { ok: false, error: String(e) };
    }
  },

  openRelations: (profileId, profileName, database) => {
    const tabId = `relations::${profileId}::${database}`;
    const existing = get().tabs.find((t) => t.id === tabId);
    if (existing) {
      set({ activeTabId: tabId });
      return;
    }
    const tab: RelationsTab = {
      id: tabId,
      kind: "relations",
      profileId,
      profileName,
      database,
    };
    set((s) => ({ tabs: [...s.tabs, tab], activeTabId: tabId }));
  },

  openQuery: (profileId, profileName, database) => {
    const tabId = `query::${profileId}::${database}::${Date.now()}`;
    const tab: QueryTab = {
      id: tabId,
      kind: "query",
      profileId,
      profileName,
      database,
      sql: "",
      maxRows: DEFAULT_QUERY_MAX_ROWS,
      result: null,
      loading: false,
      error: null,
      stopping: false,
    };
    set((s) => ({ tabs: [...s.tabs, tab], activeTabId: tabId }));
  },

  setQuerySql: (tabId, sql) => {
    set((s) => ({
      tabs: s.tabs.map((t) =>
        t.id === tabId && t.kind === "query" ? { ...t, sql } : t
      ),
    }));
  },

  setQueryMaxRows: (tabId, maxRows) => {
    set((s) => ({
      tabs: s.tabs.map((t) =>
        t.id === tabId && t.kind === "query" ? { ...t, maxRows } : t
      ),
    }));
  },

  setQueryConnection: async (tabId, profileId) => {
    const profile = get().profiles.find((p) => p.id === profileId);
    if (!profile) return;
    if (!get().connections[profileId]?.connected) {
      try {
        await get().connectProfile(profileId);
      } catch {
        /* connection error already surfaced on the connection state */
        return;
      }
    }
    const dbs = get().trees[profileId]?.databases ?? [];
    set((s) => ({
      tabs: s.tabs.map((t) =>
        t.id === tabId && t.kind === "query"
          ? {
              ...t,
              profileId,
              profileName: profile.name,
              database: dbs.includes(t.database) ? t.database : dbs[0] ?? "",
            }
          : t
      ),
    }));
  },

  setQueryDatabase: (tabId, database) => {
    set((s) => ({
      tabs: s.tabs.map((t) =>
        t.id === tabId && t.kind === "query" ? { ...t, database } : t
      ),
    }));
  },

  executeQuery: async (tabId) => {
    const tab = get().tabs.find((t) => t.id === tabId);
    if (!tab || tab.kind !== "query" || tab.loading) return;
    if (!tab.sql.trim()) return;
    set((s) => ({
      tabs: s.tabs.map((t) =>
        t.id === tabId && t.kind === "query"
          ? { ...t, loading: true, error: null, stopping: false }
          : t
      ),
    }));
    try {
      const result = await ipc.executeQuery({
        profileId: tab.profileId,
        database: tab.database,
        sql: tab.sql,
        token: tabId,
        maxRows: tab.maxRows,
      });
      set((s) => ({
        tabs: s.tabs.map((t) =>
          t.id === tabId && t.kind === "query"
            ? { ...t, loading: false, error: null, result }
            : t
        ),
      }));
      if (result.rowsAffected != null) {
        notifySuccess(
          `${result.rowsAffected} row${
            result.rowsAffected === 1 ? "" : "s"
          } affected.`
        );
      }
    } catch (e) {
      const msg = String(e);
      const current = get().tabs.find((t) => t.id === tabId);
      const wasStopped =
        (current?.kind === "query" && current.stopping) || /interrupted/i.test(msg);
      set((s) => ({
        tabs: s.tabs.map((t) =>
          t.id === tabId && t.kind === "query"
            ? { ...t, loading: false, stopping: false, error: wasStopped ? null : msg }
            : t
        ),
      }));
      if (wasStopped) notifyInfo("Query stopped.");
      else notifyError(`Query failed: ${msg}`);
    }
  },

  stopQuery: async (tabId) => {
    const tab = get().tabs.find((t) => t.id === tabId);
    if (!tab || tab.kind !== "query" || !tab.loading) return;
    set((s) => ({
      tabs: s.tabs.map((t) =>
        t.id === tabId && t.kind === "query" ? { ...t, stopping: true } : t
      ),
    }));
    try {
      await ipc.cancelQuery(tab.profileId, tabId);
    } catch (e) {
      notifyError(`Could not stop query: ${String(e)}`);
    }
  },

  openTableDesigner: (profileId, profileName, database) => {
    const tabId = `create-table::${profileId}::${database}::${Date.now()}`;
    const tab: CreateTableTab = {
      id: tabId,
      kind: "create-table",
      mode: "create",
      profileId,
      profileName,
      database,
      tableName: "",
      originalName: "",
      columns: [],
      originalColumns: [],
      indexes: [],
      originalIndexes: [],
      autoIncrementValue: "",
      originalAutoIncrementValue: "",
    };
    set((s) => ({ tabs: [...s.tabs, tab], activeTabId: tabId }));
  },

  openTableEditor: async (profileId, profileName, database, table) => {
    const tabId = `edit-table::${profileId}::${database}::${table}`;
    if (get().tabs.some((t) => t.id === tabId)) {
      set({ activeTabId: tabId });
      return;
    }
    const [defs, idxDefs, autoInc] = await Promise.all([
      ipc.columnDefinitions(profileId, database, table),
      ipc.indexDefinitions(profileId, database, table),
      ipc.tableAutoIncrement(profileId, database, table),
    ]);
    const columns = defs.map(columnDefToDraft);
    const indexes = idxDefs.map(indexDefToDraft);
    const ai = autoInc != null ? String(autoInc) : "";
    const tab: CreateTableTab = {
      id: tabId,
      kind: "create-table",
      mode: "edit",
      profileId,
      profileName,
      database,
      tableName: table,
      originalName: table,
      columns,
      originalColumns: columns.map((c) => ({ ...c })),
      indexes,
      originalIndexes: indexes.map((i) => ({
        ...i,
        columns: i.columns.map((c) => ({ ...c })),
      })),
      autoIncrementValue: ai,
      originalAutoIncrementValue: ai,
    };
    set((s) => ({ tabs: [...s.tabs, tab], activeTabId: tabId }));
  },

  updateCreateTable: (tabId, patch) => {
    set((s) => ({
      tabs: s.tabs.map((t) =>
        t.id === tabId && t.kind === "create-table" ? { ...t, ...patch } : t
      ),
    }));
  },

  finishTableCreation: async (createTabId, profileId, profileName, database, tableName) => {
    /* Remember the new table so the (re-mounted) DB view auto-selects it. */
    set((s) => ({
      lastOpenedTables: {
        ...s.lastOpenedTables,
        [`${profileId}::${database}`]: tableName,
      },
    }));
    /* Close the designer tab and any existing DB view for this database, then
       open a fresh one — remounting DatabaseView so it applies the remembered
       table as the selection and reloads the table list (including the new one). */
    const dbTabId = `db::${profileId}::${database}`;
    get().closeTab(createTabId);
    if (get().tabs.some((t) => t.id === dbTabId)) get().closeTab(dbTabId);
    await refreshFoldersEverywhere(profileId, database, set, get);
    await get().openDatabase(profileId, profileName, database);
  },

  loadRelations: async (profileId, database) => {
    const list = await ipc.listRelations(profileId, database);
    set((s) => ({
      relations: { ...s.relations, [`${profileId}::${database}`]: list },
    }));
  },

  saveRelation: async (args) => {
    await ipc.saveRelation(args);
    await get().loadRelations(args.profileId, args.database);
  },

  deleteRelation: async (profileId, database, id) => {
    await ipc.deleteRelation(profileId, database, id);
    await get().loadRelations(profileId, database);
  },

  setActiveTab: (tabId) => set({ activeTabId: tabId }),

  setTabPage: async (tabId, page) => {
    await loadTabPage(tabId, page, set, get);
  },

  setPageSize: async (tabId, pageSize) => {
    set((s) => ({
      tabs: s.tabs.map((t) =>
        t.id === tabId && t.kind === "rows" ? { ...t, pageSize, page: 1 } : t
      ),
    }));
    await loadTabPage(tabId, 1, set, get);
  },

  countExactRows: async (tabId) => {
    const tab = get().tabs.find((t) => t.id === tabId);
    if (!tab || tab.kind !== "rows") return;
    const exact = await ipc.countRows({
      profileId: tab.profileId,
      database: tab.database,
      table: tab.table,
      filters: tab.filters,
    });
    set((s) => ({
      tabs: s.tabs.map((t) =>
        t.id === tabId && t.kind === "rows" ? { ...t, exactTotal: exact } : t
      ),
    }));
  },

  refreshTab: async (tabId) => {
    const tab = get().tabs.find((t) => t.id === tabId);
    if (!tab) return;
    if (tab.kind === "rows") {
      set((s) => ({
        tabs: s.tabs.map((t) =>
          t.id === tabId && t.kind === "rows" ? { ...t, exactTotal: null } : t
        ),
      }));
      await loadTabPage(tabId, tab.page, set, get);
    } else {
      await loadDatabaseTab(tabId, set, get);
    }
  },

  setRowsSort: async (tabId, sort) => {
    set((s) => ({
      tabs: s.tabs.map((t) =>
        t.id === tabId && t.kind === "rows" ? { ...t, sort, page: 1 } : t
      ),
    }));
    await loadTabPage(tabId, 1, set, get);
  },

  setRowsFilter: async (tabId, column, filter) => {
    set((s) => ({
      tabs: s.tabs.map((t) => {
        if (t.id !== tabId || t.kind !== "rows") return t;
        const without = t.filters.filter((f) => f.column !== column);
        const next = filter ? [...without, filter] : without;
        return { ...t, filters: next, page: 1, exactTotal: null };
      }),
    }));
    const t = get().tabs.find((x) => x.id === tabId);
    if (t && t.kind === "rows") persistColumnSetup(t);
    await loadTabPage(tabId, 1, set, get);
  },

  setHiddenColumns: (tabId, hidden) => {
    set((s) => ({
      tabs: s.tabs.map((t) =>
        t.id === tabId && t.kind === "rows" ? { ...t, hiddenColumns: hidden } : t
      ),
    }));
    const t = get().tabs.find((x) => x.id === tabId);
    if (t && t.kind === "rows") persistColumnSetup(t);
  },

  setJsonDisplay: (tabId, column, path) => {
    set((s) => ({
      tabs: s.tabs.map((t) => {
        if (t.id !== tabId || t.kind !== "rows") return t;
        const next = { ...t.jsonDisplay };
        if (path && path.trim()) next[column] = path.trim();
        else delete next[column];
        return { ...t, jsonDisplay: next };
      }),
    }));
    const t = get().tabs.find((x) => x.id === tabId);
    if (t && t.kind === "rows") persistColumnSetup(t);
  },

  updateCell: async (tabId, rowIndex, column, newValue) => {
    const tab = get().tabs.find((t) => t.id === tabId);
    if (!tab || tab.kind !== "rows" || !tab.data) return;
    const row = tab.data.rows[rowIndex];
    if (!row) return;
    const pkColumns = tab.data.columns.filter((c) => c.key === "PRI");
    if (pkColumns.length === 0) {
      throw new Error("Table has no primary key — cell editing is disabled.");
    }
    const pk = pkColumns.map((c) => ({
      column: c.name,
      value: toIpcString(row[c.name]),
    }));
    await ipc.updateCell({
      profileId: tab.profileId,
      database: tab.database,
      table: tab.table,
      pk,
      column,
      value: newValue,
    });
    await loadTabPage(tabId, tab.page, set, get);
  },
}));

function toIpcString(v: unknown): string | null {
  if (v === null || v === undefined) return null;
  if (typeof v === "string") return v;
  if (typeof v === "number" || typeof v === "boolean") return String(v);
  return JSON.stringify(v);
}

type SetFn = (
  partial:
    | Partial<Store>
    | ((s: Store) => Partial<Store>)
) => void;
type GetFn = () => Store;

async function loadTabPage(tabId: string, page: number, set: SetFn, get: GetFn) {
  const tab = get().tabs.find((t) => t.id === tabId);
  if (!tab || tab.kind !== "rows") return;

  set((s) => ({
    tabs: s.tabs.map((t) =>
      t.id === tabId && t.kind === "rows"
        ? { ...t, loading: true, error: null, page }
        : t
    ),
  }));

  try {
    const result = await ipc.fetchRows({
      profileId: tab.profileId,
      database: tab.database,
      table: tab.table,
      limit: tab.pageSize,
      offset: (page - 1) * tab.pageSize,
      sort: tab.sort,
      filters: tab.filters,
    });
    set((s) => ({
      tabs: s.tabs.map((t) =>
        t.id === tabId && t.kind === "rows"
          ? {
              ...t,
              loading: false,
              error: null,
              data: {
                ...result,
                total: result.total ?? t.data?.total ?? null,
              },
            }
          : t
      ),
    }));
  } catch (e) {
    const msg = String(e);
    set((s) => ({
      tabs: s.tabs.map((t) =>
        t.id === tabId && t.kind === "rows"
          ? { ...t, loading: false, error: msg }
          : t
      ),
    }));
  }
}

async function loadDatabaseTab(tabId: string, set: SetFn, get: GetFn) {
  const tab = get().tabs.find((t) => t.id === tabId);
  if (!tab || tab.kind !== "database") return;

  set((s) => ({
    tabs: s.tabs.map((t) =>
      t.id === tabId && t.kind === "database"
        ? { ...t, loading: true, error: null }
        : t
    ),
  }));

  try {
    const [tables, folders] = await Promise.all([
      ipc.listTables(tab.profileId, tab.database),
      ipc.listFolders(tab.profileId, tab.database),
    ]);
    set((s) => ({
      tabs: s.tabs.map((t) =>
        t.id === tabId && t.kind === "database"
          ? { ...t, loading: false, error: null, tables, folders }
          : t
      ),
    }));
  } catch (e) {
    const msg = String(e);
    set((s) => ({
      tabs: s.tabs.map((t) =>
        t.id === tabId && t.kind === "database"
          ? { ...t, loading: false, error: msg, tables: [], folders: [] }
          : t
      ),
    }));
  }
}

/** Re-seed an edit-mode designer tab from the (just-saved) table, resetting the
 * dirty baseline so the tab can stay open and clean after a save. Picks up any
 * server-side canonicalization (rename, generated index names, exact types). */
async function reloadDesignerTab(
  tabId: string,
  tableName: string,
  set: SetFn,
  get: GetFn
) {
  const tab = get().tabs.find((t) => t.id === tabId);
  if (!tab || tab.kind !== "create-table") return;
  const [defs, idxDefs, autoInc] = await Promise.all([
    ipc.columnDefinitions(tab.profileId, tab.database, tableName),
    ipc.indexDefinitions(tab.profileId, tab.database, tableName),
    ipc.tableAutoIncrement(tab.profileId, tab.database, tableName),
  ]);
  const columns = defs.map(columnDefToDraft);
  const indexes = idxDefs.map(indexDefToDraft);
  const ai = autoInc != null ? String(autoInc) : "";
  set((s) => ({
    tabs: s.tabs.map((t) =>
      t.id === tabId && t.kind === "create-table"
        ? {
            ...t,
            tableName,
            originalName: tableName,
            columns,
            originalColumns: columns.map((c) => ({ ...c })),
            indexes,
            originalIndexes: indexes.map((i) => ({
              ...i,
              columns: i.columns.map((c) => ({ ...c })),
            })),
            autoIncrementValue: ai,
            originalAutoIncrementValue: ai,
          }
        : t
    ),
  }));
}

async function loadTreeDb(profileId: string, db: string, set: SetFn, _get: GetFn) {
  set((s) => {
    const t = s.trees[profileId];
    if (!t) return {};
    return {
      trees: {
        ...s.trees,
        [profileId]: {
          ...t,
          tablesByDb: { ...t.tablesByDb, [db]: emptyTreeDbState() },
        },
      },
    };
  });

  try {
    const [tables, folders] = await Promise.all([
      ipc.listTables(profileId, db),
      ipc.listFolders(profileId, db),
    ]);
    const items = tables.map((x: TableInfo) => ({ name: x.name, kind: x.kind }));
    set((s) => {
      const t = s.trees[profileId];
      const prev = t?.tablesByDb[db];
      if (!t) return {};
      return {
        trees: {
          ...s.trees,
          [profileId]: {
            ...t,
            tablesByDb: {
              ...t.tablesByDb,
              [db]: {
                loading: false,
                error: null,
                items,
                folders,
                expandedFolders: prev?.expandedFolders ?? new Set(),
              },
            },
          },
        },
      };
    });
  } catch (e) {
    const msg = String(e);
    set((s) => {
      const t = s.trees[profileId];
      if (!t) return {};
      return {
        trees: {
          ...s.trees,
          [profileId]: {
            ...t,
            tablesByDb: {
              ...t.tablesByDb,
              [db]: {
                loading: false,
                error: msg,
                items: [],
                folders: [],
                expandedFolders: new Set(),
              },
            },
          },
        },
      };
    });
  }
}

/// Pull fresh folder + table data for one (profile, database) and update everywhere
/// it's mirrored: any open DatabaseTab(s) for that DB, and the sidebar tree.
async function refreshFoldersEverywhere(
  profileId: string,
  database: string,
  set: SetFn,
  _get: GetFn
) {
  const [tables, folders] = await Promise.all([
    ipc.listTables(profileId, database).catch(() => null),
    ipc.listFolders(profileId, database).catch(() => null),
  ]);

  set((s) => {
    let next: Partial<Store> = {};

    if (folders) {
      const updatedTabs = s.tabs.map((t) =>
        t.kind === "database" && t.profileId === profileId && t.database === database
          ? { ...t, folders, tables: tables ?? t.tables }
          : t
      );
      next.tabs = updatedTabs;
    }

    const tree = s.trees[profileId];
    const dbState = tree?.tablesByDb[database];
    if (tree && dbState && (folders || tables)) {
      next.trees = {
        ...s.trees,
        [profileId]: {
          ...tree,
          tablesByDb: {
            ...tree.tablesByDb,
            [database]: {
              ...dbState,
              folders: folders ?? dbState.folders,
              items: tables
                ? tables.map((x: TableInfo) => ({ name: x.name, kind: x.kind }))
                : dbState.items,
            },
          },
        },
      };
    }

    return next;
  });
}
