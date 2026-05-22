import { create } from "zustand";
import { ipc } from "../ipc";
import type {
  ColumnFilter,
  DatabaseTab,
  Folder,
  ProfileView,
  Relation,
  RelationsTab,
  RowsTab,
  SortSpec,
  Tab,
  TableInfo,
} from "../types";

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
  /** Last table opened per `${profileId}::${database}`, for re-selecting in the DB view. */
  lastOpenedTables: Record<string, string>;
  /** Defined relations per `${profileId}::${database}`. */
  relations: Record<string, Relation[]>;

  loadProfiles: () => Promise<void>;
  connectProfile: (profileId: string) => Promise<void>;
  disconnectProfile: (profileId: string) => Promise<void>;
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
  setTableFolder: (tabId: string, table: string, folderId: string | null) => Promise<void>;
  setTablesFolder: (tabId: string, tables: string[], folderId: string | null) => Promise<void>;

  openTable: (profileId: string, profileName: string, database: string, table: string) => Promise<void>;
  openRelations: (profileId: string, profileName: string, database: string) => void;
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
  setActiveTab: (tabId: string) => void;
  setTabPage: (tabId: string, page: number) => Promise<void>;
  setPageSize: (tabId: string, pageSize: number) => Promise<void>;
  refreshTab: (tabId: string) => Promise<void>;
  countExactRows: (tabId: string) => Promise<void>;

  setRowsSort: (tabId: string, sort: SortSpec | null) => Promise<void>;
  setRowsFilter: (tabId: string, column: string, filter: ColumnFilter | null) => Promise<void>;
  setHiddenColumns: (tabId: string, hidden: string[]) => void;

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
      filters: [],
      hiddenColumns: [],
    };
    set((s) => ({ tabs: [...s.tabs, tab], activeTabId: tabId }));
    await loadTabPage(tabId, 1, set, get);
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
      return { tabs, activeTabId };
    });
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
    await loadTabPage(tabId, 1, set, get);
  },

  setHiddenColumns: (tabId, hidden) => {
    set((s) => ({
      tabs: s.tabs.map((t) =>
        t.id === tabId && t.kind === "rows" ? { ...t, hiddenColumns: hidden } : t
      ),
    }));
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
