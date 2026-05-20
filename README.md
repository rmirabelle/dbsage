# DBSage

A sleek, modern Windows desktop client for MySQL — built with Tauri 2, React 19, and Rust.

## Status

Early development. Working features:

- Multiple connection profiles (passwords stored in Windows Credential Manager via DPAPI)
- Sidebar tree: connection → databases → folders → tables (with custom client-side folders for organizing tables)
- Database view: multi-column tile grid of tables, multi-select + drag tables into folders
- Rows view: paged virtualized grid (500 rows/page)
  - Click any column header to sort (ASC/DESC) or filter (EQUALS / LIKE-as-contains)
  - Click a cell to focus it; the Expanded panel pretty-prints JSON and other long values
  - Double-click a cell to edit inline (PK-based UPDATE)
  - Show/hide columns from the gutter button
  - Drag-select multiple rows
  - Resize columns, sticky row-number gutter, sticky header
- Per-pane zoom (Ctrl+= / Ctrl+− / Ctrl+0 or Ctrl+wheel) and draggable sidebar splitter
- Dark slate-tinted theme; OS-yellow folders; Phosphor solid icons

## Run from source

```powershell
npm install
npm run tauri dev
```

Requires Rust + Node + the Tauri 2 prerequisites for Windows (WebView2 already ships with Windows 11).

## Project layout

```
src/             React 19 frontend (TypeScript, Tailwind 4)
src-tauri/       Rust backend (Tauri 2, sqlx, keyring)
src-tauri/src/
  commands/      Tauri IPC commands (profiles, connect, query, folders)
  store/         Persistence (profiles.json, folders.json, OS keyring)
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
