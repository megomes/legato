/**
 * Dev tool: prints the recognised pitch name next to every notehead (green = right hand, blue = left hand).
 * Usage: npx tsx scripts/debug-pitches.ts fixtures/flume.pdf <page> out.png [system]
 */
import fs from "node:fs";
import * as mupdf from "mupdf";
import { extractDocument } from "../src/engine/pdf/extract";
import { analyzeLayout } from "../src/engine/layout/document";
import { buildMeasures } from "../src/engine/score/build";
import { readDirections } from "../src/engine/recognize/directions";
import { assignHands } from "../src/engine/score/hands";

const [file, pageArg, out, sysArg] = process.argv.slice(2);
const pageNo = Number(pageArg);
const data = fs.readFileSync(file);
const layout = analyzeLayout(extractDocument(new Uint8Array(data)));
const built = buildMeasures(layout);
const dirs = layout.pages.flatMap((page) => {
  const systems = built.systems.filter((s) => s.page === page).map((s) => ({ sys: s.sys, measures: s.measures }));
  return systems.length ? readDirections({ page, systems }) : [];
});
assignHands(built.measures, dirs);
const NAMES = ["C", "C#", "D", "Eb", "E", "F", "F#", "G", "Ab", "A", "Bb", "B"];
const name = (step: number, alter: number, midi: number) => "CDEFGAB"[((step % 7) + 7) % 7] + (alter > 0 ? "#".repeat(alter) : alter < 0 ? "b".repeat(-alter) : "") + (Math.floor(midi / 12) - 1) + `(${NAMES[midi % 12]})`.slice(0, 0);

const scale = 3;
const doc = mupdf.Document.openDocument(data, "application/pdf");
const pix = doc.loadPage(pageNo).toPixmap(mupdf.Matrix.scale(scale, scale), mupdf.ColorSpace.DeviceRGB, false, true);
const dev = new mupdf.DrawDevice(mupdf.Matrix.scale(scale, scale), pix);
const font = new mupdf.Font("Helvetica-Bold");
const page = layout.pages[pageNo];
let crop: [number, number] | null = null;
page.systems.forEach((sys, si) => {
  if (sysArg !== undefined && Number(sysArg) !== si) return;
  const sp = sys.upper.sp;
  if (sysArg !== undefined) crop = [sys.upper.top - 14 * sp, sys.lower.bottom + 12 * sp];
  const rec = built.systems.find((r) => r.page === page && r.sys === sys)!;
  for (const m of rec.measures)
    for (const n of m.notes) {
      const t = new mupdf.Text();
      const col: [number, number, number] = n.grace ? [0.6, 0, 0.7] : n.hand === "R" ? [0, 0.55, 0.25] : [0.05, 0.25, 0.95];
      t.showString(font, [2.6, 0, 0, 2.6, n.x + 6.5, n.y + 1], name(n.step, n.alter, n.midi) + (n.tiePrev ? "~" : ""));
      dev.fillText(t, mupdf.Matrix.identity, mupdf.ColorSpace.DeviceRGB, col, 1);
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
