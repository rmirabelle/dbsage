/**
 * Regenerates help screenshots by driving the running DBSage dev app.
 *
 * Start the app with a WebView2 remote debugging port first:
 *   WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS="--remote-debugging-port=9222" npm run tauri dev
 * Then:
 *   npm run shots            all captures (writes public/help/screenshots and updates helpContent.ts sizes)
 *   npm run shots db-menu    only the named captures (a prefix like table- also works)
 *
 * Set SHOTS_DEBUG to a folder to save a screenshot of the app state after each failure.
 */
import { chromium } from "playwright-core";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { captures } from "./captures.mjs";
import { dismissDialogs, findWindow } from "./lib.mjs";

const OUT_DIR = process.env.SHOTS_OUT ?? "public/help/screenshots";
const HELP_CONTENT = "src/help/helpContent.ts";
const CDP_URL = process.env.SHOTS_CDP ?? "http://127.0.0.1:9222";
const WINDOW = { width: 1066, height: 632 };
/* `--grab name…` shoots the named captures as the screen is now: no steps, no
   cleanup, just the capture's window size and crop rule. For shots a person
   sets up by hand. */
const grab = process.argv[2] === "--grab";
const only = process.argv.slice(grab ? 3 : 2);
const cdpSessions = new WeakMap();

const browser = await chromium.connectOverCDP(CDP_URL);
const main = await findWindow(browser, "main");
if (!main) throw new Error("Main window not found on the debug port.");
main.setDefaultTimeout(8000);
const ctx = {
  browser,
  main,
  /** Resolves another app window (monitor-, admin-, ...) once it exists. */
  window: async (prefix) => {
    const win = await findWindow(browser, prefix, 8000);
    if (!win) throw new Error(`Window ${prefix}* did not open`);
    win.setDefaultTimeout(8000);
    return win;
  },
};

mkdirSync(OUT_DIR, { recursive: true });
if (!grab) await dismissDialogs(main);
let failed = 0;

for (const cap of captures) {
  if (only.length && !only.some((o) => cap.name === o || (!grab && cap.name.startsWith(o)))) continue;
  try {
    /* Grab mode keeps the window as the person sized it. */
    if (!cap.windowLabel && !grab) await setWindow(main, cap.window ?? WINDOW);
    if (!grab) await cap.steps?.(main, ctx);
    const target = cap.windowLabel ? await ctx.window(cap.windowLabel) : main;
    if (cap.windowLabel && !grab) await setWindow(target, cap.window ?? WINDOW);
    if (!cap.keepMouse) await parkMouse(target);
    await resetScroll(target);
    const clip = cap.full ? undefined : cap.box ?? (await joinedBox(target, cap));
    const file = join(OUT_DIR, `${cap.name}.png`);
    await target.screenshot({ path: file, clip });
    recordSize(cap.name, file);
    const size = clip ?? (await viewport(target));
    console.log(`${cap.name}: ${Math.round(size.width)}x${Math.round(size.height)} -> ${file}`);
  } catch (e) {
    failed++;
    console.error(`${cap.name}: FAILED - ${firstLine(e)}`);
    if (process.env.SHOTS_DEBUG) {
      const dbg = join(process.env.SHOTS_DEBUG, `failed-${cap.name}.png`);
      await main.screenshot({ path: dbg }).catch(() => {});
      console.error(`${cap.name}: state saved to ${dbg}`);
    }
  }
  if (grab) continue;
  try {
    await cap.after?.(main, ctx);
  } catch (e) {
    console.error(`${cap.name}: cleanup failed - ${firstLine(e)}`);
  }
}

await browser.close();
process.exit(failed ? 1 : 0);

/** Updates the image's pixel size in the HELP_SCREENSHOTS table. */
function recordSize(name, file) {
  const png = readFileSync(file);
  const width = png.readUInt32BE(16);
  const height = png.readUInt32BE(20);
  const src = readFileSync(HELP_CONTENT, "utf8");
  const re = new RegExp(`("${name}": \\{ physicalWidth: )\\d+(, physicalHeight: )\\d+`);
  if (!re.test(src)) {
    console.warn(`${name}: no HELP_SCREENSHOTS entry to update`);
    return;
  }
  writeFileSync(HELP_CONTENT, src.replace(re, `$1${width}$2${height}`));
}

function firstLine(e) {
  const lines = String(e?.message ?? e).split("\n");
  const detail = lines.slice(1).find((l) => l.includes("waiting for") || l.includes("locator"));
  return detail ? `${lines[0]} (${detail.trim()})` : lines[0];
}

async function viewport(page) {
  return page.evaluate(() => ({ width: innerWidth, height: innerHeight }));
}

/** Undoes any scroll of the page chrome that a scroll-into-view left behind. */
async function resetScroll(page) {
  await page.evaluate(() => {
    document.scrollingElement.scrollTop = 0;
    let el = document.querySelector('[data-el="tab-bar"]')?.parentElement;
    while (el) {
      if (el.scrollTop > 0) el.scrollTop = 0;
      el = el.parentElement;
    }
  });
}

/** Moves the pointer to an empty corner so no control shows a hover state. */
async function parkMouse(page) {
  const view = await viewport(page);
  await page.mouse.move(view.width - 12, view.height - 12);
  await page.waitForTimeout(80);
}

async function setWindow(page, { width, height }) {
  const cur = await viewport(page);
  if (cur.width === width && cur.height === height) return;
  let cdp = cdpSessions.get(page);
  if (!cdp) {
    cdp = await page.context().newCDPSession(page);
    cdpSessions.set(page, cdp);
  }
  const { windowId } = await cdp.send("Browser.getWindowForTarget");
  await cdp.send("Browser.setWindowBounds", {
    windowId,
    bounds: { left: 40, top: 40, width, height },
  });
  await page.waitForTimeout(250);
}

async function joinedBox(page, { targets, pad = 24, fromOrigin = false, origin, shift, maxWidth, maxHeight }) {
  const view = await viewport(page);
  let x1 = Infinity;
  let y1 = Infinity;
  let x2 = -Infinity;
  let y2 = -Infinity;
  for (const sel of targets) {
    const box = await page.locator(sel).first().boundingBox();
    if (!box) throw new Error(`No box for ${sel}`);
    x1 = Math.min(x1, box.x);
    y1 = Math.min(y1, box.y);
    x2 = Math.max(x2, box.x + box.width);
    y2 = Math.max(y2, box.y + box.height);
  }
  if (origin) {
    const box = await page.locator(origin).first().boundingBox();
    if (!box) throw new Error(`No box for origin ${origin}`);
    x1 = Math.max(0, box.x + (shift?.x ?? 0));
    y1 = Math.max(0, box.y + (shift?.y ?? 0));
  } else {
    x1 = fromOrigin ? 0 : Math.max(0, x1 - pad);
    y1 = fromOrigin ? 0 : Math.max(0, y1 - pad);
  }
  x2 = Math.min(view.width, x2 + pad, x1 + (maxWidth ?? Infinity));
  y2 = Math.min(view.height, y2 + pad, y1 + (maxHeight ?? Infinity));
  return { x: x1, y: y1, width: x2 - x1, height: y2 - y1 };
}
