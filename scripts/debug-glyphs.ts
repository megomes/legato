/**
 * Dev tool: renders a PDF page and prints the code point of every music-font glyph on top of it,
 * so glyph tables can be verified visually.
 * Usage: npx tsx scripts/debug-glyphs.ts fixtures/flume.pdf 0 out.png [x0 y0 x1 y1]
 */
import fs from "node:fs";
import * as mupdf from "mupdf";
import { extractDocument } from "../src/engine/pdf/extract";

const [file, pageArg, out, ...crop] = process.argv.slice(2);
const pageNo = Number(pageArg);
const data = fs.readFileSync(file);
const raw = extractDocument(new Uint8Array(data));
const page = raw.pages[pageNo];
const scale = 3;
const doc = mupdf.Document.openDocument(data, "application/pdf");
const pix = doc.loadPage(pageNo).toPixmap(mupdf.Matrix.scale(scale, scale), mupdf.ColorSpace.DeviceRGB, false, true);
const dev = new mupdf.DrawDevice(mupdf.Matrix.scale(scale, scale), pix);
const font = new mupdf.Font("Helvetica");
const textFont = /Text|Times|Arial|Palatino|Zapf|Helvetica|Georgia|Garamond/i;
for (const g of page.glyphs) {
  if (textFont.test(g.font)) continue;
  const t = new mupdf.Text();
  t.showString(font, [2.2, 0, 0, 2.2, g.x, g.y - 1], g.code.toString(16));
  dev.fillText(t, mupdf.Matrix.identity, mupdf.ColorSpace.DeviceRGB, [0.9, 0, 0], 1);
  const p = new mupdf.Path();
  p.rect(g.x - 0.3, g.y - 0.3, g.x + 0.3, g.y + 0.3);
  dev.fillPath(p, false, mupdf.Matrix.identity, mupdf.ColorSpace.DeviceRGB, [0, 0.6, 0], 1);
}
dev.close();
let outPix = pix;
if (crop.length === 4) {
  const [x0, y0, x1, y1] = crop.map((v) => Math.round(Number(v) * scale));
  const sub = new mupdf.Pixmap(mupdf.ColorSpace.DeviceRGB, [0, 0, x1 - x0, y1 - y0], false);
  // copy region
  const src = pix.getPixels();
  const dst = sub.getPixels();
  const sw = pix.getWidth();
  const n = pix.getNumberOfComponents();
  for (let y = 0; y < y1 - y0; y++)
    for (let x = 0; x < x1 - x0; x++)
      for (let c = 0; c < n; c++) dst[(y * (x1 - x0) + x) * n + c] = src[((y + y0) * sw + (x + x0)) * n + c];
  outPix = sub;
}
fs.writeFileSync(out, outPix.asPNG());
const fonts = new Map<string, Map<number, number>>();
for (const g of page.glyphs) {
  if (!fonts.has(g.font)) fonts.set(g.font, new Map());
  const m = fonts.get(g.font)!;
  m.set(g.code, (m.get(g.code) ?? 0) + 1);
}
for (const [f, m] of fonts) {
  if (textFont.test(f)) continue;
  console.log(f, [...m].map(([c, n]) => `${c.toString(16)}'${String.fromCodePoint(c)}'x${n}`).join(" "));
}
