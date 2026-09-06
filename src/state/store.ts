import { create } from "zustand";
import { save } from "@tauri-apps/plugin-dialog";
import { listen } from "@tauri-apps/api/event";
import { ipc } from "../ipc";
import {
  columnDefToDraft,
  indexDefToDraft,
  foreignKeyDefToDraft,
  cloneForeignKey,
  defaultIdColumn,
  buildCreateTableSql,
  buildAlterTableSql,
  droppedColumnNames,
} from "../lib/tableSql";
import { notifyError, notifySuccess, notifyInfo } from "./notify";
import { analyzeQueryBundle } from "../lib/queryAnalysis";
import { splitSqlStatements, returnsResultSet } from "../lib/splitSql";
import { deleteRowsWithCascade, toIpcString } from "../lib/rowDelete";
import { invalidateRelatedExistence } from "../lib/relatedExistence";
import type {
  CascadeTarget,
  ColumnFilter,
  CreateTableTab,
  DatabaseDiffSide,
  DatabaseDiffTab,
  DatabaseTab,
  Folder,
  PeekDescriptor,
  ProfileView,
  QueryResult,
  QueryTab,
  Relation,
  RelationsTab,
  RowRecord,
  RowsTab,
  SavedQuery,
  SchemaDiffSide,
  SchemaDiffTab,
  SortSpec,
  Tab,
  TableSchema,
  TableInfo,
  TableViewPreset,
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
      tab.indexes,
      tab.originalTableComment,
      tab.tableComment,
      tab.originalForeignKeys,
      tab.foreignKeys,
      tab.database
    );
    /* buildAlterTableSql returns a `--` comment when nothing changed. */
    return !alter.startsWith("--");
  }
  return (
    tab.tableName.trim() !== "" ||
    tab.columns.length > 0 ||
    tab.indexes.length > 0 ||
    tab.foreignKeys.length > 0
  );
}

/** True when a query tab's editor has unsaved edits versus its clean baseline
 * (the SQL at open, or when a saved query was last loaded/saved). */
export function isQueryTabDirty(tab: QueryTab): boolean {
  return tab.sql !== (tab.savedSql ?? "");
}

/** Persist a rows tab's column setup (visibility, filters, JSON "Show", widths)
 * to the backend store so reopening the table restores it. Best-effort. */
function persistColumnSetup(tab: RowsTab) {
  ipc
    .saveColumnSetup(tab.profileId, tab.database, tab.table, {
      hiddenColumns: tab.hiddenColumns,
      filters: tab.filters,
      jsonDisplay: tab.jsonDisplay,
      columnWidths: tab.columnWidths,
      sort: tab.sort,
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
  /** True while a torn-off tab window is hovering the tab bar, so the bar can
   * show a drop target. Set over IPC events from the dragging window. */
  tabDropActive: boolean;
  setTabDropActive: (active: boolean) => void;
  /** Re-attach a tab that was torn off into its own window (the window closes). */
  dockTab: (tab: Tab) => void;
  /** Tab awaiting an unsaved-changes confirmation before it closes; null when none. */
  pendingCloseTabId: string | null;
  /** Peek windows launched from the pending-close rows tab (labels), so the
   * close confirmation can offer to close them too. Empty when none. */
  pendingClosePeekLabels: string[];
  /** In-progress SQL-script export with row data; null when none is running. */
  sqlExport: {
    table: string;
    done: number;
    total: number;
    cancelling: boolean;
  } | null;
  /** In-progress table copy; null when none is running. `total === 0` means the
   * row count is unknown (same-connection copies finish server-side with no
   * per-row reporting), so the bar shows an indeterminate state. */
  copyProgress: {
    /** 1-based index of the table currently being copied. */
    current: number;
    /** Total number of tables in this copy batch. */
    count: number;
    table: string;
    done: number;
    total: number;
    cancelling: boolean;
  } | null;
  /** In-progress database backup; null when none is running. */
  backupProgress: {
    database: string;
    table: string;
    /** 1-based index of the table currently being dumped. */
    tableIndex: number;
    tableCount: number;
    done: number;
    total: number;
    cancelling: boolean;
  } | null;
  /** Database the restore wizard is open for; null when closed. */
  restoreTarget: { profileId: string; database: string } | null;
  /** A restored copy awaiting a "make live" swap, kept after the wizard closes so
   * the user can review the copy and finish the swap from its context menu. */
  pendingSwap: {
    profileId: string;
    /** The original database name the copy will replace. */
    liveName: string;
    /** The restored copy's database name. */
    restoredName: string;
  } | null;
  /** Last table opened per `${profileId}::${database}`, for re-selecting in the DB view. */
  lastOpenedTables: Record<string, string>;
  /** Defined relations per `${profileId}::${database}`. */
  relations: Record<string, Relation[]>;
  /** Saved-query counts per `${profileId}::${database}`, for the Query button badge. */
  savedQueryCounts: Record<string, number>;

  loadProfiles: () => Promise<void>;
  /** Move a connection so it sits where `targetId` is, persisting the new order.
   * Reorders optimistically and reverts (by reloading) if the save fails. */
  reorderProfiles: (draggedId: string, targetId: string) => Promise<void>;
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
  /** Re-list a profile's databases into the tree (after a restore/swap). */
  refreshDatabases: (profileId: string) => Promise<void>;
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
  /** Assign a table to a folder by raw identifiers (used by the tree's drag-drop,
   * which has no open database tab to look up). */
  assignTableFolder: (
    profileId: string,
    database: string,
    table: string,
    folderId: string | null
  ) => Promise<void>;
  /** Copy one or more tables to another database (structure, and optionally
   * data). The target may be a different connection. Tables are copied
   * sequentially with a progress overlay. Used by dragging table(s) onto a
   * database node. */
  copyTablesToDatabase: (
    profileId: string,
    sourceDatabase: string,
    tables: string[],
    targetProfileId: string,
    targetDatabase: string,
    includeData: boolean
  ) => Promise<void>;
  /** Cancel the in-progress table copy (interrupts the current table and stops
   * the batch). */
  cancelTableCopy: () => void;

  openTable: (profileId: string, profileName: string, database: string, table: string) => Promise<void>;
  /** Forget the remembered table for a database so the DB view stops
   * auto-reselecting it (called when the user clears the table selection). */
  forgetLastOpenedTable: (profileId: string, database: string) => void;
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
  /** Duplicate a table + its data; refreshes the DB view and returns the copy's name. */
  copyTable: (profileId: string, database: string, table: string) => Promise<string>;
  openRelations: (profileId: string, profileName: string, database: string) => void;
  /** Open (or focus) a schema-diff tab comparing two tables. */
  openSchemaDiff: (left: SchemaDiffSide, right: SchemaDiffSide) => void;
  /** Re-fetch both sides of a schema-diff tab. */
  refreshSchemaDiff: (tabId: string) => Promise<void>;
  /** Swap the two sides of a schema-diff tab in place. */
  swapSchemaDiff: (tabId: string) => void;
  /** Open (or focus) a db-diff tab comparing two databases; `tables` restricts
   * the comparison to those tables (null/omitted = all). */
  openDatabaseDiff: (
    left: DatabaseDiffSide,
    right: DatabaseDiffSide,
    tables?: string[] | null
  ) => void;
  /** Re-fetch both sides of a db-diff tab. */
  refreshDatabaseDiff: (tabId: string) => Promise<void>;
  /** Swap the two sides of a db-diff tab in place. */
  swapDatabaseDiff: (tabId: string) => void;
  /** Fold/unfold a report section in a schema-diff or db-diff tab. */
  toggleDiffSection: (tabId: string, key: string) => void;
  /** Run a schema-sync ALTER against the tab's destination (right side).
   * Returns true on success; stores `undoSql` on the tab for one-click undo. */
  executeSchemaSync: (
    tabId: string,
    sql: string,
    undoSql: string
  ) => Promise<boolean>;
  /** Run the stored reverse ALTER, restoring the destination's structure. */
  undoSchemaSync: (tabId: string) => Promise<boolean>;
  /** Open (or focus) the standalone server Monitoring window for a connection. */
  openMonitoring: (profileId: string) => void;
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
  /** EXPLAIN the query pane's SQL and grade it; `runAnalyze` measures real
   * timings (read-only statements only). Sets the tab's analysis + EXPLAIN grid. */
  explainQuery: (tabId: string, runAnalyze?: boolean) => Promise<void>;
  /** Clear the current Explain analysis for a query tab. */
  clearAnalysis: (tabId: string) => void;
  /** Request cancellation of a running query (KILL QUERY server-side). */
  stopQuery: (tabId: string) => Promise<void>;
  /** Save the query pane's current SQL under a name, scoped to its database. */
  saveQuery: (tabId: string, name: string) => Promise<void>;
  /** Load a saved query's SQL into the pane. */
  applySavedQuery: (tabId: string, name: string) => void;
  /** Delete a saved query by name. */
  deleteSavedQuery: (tabId: string, name: string) => Promise<void>;
  /** Load a history entry's SQL into the pane (no name; just SQL). */
  applyQueryHistory: (tabId: string, sql: string) => void;
  /** Delete one history entry by its SQL. */
  deleteQueryHistory: (tabId: string, sql: string) => Promise<void>;
  /** Clear the entire history for this tab's database. */
  clearQueryHistory: (tabId: string) => Promise<void>;
  openTableDesigner: (
    profileId: string,
    profileName: string,
    database: string,
    folderId?: string | null
  ) => void;
  /** Open the designer in edit mode, pre-loaded with an existing table's columns. */
  openTableEditor: (
    profileId: string,
    profileName: string,
    database: string,
    table: string
  ) => Promise<void>;
  /** Prompt for a destination and write a `.sql` script for a table (DDL, plus
   * INSERTs when `includeData`). */
  /** Save a `.sql` script for one or more tables (combined into a single file). */
  exportTableSql: (
    profileId: string,
    database: string,
    tables: string[],
    includeData: boolean
  ) => Promise<void>;
  /** Request cancellation of the in-progress SQL-script export. */
  cancelSqlExport: () => void;
  /** Back up a whole database to a `.dbbak` archive (opens a save dialog). */
  backupDatabase: (profileId: string, database: string) => Promise<void>;
  /** Request cancellation of the in-progress database backup. */
  cancelBackup: () => void;
  /** Open the restore wizard for a database. */
  openRestore: (profileId: string, database: string) => void;
  /** Close the restore wizard. */
  closeRestore: () => void;
  /** Record a restored copy that can be swapped live later (survives wizard close). */
  setPendingSwap: (swap: {
    profileId: string;
    liveName: string;
    restoredName: string;
  }) => void;
  /** Forget the pending swap without acting on it. */
  clearPendingSwap: () => void;
  /** Swap the pending restored copy into its original name (keeps the old as a
   * `_old_<ts>` stash). No-op when there's no pending swap. */
  makeLive: () => Promise<void>;
  /** Drop the pending restored copy without swapping. */
  discardRestoredCopy: () => Promise<void>;
  updateCreateTable: (
    tabId: string,
    patch: Partial<
      Pick<
        CreateTableTab,
        | "tableName"
        | "columns"
        | "indexes"
        | "foreignKeys"
        | "autoIncrementValue"
        | "tableComment"
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
    tableName: string,
    folderId?: string | null
  ) => Promise<void>;
  loadRelations: (profileId: string, database: string) => Promise<void>;
  loadSavedQueryCount: (profileId: string, database: string) => Promise<void>;
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
  /** Move a tab so it sits where `targetId` is: dragging right drops after the
   * target, dragging left drops before it (mirrors reorderProfiles). */
  reorderTabs: (draggedId: string, targetId: string) => void;
  setTabPage: (tabId: string, page: number) => Promise<void>;
  setPageSize: (tabId: string, pageSize: number) => Promise<void>;
  refreshTab: (tabId: string) => Promise<void>;
  /** Reload any open views of a table whose data changed out-of-band (e.g. a JSON
   * import launched from the tree/DB-view context menu): matching rows tabs and
   * the database tab whose tile shows its row count. */
  refreshTableData: (
    profileId: string,
    database: string,
    table: string
  ) => Promise<void>;
  countExactRows: (tabId: string) => Promise<void>;

  setRowsSort: (tabId: string, sort: SortSpec | null) => Promise<void>;
  setRowsFilter: (tabId: string, column: string, filter: ColumnFilter | null) => Promise<void>;
  /** Drop every column filter, restore hidden columns, and reload. */
  clearRowsFilters: (tabId: string) => Promise<void>;
  setHiddenColumns: (tabId: string, hidden: string[]) => void;
  /** Set (or clear, with null) a JSON column's display property path. */
  setJsonDisplay: (tabId: string, column: string, path: string | null) => void;
  setRowsActiveCell: (
    tabId: string,
    cell: { rowIndex: number; column: string } | null
  ) => void;
  /** Persist the highlighted row indices, so a torn-off window (or tab switch)
   * keeps the selection. */
  setRowsSelection: (tabId: string, indices: number[]) => void;
  /** Show/hide the Inspector panel on a rows or query tab. On the tab (not
   * component state) so a torn-off window inherits the docked state. */
  setTabInspectorOpen: (tabId: string, open: boolean) => void;
  setTabRelationsOpen: (tabId: string, open: boolean) => void;
  /** Persist manual column-width overrides (px, keyed by column name). */
  setColumnWidths: (tabId: string, widths: Record<string, number>) => void;
  /** Save the rows tab's current view (columns, widths, sort, filters, show) as
   * a named preset, scoped to its table. */
  saveTablePreset: (tabId: string, name: string) => Promise<void>;
  /** Apply a saved preset's settings to the rows tab and reload. */
  applyTablePreset: (tabId: string, name: string) => Promise<void>;
  /** Delete a saved preset by name. */
  deleteTablePreset: (tabId: string, name: string) => Promise<void>;
  /** Reset the rows tab to defaults: clear hidden columns, widths, sort,
   * filters, JSON show, and the active preset. */
  clearTableView: (tabId: string) => Promise<void>;

  updateCell: (
    tabId: string,
    rowIndex: number,
    column: string,
    newValue: string | null
  ) => Promise<void>;

  /** Apply a batch cell edit across one or more columns, then reload the page
   * ONCE. Stops at the first failed UPDATE; the reload still runs so the grid
   * reflects whatever was committed before the failure. */
  updateCells: (
    tabId: string,
    edits: { rowIndex: number; column: string; value: string | null }[]
  ) => Promise<void>;
  insertRow: (
    tabId: string,
    values: { column: string; value: string | null }[]
  ) => Promise<void>;
  /** Append several partial rows, then reload the current page once. */
  insertRows: (
    tabId: string,
    rows: { column: string; value: string | null }[][]
  ) => Promise<void>;
  deleteRows: (
    tabId: string,
    rowIndices: number[],
    cascade?: CascadeTarget[]
  ) => Promise<void>;
  /** Duplicate the given rows server-side (skipping auto-increment columns).
   * Rows that violate a unique/PK constraint come back in `conflicts` carrying a
   * snapshot of their values, so the caller can offer an edit-and-retry. */
  duplicateRows: (
    tabId: string,
    rowIndices: number[]
  ) => Promise<DuplicateRowsResult>;
}

export interface DuplicateConflict {
  /** The source row's values, as IPC strings, for seeding an edit dialog. */
  seed: Record<string, string | null>;
  /** The database conflict message, e.g. "Duplicate entry 'x' for key '…'". */
  message: string;
}

export interface DuplicateRowsResult {
  okCount: number;
  conflicts: DuplicateConflict[];
  errors: string[];
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

/** The peek windows launched from `tab`'s table — the whole tree, not just
 * direct peeks: a child peek's sourceTable is its parent peek's table, so the
 * reachable tables are walked transitively (the target table of any collected
 * peek becomes a valid source for the next). */
export function peeksReachableFrom(
  open: PeekDescriptor[],
  tab: { profileId: string; database: string; table: string }
): PeekDescriptor[] {
  const sameDb = open.filter(
    (p) => p.profileId === tab.profileId && p.database === tab.database
  );
  const reachable = new Set<string>([tab.table]);
  const collected = new Set<PeekDescriptor>();
  let changed = true;
  while (changed) {
    changed = false;
    for (const p of sameDb) {
      if (collected.has(p) || !reachable.has(p.sourceTable)) continue;
      collected.add(p);
      reachable.add(p.target.table);
      changed = true;
    }
  }
  return [...collected];
}

export const useStore = create<Store>((set, get) => ({
  profiles: [],
  loadingProfiles: false,
  connections: {},
  trees: {},
  expandedProfiles: new Set(),
  tabs: [],
  activeTabId: null,
  tabDropActive: false,
  pendingCloseTabId: null,
  pendingClosePeekLabels: [],
  sqlExport: null,
  copyProgress: null,
  backupProgress: null,
  restoreTarget: null,
  pendingSwap: null,
  lastOpenedTables: {},
  relations: {},
  savedQueryCounts: {},

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

  reorderProfiles: async (draggedId, targetId) => {
    const profiles = get().profiles;
    const from = profiles.findIndex((p) => p.id === draggedId);
    const to = profiles.findIndex((p) => p.id === targetId);
    if (from < 0 || to < 0 || from === to) return;
    const next = profiles.filter((p) => p.id !== draggedId);
    let insertAt = next.findIndex((p) => p.id === targetId);
    /* Dragging downward drops below the target; upward drops above it. */
    if (from < to) insertAt += 1;
    next.splice(insertAt, 0, profiles[from]);
    set({ profiles: next });
    try {
      await ipc.reorderProfiles(next.map((p) => p.id));
    } catch (e) {
      notifyError(`Could not reorder connections: ${String(e)}`);
      await get().loadProfiles();
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

  refreshDatabases: async (profileId) => {
    const databases = await ipc.listDatabases(profileId);
    set((s) => {
      const t = s.trees[profileId] ?? defaultTree();
      return { trees: { ...s.trees, [profileId]: { ...t, databases } } };
    });
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

    /* Carry the current search term over to the new database view so a filter
       stays applied while navigating between databases. */
    const carriedFilter =
      get().tabs.find((t) => t.kind === "database")?.filter ?? "";
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
      filter: carriedFilter,
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
          ? { ...t, currentFolderId: folderId }
          : t
      ),
    }));
  },

  exitFolder: (tabId) => {
    set((s) => ({
      tabs: s.tabs.map((t) =>
        t.id === tabId && t.kind === "database"
          ? { ...t, currentFolderId: null }
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

  assignTableFolder: async (profileId, database, table, folderId) => {
    try {
      await ipc.setTableFolder(profileId, database, table, folderId);
      await refreshFoldersEverywhere(profileId, database, set, get);
    } catch (e) {
      notifyError(`Could not move "${table}": ${String(e)}`);
    }
  },

  copyTablesToDatabase: async (
    profileId,
    sourceDatabase,
    tables,
    targetProfileId,
    targetDatabase,
    includeData
  ) => {
    if (tables.length === 0) return;

    set({
      copyProgress: {
        current: 1,
        count: tables.length,
        table: tables[0],
        done: 0,
        total: 0,
        cancelling: false,
      },
    });
    /* Cross-connection copies stream rows and report `table-copy-progress`;
       same-connection copies finish server-side and never emit, leaving the bar
       indeterminate (total stays 0). */
    const unlisten = await listen<{ done: number; total: number }>(
      "table-copy-progress",
      (e) => {
        set((s) =>
          s.copyProgress
            ? { copyProgress: { ...s.copyProgress, done: e.payload.done, total: e.payload.total } }
            : {}
        );
      }
    );

    const startedAt = performance.now();
    let copied = 0;
    let cancelled = false;
    let failed: string | null = null;
    try {
      for (let i = 0; i < tables.length; i++) {
        const table = tables[i];
        set((s) =>
          s.copyProgress
            ? { copyProgress: { ...s.copyProgress, current: i + 1, table, done: 0, total: 0 } }
            : {}
        );
        try {
          const completed = await ipc.copyTable({
            profileId,
            sourceDatabase,
            sourceTable: table,
            targetProfileId,
            targetDatabase,
            includeData,
          });
          if (!completed) {
            cancelled = true;
            break;
          }
          copied++;
        } catch (e) {
          failed = `Could not copy "${table}": ${String(e)}`;
          break;
        }
      }
    } finally {
      unlisten();
      set({ copyProgress: null });
    }

    /* Any fully-copied tables are real and need the tree/DB view refreshed,
       even when the batch was cancelled or errored partway. */
    if (copied > 0) {
      await refreshFoldersEverywhere(targetProfileId, targetDatabase, set, get);
    }

    if (cancelled) {
      notifyInfo(
        copied > 0
          ? `Copy cancelled — ${copied} of ${tables.length} tables copied.`
          : "Table copy cancelled."
      );
    } else if (copied > 0) {
      const suffix = includeData ? " with data" : " (structure only)";
      const secs = ((performance.now() - startedAt) / 1000).toFixed(1);
      notifySuccess(
        copied === 1
          ? `Copied "${tables[0]}" to "${targetDatabase}"${suffix} in ${secs}s.`
          : `Copied ${copied} tables to "${targetDatabase}"${suffix} in ${secs}s.`
      );
    }
    if (failed) notifyError(failed);
  },

  cancelTableCopy: () => {
    set((s) =>
      s.copyProgress ? { copyProgress: { ...s.copyProgress, cancelling: true } } : {}
    );
    ipc.cancelTableCopy().catch(() => {});
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

    const [saved, presets, tableComment] = await Promise.all([
      ipc.getColumnSetup(profileId, database, table),
      ipc.listTablePresets(profileId, database, table).catch(() => []),
      ipc.tableComment(profileId, database, table).catch(() => ""),
    ]);
    const tab: RowsTab = {
      id: tabId,
      kind: "rows",
      openSeq: Date.now(),
      profileId,
      profileName,
      database,
      table,
      tableComment,
      page: 1,
      pageSize: 500,
      data: null,
      exactTotal: null,
      loading: true,
      error: null,
      sort: saved?.sort ?? null,
      filters: saved?.filters ?? [],
      hiddenColumns: saved?.hiddenColumns ?? [],
      jsonDisplay: saved?.jsonDisplay ?? {},
      columnWidths: saved?.columnWidths ?? {},
      presets,
      activePreset: null,
      activeCell: null,
    };
    set((s) => ({ tabs: [...s.tabs, tab], activeTabId: tabId }));
    await loadTabPage(tabId, 1, set, get);
  },

  forgetLastOpenedTable: (profileId, database) => {
    const key = `${profileId}::${database}`;
    set((s) => {
      if (!(key in s.lastOpenedTables)) return s;
      const next = { ...s.lastOpenedTables };
      delete next[key];
      return { lastOpenedTables: next };
    });
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

  copyTable: async (profileId, database, table) => {
    /* Pick the first free `{table}_copy`, `{table}_copy2`, … from the names we
       already know; the backend re-checks and errors on a real collision. */
    const known = new Set<string>();
    const s = get();
    for (const t of s.tabs) {
      if (t.kind === "database" && t.profileId === profileId && t.database === database) {
        for (const tbl of t.tables) known.add(tbl.name);
      }
    }
    for (const it of s.trees[profileId]?.tablesByDb[database]?.items ?? []) {
      known.add(it.name);
    }
    let newName = `${table}_copy`;
    for (let n = 2; known.has(newName); n++) newName = `${table}_copy${n}`;

    await ipc.copyTable({
      profileId,
      sourceDatabase: database,
      sourceTable: table,
      targetDatabase: database,
      targetTable: newName,
      includeData: true,
    });
    await refreshFoldersEverywhere(profileId, database, set, get);
    return newName;
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
    const dirty =
      tab != null &&
      ((tab.kind === "create-table" && isDesignerTabDirty(tab)) ||
        (tab.kind === "query" && isQueryTabDirty(tab)));
    if (dirty) {
      set({ pendingCloseTabId: tabId, pendingClosePeekLabels: [] });
      return;
    }
    /* A rows tab with peek windows launched from it: offer to close them too. */
    if (tab?.kind === "rows") {
      void (async () => {
        let labels: string[] = [];
        try {
          const open = await ipc.listOpenPeeks<PeekDescriptor>();
          labels = peeksReachableFrom(open, tab)
            .map((p) => p.label)
            .filter((l): l is string => !!l);
        } catch {
          /* ignore — close the tab as usual */
        }
        if (labels.length > 0) {
          set({ pendingCloseTabId: tabId, pendingClosePeekLabels: labels });
          return;
        }
        get().closeTab(tabId);
      })();
      return;
    }
    get().closeTab(tabId);
  },

  setPendingCloseTabId: (tabId) =>
    set({ pendingCloseTabId: tabId, pendingClosePeekLabels: [] }),

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
        tab.indexes,
        tab.originalTableComment,
        tab.tableComment,
        tab.originalForeignKeys,
        tab.foreignKeys,
        tab.database
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
      const requestedAi = tab.autoIncrementValue.trim();
      const originalAi = tab.originalAutoIncrementValue.trim();
      try {
        await ipc.runDdl(tab.profileId, tab.database, alterSql);
        notifySuccess(`Table "${tab.originalName}" updated.`);
        /* Stay in the designer after saving: re-seed the tab from the now-saved
           table so the dirty baseline resets, rather than closing the tab. */
        await reloadDesignerTab(tab.id, name, set, get);
        /* InnoDB silently refuses to set AUTO_INCREMENT below the highest value
           already present in the column (it would mint colliding ids), clamping it
           back to max+1. The reload above reads the live counter, so if it differs
           from what we asked for, the engine ignored our value — surface why rather
           than letting it look like a no-op bug. */
        const saved = get().tabs.find((t) => t.id === tab.id);
        const actualAi =
          saved && saved.kind === "create-table"
            ? saved.autoIncrementValue.trim()
            : "";
        if (
          /^\d+$/.test(requestedAi) &&
          requestedAi !== originalAi &&
          actualAi !== "" &&
          actualAi !== requestedAi
        ) {
          notifyError(
            `Auto-increment couldn't be lowered to ${requestedAi}. The table already ` +
              `contains rows with values up to ${Number(actualAi) - 1}, so MySQL kept ` +
              `it at ${actualAi}. Remove those rows (or TRUNCATE the table) to reset lower.`
          );
        }
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

    const sqlText = buildCreateTableSql(
      name,
      tab.columns,
      tab.indexes,
      tab.tableComment,
      tab.foreignKeys,
      tab.database
    );
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
        name,
        tab.targetFolderId ?? null
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

  openSchemaDiff: (left, right) => {
    /* Order-independent id so comparing A↔B focuses an existing B↔A tab. */
    const sideKey = (s: SchemaDiffSide) =>
      `${s.profileId}::${s.database}::${s.table}`;
    const tabId = `schemadiff::${[sideKey(left), sideKey(right)].sort().join("::")}`;
    const existing = get().tabs.find((t) => t.id === tabId);
    if (existing) {
      set({ activeTabId: tabId });
      void get().refreshSchemaDiff(tabId);
      return;
    }
    const tab: SchemaDiffTab = {
      id: tabId,
      kind: "schema-diff",
      profileId: left.profileId,
      profileName: left.profileName,
      database: left.database,
      table: left.table,
      right,
      leftSchema: null,
      rightSchema: null,
      folded: {},
      undoSync: null,
      loading: true,
      error: null,
    };
    set((s) => ({ tabs: [...s.tabs, tab], activeTabId: tabId }));
    void get().refreshSchemaDiff(tabId);
  },

  refreshSchemaDiff: async (tabId) => {
    const tab = get().tabs.find((t) => t.id === tabId);
    if (!tab || tab.kind !== "schema-diff") return;
    const patch = (p: Partial<SchemaDiffTab>) =>
      set((s) => ({
        tabs: s.tabs.map((t) =>
          t.id === tabId && t.kind === "schema-diff" ? { ...t, ...p } : t
        ),
      }));
    patch({ loading: true, error: null });
    const fetchSide = async (side: SchemaDiffSide): Promise<TableSchema> => {
      const [columns, indexes, meta] = await Promise.all([
        ipc.columnDefinitions(side.profileId, side.database, side.table),
        ipc.indexDefinitions(side.profileId, side.database, side.table),
        ipc.tableSchemaMeta(side.profileId, side.database, side.table),
      ]);
      return { columns, indexes, meta };
    };
    try {
      const [leftSchema, rightSchema] = await Promise.all([
        fetchSide({
          profileId: tab.profileId,
          profileName: tab.profileName,
          database: tab.database,
          table: tab.table,
        }),
        fetchSide(tab.right),
      ]);
      patch({ leftSchema, rightSchema, loading: false });
    } catch (e) {
      patch({ loading: false, error: String(e) });
      notifyError(`Schema comparison failed: ${String(e)}`);
    }
  },

  swapSchemaDiff: (tabId) => {
    set((s) => ({
      tabs: s.tabs.map((t) => {
        if (t.id !== tabId || t.kind !== "schema-diff") return t;
        return {
          ...t,
          profileId: t.right.profileId,
          profileName: t.right.profileName,
          database: t.right.database,
          table: t.right.table,
          right: {
            profileId: t.profileId,
            profileName: t.profileName,
            database: t.database,
            table: t.table,
          },
          leftSchema: t.rightSchema,
          rightSchema: t.leftSchema,
        };
      }),
    }));
  },

  openDatabaseDiff: (left, right, tables = null) => {
    /* Order-independent id so comparing A↔B focuses an existing B↔A tab. */
    const sideKey = (s: DatabaseDiffSide) => `${s.profileId}::${s.database}`;
    const tabId = `dbdiff::${[sideKey(left), sideKey(right)].sort().join("::")}`;
    const existing = get().tabs.find((t) => t.id === tabId);
    if (existing) {
      /* Re-opening the same pair adopts the new table selection. */
      set((s) => ({
        activeTabId: tabId,
        tabs: s.tabs.map((t) =>
          t.id === tabId && t.kind === "db-diff" ? { ...t, tables } : t
        ),
      }));
      void get().refreshDatabaseDiff(tabId);
      return;
    }
    const tab: DatabaseDiffTab = {
      id: tabId,
      kind: "db-diff",
      profileId: left.profileId,
      profileName: left.profileName,
      database: left.database,
      right,
      tables,
      leftSchemas: null,
      rightSchemas: null,
      folded: {},
      loading: true,
      error: null,
    };
    set((s) => ({ tabs: [...s.tabs, tab], activeTabId: tabId }));
    void get().refreshDatabaseDiff(tabId);
  },

  refreshDatabaseDiff: async (tabId) => {
    const tab = get().tabs.find((t) => t.id === tabId);
    if (!tab || tab.kind !== "db-diff") return;
    const patch = (p: Partial<DatabaseDiffTab>) =>
      set((s) => ({
        tabs: s.tabs.map((t) =>
          t.id === tabId && t.kind === "db-diff" ? { ...t, ...p } : t
        ),
      }));
    patch({ loading: true, error: null });
    try {
      const [leftSchemas, rightSchemas] = await Promise.all([
        ipc.databaseSchema(tab.profileId, tab.database),
        ipc.databaseSchema(tab.right.profileId, tab.right.database),
      ]);
      patch({ leftSchemas, rightSchemas, loading: false });
    } catch (e) {
      patch({ loading: false, error: String(e) });
      notifyError(`Database comparison failed: ${String(e)}`);
    }
  },

  executeSchemaSync: async (tabId, sql, undoSql) => {
    const tab = get().tabs.find((t) => t.id === tabId);
    if (!tab || tab.kind !== "schema-diff") return false;
    const dest = tab.right;
    try {
      await ipc.runDdl(dest.profileId, dest.database, sql);
    } catch (e) {
      notifyError(
        `Schema sync failed — no changes were applied: ${String(e)}`
      );
      return false;
    }
    notifySuccess(
      `Schema synchronized to ${dest.profileName} • ${dest.database}.${dest.table}.`
    );
    set((s) => ({
      tabs: s.tabs.map((t) =>
        t.id === tabId && t.kind === "schema-diff"
          ? {
              ...t,
              undoSync: {
                sql: undoSql,
                profileId: dest.profileId,
                database: dest.database,
              },
            }
          : t
      ),
    }));
    await get().refreshSchemaDiff(tabId);
    return true;
  },

  undoSchemaSync: async (tabId) => {
    const tab = get().tabs.find((t) => t.id === tabId);
    if (!tab || tab.kind !== "schema-diff" || !tab.undoSync) return false;
    const u = tab.undoSync;
    try {
      await ipc.runDdl(u.profileId, u.database, u.sql);
    } catch (e) {
      notifyError(`Undo failed — no changes were applied: ${String(e)}`);
      return false;
    }
    notifySuccess("Schema sync undone — the structure was restored.");
    set((s) => ({
      tabs: s.tabs.map((t) =>
        t.id === tabId && t.kind === "schema-diff" ? { ...t, undoSync: null } : t
      ),
    }));
    await get().refreshSchemaDiff(tabId);
    return true;
  },

  toggleDiffSection: (tabId, key) => {
    set((s) => ({
      tabs: s.tabs.map((t) => {
        if (t.id !== tabId || (t.kind !== "schema-diff" && t.kind !== "db-diff"))
          return t;
        const folded = t.folded ?? {};
        return { ...t, folded: { ...folded, [key]: !folded[key] } };
      }),
    }));
  },

  swapDatabaseDiff: (tabId) => {
    set((s) => ({
      tabs: s.tabs.map((t) => {
        if (t.id !== tabId || t.kind !== "db-diff") return t;
        return {
          ...t,
          profileId: t.right.profileId,
          profileName: t.right.profileName,
          database: t.right.database,
          right: {
            profileId: t.profileId,
            profileName: t.profileName,
            database: t.database,
          },
          leftSchemas: t.rightSchemas,
          rightSchemas: t.leftSchemas,
        };
      }),
    }));
  },

  openMonitoring: (profileId) => {
    /* Server monitoring lives in its own OS window so it can stay open while you
       work in the main window; the Rust side creates/focuses it. */
    ipc.openMonitorWindow(profileId).catch((e) =>
      notifyError(`Could not open the monitor window: ${String(e)}`)
    );
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
      analysis: null,
      loading: false,
      error: null,
      stopping: false,
      runStartedAt: null,
      liveServerMs: 0,
      roundTripMs: null,
      savedQueries: [],
      activeSavedQuery: null,
      savedSql: "",
      queryHistory: [],
      inspectorOpen: true,
    };
    set((s) => ({ tabs: [...s.tabs, tab], activeTabId: tabId }));
    loadSavedQueries(tabId, set, get);
    loadQueryHistory(tabId, set, get);
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
              savedQueries: [],
              activeSavedQuery: null,
              queryHistory: [],
            }
          : t
      ),
    }));
    loadSavedQueries(tabId, set, get);
    loadQueryHistory(tabId, set, get);
  },

  setQueryDatabase: (tabId, database) => {
    set((s) => ({
      tabs: s.tabs.map((t) =>
        t.id === tabId && t.kind === "query"
          ? {
              ...t,
              database,
              savedQueries: [],
              activeSavedQuery: null,
              queryHistory: [],
            }
          : t
      ),
    }));
    loadSavedQueries(tabId, set, get);
    loadQueryHistory(tabId, set, get);
  },

  executeQuery: async (tabId) => {
    const tab = get().tabs.find((t) => t.id === tabId);
    if (!tab || tab.kind !== "query" || tab.loading) return;
    if (!tab.sql.trim()) return;
    const startedAt = Date.now();
    const sqlAtExecute = tab.sql;
    set((s) => ({
      tabs: s.tabs.map((t) =>
        t.id === tabId && t.kind === "query"
          ? {
              ...t,
              loading: true,
              error: null,
              stopping: false,
              runStartedAt: startedAt,
              liveServerMs: 0,
              roundTripMs: null,
            }
          : t
      ),
    }));
    /* Silently record this execution attempt. Backend dedupes + bumps timestamp
       on identical SQL. Skipped when no database is selected (no key). */
    if (tab.database) {
      ipc
        .addQueryHistory(tab.profileId, tab.database, sqlAtExecute)
        .then((queryHistory) => {
          set((s) => ({
            tabs: s.tabs.map((t) =>
              t.id === tabId &&
              t.kind === "query" &&
              t.profileId === tab.profileId &&
              t.database === tab.database
                ? { ...t, queryHistory }
                : t
            ),
          }));
        })
        .catch(() => {
          /* history is best-effort; don't surface */
        });
    }
    /* Tick the live server timer from backend progress events for this token. */
    const unlisten = await listen<{ token: string; serverMs: number }>(
      "query-progress",
      (e) => {
        if (e.payload.token !== tabId) return;
        set((s) => ({
          tabs: s.tabs.map((t) =>
            t.id === tabId && t.kind === "query"
              ? { ...t, liveServerMs: e.payload.serverMs }
              : t
          ),
        }));
      }
    );
    try {
      const result = await ipc.executeQuery({
        profileId: tab.profileId,
        database: tab.database,
        sql: sqlAtExecute,
        token: tabId,
        maxRows: tab.maxRows,
      });
      set((s) => ({
        tabs: s.tabs.map((t) =>
          t.id === tabId && t.kind === "query"
            ? {
                ...t,
                loading: false,
                error: null,
                result,
                resultSql: sqlAtExecute,
                analysis: null,
                runStartedAt: null,
                roundTripMs: Date.now() - startedAt,
              }
            : t
        ),
      }));
      /* Only announce affected rows for a pure DML/DDL run — when a result-set
         statement is present (even one that returned zero rows), the grid is
         the feedback. */
      const stmts = splitSqlStatements(sqlAtExecute);
      if (
        result.results.length > 0 &&
        result.results.every((r) => r.rowsAffected != null) &&
        !(stmts.length === result.results.length && stmts.some(returnsResultSet))
      ) {
        const affected = result.results.reduce(
          (n, r) => n + (r.rowsAffected ?? 0),
          0
        );
        notifySuccess(`${affected} row${affected === 1 ? "" : "s"} affected.`);
      }
    } catch (e) {
      const msg = String(e);
      const current = get().tabs.find((t) => t.id === tabId);
      const wasStopped =
        (current?.kind === "query" && current.stopping) || /interrupted/i.test(msg);
      set((s) => ({
        tabs: s.tabs.map((t) =>
          t.id === tabId && t.kind === "query"
            ? {
                ...t,
                loading: false,
                stopping: false,
                runStartedAt: null,
                error: wasStopped ? null : msg,
              }
            : t
        ),
      }));
      if (wasStopped) notifyInfo("Query stopped.");
      /* Keyed per tab so a new failure supersedes this pane's previous query
         error (even with different text) — only the latest query error shows. */
      else notifyError(`Query failed: ${msg}`, `query-error:${tabId}`);
    } finally {
      unlisten();
    }
  },

  explainQuery: async (tabId, runAnalyze = false) => {
    const tab = get().tabs.find((t) => t.id === tabId);
    if (!tab || tab.kind !== "query" || tab.loading) return;
    if (!tab.sql.trim()) return;
    const startedAt = Date.now();
    const sqlAtRun = tab.sql;
    set((s) => ({
      tabs: s.tabs.map((t) =>
        t.id === tabId && t.kind === "query"
          ? { ...t, loading: true, error: null, stopping: false, runStartedAt: startedAt, liveServerMs: 0, roundTripMs: null }
          : t
      ),
    }));
    try {
      const bundle = await ipc.analyzeQuery({
        profileId: tab.profileId,
        database: tab.database,
        sql: sqlAtRun,
        runAnalyze,
      });
      const analysis = analyzeQueryBundle(bundle, sqlAtRun);
      /* Show the traditional EXPLAIN grid in the normal results area. */
      const result: QueryResult = {
        results: [
          {
            columns: bundle.explainColumns.map((name) => ({
              name,
              dataType: "",
              nullable: true,
              key: "",
            })),
            rows: bundle.explainRows as unknown as RowRecord[],
            rowsAffected: null,
            truncated: false,
          },
        ],
        elapsedMs: 0,
      };
      set((s) => ({
        tabs: s.tabs.map((t) =>
          t.id === tabId && t.kind === "query"
            ? {
                ...t,
                loading: false,
                error: null,
                result,
                /* The result is the EXPLAIN grid, not the statement's own
                   output — suppress statement-based labeling. */
                resultSql: null,
                analysis,
                runStartedAt: null,
                roundTripMs: Date.now() - startedAt,
              }
            : t
        ),
      }));
    } catch (e) {
      const msg = String(e);
      set((s) => ({
        tabs: s.tabs.map((t) =>
          t.id === tabId && t.kind === "query"
            ? { ...t, loading: false, stopping: false, runStartedAt: null, error: msg }
            : t
        ),
      }));
      notifyError(`Explain failed: ${msg}`, `query-error:${tabId}`);
    }
  },

  clearAnalysis: (tabId) => {
    set((s) => ({
      tabs: s.tabs.map((t) =>
        t.id === tabId && t.kind === "query" ? { ...t, analysis: null } : t
      ),
    }));
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

  saveQuery: async (tabId, name) => {
    const tab = get().tabs.find((t) => t.id === tabId);
    if (!tab || tab.kind !== "query") return;
    const trimmed = name.trim();
    if (!trimmed) return;
    if (!tab.database) {
      notifyError("Pick a database before saving a query.");
      return;
    }
    const query: SavedQuery = { name: trimmed, sql: tab.sql };
    try {
      await ipc.saveSavedQuery(tab.profileId, tab.database, query);
      const savedQueries = await ipc.listSavedQueries(tab.profileId, tab.database);
      set((s) => ({
        tabs: s.tabs.map((t) =>
          t.id === tabId && t.kind === "query"
            ? { ...t, savedQueries, activeSavedQuery: trimmed, savedSql: query.sql }
            : t
        ),
        savedQueryCounts: {
          ...s.savedQueryCounts,
          [`${tab.profileId}::${tab.database}`]: savedQueries.length,
        },
      }));
      notifySuccess(`Saved query "${trimmed}".`);
    } catch (e) {
      notifyError(`Could not save query: ${String(e)}`);
    }
  },

  applySavedQuery: (tabId, name) => {
    const tab = get().tabs.find((t) => t.id === tabId);
    if (!tab || tab.kind !== "query") return;
    const saved = tab.savedQueries.find((q) => q.name === name);
    if (!saved) return;
    set((s) => ({
      tabs: s.tabs.map((t) =>
        t.id === tabId && t.kind === "query"
          ? { ...t, sql: saved.sql, activeSavedQuery: name, savedSql: saved.sql }
          : t
      ),
    }));
  },

  deleteSavedQuery: async (tabId, name) => {
    const tab = get().tabs.find((t) => t.id === tabId);
    if (!tab || tab.kind !== "query") return;
    try {
      await ipc.deleteSavedQuery(tab.profileId, tab.database, name);
      const remaining = tab.savedQueries.filter((q) => q.name !== name);
      set((s) => ({
        tabs: s.tabs.map((t) =>
          t.id === tabId && t.kind === "query"
            ? {
                ...t,
                savedQueries: remaining,
                activeSavedQuery:
                  t.activeSavedQuery === name ? null : t.activeSavedQuery,
              }
            : t
        ),
        savedQueryCounts: {
          ...s.savedQueryCounts,
          [`${tab.profileId}::${tab.database}`]: remaining.length,
        },
      }));
    } catch (e) {
      notifyError(`Could not delete query: ${String(e)}`);
    }
  },

  applyQueryHistory: (tabId, sql) => {
    set((s) => ({
      tabs: s.tabs.map((t) =>
        t.id === tabId && t.kind === "query"
          ? { ...t, sql, activeSavedQuery: null, savedSql: sql }
          : t
      ),
    }));
  },

  deleteQueryHistory: async (tabId, sql) => {
    const tab = get().tabs.find((t) => t.id === tabId);
    if (!tab || tab.kind !== "query" || !tab.database) return;
    try {
      await ipc.deleteQueryHistory(tab.profileId, tab.database, sql);
      set((s) => ({
        tabs: s.tabs.map((t) =>
          t.id === tabId && t.kind === "query"
            ? { ...t, queryHistory: t.queryHistory.filter((h) => h.sql !== sql) }
            : t
        ),
      }));
    } catch (e) {
      notifyError(`Could not delete history entry: ${String(e)}`);
    }
  },

  clearQueryHistory: async (tabId) => {
    const tab = get().tabs.find((t) => t.id === tabId);
    if (!tab || tab.kind !== "query" || !tab.database) return;
    try {
      await ipc.clearQueryHistory(tab.profileId, tab.database);
      set((s) => ({
        tabs: s.tabs.map((t) =>
          t.id === tabId && t.kind === "query" ? { ...t, queryHistory: [] } : t
        ),
      }));
    } catch (e) {
      notifyError(`Could not clear history: ${String(e)}`);
    }
  },

  openTableDesigner: (profileId, profileName, database, folderId = null) => {
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
      tableComment: "",
      originalTableComment: "",
      tableCollation: "",
      columns: [defaultIdColumn()],
      originalColumns: [],
      indexes: [],
      originalIndexes: [],
      foreignKeys: [],
      originalForeignKeys: [],
      autoIncrementValue: "",
      originalAutoIncrementValue: "",
      targetFolderId: folderId,
    };
    set((s) => ({ tabs: [...s.tabs, tab], activeTabId: tabId }));
  },

  openTableEditor: async (profileId, profileName, database, table) => {
    const tabId = `edit-table::${profileId}::${database}::${table}`;
    set((s) => ({
      lastOpenedTables: {
        ...s.lastOpenedTables,
        [`${profileId}::${database}`]: table,
      },
    }));
    if (get().tabs.some((t) => t.id === tabId)) {
      set({ activeTabId: tabId });
      return;
    }
    const [defs, idxDefs, fkDefs, autoInc, comment, meta] = await Promise.all([
      ipc.columnDefinitions(profileId, database, table),
      ipc.indexDefinitions(profileId, database, table),
      ipc.foreignKeyDefinitions(profileId, database, table),
      ipc.tableAutoIncrement(profileId, database, table),
      ipc.tableComment(profileId, database, table),
      ipc.tableSchemaMeta(profileId, database, table),
    ]);
    const tableCollation = meta.collation ?? "";
    const columns = defs.map((d) => columnDefToDraft(d, tableCollation));
    const indexes = idxDefs.map(indexDefToDraft);
    const foreignKeys = fkDefs.map(foreignKeyDefToDraft);
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
      tableComment: comment,
      originalTableComment: comment,
      tableCollation,
      columns,
      originalColumns: columns.map((c) => ({ ...c })),
      indexes,
      originalIndexes: indexes.map((i) => ({
        ...i,
        columns: i.columns.map((c) => ({ ...c })),
      })),
      foreignKeys,
      originalForeignKeys: foreignKeys.map(cloneForeignKey),
      autoIncrementValue: ai,
      originalAutoIncrementValue: ai,
    };
    set((s) => ({ tabs: [...s.tabs, tab], activeTabId: tabId }));
  },

  exportTableSql: async (profileId, database, tables, includeData) => {
    if (tables.length === 0) return;
    const multi = tables.length > 1;
    const label = multi ? `${tables.length} tables` : tables[0];
    const path = await save({
      defaultPath: multi ? `${database}.sql` : `${tables[0]}.sql`,
      filters: [{ name: "SQL Script", extensions: ["sql"] }],
    });
    if (!path) return;

    /* Only the data path is slow enough to warrant a progress bar; it streams
       rows backend-side and reports `table-sql-progress` (cumulative). */
    let unlisten: (() => void) | undefined;
    if (includeData) {
      set({ sqlExport: { table: label, done: 0, total: 0, cancelling: false } });
      unlisten = await listen<{ done: number; total: number }>(
        "table-sql-progress",
        (e) => {
          set((s) =>
            s.sqlExport
              ? { sqlExport: { ...s.sqlExport, done: e.payload.done, total: e.payload.total } }
              : {}
          );
        }
      );
    }

    try {
      const completed = await ipc.exportTableSql(
        profileId,
        database,
        tables,
        path,
        includeData
      );
      if (completed) {
        notifySuccess(
          multi
            ? `Saved SQL for ${tables.length} tables${includeData ? " (with data)" : ""}.`
            : `Saved ${includeData ? "table and data" : "table"} SQL to ${tables[0]}.sql`
        );
      } else {
        notifyInfo(`SQL export of ${label} cancelled.`);
      }
    } catch (e) {
      notifyError(`Could not save SQL script: ${String(e)}`);
    } finally {
      unlisten?.();
      set({ sqlExport: null });
    }
  },

  cancelSqlExport: () => {
    set((s) =>
      s.sqlExport ? { sqlExport: { ...s.sqlExport, cancelling: true } } : {}
    );
    ipc.cancelTableSqlExport().catch(() => {});
  },

  backupDatabase: async (profileId, database) => {
    const path = await save({
      defaultPath: `${database}.dbbak`,
      filters: [{ name: "DB Sage Backup", extensions: ["dbbak"] }],
    });
    if (!path) return;

    set({
      backupProgress: {
        database,
        table: "",
        tableIndex: 0,
        tableCount: 0,
        done: 0,
        total: 0,
        cancelling: false,
      },
    });
    const unlisten = await listen<{
      table: string;
      tableIndex: number;
      tableCount: number;
      done: number;
      total: number;
    }>("db-backup-progress", (e) => {
      set((s) =>
        s.backupProgress
          ? { backupProgress: { ...s.backupProgress, ...e.payload } }
          : {}
      );
    });

    try {
      const completed = await ipc.backupDatabase(profileId, database, path);
      if (completed) {
        notifySuccess(`Backed up "${database}".`);
      } else {
        notifyInfo(`Backup of "${database}" cancelled.`);
      }
    } catch (e) {
      notifyError(`Could not back up "${database}": ${String(e)}`);
    } finally {
      unlisten();
      set({ backupProgress: null });
    }
  },

  cancelBackup: () => {
    set((s) =>
      s.backupProgress
        ? { backupProgress: { ...s.backupProgress, cancelling: true } }
        : {}
    );
    ipc.cancelBackup().catch(() => {});
  },

  openRestore: (profileId, database) =>
    set({ restoreTarget: { profileId, database } }),
  closeRestore: () => set({ restoreTarget: null }),

  setPendingSwap: (swap) => set({ pendingSwap: swap }),
  clearPendingSwap: () => set({ pendingSwap: null }),

  makeLive: async () => {
    const ps = get().pendingSwap;
    if (!ps) return;
    try {
      const stash = await ipc.swapDatabase(
        ps.profileId,
        ps.liveName,
        ps.restoredName
      );
      await get().refreshDatabases(ps.profileId);
      set({ pendingSwap: null });
      notifySuccess(
        `"${ps.liveName}" is now live. Previous version kept as "${stash}".`
      );
    } catch (e) {
      notifyError(`Swap failed: ${String(e)}`);
    }
  },

  discardRestoredCopy: async () => {
    const ps = get().pendingSwap;
    if (!ps) return;
    try {
      await get().dropDatabase(ps.profileId, ps.restoredName);
      set({ pendingSwap: null });
    } catch (e) {
      notifyError(`Could not discard "${ps.restoredName}": ${String(e)}`);
    }
  },

  updateCreateTable: (tabId, patch) => {
    set((s) => ({
      tabs: s.tabs.map((t) =>
        t.id === tabId && t.kind === "create-table" ? { ...t, ...patch } : t
      ),
    }));
  },

  finishTableCreation: async (
    createTabId,
    profileId,
    profileName,
    database,
    tableName,
    folderId = null
  ) => {
    /* Remember the new table so the (re-mounted) DB view auto-selects it. */
    set((s) => ({
      lastOpenedTables: {
        ...s.lastOpenedTables,
        [`${profileId}::${database}`]: tableName,
      },
    }));
    /* When created from inside a folder, assign the new table to it before the
       folder state is reloaded below. */
    if (folderId) {
      await ipc
        .setTableFolder(profileId, database, tableName, folderId)
        .catch((e) => notifyError(`Could not add to folder: ${String(e)}`));
    }
    /* Close the designer tab and any existing DB view for this database, then
       open a fresh one — remounting DatabaseView so it applies the remembered
       table as the selection and reloads the table list (including the new one). */
    const dbTabId = `db::${profileId}::${database}`;
    get().closeTab(createTabId);
    if (get().tabs.some((t) => t.id === dbTabId)) get().closeTab(dbTabId);
    await refreshFoldersEverywhere(profileId, database, set, get);
    await get().openDatabase(profileId, profileName, database);
    /* Land the user back inside the folder so the new table is visible. */
    if (folderId) get().enterFolder(dbTabId, folderId);
  },

  loadRelations: async (profileId, database) => {
    const list = await ipc.listRelations(profileId, database);
    set((s) => ({
      relations: { ...s.relations, [`${profileId}::${database}`]: list },
    }));
  },

  loadSavedQueryCount: async (profileId, database) => {
    const list = await ipc.listSavedQueries(profileId, database);
    set((s) => ({
      savedQueryCounts: {
        ...s.savedQueryCounts,
        [`${profileId}::${database}`]: list.length,
      },
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

  reorderTabs: (draggedId, targetId) => {
    const tabs = get().tabs;
    const from = tabs.findIndex((t) => t.id === draggedId);
    const to = tabs.findIndex((t) => t.id === targetId);
    if (from < 0 || to < 0 || from === to) return;
    const next = tabs.filter((t) => t.id !== draggedId);
    let insertAt = next.findIndex((t) => t.id === targetId);
    if (from < to) insertAt += 1;
    next.splice(insertAt, 0, tabs[from]);
    set({ tabs: next });
  },

  setTabDropActive: (active) => set({ tabDropActive: active }),

  dockTab: (tab) =>
    set((s) => ({
      /* Drop any stale copy with the same id, then append and focus it. */
      tabs: [...s.tabs.filter((t) => t.id !== tab.id), tab],
      activeTabId: tab.id,
      tabDropActive: false,
    })),

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

  refreshTableData: async (profileId, database, table) => {
    const ids = get()
      .tabs.filter(
        (t) =>
          (t.kind === "rows" &&
            t.profileId === profileId &&
            t.database === database &&
            t.table === table) ||
          (t.kind === "database" &&
            t.profileId === profileId &&
            t.database === database)
      )
      .map((t) => t.id);
    for (const id of ids) await get().refreshTab(id);
  },

  setRowsSort: async (tabId, sort) => {
    set((s) => ({
      tabs: s.tabs.map((t) =>
        t.id === tabId && t.kind === "rows" ? { ...t, sort, page: 1 } : t
      ),
    }));
    const t = get().tabs.find((x) => x.id === tabId);
    if (t && t.kind === "rows") persistColumnSetup(t);
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

  clearRowsFilters: async (tabId) => {
    set((s) => ({
      tabs: s.tabs.map((t) =>
        t.id === tabId && t.kind === "rows"
          ? {
              ...t,
              filters: [],
              hiddenColumns: [],
              page: 1,
              exactTotal: null,
            }
          : t
      ),
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

  setRowsActiveCell: (tabId, cell) => {
    set((s) => ({
      tabs: s.tabs.map((t) =>
        t.id === tabId && t.kind === "rows" ? { ...t, activeCell: cell } : t
      ),
    }));
  },

  setRowsSelection: (tabId, indices) => {
    set((s) => ({
      tabs: s.tabs.map((t) =>
        t.id === tabId && t.kind === "rows"
          ? { ...t, selectedRows: indices }
          : t
      ),
    }));
  },

  setTabInspectorOpen: (tabId, open) => {
    set((s) => ({
      tabs: s.tabs.map((t) =>
        t.id === tabId && (t.kind === "rows" || t.kind === "query")
          ? { ...t, inspectorOpen: open }
          : t
      ),
    }));
  },

  setTabRelationsOpen: (tabId, open) => {
    set((s) => ({
      tabs: s.tabs.map((t) =>
        t.id === tabId && t.kind === "rows" ? { ...t, relationsOpen: open } : t
      ),
    }));
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

  setColumnWidths: (tabId, widths) => {
    set((s) => ({
      tabs: s.tabs.map((t) =>
        t.id === tabId && t.kind === "rows" ? { ...t, columnWidths: widths } : t
      ),
    }));
    const t = get().tabs.find((x) => x.id === tabId);
    if (t && t.kind === "rows") persistColumnSetup(t);
  },

  saveTablePreset: async (tabId, name) => {
    const tab = get().tabs.find((t) => t.id === tabId);
    if (!tab || tab.kind !== "rows") return;
    const trimmed = name.trim();
    if (!trimmed) return;
    /* Capture the peek windows currently open against this table, so the view
       restores them too. Best-effort — a peek-listing hiccup must not block the
       save. */
    let peeks: PeekDescriptor[] = [];
    try {
      const open = await ipc.listOpenPeeks<PeekDescriptor>();
      peeks = peeksReachableFrom(open, tab);
    } catch {
      /* ignore — save the rest of the view */
    }
    const preset: TableViewPreset = {
      name: trimmed,
      setup: {
        hiddenColumns: tab.hiddenColumns,
        columnWidths: tab.columnWidths,
        sort: tab.sort,
        filters: tab.filters,
        jsonDisplay: tab.jsonDisplay,
        /* The effective state: untouched, the panel is open when the table
           has relations defined from it (see RowsTabBody). */
        relationsOpen:
          tab.relationsOpen ??
          (get().relations[`${tab.profileId}::${tab.database}`] ?? []).some(
            (r) => r.fromTable === tab.table
          ),
        ...(peeks.length > 0 && { peeks }),
      },
    };
    try {
      await ipc.saveTablePreset(tab.profileId, tab.database, tab.table, preset);
      const presets = await ipc.listTablePresets(
        tab.profileId,
        tab.database,
        tab.table
      );
      set((s) => ({
        tabs: s.tabs.map((t) =>
          t.id === tabId && t.kind === "rows" ? { ...t, presets } : t
        ),
      }));
      notifySuccess(`Saved view "${trimmed}".`);
    } catch (e) {
      notifyError(`Could not save view: ${String(e)}`);
    }
  },

  applyTablePreset: async (tabId, name) => {
    const tab = get().tabs.find((t) => t.id === tabId);
    if (!tab || tab.kind !== "rows") return;
    const preset = tab.presets.find((p) => p.name === name);
    if (!preset) return;
    const { hiddenColumns, columnWidths, sort, filters, jsonDisplay } =
      preset.setup;
    set((s) => ({
      tabs: s.tabs.map((t) =>
        t.id === tabId && t.kind === "rows"
          ? {
              ...t,
              hiddenColumns,
              columnWidths,
              sort,
              filters,
              jsonDisplay,
              /* Views saved before the Relations panel existed leave it as is. */
              relationsOpen: preset.setup.relationsOpen ?? t.relationsOpen,
              activePreset: name,
            }
          : t
      ),
    }));
    /* Persist the now-current column setup (sort is preset-only) and reload, so
       the preset's sort + filters take effect against the server. */
    const t = get().tabs.find((x) => x.id === tabId);
    if (t && t.kind === "rows") persistColumnSetup(t);
    await loadTabPage(tabId, 1, set, get);

    /* A saved view owns the peek workspace: close any peeks currently on screen
       first, then reopen exactly the set the view captured. */
    await ipc.closeAllPeeks().catch(() => {});
    for (const p of preset.setup.peeks ?? []) {
      const seed = {
        profileId: p.profileId,
        profileName: p.profileName,
        database: p.database,
        target: p.target,
        sourceTable: p.sourceTable,
        sourceColumn: p.sourceColumn,
        hiddenColumns: p.hiddenColumns,
        inspectorOpen: p.inspectorOpen,
        sort: p.sort,
        filters: p.filters,
        columnWidths: p.columnWidths,
        jsonDisplay: p.jsonDisplay,
        relationsOpen: p.relationsOpen,
        inspectorHeight: p.inspectorHeight,
        activeColumn: p.activeColumn,
        kind: p.kind,
        compactHeight: p.compactHeight,
        fromView: true,
      };
      ipc
        .openPeekWindow(seed, p.x ?? 120, p.y ?? 120, p.width ?? 900, p.height ?? 440)
        .catch(() => {});
    }
  },

  deleteTablePreset: async (tabId, name) => {
    const tab = get().tabs.find((t) => t.id === tabId);
    if (!tab || tab.kind !== "rows") return;
    try {
      await ipc.deleteTablePreset(tab.profileId, tab.database, tab.table, name);
      set((s) => ({
        tabs: s.tabs.map((t) =>
          t.id === tabId && t.kind === "rows"
            ? {
                ...t,
                presets: t.presets.filter((p) => p.name !== name),
                activePreset: t.activePreset === name ? null : t.activePreset,
              }
            : t
        ),
      }));
    } catch (e) {
      notifyError(`Could not delete view: ${String(e)}`);
    }
  },

  clearTableView: async (tabId) => {
    const tab = get().tabs.find((t) => t.id === tabId);
    if (!tab || tab.kind !== "rows") return;
    set((s) => ({
      tabs: s.tabs.map((t) =>
        t.id === tabId && t.kind === "rows"
          ? {
              ...t,
              hiddenColumns: [],
              columnWidths: {},
              sort: null,
              filters: [],
              jsonDisplay: {},
              activePreset: null,
            }
          : t
      ),
    }));
    const t = get().tabs.find((x) => x.id === tabId);
    if (t && t.kind === "rows") persistColumnSetup(t);
    await loadTabPage(tabId, 1, set, get);
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
    invalidateRelatedExistence(tab.profileId, tab.database, tab.table);
    await loadTabPage(tabId, tab.page, set, get);
  },

  updateCells: async (tabId, edits) => {
    const tab = get().tabs.find((t) => t.id === tabId);
    if (!tab || tab.kind !== "rows" || !tab.data) return;
    const pkColumns = tab.data.columns.filter((c) => c.key === "PRI");
    if (pkColumns.length === 0) {
      throw new Error("Table has no primary key — cell editing is disabled.");
    }
    try {
      for (const edit of edits) {
        const row = tab.data.rows[edit.rowIndex];
        if (!row) continue;
        const pk = pkColumns.map((c) => ({
          column: c.name,
          value: toIpcString(row[c.name]),
        }));
        await ipc.updateCell({
          profileId: tab.profileId,
          database: tab.database,
          table: tab.table,
          pk,
          column: edit.column,
          value: edit.value,
        });
      }
    } finally {
      invalidateRelatedExistence(tab.profileId, tab.database, tab.table);
      await loadTabPage(tabId, tab.page, set, get);
    }
  },

  insertRow: async (tabId, values) => {
    const tab = get().tabs.find((t) => t.id === tabId);
    if (!tab || tab.kind !== "rows") return;
    await ipc.insertRow({
      profileId: tab.profileId,
      database: tab.database,
      table: tab.table,
      values,
    });
    invalidateRelatedExistence(tab.profileId, tab.database, tab.table);
    /* Row count changed — drop the exact count and reload the current page. */
    set((s) => ({
      tabs: s.tabs.map((t) =>
        t.id === tabId && t.kind === "rows" ? { ...t, exactTotal: null } : t
      ),
    }));
    await loadTabPage(tabId, tab.page, set, get);
  },

  insertRows: async (tabId, rows) => {
    const tab = get().tabs.find((t) => t.id === tabId);
    if (!tab || tab.kind !== "rows" || rows.length === 0) return;
    await ipc.insertRows({
      profileId: tab.profileId,
      database: tab.database,
      table: tab.table,
      rows,
    });
    invalidateRelatedExistence(tab.profileId, tab.database, tab.table);
    set((s) => ({
      tabs: s.tabs.map((t) =>
        t.id === tabId && t.kind === "rows" ? { ...t, exactTotal: null } : t
      ),
    }));
    await loadTabPage(tabId, tab.page, set, get);
  },

  deleteRows: async (tabId, rowIndices, cascade) => {
    const tab = get().tabs.find((t) => t.id === tabId);
    if (!tab || tab.kind !== "rows" || !tab.data) return;
    await deleteRowsWithCascade(
      {
        profileId: tab.profileId,
        database: tab.database,
        table: tab.table,
        columns: tab.data.columns,
        rows: tab.data.rows,
      },
      rowIndices,
      cascade
    );
    set((s) => ({
      tabs: s.tabs.map((t) =>
        t.id === tabId && t.kind === "rows" ? { ...t, exactTotal: null } : t
      ),
    }));
    await loadTabPage(tabId, tab.page, set, get);
  },

  duplicateRows: async (tabId, rowIndices) => {
    const tab = get().tabs.find((t) => t.id === tabId);
    if (!tab || tab.kind !== "rows" || !tab.data) {
      return { okCount: 0, conflicts: [], errors: [] };
    }
    const pkColumns = tab.data.columns.filter((c) => c.key === "PRI");
    if (pkColumns.length === 0) {
      throw new Error("Table has no primary key - row duplication is disabled.");
    }
    const columns = tab.data.columns;

    let okCount = 0;
    const conflicts: DuplicateConflict[] = [];
    const errors: string[] = [];

    for (const rowIndex of rowIndices) {
      const row = tab.data.rows[rowIndex];
      if (!row) continue;
      const pk = pkColumns.map((c) => ({
        column: c.name,
        value: toIpcString(row[c.name]),
      }));
      const outcome = await ipc.duplicateRow({
        profileId: tab.profileId,
        database: tab.database,
        table: tab.table,
        pk,
      });
      if (outcome.status === "ok") {
        okCount++;
      } else if (outcome.status === "conflict") {
        /* Snapshot the displayed row now — the page reloads below, after which
           this index may point at a different row. */
        const seed: Record<string, string | null> = {};
        for (const c of columns) seed[c.name] = toIpcString(row[c.name]);
        conflicts.push({ seed, message: outcome.message ?? "Constraint violation" });
      } else {
        errors.push(outcome.message ?? "Could not duplicate the row");
      }
    }

    if (okCount > 0) {
      invalidateRelatedExistence(tab.profileId, tab.database, tab.table);
      set((s) => ({
        tabs: s.tabs.map((t) =>
          t.id === tabId && t.kind === "rows" ? { ...t, exactTotal: null } : t
        ),
      }));
      await loadTabPage(tabId, tab.page, set, get);
    }

    return { okCount, conflicts, errors };
  },
}));

type SetFn = (
  partial:
    | Partial<Store>
    | ((s: Store) => Partial<Store>)
) => void;
type GetFn = () => Store;

/** Fetch the saved queries for a query tab's current database and store them on
 * the tab. Best-effort; a load failure just leaves the list empty. */
function loadSavedQueries(tabId: string, set: SetFn, get: GetFn) {
  const tab = get().tabs.find((t) => t.id === tabId);
  if (!tab || tab.kind !== "query" || !tab.database) return;
  const { profileId, database } = tab;
  ipc
    .listSavedQueries(profileId, database)
    .then((savedQueries) => {
      set((s) => ({
        tabs: s.tabs.map((t) =>
          t.id === tabId &&
          t.kind === "query" &&
          t.profileId === profileId &&
          t.database === database
            ? { ...t, savedQueries }
            : t
        ),
      }));
    })
    .catch(() => {
      /* load is best-effort */
    });
}

/** Fetch the query history for a query tab's current database and store it on
 * the tab. Best-effort; a load failure just leaves the list empty. */
function loadQueryHistory(tabId: string, set: SetFn, get: GetFn) {
  const tab = get().tabs.find((t) => t.id === tabId);
  if (!tab || tab.kind !== "query" || !tab.database) return;
  const { profileId, database } = tab;
  ipc
    .listQueryHistory(profileId, database)
    .then((queryHistory) => {
      set((s) => ({
        tabs: s.tabs.map((t) =>
          t.id === tabId &&
          t.kind === "query" &&
          t.profileId === profileId &&
          t.database === database
            ? { ...t, queryHistory }
            : t
        ),
      }));
    })
    .catch(() => {
      /* load is best-effort */
    });
}

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
  const [defs, idxDefs, fkDefs, autoInc, comment, meta] = await Promise.all([
    ipc.columnDefinitions(tab.profileId, tab.database, tableName),
    ipc.indexDefinitions(tab.profileId, tab.database, tableName),
    ipc.foreignKeyDefinitions(tab.profileId, tab.database, tableName),
    ipc.tableAutoIncrement(tab.profileId, tab.database, tableName),
    ipc.tableComment(tab.profileId, tab.database, tableName),
    ipc.tableSchemaMeta(tab.profileId, tab.database, tableName),
  ]);
  const tableCollation = meta.collation ?? "";
  const columns = defs.map((d) => columnDefToDraft(d, tableCollation));
  const indexes = idxDefs.map(indexDefToDraft);
  const foreignKeys = fkDefs.map(foreignKeyDefToDraft);
  const ai = autoInc != null ? String(autoInc) : "";
  set((s) => ({
    tabs: s.tabs.map((t) =>
      t.id === tabId && t.kind === "create-table"
        ? {
            ...t,
            tableName,
            originalName: tableName,
            tableComment: comment,
            originalTableComment: comment,
            tableCollation,
            columns,
            originalColumns: columns.map((c) => ({ ...c })),
            indexes,
            originalIndexes: indexes.map((i) => ({
              ...i,
              columns: i.columns.map((c) => ({ ...c })),
            })),
            foreignKeys,
            originalForeignKeys: foreignKeys.map(cloneForeignKey),
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
