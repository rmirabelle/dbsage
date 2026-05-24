import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import {
  CaretRight as ChevronRight,
  Database,
  Folder as FolderIcon,
  CircleNotch as Loader2,
  Plus,
  HardDrives as Server,
  Table as Table2,
  PencilSimple,
  TextT,
  Power,
  Trash,
} from "@phosphor-icons/react";
import clsx from "clsx";
import { useStore } from "../state/store";
import { notifyError } from "../state/notify";
import type { ProfileView } from "../types";
import { ProfileDialog } from "./ProfileDialog";
import { FolderDeleteDialog } from "./FolderDeleteDialog";
import { TableActionDialog, type TableAction } from "./TableActionDialog";
import { TableContextMenu } from "./TableContextMenu";
import { NewDatabaseDialog } from "./NewDatabaseDialog";
import { DropDatabaseDialog } from "./DropDatabaseDialog";
import { ipc } from "../ipc";

export function ConnectionTree() {
  const profiles = useStore((s) => s.profiles);
  const loadingProfiles = useStore((s) => s.loadingProfiles);
  const expandedProfiles = useStore((s) => s.expandedProfiles);
  const toggleProfileExpanded = useStore((s) => s.toggleProfileExpanded);
  const loadProfiles = useStore((s) => s.loadProfiles);
  const disconnectProfile = useStore((s) => s.disconnectProfile);
  const createDatabase = useStore((s) => s.createDatabase);
  const connections = useStore((s) => s.connections);

  const [dialogOpen, setDialogOpen] = useState(false);
  const [editing, setEditing] = useState<ProfileView | null>(null);
  const [menu, setMenu] = useState<{
    profileId: string;
    x: number;
    y: number;
  } | null>(null);
  const [renamingId, setRenamingId] = useState<string | null>(null);
  const [newDbProfile, setNewDbProfile] = useState<ProfileView | null>(null);

  useEffect(() => {
    loadProfiles();
  }, [loadProfiles]);

  const commitRename = async (profile: ProfileView, rawName: string) => {
    setRenamingId(null);
    const name = rawName.trim();
    if (!name || name === profile.name) return;
    await ipc.saveProfile({
      id: profile.id,
      name,
      host: profile.host,
      port: profile.port,
      username: profile.username,
      defaultDatabase: profile.defaultDatabase,
    });
    await loadProfiles();
  };

  return (
    <aside data-el="connection-tree" className="w-full h-full bg-zinc-950 border-r border-zinc-800/80 flex flex-col">
      <div data-el="connection-tree-header" className="dbs-toolbar h-9 flex items-center justify-between px-3 border-b border-zinc-800/60 gap-2">
        <span className="text-[10px] font-semibold uppercase tracking-[0.14em] text-zinc-500">
          Connections
        </span>
        <div className="flex items-center gap-1">
          <button
            data-el="add-connection-btn"
            onClick={() => {
              setEditing(null);
              setDialogOpen(true);
            }}
            className="text-zinc-400 hover:text-accent-400 transition h-5 w-5 inline-flex items-center justify-center rounded hover:bg-zinc-800"
            aria-label="Add connection"
          >
            <Plus size={15} />
          </button>
        </div>
      </div>

      <div className="flex-1 overflow-y-auto py-1 select-none">
        {loadingProfiles && profiles.length === 0 && (
          <div className="px-3 py-4 text-zinc-500 text-xs flex items-center gap-2">
            <Loader2 size={14} className="animate-spin" /> Loading…
          </div>
        )}

        {!loadingProfiles && profiles.length === 0 && (
          <div className="px-3 py-6 text-zinc-500 text-xs leading-relaxed">
            No connections yet.
            <button
              onClick={() => {
                setEditing(null);
                setDialogOpen(true);
              }}
              className="block mt-2 text-accent-400 hover:text-accent-300"
            >
              + Add your first connection
            </button>
          </div>
        )}

        {profiles.map((profile) => {
          const expanded = expandedProfiles.has(profile.id);
          const conn = connections[profile.id];
          return (
            <div key={profile.id} className="text-xs">
              <div
                data-el="connection-row"
                className={clsx(
                  "group flex items-center gap-1 px-2 py-1.5 cursor-pointer hover:bg-zinc-900/70",
                  expanded && "bg-zinc-900/40"
                )}
                onClick={() => toggleProfileExpanded(profile.id)}
                onContextMenu={(e) => {
                  e.preventDefault();
                  e.stopPropagation();
                  setMenu({ profileId: profile.id, x: e.clientX, y: e.clientY });
                }}
              >
                <ChevronRight
                  size={16}
                  className={clsx(
                    "text-zinc-500 transition-transform",
                    expanded && "rotate-90"
                  )}
                />
                {conn?.connecting ? (
                  <Loader2 size={18} className="shrink-0 animate-spin text-lime-400" />
                ) : conn?.connected ? (
                  <button
                    data-el="disconnect-btn"
                    onClick={(e) => {
                      e.stopPropagation();
                      disconnectProfile(profile.id);
                    }}
                    className="shrink-0 text-lime-400 hover:text-zinc-300 transition-colors"
                    aria-label="Disconnect"
                    title="Disconnect"
                  >
                    <Server size={18} />
                  </button>
                ) : (
                  <Server size={18} className="shrink-0 text-zinc-500" />
                )}
                {renamingId === profile.id ? (
                  <ProfileRenameInput
                    initial={profile.name}
                    onCommit={(name) => commitRename(profile, name)}
                    onCancel={() => setRenamingId(null)}
                  />
                ) : (
                  <span className="flex-1 truncate text-zinc-200 text-[16px] font-bold">
                    {profile.name}
                  </span>
                )}
              </div>

              {menu?.profileId === profile.id && (
                <ConnectionContextMenu
                  x={menu.x}
                  y={menu.y}
                  profile={profile}
                  connected={!!conn?.connected}
                  onClose={() => setMenu(null)}
                  onRename={() => {
                    setRenamingId(profile.id);
                    setMenu(null);
                  }}
                  onEdit={() => {
                    setEditing(profile);
                    setDialogOpen(true);
                    setMenu(null);
                  }}
                  onNewDatabase={() => {
                    setNewDbProfile(profile);
                    setMenu(null);
                  }}
                  onDisconnect={async () => {
                    await disconnectProfile(profile.id);
                    setMenu(null);
                  }}
                />
              )}

              {conn?.error && expanded && (
                <div className="px-7 py-1.5 text-rose-400 text-[11px] leading-snug break-words">
                  {conn.error}
                </div>
              )}

              {expanded && conn?.connected && <DatabaseList profile={profile} />}
            </div>
          );
        })}
      </div>

      {dialogOpen && (
        <ProfileDialog
          profile={editing}
          onClose={() => {
            setDialogOpen(false);
            setEditing(null);
          }}
          onSaved={() => {
            setDialogOpen(false);
            setEditing(null);
            loadProfiles();
          }}
        />
      )}

      {newDbProfile && (
        <NewDatabaseDialog
          connectionName={newDbProfile.name}
          onCreate={(name) => createDatabase(newDbProfile.id, name)}
          onClose={() => setNewDbProfile(null)}
        />
      )}
    </aside>
  );
}

function ConnectionContextMenu({
  x,
  y,
  profile,
  connected,
  onClose,
  onRename,
  onEdit,
  onNewDatabase,
  onDisconnect,
}: {
  x: number;
  y: number;
  profile: ProfileView;
  connected: boolean;
  onClose: () => void;
  onRename: () => void;
  onEdit: () => void;
  onNewDatabase: () => void;
  onDisconnect: () => void;
}) {
  const loadProfiles = useStore((s) => s.loadProfiles);

  useEffect(() => {
    const close = () => onClose();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("click", close);
    window.addEventListener("contextmenu", close);
    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("click", close);
      window.removeEventListener("contextmenu", close);
      window.removeEventListener("keydown", onKey);
    };
  }, [onClose]);

  const item =
    "flex w-full items-center gap-2.5 text-left px-3 py-1.5 hover:bg-zinc-800";

  return createPortal(
    <div
      data-el="connection-menu"
      style={{ top: y, left: x }}
      onClick={(e) => e.stopPropagation()}
      className="dbs-context-menu fixed z-50 min-w-[160px] rounded border border-zinc-700 bg-zinc-900/95 backdrop-blur-sm py-1 shadow-xl shadow-black/60"
    >
      <button
        data-el="rename-connection-btn"
        className={clsx(item, "text-zinc-200")}
        onClick={onRename}
      >
        <TextT size={14} className="text-accent-400 shrink-0" />
        Rename Connection
      </button>
      <button className={clsx(item, "text-zinc-200")} onClick={onEdit}>
        <PencilSimple size={14} className="text-accent-400 shrink-0" />
        Edit Connection
      </button>
      <button className={clsx(item, "text-zinc-200")} onClick={onNewDatabase}>
        <Database size={14} className="text-accent-400 shrink-0" />
        New Database
      </button>
      {connected && (
        <button className={clsx(item, "text-zinc-200")} onClick={onDisconnect}>
          <Power size={14} className="text-zinc-400 shrink-0" />
          Disconnect
        </button>
      )}
      <button
        className={clsx(item, "text-rose-400")}
        onClick={async () => {
          if (!confirm(`Delete connection "${profile.name}"?`)) return;
          await ipc.deleteProfile(profile.id);
          await loadProfiles();
          onClose();
        }}
      >
        <Trash size={14} className="shrink-0" />
        Delete Connection
      </button>
    </div>,
    document.body
  );
}

function ProfileRenameInput({
  initial,
  onCommit,
  onCancel,
}: {
  initial: string;
  onCommit: (name: string) => void;
  onCancel: () => void;
}) {
  const [val, setVal] = useState(initial);
  const ref = useRef<HTMLInputElement>(null);
  const done = useRef(false);
  useEffect(() => {
    ref.current?.focus();
    ref.current?.select();
  }, []);
  const finish = (fn: () => void) => {
    if (done.current) return;
    done.current = true;
    fn();
  };
  return (
    <input
      ref={ref}
      data-el="connection-rename-input"
      value={val}
      onChange={(e) => setVal(e.target.value)}
      onClick={(e) => e.stopPropagation()}
      onDoubleClick={(e) => e.stopPropagation()}
      onKeyDown={(e) => {
        if (e.key === "Enter") {
          e.preventDefault();
          finish(() => onCommit(val));
        } else if (e.key === "Escape") {
          e.preventDefault();
          finish(onCancel);
        }
      }}
      onBlur={() => finish(() => onCommit(val))}
      className="flex-1 min-w-0 bg-zinc-900 border border-accent-500/60 rounded px-1.5 py-0.5 text-[16px] font-bold text-zinc-100 outline-none"
    />
  );
}

function DatabaseList({ profile }: { profile: ProfileView }) {
  const tree = useStore((s) => s.trees[profile.id]);
  const toggleDbExpanded = useStore((s) => s.toggleDbExpanded);
  const toggleFolderExpandedInTree = useStore((s) => s.toggleFolderExpandedInTree);
  const openDatabase = useStore((s) => s.openDatabase);
  const openTable = useStore((s) => s.openTable);
  const openTableEditor = useStore((s) => s.openTableEditor);
  const renameTable = useStore((s) => s.renameTable);
  const renameFolderInDb = useStore((s) => s.renameFolderInDb);
  const deleteFolderInDb = useStore((s) => s.deleteFolderInDb);
  const [tableMenu, setTableMenu] = useState<{
    db: string;
    table: string;
    x: number;
    y: number;
  } | null>(null);
  const [pendingTableAction, setPendingTableAction] = useState<{
    kind: TableAction;
    db: string;
    table: string;
  } | null>(null);
  const [renamingTable, setRenamingTable] = useState<{
    db: string;
    table: string;
  } | null>(null);
  const [dbMenu, setDbMenu] = useState<{
    db: string;
    x: number;
    y: number;
  } | null>(null);
  const [pendingDbDrop, setPendingDbDrop] = useState<string | null>(null);
  const [folderMenu, setFolderMenu] = useState<{
    db: string;
    folderId: string;
    folderName: string;
    tableCount: number;
    x: number;
    y: number;
  } | null>(null);
  const [renamingFolder, setRenamingFolder] = useState<{
    db: string;
    folderId: string;
  } | null>(null);
  const [pendingFolderDelete, setPendingFolderDelete] = useState<{
    db: string;
    folderId: string;
    folderName: string;
    tableCount: number;
  } | null>(null);
  const activeDbName = useStore((s) => {
    const tab = s.tabs.find((t) => t.id === s.activeTabId);
    if (!tab || tab.kind !== "database" || tab.profileId !== profile.id) return null;
    return tab.database;
  });

  useEffect(() => {
    if (!tableMenu) return;
    const close = () => setTableMenu(null);
    window.addEventListener("click", close);
    window.addEventListener("contextmenu", close);
    return () => {
      window.removeEventListener("click", close);
      window.removeEventListener("contextmenu", close);
    };
  }, [tableMenu]);

  useEffect(() => {
    if (!dbMenu) return;
    const close = () => setDbMenu(null);
    window.addEventListener("click", close);
    window.addEventListener("contextmenu", close);
    return () => {
      window.removeEventListener("click", close);
      window.removeEventListener("contextmenu", close);
    };
  }, [dbMenu]);

  if (!tree) return null;
  if (tree.databases.length === 0) {
    return (
      <div className="pl-9 py-1.5 text-zinc-600 text-[11px]">No databases</div>
    );
  }

  /** Render one table row (used for both foldered and unfoldered tables), with
   * inline rename + a right-click context menu mirroring the DB view. */
  const renderTableRow = (
    t: { name: string; kind: string },
    db: string,
    paddingClass: string
  ) => {
    const isRenaming =
      renamingTable?.db === db && renamingTable.table === t.name;
    if (isRenaming) {
      return (
        <div
          key={t.name}
          className={clsx("flex items-center gap-2 pr-2 py-1", paddingClass)}
        >
          <Table2 size={13} className="text-zinc-600 shrink-0" />
          <TreeRenameInput
            initial={t.name}
            onCommit={(name) => {
              setRenamingTable(null);
              const trimmed = name.trim();
              if (trimmed && trimmed !== t.name) {
                renameTable(profile.id, db, t.name, trimmed).catch((err) =>
                  notifyError(`Could not rename table: ${String(err)}`)
                );
              }
            }}
            onCancel={() => setRenamingTable(null)}
          />
        </div>
      );
    }
    return (
      <div
        key={t.name}
        data-el="table-row"
        onDoubleClick={() => openTable(profile.id, profile.name, db, t.name)}
        onContextMenu={(e) => {
          e.preventDefault();
          e.stopPropagation();
          setTableMenu({ db, table: t.name, x: e.clientX, y: e.clientY });
        }}
        className={clsx(
          "flex items-center gap-2 pr-2 py-1 cursor-pointer hover:bg-zinc-900/70 text-zinc-400 hover:text-zinc-100",
          paddingClass
        )}
        title="Double-click to open · right-click for actions"
      >
        <Table2 size={13} className="text-zinc-600 shrink-0" />
        <span className="truncate">{t.name}</span>
      </div>
    );
  };

  return (
    <div>
      {tree.databases.map((db) => {
        const expanded = tree.expandedDbs.has(db);
        const state = tree.tablesByDb[db];

        const folderByTable = new Map<string, string>();
        if (state) {
          for (const f of state.folders) for (const t of f.tables) folderByTable.set(t, f.id);
        }
        const unsortedTables = state
          ? state.items.filter((t) => !folderByTable.has(t.name))
          : [];
        const sortedFolders = state
          ? [...state.folders].sort((a, b) =>
              a.name.localeCompare(b.name, undefined, { sensitivity: "base" })
            )
          : [];
        const tablesByFolderId = new Map<string, { name: string; kind: string }[]>();
        if (state) {
          const byName = new Map(state.items.map((t) => [t.name, t]));
          for (const f of state.folders) {
            tablesByFolderId.set(
              f.id,
              f.tables
                .map((n) => byName.get(n))
                .filter((t): t is { name: string; kind: string } => Boolean(t))
            );
          }
        }

        const isActive = db === activeDbName;
        return (
          <div key={db}>
            <div
              data-el="db-row"
              className={clsx(
                "flex items-center gap-1 pl-6 pr-2 py-1.5 cursor-pointer hover:bg-zinc-900/70",
                isActive && "bg-zinc-900/60"
              )}
              onClick={() => openDatabase(profile.id, profile.name, db)}
              onDoubleClick={() => toggleDbExpanded(profile.id, db)}
              onContextMenu={(e) => {
                e.preventDefault();
                e.stopPropagation();
                setDbMenu({ db, x: e.clientX, y: e.clientY });
              }}
              title="Click to view tables · double-click or arrow to expand · right-click for actions"
            >
              <button
                onClick={(e) => {
                  e.stopPropagation();
                  toggleDbExpanded(profile.id, db);
                }}
                className="p-0.5 -m-0.5 rounded hover:bg-zinc-800 text-zinc-600 hover:text-zinc-300"
                aria-label={expanded ? "Collapse" : "Expand"}
              >
                <ChevronRight
                  size={13}
                  className={clsx(
                    "transition-transform",
                    expanded && "rotate-90"
                  )}
                />
              </button>
              <Database
                size={13}
                className={isActive ? "text-accent-400" : "text-zinc-500"}
              />
              <span
                className={clsx(
                  "truncate",
                  isActive ? "text-zinc-100 font-semibold" : "text-zinc-300"
                )}
              >
                {db}
              </span>
            </div>
            {expanded && state && (
              <div>
                {state.loading && (
                  <div className="pl-14 py-1.5 text-zinc-600 text-[11px] flex items-center gap-2">
                    <Loader2 size={12} className="animate-spin" /> Loading…
                  </div>
                )}
                {state.error && (
                  <div className="pl-14 py-1.5 text-rose-400 text-[11px] break-words">
                    {state.error}
                  </div>
                )}
                {!state.loading &&
                  !state.error &&
                  state.folders.length === 0 &&
                  state.items.length === 0 && (
                    <div className="pl-14 py-1.5 text-zinc-600 text-[11px]">
                      No tables
                    </div>
                  )}

                {sortedFolders.map((folder) => {
                  const folderExpanded = state.expandedFolders.has(folder.id);
                  const folderTables = tablesByFolderId.get(folder.id) ?? [];
                  return (
                    <div key={folder.id}>
                      <div
                        data-el="folder-row"
                        onClick={() =>
                          toggleFolderExpandedInTree(profile.id, db, folder.id)
                        }
                        onContextMenu={(e) => {
                          e.preventDefault();
                          e.stopPropagation();
                          setFolderMenu({
                            db,
                            folderId: folder.id,
                            folderName: folder.name,
                            tableCount: folder.tables.length,
                            x: e.clientX,
                            y: e.clientY,
                          });
                        }}
                        className="flex items-center gap-1 pl-11 pr-2 py-1 cursor-pointer hover:bg-zinc-900/70 text-zinc-300"
                        title={`${folder.name} · ${folder.tables.length} table(s) · right-click for actions`}
                      >
                        <ChevronRight
                          size={13}
                          className={clsx(
                            "text-zinc-600 transition-transform",
                            folderExpanded && "rotate-90"
                          )}
                        />
                        <FolderIcon
                          size={13}
                          className="text-accent-400"
                          strokeWidth={1.8}
                        />
                        {renamingFolder?.db === db &&
                        renamingFolder.folderId === folder.id ? (
                          <TreeRenameInput
                            initial={folder.name}
                            onCommit={(name) => {
                              setRenamingFolder(null);
                              if (name.trim() && name.trim() !== folder.name) {
                                renameFolderInDb(profile.id, db, folder.id, name).catch(
                                  (err) =>
                                    notifyError(`Could not rename folder: ${String(err)}`)
                                );
                              }
                            }}
                            onCancel={() => setRenamingFolder(null)}
                          />
                        ) : (
                          <>
                            <span className="truncate flex-1">{folder.name}</span>
                            <span className="text-[10px] font-mono text-zinc-600">
                              {folder.tables.length}
                            </span>
                          </>
                        )}
                      </div>
                      {folderExpanded &&
                        folderTables.map((t) => renderTableRow(t, db, "pl-20"))}
                    </div>
                  );
                })}

                {unsortedTables.map((t) => renderTableRow(t, db, "pl-14"))}
              </div>
            )}
          </div>
        );
      })}

      {folderMenu && (
        <TreeFolderContextMenu
          x={folderMenu.x}
          y={folderMenu.y}
          onClose={() => setFolderMenu(null)}
          onRename={() => {
            setRenamingFolder({ db: folderMenu.db, folderId: folderMenu.folderId });
            setFolderMenu(null);
          }}
          onDelete={() => {
            const { db, folderId, folderName, tableCount } = folderMenu;
            setFolderMenu(null);
            setPendingFolderDelete({ db, folderId, folderName, tableCount });
          }}
        />
      )}

      {pendingFolderDelete && (
        <FolderDeleteDialog
          folderName={pendingFolderDelete.folderName}
          tableCount={pendingFolderDelete.tableCount}
          onConfirm={() =>
            deleteFolderInDb(
              profile.id,
              pendingFolderDelete.db,
              pendingFolderDelete.folderId
            )
          }
          onClose={() => setPendingFolderDelete(null)}
        />
      )}

      {tableMenu && (
        <TableContextMenu
          x={tableMenu.x}
          y={tableMenu.y}
          onEdit={() => {
            const { db, table } = tableMenu;
            setTableMenu(null);
            openTableEditor(profile.id, profile.name, db, table).catch((e) =>
              notifyError(`Could not open "${table}" for editing: ${String(e)}`)
            );
          }}
          onRename={() => {
            setRenamingTable({ db: tableMenu.db, table: tableMenu.table });
            setTableMenu(null);
          }}
          onTruncate={() => {
            setPendingTableAction({
              kind: "truncate",
              db: tableMenu.db,
              table: tableMenu.table,
            });
            setTableMenu(null);
          }}
          onDelete={() => {
            setPendingTableAction({
              kind: "delete",
              db: tableMenu.db,
              table: tableMenu.table,
            });
            setTableMenu(null);
          }}
        />
      )}

      {pendingTableAction && (
        <TableActionDialog
          action={pendingTableAction.kind}
          profileId={profile.id}
          database={pendingTableAction.db}
          table={pendingTableAction.table}
          onClose={() => setPendingTableAction(null)}
        />
      )}

      {dbMenu && (
        <DbContextMenu
          x={dbMenu.x}
          y={dbMenu.y}
          onDrop={() => {
            setPendingDbDrop(dbMenu.db);
            setDbMenu(null);
          }}
        />
      )}

      {pendingDbDrop && (
        <DropDatabaseDialog
          profileId={profile.id}
          database={pendingDbDrop}
          onClose={() => setPendingDbDrop(null)}
        />
      )}
    </div>
  );
}

function TreeRenameInput({
  initial,
  onCommit,
  onCancel,
}: {
  initial: string;
  onCommit: (name: string) => void;
  onCancel: () => void;
}) {
  const [val, setVal] = useState(initial);
  const ref = useRef<HTMLInputElement>(null);
  const done = useRef(false);
  useEffect(() => {
    ref.current?.focus();
    ref.current?.select();
  }, []);
  const finish = (fn: () => void) => {
    if (done.current) return;
    done.current = true;
    fn();
  };
  return (
    <input
      ref={ref}
      data-el="folder-rename-input"
      value={val}
      onChange={(e) => setVal(e.target.value)}
      onClick={(e) => e.stopPropagation()}
      onDoubleClick={(e) => e.stopPropagation()}
      onKeyDown={(e) => {
        if (e.key === "Enter") {
          e.preventDefault();
          finish(() => onCommit(val));
        } else if (e.key === "Escape") {
          e.preventDefault();
          finish(onCancel);
        }
      }}
      onBlur={() => finish(() => onCommit(val))}
      className="flex-1 min-w-0 bg-zinc-900 border border-accent-500/60 rounded px-1.5 py-0.5 text-xs text-zinc-100 outline-none"
    />
  );
}

function DbContextMenu({
  x,
  y,
  onDrop,
}: {
  x: number;
  y: number;
  onDrop: () => void;
}) {
  return createPortal(
    <div
      data-el="db-context-menu"
      style={{ top: y, left: x }}
      onClick={(e) => e.stopPropagation()}
      className="dbs-context-menu fixed z-50 min-w-[160px] rounded border border-zinc-700 bg-zinc-900/95 backdrop-blur-sm py-1 shadow-xl shadow-black/60"
    >
      <button
        data-el="ctx-drop-database"
        className="flex w-full items-center gap-2.5 text-left px-3 py-1.5 hover:bg-zinc-800 text-rose-400"
        onClick={onDrop}
      >
        <Trash size={14} className="shrink-0" />
        Drop Database
      </button>
    </div>,
    document.body
  );
}

function TreeFolderContextMenu({
  x,
  y,
  onClose,
  onRename,
  onDelete,
}: {
  x: number;
  y: number;
  onClose: () => void;
  onRename: () => void;
  onDelete: () => void;
}) {
  useEffect(() => {
    const close = () => onClose();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("click", close);
    window.addEventListener("contextmenu", close);
    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("click", close);
      window.removeEventListener("contextmenu", close);
      window.removeEventListener("keydown", onKey);
    };
  }, [onClose]);

  const item = "flex w-full items-center gap-2.5 px-3 py-1.5 text-left hover:bg-zinc-800";

  return createPortal(
    <div
      data-el="tree-folder-menu"
      style={{ top: y, left: x }}
      onClick={(e) => e.stopPropagation()}
      className="dbs-context-menu fixed z-50 min-w-[150px] rounded border border-zinc-700 bg-zinc-900/95 backdrop-blur-sm py-1 shadow-xl shadow-black/60"
    >
      <button className={clsx(item, "text-zinc-200")} onClick={onRename}>
        <TextT size={14} className="text-accent-400 shrink-0" />
        Rename Folder
      </button>
      <button className={clsx(item, "text-rose-400")} onClick={onDelete}>
        <Trash size={14} className="shrink-0" />
        Delete Folder
      </button>
    </div>,
    document.body
  );
}

