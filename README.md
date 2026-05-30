# DB Sage

A focused, opinionated, intelligent and robust MySQL client for Windows — built with Tauri 2, React 19, and Rust.

DB Sage pairs a fast, virtualized data grid with a full SQL workspace, a visual schema designer, and a custom relations layer that lets you link tables however you think about your data — independent of how MySQL was set up.

---

## Features

### Connections & navigation

- **Multiple connection profiles** — passwords are stored in the Windows Credential Manager (DPAPI), never in plaintext on disk.
- **Test before you save** — validate host / port / user / password from the profile dialog.
- **Sidebar tree** — connection → databases → folders → tables.
- **Client-side folders** — organize tables into custom folders per database; folders are purely a DB Sage organizational layer and don't touch the schema.
- **Drag and drop** — drag tables into folders, or onto another database to copy them (structure-only or with data). Copying works **across connections** too (even to a different server); large copies show a progress bar and can be cancelled mid-flight.
- **Right-click context menus throughout** — connections (rename / edit / new database / disconnect / delete), databases (drop), folders (rename / delete), and tables (edit / rename / truncate / drop / export SQL).

### SQL query workspace

- **SQL editor** with syntax highlighting and **context-aware autocompletion** — suggests tables, columns, and keywords based on the `FROM` / `JOIN` clauses in your query.
- **One-click formatting** of the current statement.
- **Run with `Ctrl+Enter`**, cancel long-running queries mid-flight.
- **Live query timing** — round-trip duration and streaming row count as results arrive.
- **Results in the same virtualized grid** used for table browsing, with the expanded-value and JSON tools described below.

### Browsing & editing rows

- **Paged, virtualized grid** (500 rows/page) that stays smooth on large tables.
- **Per-column sort and filter** (equals / contains).
- **Inline cell editing** — double-click a cell; updates are written with a primary-key-scoped `UPDATE`.
- **Row insert** — a dialog that respects column metadata (auto-increment, defaults, required fields).
- **Keyboard grid navigation** — arrow keys to move the active cell, `Escape` to leave edit mode.
- **Show / hide and resize columns**; column widths and per-table setup (visibility + filters + JSON show) persist across sessions.
- **Table view presets** — save and recall named column layouts (visibility + filters + JSON show) per table.
- **Copy As** — copy selected rows as an `INSERT` statement, an `UPDATE` statement, TSV, or TSV with a header row.
- **Export** query or table results to **CSV, JSON, or XLSX**, with cancellation for large exports.

### JSON columns

- **Filter by property** — `equals` (via `JSON_CONTAINS`) and `contains` (via `JSON_SEARCH`), shape-agnostic across objects and arrays of objects, including correlated `array[key=value].field` selectors.
- **Show an extracted property** (or a comma-separated list of them) inline instead of the raw JSON.
- **Expanded panel** — an editable, pretty-printed value next to a collapsible **JSON tree view**, with search / next / prev across both panes.

### Schema design

- **Visual table designer** with a **Columns** editor (type, length/decimals, NOT NULL, key, default, auto-increment, unsigned/zerofill) and an **Indexes** editor (multi-column with ASC/DESC; type NORMAL / UNIQUE / FULLTEXT / SPATIAL; method) — with a **live SQL preview** of the generated `CREATE TABLE` / `ALTER TABLE`.
- **Create new tables or edit existing ones** in place.
- **Export a table's schema and data as SQL** (`CREATE` + `INSERT`).
- **Create and drop databases.**

### Relations & related-row peeks

- **Custom relations** — define arbitrary, one-way **HAS ONE** or **HAS MANY** relations between any two tables that contain related data. Relations are completely independent of MySQL indexes or foreign keys.
- **Related-row peek** — from the grid, pop open a floating window showing the rows on the other side of a relation, without leaving your current view.

### Server operations

- **Live monitoring** — a per-connection **Monitor** window showing server activity (the live process list), throughput and status counters, and trend charts backed by sampled history.
- **Local server administration (Windows)** — for connections to the local machine (`localhost` / `127.0.0.1`), a per-connection **Admin** window with three tabs:
  - **Service** — see the MySQL Windows service's status and startup type, and **start / stop / restart** it or change its startup type. Each privileged action raises a single Windows **UAC** prompt; DB Sage itself never runs elevated.
  - **Logs** — tail the **error**, **slow-query**, and **general** logs, transparently reading from a file, the `mysql.*_log` tables (`log_output=TABLE`), or the Windows Event Log, with optional word-wrap and live polling.
  - **Configuration** — resolves the `my.ini` the server actually uses (from the service's `--defaults-file`, otherwise the Windows search order), and edits it with a **guided form** for common settings (typed inputs, enum dropdowns, and plain-English descriptions) or a **raw** editor. Saves create a `.bak` backup and write via UAC; a service restart applies the changes.

### Workspace

- **Encrypted, passphrase-protected state export/import** (connections, relations, folders, column setups, and presets), with a preview of a file's contents before importing.
- **In-app auto-updater** — checks GitHub releases and can download and run the installer.
- **Per-pane zoom** (`Ctrl+=` / `Ctrl+−` / `Ctrl+0`, or `Ctrl+wheel`), draggable splitters, multi-tab interface with reorder, a dark slate-tinted theme, and Phosphor icons.

---

## Keyboard shortcuts

| Shortcut | Action |
| --- | --- |
| `Ctrl+Enter` | Run the current query |
| `Ctrl+=` / `Ctrl+−` | Zoom the focused pane in / out |
| `Ctrl+0` | Reset zoom |
| `Ctrl+wheel` | Zoom the pane under the cursor |
| Arrow keys | Move the active cell in the grid |
| `Escape` | Exit cell editing / close the expanded panel / close dialogs |

---

## Run from source

```powershell
npm install
npm run tauri dev
```

Requires Rust + Node + the Tauri 2 prerequisites for Windows (WebView2 already ships with Windows 11).

To cut a release, bump the `version` in **all three** of `src-tauri/Cargo.toml`, `package.json`, and `src-tauri/tauri.conf.json`, then run `.\publish.ps1`.

---

## Project layout

```
src/                React 19 frontend (TypeScript, Tailwind 4, Zustand)
  components/        UI: tree, tabs, grid, SQL editor, designer, relations, dialogs
  state/             Zustand stores (app state, UI layout, notifications)
  lib/               Helpers (copy-as, updater, horizontal-wheel, etc.)
src-tauri/          Rust backend (Tauri 2, sqlx, keyring)
src-tauri/src/
  commands/          Tauri IPC commands (profiles, connect, query, schema/DDL,
                     folders, relations, column_setups, presets, state, updater,
                     monitoring, admin)
  store/             Persistence (profiles, secrets, folders, relations,
                     column_setups, table_view_presets — JSON + OS keyring)
  db/                MySQL connection pool + row→JSON serializer
```

---

## Tech stack

- **Frontend** — React 19, TypeScript, Tailwind CSS 4, Zustand, TanStack Virtual, `@dnd-kit`, `sql-formatter`, Phosphor icons.
- **Backend** — Rust, Tauri 2, `sqlx` (MySQL), `keyring` (Windows Credential Manager).

## Roadmap (rough)

- Multi-sort (Shift+click)
- Postgres and SQLite drivers

## License

Private — not for distribution yet.
