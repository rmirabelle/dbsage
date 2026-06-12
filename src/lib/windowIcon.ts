import { getCurrentWindow } from "@tauri-apps/api/window";
import { Image } from "@tauri-apps/api/image";

/* Phosphor fill-weight glyphs (viewBox 0 0 256 256), matching the icons the
   in-app titlebars use. */
const TABLE_FILL =
  "M224,48H32a8,8,0,0,0-8,8V192a16,16,0,0,0,16,16H216a16,16,0,0,0,16-16V56A8,8,0,0,0,224,48ZM40,112H80v32H40Zm56,0H216v32H96ZM40,160H80v32H40Zm176,32H96V160H216v32Z";
const CODE_FILL =
  "M216,40H40A16,16,0,0,0,24,56V200a16,16,0,0,0,16,16H216a16,16,0,0,0,16-16V56A16,16,0,0,0,216,40ZM92.8,145.6a8,8,0,1,1-9.6,12.8l-32-24a8,8,0,0,1,0-12.8l32-24a8,8,0,0,1,9.6,12.8L69.33,128Zm58.89-71.4-32,112a8,8,0,1,1-15.38-4.4l32-112a8,8,0,0,1,15.38,4.4Zm53.11,60.2-32,24a8,8,0,0,1-9.6-12.8L186.67,128,163.2,110.4a8,8,0,1,1,9.6-12.8l32,24a8,8,0,0,1,0,12.8Z";
const SHARE_NETWORK_FILL =
  "M212,200a36,36,0,1,1-69.85-12.25l-53-34.05a36,36,0,1,1,0-51.4l53-34a36.09,36.09,0,1,1,8.67,13.45l-53,34.05a36,36,0,0,1,0,24.5l53,34.05A36,36,0,0,1,212,200Z";

export interface Glyph {
  path: string;
  fill: string;
}

/** Window-icon glyphs keyed to a tab kind / window role; colors match the
 * in-app titlebar icon colors (emerald table/query, orange designer, violet
 * relations/peek). */
export const GLYPHS = {
  table: { path: TABLE_FILL, fill: "#34d399" },
  tableDesigner: { path: TABLE_FILL, fill: "#fb923c" },
  query: { path: CODE_FILL, fill: "#34d399" },
  relations: { path: SHARE_NETWORK_FILL, fill: "#a78bfa" },
} satisfies Record<string, Glyph>;

/**
 * Give the current window its own taskbar/titlebar icon — a phosphor glyph
 * matching its role — instead of the default app icon. We rasterize the SVG to
 * RGBA in a canvas and hand it to `setIcon`, so there's no bundled asset or
 * build tooling involved.
 */
export async function setWindowGlyphIcon(glyph: Glyph) {
  try {
    const size = 64;
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 256 256" width="${size}" height="${size}"><path d="${glyph.path}" fill="${glyph.fill}"/></svg>`;
    const el = new window.Image();
    await new Promise<void>((resolve, reject) => {
      el.onload = () => resolve();
      el.onerror = reject;
      el.src = "data:image/svg+xml;base64," + btoa(svg);
    });
    const canvas = document.createElement("canvas");
    canvas.width = size;
    canvas.height = size;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    ctx.drawImage(el, 0, 0, size, size);
    const rgba = new Uint8Array(ctx.getImageData(0, 0, size, size).data.buffer);
    const icon = await Image.new(rgba, size, size);
    await getCurrentWindow().setIcon(icon);
  } catch {
    /* Non-essential polish — keep the default app icon if anything fails. */
  }
}
