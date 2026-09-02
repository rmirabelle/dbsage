export type HelpScreenshotLayout = "auto" | "wide" | "inline-left" | "inline-right";

export type HelpBlock =
  | { type: "paragraph"; text: string }
  | { type: "bullets"; items: string[] }
  | { type: "steps"; items: string[]; start?: number }
  | { type: "note"; title: string; text: string; tone?: "tip" | "warning" }
  | {
      type: "screenshot";
      id: HelpScreenshotId;
      alt: string;
      caption: string;
      layout?: HelpScreenshotLayout;
    }
  | { type: "keys"; items: Array<[keys: string, action: string]> };

export interface HelpSection {
  title: string;
  blocks: HelpBlock[];
}

export interface HelpArticle {
  id: string;
  title: string;
  summary: string;
  sections: HelpSection[];
}

export interface HelpGroup {
  id: string;
  title: string;
  articles: HelpArticle[];
}

export const HELP_SCREENSHOTS = {
  "app-overview": { physicalWidth: 1400, physicalHeight: 1000, framing: "full app" },
  "connection-dialog": { physicalWidth: 960, physicalHeight: 720, framing: "dialog crop" },
  "connection-sidebar": { physicalWidth: 560, physicalHeight: 820, framing: "sidebar crop" },
  "connection-actions": { physicalWidth: 720, physicalHeight: 720, framing: "sidebar and menu" },
  "server-monitor": { physicalWidth: 1440, physicalHeight: 850, framing: "window crop" },
  "server-admin": { physicalWidth: 1440, physicalHeight: 850, framing: "window crop" },
  "database-overview": { physicalWidth: 1440, physicalHeight: 850, framing: "main pane" },
  "database-organize": { physicalWidth: 1440, physicalHeight: 850, framing: "main pane" },
  "table-actions": { physicalWidth: 1000, physicalHeight: 720, framing: "tiles and menu" },
  "schema-compare": { physicalWidth: 1440, physicalHeight: 850, framing: "main pane" },
  "backup-restore": { physicalWidth: 1000, physicalHeight: 720, framing: "dialog crop" },
  "table-overview": { physicalWidth: 1440, physicalHeight: 850, framing: "main pane" },
  "column-controls": { physicalWidth: 1100, physicalHeight: 760, framing: "grid crop" },
  "row-editing": { physicalWidth: 1200, physicalHeight: 760, framing: "grid and editor" },
  "copy-export": { physicalWidth: 1000, physicalHeight: 720, framing: "grid and menu" },
  "json-inspector": { physicalWidth: 1440, physicalHeight: 850, framing: "main pane" },
  "table-designer-columns": { physicalWidth: 1440, physicalHeight: 850, framing: "main pane" },
  "table-designer-indexes": { physicalWidth: 1440, physicalHeight: 850, framing: "main pane" },
  "query-workspace": { physicalWidth: 1440, physicalHeight: 850, framing: "main pane" },
  "query-autocomplete": { physicalWidth: 1100, physicalHeight: 680, framing: "editor crop" },
  "query-results": { physicalWidth: 1440, physicalHeight: 850, framing: "main pane" },
  "query-analysis": { physicalWidth: 1440, physicalHeight: 850, framing: "main pane" },
  "query-tools": { physicalWidth: 1100, physicalHeight: 760, framing: "toolbar and menus" },
  "relations-overview": { physicalWidth: 1440, physicalHeight: 850, framing: "main pane" },
  "relation-editor": { physicalWidth: 960, physicalHeight: 720, framing: "dialog crop" },
  "relation-cell-menu": { physicalWidth: 1000, physicalHeight: 700, framing: "grid and menu" },
  "peek-window": { physicalWidth: 1200, physicalHeight: 760, framing: "window crop" },
  "tabs-windows": { physicalWidth: 1440, physicalHeight: 850, framing: "app chrome" },
  "settings-transfer": { physicalWidth: 1000, physicalHeight: 720, framing: "dialog crop" },
  "main-first_run": { physicalWidth: 1332, physicalHeight: 790, framing: "annotated main window" },
  "main-file-import": { physicalWidth: 431, physicalHeight: 182, framing: "File menu crop" },
  "main-import_dialog": { physicalWidth: 604, physicalHeight: 430, framing: "import dialog" },
  "main-import_dialog-confirm": { physicalWidth: 601, physicalHeight: 542, framing: "import preview dialog" },
  "main-db": { physicalWidth: 1332, physicalHeight: 790, framing: "connected main window" },
  "main-db-folder": { physicalWidth: 1098, physicalHeight: 372, framing: "database folder view" },
  "main-db-context": { physicalWidth: 781, physicalHeight: 633, framing: "table context menu" },
  "main-new_connection": { physicalWidth: 581, physicalHeight: 639, framing: "new connection dialog" },
  "db-drag_to_folder": { physicalWidth: 842, physicalHeight: 374, framing: "annotated folder drop target" },
  "db-drag_to_db": { physicalWidth: 796, physicalHeight: 408, framing: "annotated database drop target" },
  "db-menu": { physicalWidth: 649, physicalHeight: 530, framing: "database context menu" },
  "db-compare_schema": { physicalWidth: 1332, physicalHeight: 790, framing: "database comparison" },
  "connection-monitor": { physicalWidth: 1118, physicalHeight: 669, framing: "monitor window" },
  "connection-admin-config": { physicalWidth: 1250, physicalHeight: 819, framing: "configuration tab" },
  "connection-admin-service": { physicalWidth: 882, physicalHeight: 423, framing: "service tab" },
  "connection-admin-logs": { physicalWidth: 940, physicalHeight: 590, framing: "logs tab" },
  "connection-reorder": { physicalWidth: 539, physicalHeight: 482, framing: "annotated connection drag" },
  "connection-db_expanded": { physicalWidth: 700, physicalHeight: 432, framing: "annotated expanded database" },
  "db-search": { physicalWidth: 775, physicalHeight: 429, framing: "annotated database search" },
  "db-multiselect": { physicalWidth: 1019, physicalHeight: 487, framing: "multi-table context menu" },
  "table-columns_filter": { physicalWidth: 845, physicalHeight: 672, framing: "column visibility menu" },
  "table-copy_rows_and_columns": { physicalWidth: 741, physicalHeight: 572, framing: "cell selection copy menu" },
  "table-column_menu": { physicalWidth: 982, physicalHeight: 623, framing: "column sort and filter menu" },
  "table-views": { physicalWidth: 960, physicalHeight: 629, framing: "saved Views menu" },
  "table-select_row": { physicalWidth: 928, physicalHeight: 367, framing: "annotated row selection" },
  "table-select cell": { physicalWidth: 691, physicalHeight: 319, framing: "annotated cell selection" },
  "table-duplicate_row": { physicalWidth: 1157, physicalHeight: 401, framing: "annotated duplicated row" },
  "table-edit_cell": { physicalWidth: 670, physicalHeight: 411, framing: "annotated inline cell edit" },
  "table-import_json": { physicalWidth: 807, physicalHeight: 583, framing: "JSON import preview dialog" },
  "table-import_json_map": { physicalWidth: 799, physicalHeight: 768, framing: "JSON field mapping dialog" },
  "table-json": { physicalWidth: 1473, physicalHeight: 1318, framing: "annotated JSON tools workspace" },
  "table-new": { physicalWidth: 1156, physicalHeight: 1136, framing: "annotated new table designer" },
  "table-new_indexes": { physicalWidth: 1042, physicalHeight: 702, framing: "annotated Indexes tab" },
  "table-fks": { physicalWidth: 1238, physicalHeight: 782, framing: "annotated Foreign Keys tab" },
  "query-overview": { physicalWidth: 1333, physicalHeight: 800, framing: "annotated query workspace" },
  "query-explain": { physicalWidth: 1253, physicalHeight: 880, framing: "annotated Query Analysis panel" },
  "query-new": { physicalWidth: 861, physicalHeight: 421, framing: "annotated Saved queries menu" },
  "query-history": { physicalWidth: 934, physicalHeight: 537, framing: "annotated Query History" },
  "query-multi": { physicalWidth: 773, physicalHeight: 677, framing: "annotated result-set tabs" },
  "relations": { physicalWidth: 1014, physicalHeight: 410, framing: "Relations View" },
  "relation-edit": { physicalWidth: 726, physicalHeight: 362, framing: "Edit Relation dialog" },
  "relations-copy": { physicalWidth: 625, physicalHeight: 344, framing: "Copy Relations dialog" },
  "relations-menu": { physicalWidth: 1145, physicalHeight: 571, framing: "annotated cell Relations menu" },
  "relations-peek": { physicalWidth: 1678, physicalHeight: 582, framing: "annotated table with two peek windows" },
} as const;

export type HelpScreenshotId = keyof typeof HELP_SCREENSHOTS;

const shot = (
  id: HelpScreenshotId,
  alt: string,
  caption: string,
  layout: HelpScreenshotLayout = "auto"
): HelpBlock => ({ type: "screenshot", id, alt, caption, layout });

export const HELP_GROUPS: HelpGroup[] = [
  {
    id: "start",
    title: "Getting started",
    articles: [
      {
        id: "welcome",
        title: "Welcome to DB Sage",
        summary: "A quick tour of the workspace and the fastest path to your data.",
        sections: [
          {
            title: "Choose how to begin",
            blocks: [
              {
                type: "paragraph",
                text: "Connections live in the left sidebar. On a new installation, choose + beside Connections to create one. A dimmed connection with a disconnected icon is already saved but is not currently connected; click it once to connect. If you are moving from another DB Sage installation, File > Import Settings can restore exported connections and other workspace settings instead.",
              },
              shot(
                "main-first_run",
                "DB Sage before a database connection is opened, annotated with the new and existing connection entry points",
                "Choose + to create a connection profile. A saved connection remains in the sidebar while disconnected and can be opened again without re-entering its details.",
                "wide"
              ),
            ],
          },
          {
            title: "Your first minute",
            blocks: [
              {
                type: "steps",
                items: [
                  "Create a connection with +, import an existing DB Sage setup, or use a saved profile already shown in the sidebar.",
                  "Click the connection once, then expand it to see its databases.",
                  "Double-click a database for its visual Database View, or expand it in the tree and open a table directly.",
                  "Use New Query in a database toolbar whenever you want a SQL workspace scoped to that database.",
                ],
              },
              {
                type: "note",
                title: "Look for right-click actions",
                text: "Connections, databases, folders, tables, tabs, rows, cells, and column headers all expose useful context menus.",
              },
            ],
          },
        ],
      },
    ],
  },
  {
    id: "connections",
    title: "Connections",
    articles: [
      {
        id: "connections-create",
        title: "Add and connect",
        summary: "Create, test, edit, connect, and disconnect database profiles.",
        sections: [
          {
            title: "Create a profile",
            blocks: [
              shot(
                "main-new_connection",
                "New connection dialog with fields for a local MySQL server",
                "Give the profile a recognizable name, enter the server address and credentials, and optionally choose a default database. Test verifies the details before Add saves the profile.",
                "inline-right"
              ),
              {
                type: "steps",
                items: [
                  "Choose + in the Connections header.",
                  "Enter a recognizable profile name, then the server host, port, username, and password.",
                  "Optionally enter a default database to open that database first after connecting. Leave SSL enabled when the server supports it.",
                  "Choose Test to catch network or credential problems without saving the profile.",
                  "Choose Add, then click the new connection once to connect and load its databases.",
                ],
              },
              {
                type: "note",
                title: "Safe credential storage",
                text: "Saved passwords are protected by Windows Credential Manager rather than stored in the settings file. An exported settings file must use a passphrase whenever connection profiles are included.",
              },
            ],
          },
          {
            title: "Connection state",
            blocks: [
              {
                type: "bullets",
                items: [
                  "Click a disconnected profile once to connect.",
                  "Use the power button on a connected profile to disconnect without deleting it.",
                  "Right-click a profile to rename, edit, create a database, disconnect, or delete the profile.",
                ],
              },
            ],
          },
        ],
      },
      {
        id: "connections-sidebar",
        title: "Navigate the sidebar",
        summary: "Move through connections, databases, folders, and tables.",
        sections: [
          {
            title: "Tree navigation",
            blocks: [
              shot(
                "connection-db_expanded",
                "An expanded MySQL database showing tables inside and outside a folder",
                "Use the disclosure arrows to expand connections, databases, and folders. A folder's count shows how many tables it contains; unfiled tables remain directly under the database.",
                "inline-right"
              ),
              {
                type: "bullets",
                items: [
                  "A database expands to show its unfiled tables and client-side folders.",
                  "Double-click a database or table to open it in the main workspace.",
                  "DB Sage folders organize the sidebar and Database View only; they do not alter MySQL.",
                  "The Monitor button appears on connected profiles. Localhost connections also expose Server Admin.",
                ],
              },
            ],
          },
          {
            title: "Reorder connections",
            blocks: [
              shot(
                "connection-reorder",
                "A localhost connection header being dragged above Demo MySQL",
                "Drag a connection by its header to change the order of saved connections in the sidebar.",
                "inline-left"
              ),
              {
                type: "paragraph",
                text: "Connection order is saved automatically. Drag the connection name and status header—not one of its databases or tables—and release it at the desired position.",
              },
            ],
          },
        ],
      },
      {
        id: "connections-manage",
        title: "Database operations",
        summary: "Create, back up, restore, compare, and remove databases.",
        sections: [
          {
            title: "Connection and database menus",
            blocks: [
              shot(
                "db-menu",
                "A database context menu open from the connection sidebar",
                "Right-click a database to start a query, compare schemas, create or restore a backup, or drop the database. Right-click the connection itself when you need to create a new database.",
                "inline-right"
              ),
              {
                type: "bullets",
                items: [
                  "New Database is available from a connection's context menu.",
                  "Backup Database writes a DB Sage backup file and shows progress.",
                  "Restore Database restores into a safe copy first; review it before choosing Make Live.",
                  "Compare Schema compares whole databases and lets you drill into individual table differences.",
                  "Drop Database is destructive and always requires confirmation.",
                ],
              },
              shot(
                "backup-restore",
                "Database restore workflow",
                "Restore uses a staged copy so you can inspect the result before swapping it into the live database name."
              ),
            ],
          },
        ],
      },
      {
        id: "connections-server-tools",
        title: "Monitor and Server Admin",
        summary: "Inspect server activity and administer local MySQL services.",
        sections: [
          {
            title: "Monitor",
            blocks: [
              shot(
                "connection-monitor",
                "Monitor window showing server vitals, history charts, and active processes",
                "Monitor combines current server counters, sampled history, and the live MySQL process list in a separate window.",
                "wide"
              ),
              {
                type: "paragraph",
                text: "Open Monitor from a connected profile. Pause freezes live polling while you inspect a moment in time; Refresh reads immediately, and the interval menu controls how often the current values and process list update.",
              },
              {
                type: "bullets",
                items: [
                  "Hide sleeping removes idle connections from the process list without terminating them.",
                  "The summary cards show resources, uptime, activity rates, connections, slow queries, network traffic, and buffer-pool misses.",
                  "Choose a History window to compare query, thread, network, and buffer-miss trends over time.",
                ],
              },
            ],
          },
          {
            title: "Windows service control",
            blocks: [
              {
                type: "paragraph",
                text: "Localhost profiles expose Server Admin. When MySQL is installed as a Windows service, the Service tab shows its current state, registered executable, and defaults file.",
              },
              shot(
                "connection-admin-service",
                "Server Admin Service tab showing a running MySQL80 Windows service",
                "Start, stop, or restart the detected service and choose whether Windows starts it automatically, manually, or not at all.",
                "wide"
              ),
              {
                type: "note",
                title: "Administrator approval is action-specific",
                text: "Service controls and startup changes open a focused Windows UAC prompt when needed. DB Sage itself does not remain elevated.",
              },
            ],
          },
          {
            title: "Server logs",
            blocks: [
              shot(
                "connection-admin-logs",
                "Server Admin Logs tab displaying the MySQL error log",
                "Switch among the Error, Slow Query, and General logs. Wrap changes long-line display, Live refreshes every two seconds, and the filter narrows the visible entries.",
                "wide"
              ),
              {
                type: "paragraph",
                text: "DB Sage finds the configured log files and reads their recent contents. Slow Query entries receive a structured view when MySQL's standard slow-log format is available; Error and General logs retain their original text.",
              },
            ],
          },
          {
            title: "MySQL configuration",
            blocks: [
              shot(
                "connection-admin-config",
                "Server Admin Configuration tab in guided Form mode",
                "Form mode provides guided controls and explanations for common my.ini options. Raw mode exposes the complete file without discarding settings the form does not recognize.",
                "wide"
              ),
              {
                type: "bullets",
                items: [
                  "Use Option file to confirm which discovered my.ini is applied before editing.",
                  "Form mode groups common settings and explains multi-choice values such as sql_mode.",
                  "Raw mode edits the same file directly; switching modes preserves all unknown options.",
                  "Save requests administrator approval when necessary.",
                ],
              },
              {
                type: "note",
                tone: "warning",
                title: "Restart MySQL to apply saved changes",
                text: "Saving updates the option file, but MySQL continues using its current configuration until the service is restarted.",
              },
            ],
          },
        ],
      },
    ],
  },
  {
    id: "database-view",
    title: "Database View",
    articles: [
      {
        id: "database-browse",
        title: "Browse a database",
        summary: "Filter, open, select, and refresh tables from the visual tile view.",
        sections: [
          {
            title: "Database toolbar",
            blocks: [
              shot(
                "main-db",
                "DB Sage with Demo MySQL connected and a database open",
                "The selected database opens in the main pane while the same connection, databases, folders, and tables remain available in the sidebar. The database toolbar starts a table design, query, or Relations View.",
                "wide"
              ),
              {
                type: "bullets",
                items: [
                  "Type in Filter tables to narrow a large schema instantly.",
                  "Double-click a table tile to browse its rows. Double-click a folder to enter it.",
                  "Use Refresh after schema changes made outside DB Sage.",
                  "The selected table count and total table count stay visible while you work.",
                ],
              },
            ],
          },
          {
            title: "Quick table search",
            blocks: [
              shot(
                "db-search",
                "Database View filtered to the event_log table by a quick search",
                "Type part of a table or folder name to narrow Database View immediately. Use the clear button inside the search box to restore the complete list.",
                "inline-right"
              ),
              {
                type: "paragraph",
                text: "Search filters the current database or open folder as you type; it does not query table rows or change the database. This is the fastest way to find a table in a large schema.",
              },
            ],
          },
          {
            title: "Selecting tables",
            blocks: [
              shot(
                "db-multiselect",
                "Two selected table tiles with the multi-table context menu open",
                "Right-click within a multi-table selection to use supported actions on the whole group, including truncate, delete, or exporting SQL that recreates the selected tables with or without their data.",
                "wide"
              ),
              {
                type: "bullets",
                items: [
                  "Click empty space and drag a marquee around several tiles.",
                  "Use Ctrl+click to add or remove individual tables from the selection.",
                  "Right-click a selected table to run actions on the whole selection when the action supports it.",
                ],
              },
            ],
          },
        ],
      },
      {
        id: "database-organize",
        title: "Organize and copy",
        summary: "Use folders and copy one or more tables within or across servers.",
        sections: [
          {
            title: "Organize tables with folders",
            blocks: [
              shot(
                "db-drag_to_folder",
                "A customers table tile being dragged onto the Sales folder",
                "While dragging a table, the highlighted folder border identifies the active drop target. Release there to file the table without changing the MySQL schema.",
                "wide"
              ),
              {
                type: "bullets",
                items: [
                  "Drag a table onto a folder to file it, or back to the database root to unfile it.",
                  "Folder organization appears in both the connection sidebar and Database View.",
                  "Folders exist only in DB Sage, so moving a table never renames it or changes its MySQL schema.",
                ],
              },
            ],
          },
          {
            title: "Copy table(s) to another database",
            blocks: [
              shot(
                "db-drag_to_db",
                "An event_log table being dragged to another database in the sidebar",
                "Drop selected table tiles onto a destination database, then choose whether to copy only their definitions or both their definitions and rows.",
                "wide"
              ),
              {
                type: "bullets",
                items: [
                  "Select one or more table tiles, then drag them onto the destination database in the sidebar.",
                  "Choose structure only to create empty tables, or structure and data to copy their rows as well.",
                  "The destination may belong to the same connection or another connected server.",
                  "Large data copies report progress and can be cancelled.",
                ],
              },
            ],
          },
        ],
      },
      {
        id: "database-folders",
        title: "Folders and table actions",
        summary: "Group tables and use the tile context menus safely.",
        sections: [
          {
            title: "Folders",
            blocks: [
              shot(
                "main-db-folder",
                "The Sales folder open in Database View",
                "Opening a folder narrows Database View to the tables filed there. Use the yellow database button to return to the database root.",
                "wide"
              ),
              {
                type: "paragraph",
                text: "Folders are a DB Sage organization feature, not objects created in MySQL. Right-click empty space in the database root to create one, then drag table tiles into it. Rename a folder from its context menu or delete it; deleting a folder returns its tables to the database root and never drops the tables.",
              },
            ],
          },
          {
            title: "Table actions",
            blocks: [
              shot(
                "main-db-context",
                "A table selected in Database View with its context menu open",
                "Right-click a table for structure, copy, comparison, rename, destructive data actions, JSON import, and SQL-script export. Actions below the divider operate on table data or create an external file.",
                "wide"
              ),
              {
                type: "note",
                tone: "warning",
                title: "Truncate and drop are destructive",
                text: "Truncate removes every row but keeps the table. Drop removes the table itself. DB Sage asks for confirmation before either operation.",
              },
            ],
          },
        ],
      },
      {
        id: "database-compare",
        title: "Compare schemas",
        summary: "Compare two databases or two individual tables and synchronize differences.",
        sections: [
          {
            title: "Database and table comparison",
            blocks: [
              {
                type: "steps",
                items: [
                  "Right-click a database and choose Compare Schema, or use Compare Schema on a table for a focused comparison.",
                  "Choose the other connection, database, and table when applicable.",
                  "Review missing, added, and changed objects. Swap the two sides when you want to reverse the comparison direction.",
                  "Use synchronization only after reviewing the generated changes and their target side.",
                ],
              },
              shot(
                "db-compare_schema",
                "Database schema comparison showing missing, added, and changed tables",
                "Red and green sections identify tables found on only one side. The orange section summarizes changed columns and indexes; choose a table row to inspect its detailed differences.",
                "wide"
              ),
            ],
          },
        ],
      },
    ],
  },
  {
    id: "table-view",
    title: "Table View",
    articles: [
      {
        id: "table-browse",
        title: "Browse rows",
        summary: "Understand the grid, pages, row counts, selection, and navigation.",
        sections: [
          {
            title: "Table workspace",
            blocks: [
              shot(
                "table-overview",
                "Table View showing rows and its toolbar",
                "The toolbar handles schema editing, inserts, refresh, import, saved views, export, and the Inspector. Paging controls stay at the bottom."
              ),
              {
                type: "bullets",
                items: [
                  "Use the footer to move between pages, enter a page number, change rows per page, or request an exact COUNT(*).",
                  "Right-click rows and cells for copy, delete, value, and relation actions.",
                ],
              },
            ],
          },
          {
            title: "Select rows",
            blocks: [
              shot(
                "table-select_row",
                "A complete products row selected from its row-number gutter",
                "Click a row number in the left gutter to select the complete row. The selection highlight spans every visible column.",
                "wide"
              ),
              {
                type: "paragraph",
                text: "Use Ctrl+click to toggle individual rows or Shift+click to extend a contiguous range. Right-click a selected row number for actions that operate on complete rows, including duplicate, delete, and Copy As formats.",
              },
            ],
          },
          {
            title: "Select cells",
            blocks: [
              shot(
                "table-select cell",
                "An individual sku cell active in the products table",
                "Click a cell to make it active. The cyan outline identifies the current cell independently of complete-row selection.",
                "inline-right"
              ),
              {
                type: "paragraph",
                text: "Use the arrow keys to move the active cell. Drag across cells to create a rectangular row-and-column selection, then right-click it for value editing, tab-delimited or JSON copying, and other actions supported by that selection.",
              },
            ],
          },
        ],
      },
      {
        id: "table-shape",
        title: "Customize and save views",
        summary: "Choose visible rows and columns, sort and filter data, resize columns, and save the setup as a View.",
        sections: [
          {
            title: "Show, hide, and select",
            blocks: [
              shot(
                "table-columns_filter",
                "Table View column visibility and row-selection menu",
                "Choose the eye above the row-number gutter to show or hide individual columns, show all or none, and select or clear all rows on the current page.",
                "wide"
              ),
              {
                type: "bullets",
                items: [
                  "Choose a column's eye to toggle only that column.",
                  "Show Columns All or None changes the entire column set at once.",
                  "Select Rows All or None changes row selection on the current page.",
                  "The eye above the gutter turns amber when one or more columns are hidden.",
                ],
              },
            ],
          },
          {
            title: "Sort and filter",
            blocks: [
              shot(
                "table-column_menu",
                "Column menu with descending sort and a LIKE filter",
                "Click a column header to choose its sort direction or filter rows with NULL checks, equality, LIKE searches, or numeric and ordered comparisons.",
                "wide"
              ),
              {
                type: "bullets",
                items: [
                  "The active sort direction appears as an arrow in the column header.",
                  "Text filters support EQUALS, NOT EQUAL, LIKE, and NOT LIKE; comparable values also support greater-than and less-than operators.",
                  "A filtered header and the grid's top edge turn amber so an active filter cannot be mistaken for missing data.",
                  "Drag a header edge to resize its column. Clear Filters removes filters and restores hidden columns.",
                ],
              },
            ],
          },
          {
            title: "Save complete setups as Views",
            blocks: [
              shot(
                "table-views",
                "Views menu with named table display setups",
                "A View stores the table's complete display setup. Choose a saved name to restore it, Clear View to return to defaults, or enter a name to save the current setup.",
                "wide"
              ),
              {
                type: "paragraph",
                text: "Views remember column visibility and widths, sort direction, filters, and JSON display choices for the table. The active View appears in the toolbar, and the badge shows how many named Views are saved.",
              },
            ],
          },
        ],
      },
      {
        id: "table-edit",
        title: "Add and edit data",
        summary: "Insert, change, batch-edit, and delete rows.",
        sections: [
          {
            title: "Editing safely",
            blocks: [
              {
                type: "bullets",
                items: [
                  "Choose Add Row for a form based on the table's column metadata and defaults.",
                  "Double-click an editable cell, make the change, and commit it. Primary-key values scope the generated UPDATE.",
                  "Right-click a row number and choose Duplicate Row to stage a copy as a new row, then edit any values that must be unique.",
                  "Select multiple rows before editing when you intentionally want to apply the same value as a batch.",
                  "Right-click selected rows to delete them. Review the confirmation carefully.",
                ],
              },
              shot(
                "table-edit_cell",
                "A products table cell in edit mode with an annotation pointing to the active value",
                "Double-click a cell to edit it inline. Press Enter to commit the value or Escape to cancel the edit.",
                "wide"
              ),
              shot(
                "table-duplicate_row",
                "A products row duplicated into an editable new row with annotations explaining the workflow",
                "Duplicate Row copies the selected row into a staged NEW row. Change unique or identifying values, then press Enter to insert it or Escape to cancel.",
                "wide"
              ),
              {
                type: "note",
                tone: "warning",
                title: "A primary key matters",
                text: "DB Sage only enables safe inline updates when it can identify a row reliably. Tables without a usable primary key may be read-only in the grid.",
              },
            ],
          },
        ],
      },
      {
        id: "table-move-data",
        title: "Copy, import, and export",
        summary: "Move rows between DB Sage, SQL, spreadsheets, and JSON files.",
        sections: [
          {
            title: "Copy selected rows or cells",
            blocks: [
              shot(
                "table-copy_rows_and_columns",
                "A rectangular two-row, two-column selection with its copy menu open",
                "Drag across cells to select a rectangular range, then right-click it. Copy as tab-delimited text for a spreadsheet, as JSON, or stage the values as new rows in DB Sage.",
                "wide"
              ),
              {
                type: "bullets",
                items: [
                  "Right-click selected row numbers to duplicate rows or copy complete rows in SQL and data formats.",
                  "Right-click a rectangular cell selection to copy only those rows and columns as tab-delimited text or JSON.",
                  "To New Rows opens the row-insert workflow with the selected values staged for review before insertion.",
                ],
              },
            ],
          },
          {
            title: "Import JSON",
            blocks: [
              {
                type: "steps",
                items: [
                  "Choose Import in the table toolbar or Import JSON from the table context menu, then select a JSON file containing an array of objects.",
                  "Review the detected record and property counts and inspect the first record before choosing Next: map fields.",
                ],
              },
              shot(
                "table-import_json",
                "Import JSON dialog previewing the first of four detected records",
                "DB Sage validates the JSON array and previews its first object before any rows are written.",
                "wide"
              ),
              {
                type: "steps",
                start: 3,
                items: [
                  "Map each table column to a JSON property. Choose skip for an auto-increment column or any column that should use its database default.",
                  "Decide whether Continue on error should keep importing after a row fails, then choose Import and review the completion result.",
                ],
              },
              shot(
                "table-import_json_map",
                "Import JSON field mapping dialog with source properties assigned to table columns",
                "Required columns are marked, MySQL types stay visible, and each destination column can receive a JSON property or be skipped.",
                "wide"
              ),
            ],
          },
          {
            title: "Export data",
            blocks: [
              {
                type: "bullets",
                items: [
                  "Export the selected rows—or the full current result—to CSV, JSON, or XLSX.",
                  "Export SQL from a table menu when you need CREATE TABLE plus optional INSERT statements.",
                ],
              },
            ],
          },
        ],
      },
      {
        id: "table-json",
        title: "JSON and Inspector",
        summary: "Search, filter, extract, inspect, and edit large or structured values.",
        sections: [
          {
            title: "JSON-aware tools",
            blocks: [
              {
                type: "bullets",
                items: [
                  "Filter a JSON column by a property and value, including paths inside arrays of objects.",
                  "Use Show to display one or more extracted JSON properties inline instead of the raw document.",
                  "Select a cell and open Inspector for a large editable text view beside a collapsible JSON tree.",
                  "Search inside the Inspector and move through matches in both the text and tree panes.",
                ],
              },
              shot(
                "table-json",
                "Annotated Table View showing a JSON path filter, extracted values, and the Inspector's editable text and tree panes",
                "Enter a JSON path to filter or show extracted values in the grid. Inspector keeps the stored JSON editable beside a collapsible tree, and its search remains active as you select other rows.",
                "wide"
              ),
            ],
          },
        ],
      },
      {
        id: "table-design",
        title: "Design a table",
        summary: "Create or alter columns, indexes, and foreign keys with live SQL preview.",
        sections: [
          {
            title: "Columns",
            blocks: [
              {
                type: "paragraph",
                text: "Open New Table from Database View or Edit Table from a table toolbar or context menu. The designer generates a live CREATE TABLE or ALTER TABLE preview as you work.",
              },
              shot(
                "table-new",
                "Add New Table designer annotated with the Add Column button, the drag handle for reordering, the table comment, and the SQL preview",
                "Define names, types, lengths, nullability, keys, defaults, auto-increment, unsigned/zerofill, and comments. Expand a column row for its default and numeric options. Drag the handle at the right of a row to reorder columns. The table comment appears as a tooltip when you hover the table's tab, and Copy in the SQL preview copies the generated statement.",
                "wide"
              ),
            ],
          },
          {
            title: "Indexes and foreign keys",
            blocks: [
              {
                type: "paragraph",
                text: "The Indexes and Foreign Keys tabs sit beside Columns. Changes on any tab feed the same SQL preview, and one Save applies them together.",
              },
              shot(
                "table-new_indexes",
                "Table designer Indexes tab with a compound index and a unique index",
                "Add Index creates simple, compound, or unique indexes. Add columns to an index one at a time, set each column's direction, and reorder them with the arrows. Index type and method are chosen per index."
              ),
              shot(
                "table-fks",
                "Table designer Foreign Keys tab with one foreign key and the resulting ALTER TABLE preview",
                "Add Foreign Key picks the local fields, the referenced schema, table, and fields, and the ON UPDATE and ON DELETE actions. The SQL preview shows the exact constraint statements that Save will run."
              ),
              {
                type: "note",
                title: "Review the SQL preview",
                text: "The preview is the most precise description of what Save will do. Read it before applying structural changes to important tables.",
              },
            ],
          },
        ],
      },
    ],
  },
  {
    id: "query",
    title: "Query",
    articles: [
      {
        id: "query-write",
        title: "Write and run SQL",
        summary: "Choose context, use completion, run statements, limit results, and cancel.",
        sections: [
          {
            title: "Query toolbar and editor",
            blocks: [
              shot(
                "query-overview",
                "DB Sage query tab annotated with the connection and database selectors, Execute, Saved queries, History, Insert, Export, and the result filter controls",
                "A query tab combines connection and database selectors, execution tools, the SQL editor, and a results grid. The grid supports the same post-query filtering and sorting as Table View, and Export sends selected rows to Excel, JSON, and other formats.",
                "wide"
              ),
              {
                type: "steps",
                items: [
                  "Choose the connection and database at the left of the toolbar.",
                  "Write SQL in the editor. Completion suggests keywords, tables, and columns based on FROM and JOIN context.",
                ],
              },
              shot(
                "query-autocomplete",
                "Context-aware SQL completion in the editor",
                "Completion narrows column suggestions to tables already introduced by FROM and JOIN clauses."
              ),
              {
                type: "steps",
                start: 3,
                items: [
                  "Press Ctrl+Enter or choose Execute to run the current statement or selection.",
                  "Use Stop while a long query is running. Adjust Max rows before running when you need a larger or unlimited result.",
                ],
              },
            ],
          },
        ],
      },
      {
        id: "query-results",
        title: "Work with results",
        summary: "Read multiple result sets, cap rows, filter, inspect, copy, and export.",
        sections: [
          {
            title: "Result sets",
            blocks: [
              {
                type: "bullets",
                items: [
                  "Multi-statement SQL produces numbered result-set tabs with row or affected-row summaries.",
                  "Max rows protects the app from accidentally fetching a huge result. A capped result is clearly marked.",
                  "Query results share the table grid's sorting, filters, column visibility, selection, Copy As, Export, and Inspector tools.",
                  "The footer separates server execution time from total round-trip and transfer time.",
                ],
              },
              shot(
                "query-multi",
                "Query tab after running three statements, annotated with the numbered Result tabs above the grid",
                "Each statement gets a numbered Result tab. Switch result sets without rerunning the batch; each result keeps its own rows and status summary."
              ),
            ],
          },
        ],
      },
      {
        id: "query-analysis",
        title: "Explain and analyze",
        summary: "Use execution plans and DB Sage findings to improve a query.",
        sections: [
          {
            title: "From plan to action",
            blocks: [
              {
                type: "steps",
                items: [
                  "Open the Execute menu and choose Explain, or toggle Query Analysis when appropriate.",
                  "Review plan rows, cardinality estimates, access methods, keys, and Extra flags.",
                  "Read DB Sage findings as evidence, then confirm suggested indexes or rewrites against your workload.",
                  "Re-run the plan after a change and compare the estimated and measured behavior.",
                ],
              },
              shot(
                "query-explain",
                "Query Analysis panel showing a score, a ranked list of suggestions, and a suggested index with Copy and Apply buttons",
                "Explain scores the query and lists suggestions with the most impactful first. Each suggestion explains why the behavior matters and may offer a ready-to-run fix. Apply runs the fix; Copy lets you review it first. The Plan tab shows the raw execution plan.",
                "wide"
              ),
            ],
          },
        ],
      },
      {
        id: "query-tools",
        title: "Saved queries and tools",
        summary: "Reuse SQL, inspect history, generate snippets, and choose a formatting style.",
        sections: [
          {
            title: "Reusable query work",
            blocks: [
              {
                type: "paragraph",
                text: "The Saved menu lists saved queries for the current connection and holds the name field for saving the current SQL. When you open a new Query tab, the Saved menu expands automatically so you can pick a query at once.",
              },
              shot(
                "query-new",
                "Saved queries menu open on a new query tab, listing two saved queries and a Save current query field",
                "",
                "wide"
              ),
              {
                type: "bullets",
                items: [
                  "Save a query with a name, open saved SQL later, or explicitly overwrite the active saved query.",
                  "Query History lets you recover recently executed SQL.",
                ],
              },
              shot(
                "query-history",
                "Query History list with recent SQL and relative timestamps",
                "History keeps recently executed SQL with the time it ran. Click an entry to load it into the editor, remove a single entry with its X, or use Clear all."
              ),
              {
                type: "bullets",
                items: [
                  "Insert adds generated SQL snippets, including structured helpers such as AS_JSON.",
                  "Format applies the selected formatting style to the current statement.",
                ],
              },
            ],
          },
        ],
      },
    ],
  },
  {
    id: "relations",
    title: "Relations and peek",
    articles: [
      {
        id: "relations-concepts",
        title: "How relations work",
        summary: "Connect related data without changing MySQL foreign keys.",
        sections: [
          {
            title: "A DB Sage relation",
            blocks: [
              {
                type: "paragraph",
                text: "Relations are one-way, client-side links between a source column and a target column. They can describe data relationships even when the database has no matching foreign key or index, and they do not modify the schema.",
              },
              {
                type: "bullets",
                items: [
                  "HAS ONE expects a source value to identify one related target row.",
                  "HAS MANY expects a source value to match several target rows.",
                  "The direction matters: define another relation when you want navigation in the reverse direction.",
                  "An optional relation name gives the action a clearer domain label than the target table name.",
                ],
              },
              {
                type: "note",
                title: "Relations are not foreign keys",
                text: "Relations do not depend on foreign keys and should not be confused with them. Any two columns from any two tables can be related, provided the columns share the same values. DB Sage never reads or writes MySQL constraints when you define a relation.",
                tone: "tip",
              },
            ],
          },
          {
            title: "Relations View",
            blocks: [
              shot(
                "relations",
                "Relations View listing four relations grouped by source table, with the search box, + Relation, Copy All, Clear All, Export, and Import toolbar",
                "Relations are grouped by source table and labeled HAS ONE or HAS MANY. Each row shows the label and the matching columns. Click a relation to edit it.",
                "wide"
              ),
              {
                type: "paragraph",
                text: "Relations belong to DB Sage, not to the database, so they travel easily. Copy All copies every relation to another database on any connection, which is useful when a copy of a database has the same tables. Export writes the relations to a portable file, and Import reads that file into another database or another DB Sage installation.",
              },
              shot(
                "relations-copy",
                "Copy Relations dialog with connection and database selectors",
                "Copy All copies every relation on the current database to another database, on the same or a different connection. Copy stays disabled until you pick a different target."
              ),
            ],
          },
        ],
      },
      {
        id: "relations-manage",
        title: "Create and manage relations",
        summary: "Define, search, edit, copy, export, import, and remove relations.",
        sections: [
          {
            title: "Manage relations",
            blocks: [
              {
                type: "bullets",
                items: [
                  "Open Relations from Database View and choose + Relation.",
                  "Choose source table and column, kind, target table and column, and an optional display name.",
                ],
              },
              shot(
                "relation-edit",
                "Edit Relation dialog with From, Type, To, and Label fields and Delete, Cancel, and Save buttons",
                "A relation is explicit about direction, cardinality, and the two columns whose values must match. Delete Relation removes only the DB Sage relation.",
                "wide"
              ),
              {
                type: "bullets",
                items: [
                  "Search by table, copy all relations to another database, or export/import them as a portable file.",
                  "Refresh after schema changes. Clear All removes only DB Sage relations, never database constraints.",
                ],
              },
            ],
          },
        ],
      },
      {
        id: "relations-peek",
        title: "Peek at related rows",
        summary: "Jump from a cell to related data without losing your place.",
        sections: [
          {
            title: "Open a peek",
            blocks: [
              {
                type: "paragraph",
                text: "Peek windows are unique to DB Sage. A peek shows the rows related to the selected cell in a separate window, so you can follow data across tables without leaving the table you are working in.",
              },
              {
                type: "steps",
                items: [
                  "In Table View, right-click any cell.",
                  "Choose the named relation under Relations. If none exists, use New Relation from that same menu.",
                  "DB Sage opens a focused window filtered to matching rows in the target table.",
                  "Use Inspector inside the peek for large values, or Open Table to promote the result to a full filtered tab.",
                ],
              },
              shot(
                "relations-menu",
                "Table View annotated with the purple relation icon on a column header and the Relations menu open on a right-clicked cell",
                "A purple icon and purple header text mark a column that has a relation. Right-click any cell to open the Relations menu, then choose a relation to open a peek window. The pencil beside each relation edits it, and New Relation starts a new one.",
                "wide"
              ),
              shot(
                "relations-peek",
                "Orders table beside two peek windows, one showing the HAS ONE customer and one showing the HAS MANY order items for the selected row",
                "A peek is a separate window filtered to the matching target rows, with the filter shown in its title bar. Open peeks follow the selection: click another parent row and each peek updates to that row's related data.",
                "wide"
              ),
            ],
          },
          {
            title: "Work inside a peek",
            blocks: [
              {
                type: "paragraph",
                text: "A peek is a real window. Move it and resize it freely, and keep as many open as you need beside the parent table.",
              },
              {
                type: "bullets",
                items: [
                  "Sort and filter columns in a peek the same way as in Table View, and use Inspector for large values.",
                  "The green open-in-tab button in the peek title bar expands the peek into a full, filtered table tab, where you can edit the related rows.",
                  "Relations nest. If the peeked table has its own relations, right-click a cell in the peek to open a child peek from it.",
                ],
              },
              {
                type: "note",
                title: "Peek layouts are saved with Views",
                text: "When you save a Table View, the open peek windows, their positions, and their sizes are saved with it. Opening the View later restores the whole layout.",
                tone: "tip",
              },
              {
                type: "paragraph",
                text: "With well-chosen relations and a saved peek layout, you can build an advanced data mining setup: select a row in the parent table, and every level of related data updates at once.",
              },
            ],
          },
        ],
      },
    ],
  },
  {
    id: "workspace",
    title: "Workspace",
    articles: [
      {
        id: "workspace-tabs",
        title: "Tabs, windows, and zoom",
        summary: "Arrange the app around the task you are doing.",
        sections: [
          {
            title: "Tabs and panes",
            blocks: [
              shot(
                "tabs-windows",
                "DB Sage tab bar and pane controls",
                "Reorder tabs by dragging, pop a tab into its own window, and drag a detached tab back to the main tab bar to dock it."
              ),
              {
                type: "bullets",
                items: [
                  "Drag the vertical splitter to resize the connection sidebar.",
                  "Zoom applies independently to the sidebar or main pane, based on the last pane you focused.",
                  "Ctrl+W closes the active tab. Unsaved designer tabs ask before closing.",
                  "Right-click a tab for close options; use the pop-out button when a comparison or query deserves its own window.",
                ],
              },
            ],
          },
        ],
      },
      {
        id: "workspace-settings",
        title: "Transfer settings and update",
        summary: "Transfer DB Sage state and keep the application current.",
        sections: [
          {
            title: "Import and export settings",
            blocks: [
              shot(
                "main-file-import",
                "DB Sage File menu showing Import Settings and Export Settings",
                "Open the File menu to import a .dbsage settings file or create one for transfer to another installation.",
                "inline-right"
              ),
              {
                type: "paragraph",
                text: "A .dbsage file can carry connection profiles, relations, table folders, column setups, table view presets, and saved queries. Export lets you choose the categories to include. A passphrase is required when connections are included because they contain saved passwords; for other categories, encryption is optional.",
              },
              {
                type: "note",
                title: "Passphrases cannot be recovered",
                text: "Store an export passphrase separately from the .dbsage file. DB Sage cannot open an encrypted export without it.",
              },
            ],
          },
          {
            title: "Open and unlock an import",
            blocks: [
              shot(
                "main-import_dialog",
                "Import Settings dialog with a selected .dbsage file and masked passphrase",
                "Choose the exported .dbsage file and enter its passphrase when it is encrypted, then choose Continue to preview its contents.",
                "inline-left"
              ),
              {
                type: "steps",
                items: [
                  "Choose File > Import Settings, then select the .dbsage file.",
                  "Enter the passphrase if the export is encrypted. Leave it empty for an unencrypted export.",
                  "Choose Continue. DB Sage validates and reads the file without merging anything yet.",
                ],
              },
            ],
          },
          {
            title: "Choose what to merge",
            blocks: [
              shot(
                "main-import_dialog-confirm",
                "Import Settings preview listing selectable categories and item counts",
                "The preview shows how many items each category contains. Clear any category you do not want to merge before choosing Import.",
                "inline-right"
              ),
              {
                type: "paragraph",
                text: "Import merges only the checked categories. Items with matching internal IDs are updated and new items are added; categories you clear remain unchanged. Review the counts, choose Import, and wait for the completion summary before closing the dialog.",
              },
            ],
          },
          {
            title: "Updates",
            blocks: [
              {
                type: "paragraph",
                text: "Help > About DB Sage shows the installed version and checks for updates. When an update is available, DB Sage can download the installer and launch it after the download completes.",
              },
            ],
          },
        ],
      },
      {
        id: "workspace-shortcuts",
        title: "Keyboard shortcuts",
        summary: "Keep common navigation and execution commands under your fingers.",
        sections: [
          {
            title: "Application shortcuts",
            blocks: [
              {
                type: "keys",
                items: [
                  ["F1", "Open Help"],
                  ["Ctrl + Enter", "Run the current query or selection"],
                  ["Ctrl + W", "Close the active tab"],
                  ["Ctrl + =", "Zoom in on the focused pane"],
                  ["Ctrl + -", "Zoom out on the focused pane"],
                  ["Ctrl + 0", "Reset zoom on the focused pane"],
                  ["Ctrl + wheel", "Zoom the pane under the pointer"],
                  ["Arrow keys", "Move the active grid cell"],
                  ["Escape", "Leave editing, close Inspector, or close a dialog"],
                ],
              },
            ],
          },
        ],
      },
    ],
  },
];

export const DEFAULT_HELP_ARTICLE = "welcome";

export function findHelpArticle(id: string) {
  for (const group of HELP_GROUPS) {
    const article = group.articles.find((candidate) => candidate.id === id);
    if (article) return { group, article };
  }
  return { group: HELP_GROUPS[0], article: HELP_GROUPS[0].articles[0] };
}

export function articleSearchText(article: HelpArticle) {
  const blockText = article.sections.flatMap((section) => [
    section.title,
    ...section.blocks.flatMap((block) => {
      if (block.type === "paragraph") return [block.text];
      if (block.type === "bullets" || block.type === "steps") return block.items;
      if (block.type === "note") return [block.title, block.text];
      if (block.type === "screenshot") return [block.alt, block.caption];
      return block.items.flat();
    }),
  ]);
  return [article.title, article.summary, ...blockText].join(" ").toLowerCase();
}
