import { useEffect, useState } from "react";
import {
  CaretRight as ChevronRight,
  Database,
  Folder as FolderIcon,
  CircleNotch as Loader2,
  Plus,
  HardDrives as Server,
  Table as Table2,
  Lightning as PlugZap,
  DotsThreeVertical as MoreVertical,
} from "@phosphor-icons/react";
import clsx from "clsx";
import { useStore } from "../state/store";
import type { ProfileView } from "../types";
import { ProfileDialog } from "./ProfileDialog";
import { ZoomControls } from "./ZoomControls";
import { ipc } from "../ipc";

export function ConnectionTree() {
  const profiles = useStore((s) => s.profiles);
  const loadingProfiles = useStore((s) => s.loadingProfiles);
  const expandedProfiles = useStore((s) => s.expandedProfiles);
  const toggleProfileExpanded = useStore((s) => s.toggleProfileExpanded);
  const loadProfiles = useStore((s) => s.loadProfiles);
  const disconnectProfile = useStore((s) => s.disconnectProfile);
  const connections = useStore((s) => s.connections);

  const [dialogOpen, setDialogOpen] = useState(false);
  const [editing, setEditing] = useState<ProfileView | null>(null);
  const [menuOpen, setMenuOpen] = useState<string | null>(null);

  useEffect(() => {
    loadProfiles();
  }, [loadProfiles]);

  return (
    <aside className="w-full h-full bg-zinc-950 border-r border-zinc-800/80 flex flex-col">
      <div className="h-9 flex items-center justify-between px-3 border-b border-zinc-800/60 gap-2">
        <span className="text-[10px] font-semibold uppercase tracking-[0.14em] text-zinc-500">
          Connections
        </span>
        <div className="flex items-center gap-1">
          <ZoomControls pane="tree" />
          <button
            onClick={() => {
              setEditing(null);
              setDialogOpen(true);
            }}
            className="text-zinc-400 hover:text-accent-400 transition h-5 w-5 inline-flex items-center justify-center rounded hover:bg-zinc-800"
            aria-label="Add connection"
          >
            <Plus size={13} />
          </button>
        </div>
      </div>

      <div className="flex-1 overflow-y-auto py-1">
        {loadingProfiles && profiles.length === 0 && (
          <div className="px-3 py-4 text-zinc-500 text-xs flex items-center gap-2">
            <Loader2 size={12} className="animate-spin" /> Loading…
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
                className={clsx(
                  "group flex items-center gap-1 px-2 py-1.5 cursor-pointer hover:bg-zinc-900/70",
                  expanded && "bg-zinc-900/40"
                )}
                onClick={() => toggleProfileExpanded(profile.id)}
              >
                <ChevronRight
                  size={12}
                  className={clsx(
                    "text-zinc-500 transition-transform",
                    expanded && "rotate-90"
                  )}
                />
                {conn?.connecting ? (
                  <Loader2 size={12} className="animate-spin text-accent-400" />
                ) : conn?.connected ? (
                  <PlugZap size={12} className="text-accent-400" />
                ) : (
                  <Server size={12} className="text-zinc-500" />
                )}
                <span className="flex-1 truncate text-zinc-200">{profile.name}</span>
                <button
                  className="opacity-0 group-hover:opacity-100 text-zinc-500 hover:text-zinc-200 transition"
                  onClick={(e) => {
                    e.stopPropagation();
                    setMenuOpen(menuOpen === profile.id ? null : profile.id);
                  }}
                  aria-label="Profile actions"
                >
                  <MoreVertical size={12} />
                </button>
              </div>

              {menuOpen === profile.id && (
                <ProfileMenu
                  profile={profile}
                  connected={!!conn?.connected}
                  onClose={() => setMenuOpen(null)}
                  onEdit={() => {
                    setEditing(profile);
                    setDialogOpen(true);
                    setMenuOpen(null);
                  }}
                  onDisconnect={async () => {
                    await disconnectProfile(profile.id);
                    setMenuOpen(null);
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
    </aside>
  );
}

function ProfileMenu({
  profile,
  connected,
  onClose,
  onEdit,
  onDisconnect,
}: {
  profile: ProfileView;
  connected: boolean;
  onClose: () => void;
  onEdit: () => void;
  onDisconnect: () => void;
}) {
  const loadProfiles = useStore((s) => s.loadProfiles);

  return (
    <div
      className="ml-7 mt-0.5 mb-1 rounded border border-zinc-800 bg-zinc-900/95 backdrop-blur-sm py-1 text-[11px] shadow-xl shadow-black/50"
      onMouseLeave={onClose}
    >
      <button
        className="w-full text-left px-3 py-1.5 hover:bg-zinc-800 text-zinc-200"
        onClick={onEdit}
      >
        Edit…
      </button>
      {connected && (
        <button
          className="w-full text-left px-3 py-1.5 hover:bg-zinc-800 text-zinc-200"
          onClick={onDisconnect}
        >
          Disconnect
        </button>
      )}
      <button
        className="w-full text-left px-3 py-1.5 hover:bg-zinc-800 text-rose-400"
        onClick={async () => {
          if (!confirm(`Delete connection "${profile.name}"?`)) return;
          await ipc.deleteProfile(profile.id);
          await loadProfiles();
          onClose();
        }}
      >
        Delete
      </button>
    </div>
  );
}

function DatabaseList({ profile }: { profile: ProfileView }) {
  const tree = useStore((s) => s.trees[profile.id]);
  const toggleDbExpanded = useStore((s) => s.toggleDbExpanded);
  const toggleFolderExpandedInTree = useStore((s) => s.toggleFolderExpandedInTree);
  const openDatabase = useStore((s) => s.openDatabase);
  const openTable = useStore((s) => s.openTable);
  const activeDbName = useStore((s) => {
    const tab = s.tabs.find((t) => t.id === s.activeTabId);
    if (!tab || tab.kind !== "database" || tab.profileId !== profile.id) return null;
    return tab.database;
  });

  if (!tree) return null;
  if (tree.databases.length === 0) {
    return (
      <div className="pl-7 py-1.5 text-zinc-600 text-[11px]">No databases</div>
    );
  }

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
              className={clsx(
                "flex items-center gap-1 pl-3 pr-2 py-1.5 cursor-pointer hover:bg-zinc-900/70",
                isActive && "bg-zinc-900/60"
              )}
              onClick={() => openDatabase(profile.id, profile.name, db)}
              title="Click to view tables · arrow to expand inline"
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
                  size={11}
                  className={clsx(
                    "transition-transform",
                    expanded && "rotate-90"
                  )}
                />
              </button>
              <Database
                size={11}
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
                  <div className="pl-12 py-1.5 text-zinc-600 text-[11px] flex items-center gap-2">
                    <Loader2 size={10} className="animate-spin" /> Loading…
                  </div>
                )}
                {state.error && (
                  <div className="pl-12 py-1.5 text-rose-400 text-[11px] break-words">
                    {state.error}
                  </div>
                )}
                {!state.loading &&
                  !state.error &&
                  state.folders.length === 0 &&
                  state.items.length === 0 && (
                    <div className="pl-12 py-1.5 text-zinc-600 text-[11px]">
                      No tables
                    </div>
                  )}

                {sortedFolders.map((folder) => {
                  const folderExpanded = state.expandedFolders.has(folder.id);
                  const folderTables = tablesByFolderId.get(folder.id) ?? [];
                  return (
                    <div key={folder.id}>
                      <div
                        onClick={() =>
                          toggleFolderExpandedInTree(profile.id, db, folder.id)
                        }
                        className="flex items-center gap-1 pl-8 pr-2 py-1 cursor-pointer hover:bg-zinc-900/70 text-zinc-300"
                        title={`${folder.name} · ${folder.tables.length} table(s)`}
                      >
                        <ChevronRight
                          size={11}
                          className={clsx(
                            "text-zinc-600 transition-transform",
                            folderExpanded && "rotate-90"
                          )}
                        />
                        <FolderIcon
                          size={11}
                          className="text-accent-400"
                          strokeWidth={1.8}
                        />
                        <span className="truncate flex-1">{folder.name}</span>
                        <span className="text-[10px] font-mono text-zinc-600">
                          {folder.tables.length}
                        </span>
                      </div>
                      {folderExpanded &&
                        folderTables.map((t) => (
                          <div
                            key={t.name}
                            onDoubleClick={() =>
                              openTable(profile.id, profile.name, db, t.name)
                            }
                            className="flex items-center gap-2 pl-16 pr-2 py-1 cursor-pointer hover:bg-zinc-900/70 text-zinc-400 hover:text-zinc-100"
                            title="Double-click to open"
                          >
                            <Table2 size={11} className="text-zinc-600" />
                            <span className="truncate">{t.name}</span>
                          </div>
                        ))}
                    </div>
                  );
                })}

                {unsortedTables.map((t) => (
                  <div
                    key={t.name}
                    onDoubleClick={() =>
                      openTable(profile.id, profile.name, db, t.name)
                    }
                    className="flex items-center gap-2 pl-12 pr-2 py-1 cursor-pointer hover:bg-zinc-900/70 text-zinc-400 hover:text-zinc-100"
                    title="Double-click to open"
                  >
                    <Table2 size={11} className="text-zinc-600" />
                    <span className="truncate">{t.name}</span>
                  </div>
                ))}
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}

