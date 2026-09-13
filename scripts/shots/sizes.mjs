/** Records the pixel size of hand-made screenshots in HELP_SCREENSHOTS: node scripts/shots/sizes.mjs name… */
import { readFileSync, writeFileSync } from "node:fs";
const HELP = "src/help/helpContent.ts";
let src = readFileSync(HELP, "utf8");
for (const name of process.argv.slice(2)) {
  const png = readFileSync(`public/help/screenshots/${name}.png`);
  const w = png.readUInt32BE(16);
  const h = png.readUInt32BE(20);
  const re = new RegExp(`("${name}": \\{ physicalWidth: )\\d+(, physicalHeight: )\\d+`);
  if (!re.test(src)) { console.warn(`${name}: no registry entry`); continue; }
  src = src.replace(re, `$1${w}$2${h}`);
  console.log(`${name}: ${w}x${h}`);
}
writeFileSync(HELP, src);
