/** Small helpers shared by the capture definitions. */
import { execFile } from "node:child_process";

/** Drags with the mouse from one element to another in small steps; the button stays down. */
export async function dragHold(page, from, to, steps = 12) {
  const a = await from.boundingBox();
  const b = await to.boundingBox();
  const x0 = a.x + a.width / 2;
  const y0 = a.y + a.height / 2;
  const x1 = b.x + b.width / 2;
  const y1 = b.y + b.height / 2;
  await page.mouse.move(x0, y0);
  await page.mouse.down();
  for (let i = 1; i <= steps; i++) {
    const t = i / steps;
    await page.mouse.move(x0 + (x1 - x0) * t, y0 + (y1 - y0) * t);
  }
  await page.waitForTimeout(150);
}

/** Opens a title-bar menu (File, View, Help) by its label. */
export async function openAppMenu(page, label) {
  await page.locator('[data-el="app-menu"]').getByRole("button", { name: label }).click();
}

export const DEMO = "Demo MySQL";
export const DB = "dbsage_screenshot_demo";
export const DB2 = "dbsage_screenshot_compare";

export const connRow = (page, name = DEMO) =>
  page.locator('[data-el="connection-row"]', { hasText: name });
export const dbRow = (page, db = DB) =>
  page.locator('[data-el="db-row"]', { hasText: db });
export const tile = (page, table) => page.locator(`[data-table-name="${table}"]`);

/** Expands the connection so its database rows show. */
export async function expandConnection(page, name = DEMO) {
  if (!(await dbRow(page).isVisible())) await connRow(page, name).click();
  await dbRow(page).waitFor();
}

/** Expands or collapses a database row in the tree. */
export async function setDbExpanded(page, db, want) {
  const chevron = dbRow(page, db).getByRole("button", { name: want ? "Expand" : "Collapse" });
  if (await chevron.count()) await chevron.click();
}

/** Expands or collapses a folder row in the tree. */
export async function setFolderExpanded(page, folder, firstTable, want) {
  const row = page.locator('[data-el="table-row"]', { hasText: firstTable });
  const open = await row.isVisible();
  if (open !== want) await page.locator('[data-el="folder-row"]', { hasText: folder }).click();
}

/** Opens the database tab for `db` and waits for its tile grid. */
export async function openDb(page, db = DB) {
  await expandConnection(page);
  await dbRow(page, db).click();
  await page.locator('[data-el="tile-grid"]').waitFor();
}

/** Opens a table from the tree and waits for its first grid row. */
export async function openTable(page, table, folder = null) {
  await expandConnection(page);
  await setDbExpanded(page, DB, true);
  if (folder) await setFolderExpanded(page, folder.name, folder.firstTable, true);
  await page.locator('[data-el="table-row"]', { hasText: table }).first().dblclick();
  await page.locator('[data-el="grid-row"]').first().waitFor();
  /* The Saved Views menu may drop open once per table open; it would block clicks. */
  const presets = page.locator('[data-el="view-presets-menu"]');
  if (await presets.isVisible()) {
    await page.keyboard.press("Escape");
    await presets.waitFor({ state: "hidden" });
  }
  const clear = page.locator('[data-el="clear-filters-btn"]');
  if (await clear.isVisible()) {
    await clear.click();
    await page.waitForTimeout(300);
  }
  await scrollGridLeft(page);
}

/** Scrolls the active grid back to its left edge. */
export async function scrollGridLeft(page) {
  await page.evaluate(() => {
    for (const el of document.querySelectorAll('[data-el="data-grid"]')) el.scrollLeft = 0;
  });
}

/** Opens the SQL preview pane in the table designer when it is collapsed. */
export async function expandSqlPane(page) {
  if (!(await page.locator('[data-el="sql-text"]').isVisible())) {
    await page.locator('[data-el="sql-pane-toggle"]').click();
    await page.locator('[data-el="sql-text"]').waitFor();
  }
}

/** Grid cell by zero-based row and visible column index. */
export const cell = (page, row, col) =>
  page.locator(`[data-row-index="${row}"] [data-el="grid-cell"]`).nth(col);

/**
 * Opens the header menu for a column. A header that is only partly on screen
 * gets a synthetic click, because a real click would scroll the grid first.
 */
export async function headerMenu(page, column) {
  const header = page.locator(`[data-column-header="${column}"]`);
  const box = await header.boundingBox();
  const width = await page.evaluate(() => innerWidth);
  if (box && (box.x < 0 || box.x + box.width > width)) {
    const clientX = Math.round(Math.max(box.x, 0) + 20);
    const clientY = Math.round(box.y + box.height / 2);
    await header.dispatchEvent("click", { clientX, clientY, bubbles: true });
  } else {
    await header.click();
  }
  await page.locator('[data-el="column-header-menu"]').waitFor();
}

/** Closes any open modal dialog or menu left behind by an earlier run. */
export async function dismissDialogs(page) {
  for (let i = 0; i < 4; i++) {
    const dialog = page.locator('[role="dialog"]:visible').last();
    if (!(await dialog.count())) break;
    const cancel = dialog.getByRole("button", { name: /^(Cancel|Close)$/ });
    if (await cancel.count()) await cancel.first().click();
    else await page.keyboard.press("Escape");
    await page.waitForTimeout(150);
  }
  await page.keyboard.press("Escape");
}

/** Closes every open tab. */
export async function closeAllTabs(page) {
  const btn = page.locator('[data-el="tab-close-btn"]');
  while (await btn.count()) {
    await btn.first().click();
    await page.waitForTimeout(100);
  }
}

/** Picks an option in a StyledSelect by its data-el and option text. */
export async function pickOption(page, dataEl, text) {
  await page.locator(`[data-el="${dataEl}"]`).click();
  await page.getByRole("button", { name: text, exact: true }).last().click();
}

/**
 * Finds the app window whose Tauri label starts with `prefix` (main, monitor-, admin-).
 * Every window loads the same dev URL, so the label is the only reliable key.
 */
export async function findWindow(browser, prefix, waitMs = 0) {
  const deadline = Date.now() + waitMs;
  do {
    for (const p of browser.contexts().flatMap((c) => c.pages())) {
      const label = await p
        .evaluate(() => window.__TAURI_INTERNALS__?.metadata?.currentWindow?.label ?? "")
        .catch(() => "");
      if (label.startsWith(prefix)) return p;
    }
    if (Date.now() < deadline) await new Promise((r) => setTimeout(r, 250));
  } while (Date.now() < deadline);
  return null;
}

/**
 * Types a path into the next native file dialog ("Open" or "Save As") and confirms it.
 * Start this BEFORE the click that opens the dialog, then await it after.
 * The Tauri invoke bridge is read-only, so the dialog cannot be faked in-page.
 */
export function pickNativeFile(path, title = "Open") {
  const winPath = path.replace(/\//g, "\\");
  const script = [
    "Add-Type -AssemblyName System.Windows.Forms",
    "$w = New-Object -ComObject wscript.shell",
    "$ok = $false",
    `for ($i = 0; $i -lt 100 -and -not $ok; $i++) { Start-Sleep -Milliseconds 100; $ok = $w.AppActivate('${title}') }`,
    "if (-not $ok) { exit 1 }",
    "Start-Sleep -Milliseconds 800",
    "[System.Windows.Forms.SendKeys]::SendWait('%n')",
    "Start-Sleep -Milliseconds 300",
    `[System.Windows.Forms.SendKeys]::SendWait('${winPath}')`,
    "Start-Sleep -Milliseconds 300",
    "[System.Windows.Forms.SendKeys]::SendWait('{ENTER}')",
    /** A slow dialog can swallow the first Enter; press again while it is still up. */
    `for ($j = 0; $j -lt 3; $j++) { Start-Sleep -Milliseconds 600; if (-not $w.AppActivate('${title}')) { break }; [System.Windows.Forms.SendKeys]::SendWait('{ENTER}') }`,
  ].join("; ");
  return new Promise((resolve, reject) => {
    execFile("powershell", ["-NoProfile", "-Command", script], (err) =>
      err ? reject(new Error(`native ${title} dialog did not appear`)) : resolve()
    );
  });
}
