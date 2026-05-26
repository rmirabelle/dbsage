# DB Sage

A sleek, modern Windows desktop client for MySQL — built with Tauri 2, React 19, and Rust.

## Features

**Connections & navigation**

- Multiple connection profiles (passwords stored in Windows Credential Manager via DPAPI)
- Sidebar tree: connection → databases → folders → tables, with custom client-side folders for organizing tables
- Right-click context menus throughout: connections (rename / edit / new database / disconnect / delete), databases (drop), folders, and tables (edit / rename / truncate / delete)
- Create and drop databases

**Schema**

- Table designer with a visual **Columns** editor (type, length/decimals, NOT NULL, key, default, auto-increment, unsigned/zerofill) and an **Indexes** editor (multi-column with ASC/DESC, type NORMAL/UNIQUE/FULLTEXT/SPATIAL, method) — generates the `CREATE TABLE` / `ALTER TABLE` and shows a live SQL preview
- Create new tables or edit existing ones in place
- **Relations**: define custom, arbitrary, one-way, HAS ONE or HAS MANY relations between any two tables that contain related data. Relations are completely independent of MySQL indexes or foreign keys

**Browsing & editing rows**

- Paged, virtualized grid (500 rows/page)
- Sort and filter per column (equals / contains)
- **JSON columns**: filter by property — `equals` (via `JSON_CONTAINS`) and `contains` (via `JSON_SEARCH`), shape-agnostic across objects and arrays of objects — including correlated `array[key=value].field` selectors; or **Show** an extracted property (or a comma-separated list) inline instead of the raw JSON
- Inline cell editing (PK-based `UPDATE`)
- Show/hide and resize columns; column widths and per-table setup (visibility + filters + JSON show) persist across sessions
- Expanded panel: an editable, pretty-printed value next to a collapsible **JSON tree view**, with search/next/prev across both panes

**Workspace**

- Encrypted, passphrase-protected state export/import (connections, relations, folders, and column setups)
- In-app auto-updater (checks GitHub releases)
- Per-pane zoom (Ctrl+= / Ctrl+− / Ctrl+0 or Ctrl+wheel), draggable splitters, dark slate-tinted theme, Phosphor icons

## Run from source

```powershell
npm install
npm run tauri dev
```

Requires Rust + Node + the Tauri 2 prerequisites for Windows (WebView2 already ships with Windows 11).

To cut a release, bump the version in `src-tauri/Cargo.toml`, `package.json`, and `src-tauri/tauri.conf.json`, then run `.\publish.ps1`.

## Project layout

```
src/             React 19 frontend (TypeScript, Tailwind 4, Zustand)
src-tauri/       Rust backend (Tauri 2, sqlx, keyring)
src-tauri/src/
  commands/      Tauri IPC commands (profiles, connect, query, folders,
                 relations, column_setups, state import/export)
  store/         Persistence (profiles.json, folders.json, relations.json,
                 column_setups.json, OS keyring)
  db/            MySQL connection pool + row→JSON serializer
```

## Roadmap (rough)

- Multi-sort (Shift+click)
- Query editor tab
- Row insert / delete
- Foreign-key navigation
- CSV/JSON export
- Postgres, SQLite drivers

## License

Private — not for distribution yet.
