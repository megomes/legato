/**
 * Dev tool: overlays recognised symbols (durations, dots, accidentals, problems) on a rendered page.
 * Usage: npx tsx scripts/debug-symbols.ts fixtures/flume.pdf <page> out.png [system]
 */
import fs from "node:fs";
import * as mupdf from "mupdf";
import { extractDocument } from "../src/engine/pdf/extract";
import { analyzeLayout } from "../src/engine/layout/document";
import { readSystemSymbols } from "../src/engine/recognize/symbols";

const [file, pageArg, out, sysArg] = process.argv.slice(2);
const pageNo = Number(pageArg);
const data = fs.readFileSync(file);
const layout = analyzeLayout(extractDocument(new Uint8Array(data)));
const page = layout.pages[pageNo];
const scale = 3;
const doc = mupdf.Document.openDocument(data, "application/pdf");
const pix = doc.loadPage(pageNo).toPixmap(mupdf.Matrix.scale(scale, scale), mupdf.ColorSpace.DeviceRGB, false, true);
const dev = new mupdf.DrawDevice(mupdf.Matrix.scale(scale, scale), pix);
const font = new mupdf.Font("Helvetica");
const label = (x: number, y: number, s: string, rgb: [number, number, number], size = 3) => {
  const t = new mupdf.Text();
  t.showString(font, [size, 0, 0, size, x, y], s);
  dev.fillText(t, mupdf.Matrix.identity, mupdf.ColorSpace.DeviceRGB, rgb, 1);
};
const box = (x0: number, y0: number, x1: number, y1: number, rgb: [number, number, number], a = 0.35) => {
  const p = new mupdf.Path();
  p.rect(x0, y0, x1, y1);
  dev.fillPath(p, false, mupdf.Matrix.identity, mupdf.ColorSpace.DeviceRGB, rgb, a);
};
const fr = (f: { n: number; d: number }) => (f.d === 1 ? `${f.n}` : `${f.n}/${f.d}`);
let crop: [number, number] | null = null;
page.systems.forEach((sys, i) => {
  if (sysArg !== undefined && Number(sysArg) !== i) return;
  const sy = readSystemSymbols(page, sys);
  const sp = sys.upper.sp;
  if (sysArg !== undefined) crop = [sys.upper.top - 12 * sp, sys.lower.bottom + 10 * sp];
  for (const b of sys.bars) box(b.x0 - 0.3, sys.upper.top - 2, b.x1 + 0.3, sys.upper.top - 0.5, [0, 0, 1], 0.8);
  for (const c of [...sy.chords, ...sy.graceChords]) {
    const col: [number, number, number] = c.grace ? [0.6, 0, 0.8] : c.staff === 0 ? [0, 0.55, 0.3] : [0.1, 0.3, 0.9];
    for (const h of c.heads) box(h.x, h.y - sp / 2, h.xr, h.y + sp / 2, col);
    const y = c.dir === "down" ? Math.max(...c.heads.map((h) => h.y)) + 2.2 * sp : Math.max(...c.heads.map((h) => h.y)) + 1.4 * sp;
    label(c.anchor - 2, y, fr(c.base) + (c.tuplet ? "t" : ""), col, 3.2);
    for (const h of c.heads) if (h.accidental) label(h.x - 3, h.y - 2.5, h.accidental[0] + (h.courtesy ? "?" : ""), [0.8, 0.3, 0], 3);
  }
  for (const r of sy.rests) {
    box(r.x, r.y - sp, r.x + r.glyph.adv, r.y + sp * 0.3, [0.9, 0.6, 0]);
    label(r.x, r.y + 2.2 * sp, (r.measureRest ? "M" : "") + fr(r.base), [0.7, 0.4, 0], 3);
  }
  for (const k of sy.keys) label(k.x, sy.staves[k.staff].top - 1, `K${k.fifths}`, [0.7, 0, 0.5], 3);
  for (const c of sy.clefs) label(c.x, sy.staves[c.staff].bottom + 6, c.clef, [0.7, 0, 0.5], 3);
  for (const t of sy.times) label(t.x, sys.upper.top - 4, `${t.num}/${t.den}`, [0.7, 0, 0.5], 3);
  for (const t of sy.tuplets) box(t.x - 1.5, t.y - 4, t.x + 1.5, t.y, [1, 0, 1], 0.5);
  for (const c of sy.curves) box(c.left[0], c.left[1] - 0.6, c.left[0] + 1.2, c.left[1] + 0.6, [1, 0.5, 0], 0.9);
  for (const p of sy.problems) {
    const st = p.staff === 1 ? sys.lower : sys.upper;
    box(p.x - 1, st.top - 1, p.x + 1, st.bottom + 1, p.severity === "error" ? [1, 0, 0] : [1, 0.7, 0], 0.6);
    console.log(`sys ${i} ${p.severity} x=${p.x.toFixed(1)} staff=${p.staff}: ${p.message}`);
  }
});
dev.close();
let outPix = pix;
if (crop) {
  const [y0, y1] = (crop as [number, number]).map((v) => Math.max(0, Math.round(v * scale)));
  const w = pix.getWidth();
  const h = Math.min(pix.getHeight(), y1) - y0;
  const sub = new mupdf.Pixmap(mupdf.ColorSpace.DeviceRGB, [0, 0, w, h], false);
  const src = pix.getPixels();
  const dst = sub.getPixels();
  const n = pix.getNumberOfComponents();
  for (let y = 0; y < h; y++) for (let x = 0; x < w * n; x++) dst[y * w * n + x] = src[(y + y0) * w * n + x];
  outPix = sub;
}
fs.writeFileSync(out, outPix.asPNG());
