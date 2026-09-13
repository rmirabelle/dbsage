/** Temporary probe: mirror the table-to-query capture and dump state at each step. */
import { chromium } from "playwright-core";
import { cell, openTable } from "./lib.mjs";

const browser = await chromium.connectOverCDP(process.env.SHOTS_CDP ?? "http://127.0.0.1:9222");
const page = browser.contexts().flatMap((c) => c.pages()).find((p) => p.url().includes("localhost:14210"));

const dump = (label) =>
  page.evaluate(() => {
    const s = window.__dbsageStore.getState();
    const tab = s.tabs.find((t) => t.kind === "rows" && t.table === "orders");
    const p = tab?.peekAll;
    return { relationsOpen: tab?.relationsOpen, peekAll: p ? { closed: p.closed, activeId: p.activeId, peeks: p.peeks.map((x) => x.title), hidden: (p.hiddenPeeks ?? []).map((x) => x.title) } : null };
  }).then((v) => console.log(label, JSON.stringify(v)));

await openTable(page, "orders", { name: "Sales", firstTable: "orders" });
await dump("after openTable");
await cell(page, 1, 2).click();
const panel = page.locator('[data-el="relations-panel"]');
console.log("relations panel visible:", await panel.isVisible());
if (!(await panel.isVisible())) {
  await page.locator('[data-el="relations-toggle-btn"]').click();
  await panel.waitFor();
}
await dump("after toggle");
const peekPanel = page.locator('[data-el="integrated-peek-panel"]');
console.log("peek panel visible:", await peekPanel.isVisible());
if (!(await peekPanel.isVisible())) {
  await panel.getByRole("button", { name: /Customer peek tab/ }).click();
  await peekPanel.waitFor();
}
await page.waitForTimeout(800);
await dump("before to Query");
await browser.close();
