/** Saves a screenshot of the app as it is now, for debugging captures. */
import { chromium } from "playwright-core";

const browser = await chromium.connectOverCDP(process.env.SHOTS_CDP ?? "http://127.0.0.1:9222");
const page = browser
  .contexts()
  .flatMap((c) => c.pages())
  .find((p) => p.url().includes("localhost:14210"));
const out = process.argv[2] ?? "peek.png";
await page.screenshot({ path: out });
console.log(`saved ${out}`);
await browser.close();
