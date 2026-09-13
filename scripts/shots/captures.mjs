/**
 * Screenshot definitions for the help pages.
 *
 * Each capture has:
 *   name        output file name (without .png)
 *   steps       drives the live app to the state you want to show
 *   targets     selectors whose on-screen boxes are joined to form the crop
 *   pad         extra pixels around the joined box (default 24)
 *   fromOrigin  start the crop at the window's top-left corner
 *   origin      selector whose top-left corner starts the crop instead
 *   shift       { x, y } offset applied to that origin corner
 *   maxWidth    clamp the crop width (from the left edge)
 *   maxHeight   clamp the crop height (from the top edge)
 *   box         explicit crop { x, y, width, height } instead of targets
 *   full        capture the whole window
 *   window      { width, height } window size for this capture (CSS px)
 *   after       cleanup steps run once the image is saved
 *   keepMouse   leave the pointer where the steps put it (hover states)
 *
 * Sizes are CSS pixels; the saved PNG is scaled by the display's pixel ratio.
 */
import { rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import {
  DB,
  DB2,
  cell,
  closeAllTabs,
  connRow,
  dbRow,
  dismissDialogs,
  dragHold,
  expandConnection,
  expandSqlPane,
  headerMenu,
  openAppMenu,
  openDb,
  openTable,
  pickNativeFile,
  pickOption,
  scrollGridLeft,
  setDbExpanded,
  setFolderExpanded,
  tile,
} from "./lib.mjs";

const SALES = { name: "Sales", firstTable: "orders" };
const MAIN = '[data-el="main-pane"]';
const FIXTURE_JSON = resolve("scripts/shots/fixtures/test.json");
const SETTINGS_FILE = resolve(tmpdir(), "dbsage-workspace-2026-08-30.dbsage");
const SETTINGS_PASSPHRASE = "screenshots";
/* A plaintext workspace file from an "old laptop": its host matches no
   connection here, so Import Workspace offers to map it. */
const FOREIGN_FILE = resolve(tmpdir(), "dbsage-workspace-old-laptop.dbsage");
const FOREIGN_BUNDLE = {
  app: "DBSage",
  format: "dbsage-state",
  version: 1,
  exportedAt: "2026-08-30T12:00:00Z",
  relations: {
    "old-laptop": {
      [DB]: [
        { id: "shot-rel-1", fromTable: "orders", fromColumn: "customer_id", toTable: "customers", toColumn: "id", kind: "has_one", name: "Customer" },
      ],
    },
  },
};

const PARAMS_SQL = `SELECT id, status, total
FROM orders
WHERE status = '{{Order status=shipped|Pending=pending|Cancelled=cancelled}}'
  AND total >= {{Minimum total}}
ORDER BY id DESC`;

const NESTED_SQL = `SELECT COLUMN_NAME, DATA_TYPE
FROM information_schema.COLUMNS
WHERE TABLE_SCHEMA = '${DB}'
  AND TABLE_NAME = '{{Table^SELECT TABLE_NAME FROM information_schema.TABLES WHERE TABLE_SCHEMA=\\'${DB}\\' ORDER BY TABLE_NAME}}'
  AND COLUMN_NAME = '{{Column^SELECT COLUMN_NAME FROM information_schema.COLUMNS WHERE TABLE_SCHEMA=\\'${DB}\\' AND TABLE_NAME=\\'{{Table}}\\'}}'`;

const STAR_SQL = `SELECT o.*, c.name
FROM orders o
JOIN customers c ON c.id = o.customer_id`;

/** Replace the query editor's text (a controlled textarea). */
async function setEditorSql(page, sql) {
  const editor = page.locator('textarea[data-el="query-editor"]');
  await editor.click();
  await editor.fill(sql);
  await page.keyboard.press("Escape");
}

export const captures = [
  {
    name: "connection-db_expanded",
    fromOrigin: true,
    maxWidth: 560,
    pad: 16,
    targets: ['[data-el="table-row"]:has-text("products")'],
    async steps(page) {
      await closeAllTabs(page);
      await expandConnection(page);
      await setDbExpanded(page, DB, true);
      await setFolderExpanded(page, "Sales", "orders", true);
    },
  },
  {
    name: "connection-reorder",
    keepMouse: true,
    box: { x: 0, y: 0, width: 430, height: 385 },
    async steps(page) {
      await setDbExpanded(page, DB, false);
      const from = await connRow(page, "localhost").boundingBox();
      const to = await connRow(page).boundingBox();
      const y0 = from.y + from.height / 2;
      const y1 = to.y + 10;
      await page.mouse.move(from.x + 60, y0);
      await page.mouse.down();
      for (let i = 1; i <= 12; i++) {
        const t = i / 12;
        await page.mouse.move(from.x + 60 + 40 * t, y0 + (y1 - y0) * t);
      }
      await page.waitForTimeout(150);
    },
    async after(page) {
      await page.keyboard.press("Escape");
      await page.mouse.up();
    },
  },
  {
    name: "db-menu",
    pad: 28,
    targets: [
      '[data-el="connection-row"]:has-text("Demo MySQL")',
      `[data-el="db-row"]:has-text("${DB}")`,
      '[data-el="db-context-menu"]',
    ],
    async steps(page) {
      await expandConnection(page);
      await dbRow(page).click({ button: "right" });
      await page.locator('[data-el="db-context-menu"]').waitFor();
    },
    after: (page) => page.keyboard.press("Escape"),
  },
  {
    name: "main-new_connection",
    pad: 12,
    targets: ['[data-el="profile-dialog"]'],
    async steps(page) {
      await page.locator('[data-el="add-connection-btn"]').click();
      await page.locator('[data-el="profile-dialog"]').waitFor();
    },
    after: (page) => page.locator('[data-el="profile-dialog-close-btn"]').click(),
  },
  {
    name: "main-db",
    full: true,
    async steps(page) {
      await openDb(page);
      await setDbExpanded(page, DB, true);
      await setFolderExpanded(page, "Sales", "orders", true);
    },
  },
  {
    name: "db-search",
    box: { x: 0, y: 0, width: 620, height: 343 },
    async steps(page) {
      await openDb(page);
      await page.locator('[data-el="table-filter-input"]').fill("ev");
      await tile(page, "event_log").waitFor();
    },
    after: (page) => page.locator('[data-el="table-filter-input"]').fill(""),
  },
  {
    name: "db-multiselect",
    keepMouse: true,
    fromOrigin: true,
    pad: 24,
    targets: ['[data-el="table-context-menu"]', '[data-el="ctx-save-sql-create-data"]'],
    async steps(page) {
      await openDb(page);
      await tile(page, "event_log").click();
      await tile(page, "products").click({ modifiers: ["Control"] });
      await tile(page, "products").click({ button: "right" });
      await page.locator('[data-el="ctx-save-sql"]').hover();
      await page.locator('[data-el="ctx-save-sql-create-data"]').waitFor();
    },
    async after(page) {
      await page.keyboard.press("Escape");
      await page.locator('[data-el="tile-grid"]').click({ position: { x: 5, y: 5 } });
    },
  },
  {
    name: "main-db-context",
    fromOrigin: true,
    pad: 24,
    targets: ['[data-el="table-context-menu"]'],
    async steps(page) {
      await openDb(page);
      await tile(page, "event_log").click({ button: "right" });
      await page.locator('[data-el="table-context-menu"]').waitFor();
    },
    after: (page) => page.keyboard.press("Escape"),
  },
  {
    name: "main-db-folder",
    box: { x: 0, y: 0, width: 878, height: 298 },
    async steps(page) {
      await openDb(page);
      await page.locator('[data-el="folder-tile"]', { hasText: "Sales" }).dblclick();
      await page.locator('[data-el="folder-up-btn"]').waitFor();
    },
    after: (page) => page.locator('[data-el="folder-up-btn"]').click(),
  },
  {
    name: "db-compare_schema_config",
    pad: 12,
    targets: ['[data-el="compare-database-dialog"]'],
    async steps(page) {
      await closeAllTabs(page);
      await expandConnection(page);
      await dbRow(page).click({ button: "right" });
      await page.locator('[data-el="ctx-compare-db-schema"]').click();
      await page.locator('[data-el="compare-database-dialog"]').waitFor();
      await pickOption(page, "compare-db-target-database", DB2);
      await page.getByText("Select specific tables").click();
      await page.getByText("6 of 6 tables selected").waitFor();
    },
  },
  {
    name: "db-compare_schema",
    full: true,
    window: { width: 1042, height: 836 },
    async steps(page) {
      await page.locator('[data-el="compare-database-go"]').click();
      await page.locator(".schema-diff").waitFor();
      await page.getByText("Tables with schema differences").waitFor();
      await page.locator(".schema-diff").getByText("orders", { exact: true }).first().click();
      await page.waitForTimeout(200);
    },
  },
  {
    name: "db-diff",
    box: { x: 0, y: 0, width: 728, height: 582 },
    async steps() {},
    after: (page) => closeAllTabs(page),
  },
  {
    name: "table-select_row",
    origin: MAIN,
    shift: { x: -120 },
    pad: 0,
    maxWidth: 742,
    targets: ['[data-row-index="6"]'],
    async steps(page) {
      await closeAllTabs(page);
      await openTable(page, "order_items", SALES);
      await page.locator('[data-row-index="1"] [data-el="row-gutter"]').click();
    },
  },
  {
    name: "table-select cell",
    origin: MAIN,
    shift: { x: -60, y: -30 },
    pad: 0,
    maxWidth: 553,
    targets: ['[data-row-index="2"]'],
    async steps(page) {
      await openTable(page, "products");
      await cell(page, 0, 1).click();
    },
  },
  {
    name: "table-columns_filter",
    origin: MAIN,
    shift: { x: -30 },
    pad: 24,
    maxWidth: 581,
    targets: ['[data-el="columns-menu"]', '[data-column-header="inventory_count"]'],
    async steps(page) {
      await openTable(page, "products");
      await page.locator('[data-el="columns-toggle-btn"]').click();
      const menu = page.locator('[data-el="columns-menu"]');
      await menu.waitFor();
      const toggle = (name) =>
        menu.locator('[data-el="column-toggle"]').filter({ has: page.locator("span", { hasText: new RegExp(`^${name}$`) }) });
      await toggle("id").click();
      await toggle("sku").click();
    },
    async after(page) {
      await page.locator('[data-el="columns-show-all-btn"]').click();
      await page.keyboard.press("Escape");
    },
  },
  {
    name: "table-column_menu",
    origin: MAIN,
    pad: 24,
    maxWidth: 814,
    targets: ['[data-el="column-header-menu"]'],
    async steps(page) {
      await openTable(page, "products");
      await headerMenu(page, "sku");
      await page.getByText("Sort descending").click();
      const menu = page.locator('[data-el="column-header-menu"]');
      if (!(await menu.isVisible())) await headerMenu(page, "sku");
      await page.locator('[data-el="filter-op-equals"]').click();
      await page.locator('[data-el="column-filter-input"]').first().fill("DSK-4K-05");
      await page.keyboard.press("Enter");
      await page.waitForTimeout(300);
      if (!(await menu.isVisible())) await headerMenu(page, "sku");
    },
    async after(page) {
      await page.keyboard.press("Escape");
      await page.locator('[data-el="clear-filters-btn"]').click();
    },
  },
  {
    name: "table-filter-auto_suggest",
    origin: MAIN,
    pad: 24,
    maxWidth: 579,
    targets: ['[data-el="column-filter-suggestions"]'],
    async steps(page) {
      await openTable(page, "event_log");
      await headerMenu(page, "event_type");
      await page.locator('[data-el="filter-op-equals"]').click();
      await page.locator('[data-el="column-filter-input"]').first().click();
      await page.locator('[data-el="column-filter-suggestions"]').waitFor();
    },
    after: (page) => page.keyboard.press("Escape"),
  },
  {
    name: "table-views",
    origin: MAIN,
    shift: { x: -130, y: -30 },
    pad: 0,
    maxWidth: 768,
    targets: ['[data-el="view-presets-menu"]', '[data-row-index="10"]'],
    async steps(page) {
      await openTable(page, "products");
      await page.locator('[data-el="view-presets-btn"]').click();
      await page.locator('[data-el="view-presets-menu"]').getByText("Price DESC").click();
      await page.waitForTimeout(300);
      await page.locator('[data-el="view-presets-btn"]').click();
      await page.locator('[data-el="view-presets-menu"]').waitFor();
    },
    async after(page) {
      await page.locator('[data-el="view-presets-menu"]').getByText("Clear View").click();
      await page.keyboard.press("Escape");
    },
  },
  {
    name: "table-edit_cell",
    origin: MAIN,
    shift: { x: -60, y: -30 },
    pad: 0,
    maxWidth: 536,
    targets: ['[data-row-index="5"]'],
    async steps(page) {
      await openTable(page, "products");
      await cell(page, 2, 1).dblclick();
      await page.locator('[data-el="cell-editor-input"]').waitFor();
    },
    after: (page) => page.keyboard.press("Escape"),
  },
  {
    name: "table-duplicate_row",
    window: { width: 1300, height: 632 },
    origin: MAIN,
    pad: 0,
    maxWidth: 926,
    targets: ['[data-row-index="4"]'],
    async steps(page) {
      await openTable(page, "products");
      await page.locator('[data-row-index="0"] [data-el="row-gutter"]').click({ button: "right" });
      await page.locator('[data-el="row-context-menu"]').getByText("Duplicate 1 row").click();
      await page.locator('[data-el="draft-grid-row"]').waitFor();
    },
    after: (page) => page.keyboard.press("Escape"),
  },
  {
    name: "table-copy_rows_and_columns",
    origin: MAIN,
    shift: { x: -60, y: -30 },
    pad: 24,
    targets: ['[data-el="cell-copy-menu"]'],
    async steps(page) {
      await openTable(page, "products");
      await cell(page, 1, 1).click();
      await cell(page, 2, 2).click({ modifiers: ["Shift"] });
      await cell(page, 2, 2).click({ button: "right" });
      await page.locator('[data-el="cell-copy-menu"]').waitFor();
    },
    after: (page) => page.keyboard.press("Escape"),
  },
  {
    name: "table-import_json",
    pad: 12,
    targets: ['[data-el="import-json-dialog"]'],
    async steps(page) {
      await openTable(page, "products");
      await page.locator('[data-el="import-json-btn"]').click();
      await page.locator('[data-el="import-json-dialog"]').waitFor();
      const picker = pickNativeFile(FIXTURE_JSON);
      await page.getByText("Choose JSON file").click();
      await picker;
      await page.getByText("First record").waitFor();
    },
  },
  {
    name: "table-import_json_map",
    window: { width: 1066, height: 800 },
    pad: 12,
    targets: ['[data-el="import-json-dialog"]'],
    async steps(page) {
      await page.locator('[data-el="import-json-next-btn"]').click();
      await page.locator('[data-el="import-json-run-btn"]').waitFor();
      await page.locator('[data-el="import-json-dialog"] select').nth(5).selectOption({ index: 0 });
    },
    after: (page) => dismissDialogs(page),
  },
  {
    name: "table-compare_schema_config",
    pad: 12,
    targets: ['[data-el="compare-schema-dialog"]'],
    async steps(page) {
      await closeAllTabs(page);
      await openDb(page);
      await tile(page, "products").click({ button: "right" });
      await page.locator('[data-el="ctx-compare-schema"]').click();
      await page.locator('[data-el="compare-schema-dialog"]').waitFor();
      await pickOption(page, "compare-target-database", DB2);
      await pickOption(page, "compare-target-table", "products");
    },
  },
  {
    name: "table-sync",
    pad: 12,
    targets: ['[data-el="sync-execute"] >> xpath=ancestor::*[@role="dialog"]'],
    async steps(page) {
      await pickOption(page, "compare-source-table", "orders");
      await pickOption(page, "compare-target-table", "orders");
      await page.locator('[data-el="compare-schema-go"]').click();
      await page.getByRole("button", { name: "Sync" }).click();
      await page.locator('[data-el="sync-execute"]').waitFor();
    },
    async after(page) {
      await page.getByRole("button", { name: "Cancel" }).click();
      await closeAllTabs(page);
    },
  },
  {
    name: "table-new",
    full: true,
    window: { width: 1240, height: 973 },
    async steps(page) {
      await openDb(page);
      await tile(page, "products").click({ button: "right" });
      await page.locator('[data-el="ctx-edit-table"]').click();
      await page.locator('[data-el="table-designer"]').waitFor();
      await page.locator('[data-el="col-name"]').first().click();
      await page.locator('[data-el="column-advanced"]').waitFor();
      await expandSqlPane(page);
    },
    after: (page) => closeAllTabs(page),
  },
  {
    name: "table-new_indexes",
    origin: MAIN,
    pad: 0,
    maxWidth: 834,
    targets: ['[data-el="sql-pane"]'],
    async steps(page) {
      await openTable(page, "customers", SALES);
      await page.locator('[data-el="edit-table-btn"]').click();
      await page.locator('[data-el="table-designer"]').waitFor();
      await page.locator('[data-el="designer-subtab-indexes"]').click();
      await page.locator('[data-el="index-row"]').first().waitFor();
      await expandSqlPane(page);
    },
    after: (page) => closeAllTabs(page),
  },
  {
    name: "table-fks",
    origin: MAIN,
    pad: 0,
    maxWidth: 990,
    targets: ['[data-el="sql-pane"]'],
    async steps(page) {
      await openTable(page, "orders", SALES);
      await page.locator('[data-el="edit-table-btn"]').click();
      await page.locator('[data-el="table-designer"]').waitFor();
      await page.locator('[data-el="designer-subtab-foreign-keys"]').click();
      await page.locator('[data-el="fk-row"]').first().waitFor();
      await expandSqlPane(page);
    },
    after: (page) => closeAllTabs(page),
  },
  {
    name: "table-json",
    full: true,
    window: { width: 1178, height: 1054 },
    async steps(page) {
      await openDb(page);
      await openTable(page, "event_log");
      await headerMenu(page, "payload");
      await page.locator('[data-el="json-show-input"]').fill("changes[field=status].to");
      await page.keyboard.press("Enter");
      await page.locator('[data-el="column-header-menu"]').waitFor({ state: "hidden" });
      await cell(page, 11, 4).click();
      await page.locator('[data-el="expanded-toggle-btn"]').click();
      await page.locator('[data-el="expanded-panel"]').waitFor();
      await page.locator('[data-el="expanded-search-input"]').fill("paid");
      await page.keyboard.press("Enter");
      await page.waitForTimeout(200);
      await scrollGridLeft(page);
      await headerMenu(page, "payload");
    },
    async after(page) {
      await page.locator('[data-el="json-show-input"]').fill("");
      await page.keyboard.press("Enter");
      await page.locator('[data-el="expanded-toggle-btn"]').click();
      await closeAllTabs(page);
    },
  },
  {
    name: "query-new",
    origin: MAIN,
    shift: { x: -50, y: -30 },
    pad: 24,
    maxWidth: 689,
    targets: ['[data-el="saved-queries-menu"]', '[data-el="query-toolbar"]'],
    async steps(page) {
      await closeAllTabs(page);
      await openDb(page);
      await page.locator('[data-el="new-query-btn"]').click();
      await page.locator('[data-el="saved-queries-menu"]').waitFor();
    },
  },
  {
    name: "query-overview",
    full: true,
    async steps(page) {
      await page.locator('[data-el="saved-queries-menu"]').getByText("2026 orders matching").click();
      await page.locator('[data-el="query-execute-btn"]').click();
      await page.locator('[data-el="query-results-toolbar"]').waitFor();
      const inspector = page.locator('[data-el="expanded-panel"]');
      if (await inspector.isVisible()) await page.locator('[data-el="expanded-toggle-btn"]').click();
      await page.locator('[data-el="grid-row"]').first().waitFor();
      await page.locator('[data-row-index="2"] [data-el="row-gutter"]').click();
    },
  },
  {
    name: "query-explain",
    window: { width: 1300, height: 750 },
    origin: MAIN,
    pad: 8,
    targets: ['[data-el="query-analysis-panel"]'],
    async steps(page) {
      await page.locator('[data-el="query-execute-menu-btn"]').click();
      await page.locator('[data-el="query-explain-btn"]').click();
      await page.locator('[data-el="query-analysis-panel"]').getByText(/^Suggestions \(/).waitFor();
      await page.waitForTimeout(300);
    },
    after: (page) => page.getByRole("button", { name: "Close analysis" }).click(),
  },
  {
    name: "query-history",
    pad: 12,
    targets: ['[data-el="query-history-dialog"]'],
    async steps(page) {
      await page.locator('[data-el="query-history-btn"]').click();
      await page.locator('[data-el="query-history-dialog"]').waitFor();
    },
    after: (page) => dismissDialogs(page),
  },
  {
    name: "query-expand-star",
    origin: MAIN,
    pad: 16,
    targets: ['[data-el="query-toolbar"]', '[data-el="expand-star-dialog"]'],
    async steps(page) {
      await setEditorSql(page, STAR_SQL);
      await page.locator('[data-el="query-expand-star-btn"]').click();
      await page.locator('[data-el="expand-star-dialog"] input[type="checkbox"]').first().waitFor();
    },
    after: (page) => dismissDialogs(page),
  },
  {
    name: "query-params",
    origin: MAIN,
    pad: 16,
    targets: ['[data-el="query-editor"]', '[data-el="query-params-dialog"]'],
    async steps(page) {
      await setEditorSql(page, PARAMS_SQL);
      await page.locator('[data-el="query-execute-btn"]').click();
      await page.locator('[data-el="query-params-dialog"]').waitFor();
      await page.locator('[data-el="query-param-input"]').fill("100");
    },
    after: (page) => dismissDialogs(page),
  },
  {
    name: "query-params-nested",
    pad: 12,
    targets: ['[data-el="query-params-dialog"]'],
    async steps(page) {
      await setEditorSql(page, NESTED_SQL);
      await page.locator('[data-el="query-execute-btn"]').click();
      const dialog = page.locator('[data-el="query-params-dialog"]');
      await dialog.waitFor();
      /* Both menus load: the outer one after the inner one has its first value. */
      await dialog.locator('[data-el="query-param-select"]').nth(1).waitFor();
      await page.waitForTimeout(300);
    },
    after: (page) => dismissDialogs(page),
  },
  {
    name: "query-multi",
    origin: MAIN,
    pad: 0,
    maxWidth: 618,
    targets: ['[data-el="query-results-toolbar"]', '[data-row-index="2"]'],
    async steps(page) {
      await page.locator('[data-el="saved-queries-btn"]').click();
      await page.locator('[data-el="saved-queries-menu"]').getByText("Revenue, Top Products").click();
      await page.locator('[data-el="query-execute-btn"]').click();
      await page.locator('[data-el="query-result-set-btn"]').nth(1).click();
      await page.locator('[data-el="grid-row"]').first().waitFor();
      await page.locator('textarea[data-el="query-editor"]').evaluate((el) => {
        el.scrollTop = el.scrollHeight;
      });
    },
    after: (page) => closeAllTabs(page),
  },
  {
    name: "relations",
    origin: MAIN,
    pad: 12,
    maxWidth: 811,
    maxHeight: 328,
    targets: ['[data-el="relations-body"]'],
    async steps(page) {
      await openDb(page);
      await page.locator('[data-el="relationships-btn"]').click();
      await page.locator('[data-el="relation-table-row"]').first().waitFor();
    },
  },
  {
    name: "relation-edit",
    pad: 12,
    targets: ['[data-el="relation-edit-dialog"]'],
    async steps(page) {
      await page.locator('[data-el="relation-row"]').first().click();
      await page.locator('[data-el="relation-edit-dialog"]').waitFor();
    },
    after: (page) => dismissDialogs(page),
  },
  {
    name: "relations-copy",
    pad: 12,
    targets: ['[data-el="copy-relations-dialog"]'],
    async steps(page) {
      await page.locator('[data-el="copy-relations-btn"]').click();
      await page.locator('[data-el="copy-relations-dialog"]').waitFor();
    },
    async after(page) {
      await dismissDialogs(page);
      await closeAllTabs(page);
    },
  },
  {
    name: "relations-menu",
    window: { width: 1300, height: 700 },
    full: true,
    async steps(page) {
      await openTable(page, "orders", SALES);
      await cell(page, 1, 2).click();
      const toggle = page.locator('[data-el="relations-toggle-btn"]');
      const panel = page.locator('[data-el="relations-panel"]');
      for (let i = 0; i < 2 && !(await panel.isVisible()); i++) {
        await toggle.click();
        await page.waitForTimeout(600);
      }
      await panel.waitFor();
    },
  },
  {
    name: "relations-peek",
    window: { width: 1300, height: 700 },
    full: true,
    async steps(page) {
      const panel = page.locator('[data-el="relations-panel"]');
      await panel.getByRole("button", { name: /Customer peek tab/ }).click();
      await page.locator('[data-el="integrated-peek-panel"]').waitFor();
      await panel.getByRole("button", { name: /Order Items peek tab/ }).click();
      await page.waitForTimeout(400);
    },
    async after(page) {
      await page.locator('[data-el="relations-toggle-btn"]').click();
      await closeAllTabs(page);
    },
  },
  {
    /* Hand-set scene (grab mode): the table view before choosing to Query. */
    name: "table-to-query-source",
    window: { width: 1300, height: 760 },
    full: true,
    async steps() {},
  },
  {
    name: "table-to-query",
    window: { width: 1300, height: 760 },
    full: true,
    async steps(page) {
      await openTable(page, "orders", SALES);
      await cell(page, 1, 2).click();
      const panel = page.locator('[data-el="relations-panel"]');
      if (!(await panel.isVisible())) {
        await page.locator('[data-el="relations-toggle-btn"]').click();
        await panel.waitFor();
      }
      /* The saved layout may already show the Customer peek; clicking its tab
         again would close it. */
      const peekPanel = page.locator('[data-el="integrated-peek-panel"]');
      if (!(await peekPanel.isVisible())) {
        await panel.getByRole("button", { name: /Customer peek tab/ }).click();
        await peekPanel.waitFor();
      }
      await page.waitForTimeout(800);
      await page.locator('[data-el="table-to-query-btn"]').click();
      await page.locator('textarea[data-el="query-editor"]').waitFor();
      await page.locator('[data-el="query-execute-btn"]').click();
      await page.locator('[data-el="grid-row"]').first().waitFor();
      await page.locator('[data-row-index="0"] [data-el="row-gutter"]').click();
      await page.waitForTimeout(300);
    },
    after: (page) => closeAllTabs(page),
  },
  {
    name: "relations-export",
    pad: 12,
    targets: ['[data-el="export-relations-dialog"]'],
    async steps(page) {
      await openDb(page);
      await page.locator('[data-el="relationships-btn"]').click();
      await page.locator('[data-el="relation-table-row"]').first().waitFor();
      await page.locator('[data-el="export-relations-btn"]').click();
      await page.locator('[data-el="export-relations-dialog"]').waitFor();
    },
    after: (page) => dismissDialogs(page),
  },
  {
    name: "relations-clear-warning",
    pad: 12,
    targets: ['[data-el="clear-relations-dialog"]'],
    async steps(page) {
      await page.locator('[data-el="clear-relations-btn"]').click();
      await page.locator('[data-el="clear-relations-peek-warning"]').waitFor();
    },
    async after(page) {
      await dismissDialogs(page);
      await closeAllTabs(page);
    },
  },
  {
    name: "db-export-setup",
    pad: 12,
    targets: ['[data-el="export-database-setup-dialog"]'],
    async steps(page) {
      await openDb(page);
      await page.locator('[data-el="database-export-settings"]').click();
      await page.locator('[data-el="export-database-setup-dialog"]').waitFor();
    },
    after: (page) => dismissDialogs(page),
  },
  {
    name: "main-first_run",
    full: true,
    async steps(page) {
      await closeAllTabs(page);
      await expandConnection(page);
      await page.locator('[data-el="disconnect-btn"]').first().click();
      await page.locator('[data-el="db-row"]').first().waitFor({ state: "hidden" });
    },
  },
  {
    name: "main-file-import",
    fromOrigin: true,
    pad: 24,
    targets: ['[data-el="menu-import-state"]', '[data-el="menu-export-state"]'],
    async steps(page) {
      await openAppMenu(page, "File");
      await page.locator('[data-el="menu-import-state"]').waitFor();
    },
    after: (page) => page.keyboard.press("Escape"),
  },
  {
    name: "main-import_dialog",
    pad: 12,
    targets: ['[data-el="state-transfer-dialog"]'],
    async steps(page) {
      rmSync(SETTINGS_FILE, { force: true });
      await openAppMenu(page, "File");
      await page.locator('[data-el="menu-export-state"]').click();
      await page.locator('[data-el="export-passphrase-input"]').fill(SETTINGS_PASSPHRASE);
      await page.locator('[data-el="export-confirm-input"]').fill(SETTINGS_PASSPHRASE);
      const save = pickNativeFile(SETTINGS_FILE, "Save As");
      await page.locator('[data-el="export-submit-btn"]').click();
      await save;
      await page.locator('[data-el="state-transfer-done-btn"]').click();

      await openAppMenu(page, "File");
      await page.locator('[data-el="menu-import-state"]').click();
      const open = pickNativeFile(SETTINGS_FILE);
      await page.locator('[data-el="import-choose-btn"]').click();
      await open;
      await page.getByText("dbsage-workspace-2026-08-30.dbsage").waitFor();
      await page.locator('[data-el="import-passphrase-input"]').fill(SETTINGS_PASSPHRASE);
    },
  },
  {
    name: "main-import_dialog-confirm",
    pad: 12,
    targets: ['[data-el="state-transfer-dialog"]'],
    async steps(page) {
      await page.locator('[data-el="import-unlock-btn"]').click();
      await page.locator('[data-el="import-submit-btn"]').waitFor();
    },
    async after(page) {
      await page.locator('[data-el="state-transfer-close-btn"]').click();
      rmSync(SETTINGS_FILE, { force: true });
    },
  },
  {
    name: "main-import-host-map",
    pad: 12,
    targets: ['[data-el="state-transfer-dialog"]'],
    async steps(page) {
      writeFileSync(FOREIGN_FILE, JSON.stringify(FOREIGN_BUNDLE, null, 2));
      await openAppMenu(page, "File");
      await page.locator('[data-el="menu-import-state"]').click();
      const open = pickNativeFile(FOREIGN_FILE);
      await page.locator('[data-el="import-choose-btn"]').click();
      await open;
      await page.getByText("dbsage-workspace-old-laptop.dbsage").waitFor();
      await page.locator('[data-el="import-unlock-btn"]').click();
      await page.locator('[data-el="import-host-map"]').waitFor();
    },
    async after(page) {
      await page.locator('[data-el="state-transfer-close-btn"]').click();
      rmSync(FOREIGN_FILE, { force: true });
    },
  },
  {
    name: "db-drag_to_folder",
    keepMouse: true,
    origin: MAIN,
    shift: { x: -40, y: -20 },
    pad: 40,
    maxWidth: 674,
    targets: ['[data-el="database-toolbar"]', '[data-el="folder-tile"]', '[data-table-name="products"]'],
    async steps(page) {
      await openDb(page);
      await dragHold(page, tile(page, "products"), page.locator('[data-el="folder-tile"]', { hasText: "Sales" }));
    },
    async after(page) {
      await page.keyboard.press("Escape");
      await page.mouse.up();
    },
  },
  {
    name: "db-drag_to_db",
    fromOrigin: true,
    pad: 24,
    maxWidth: 637,
    targets: ['[data-el="copy-table-menu"]', `[data-el="db-row"]:has-text("${DB2}")`],
    async steps(page) {
      await openDb(page);
      await dragHold(page, tile(page, "event_log"), dbRow(page, DB2));
      await page.mouse.up();
      await page.locator('[data-el="copy-table-menu"]').waitFor();
    },
    after: (page) => page.keyboard.press("Escape"),
  },
  {
    name: "connection-monitor",
    windowLabel: "monitor-",
    window: { width: 894, height: 535 },
    full: true,
    async steps(page, ctx) {
      await expandConnection(page);
      await page.getByRole("button", { name: "Monitor Server" }).first().click();
      const win = await ctx.window("monitor-");
      await win.locator('[data-el="monitoring-row"]').first().waitFor();
      await win.waitForTimeout(2500);
    },
  },
  {
    name: "connection-admin-service",
    windowLabel: "admin-",
    window: { width: 706, height: 338 },
    full: true,
    async steps(page, ctx) {
      await page.getByRole("button", { name: "Server Admin" }).first().click();
      const win = await ctx.window("admin-");
      await win.getByRole("button", { name: "Service" }).click();
      await win.getByText("RUNNING").waitFor();
    },
  },
  {
    name: "connection-admin-logs",
    windowLabel: "admin-",
    window: { width: 752, height: 472 },
    full: true,
    async steps(page, ctx) {
      const win = await ctx.window("admin-");
      await win.getByRole("button", { name: "Logs" }).click();
      await win.getByText("[System]").first().waitFor();
    },
  },
  {
    name: "connection-admin-config",
    windowLabel: "admin-",
    window: { width: 1000, height: 655 },
    full: true,
    async steps(page, ctx) {
      const win = await ctx.window("admin-");
      await win.getByRole("button", { name: "Configuration" }).click();
      await win.getByText("GENERAL").first().waitFor();
    },
  },
];
