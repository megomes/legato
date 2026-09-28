import fs from "node:fs";
import { extractDocument } from "../src/engine/pdf/extract";
const textFont = /Times|Arial|Palatino|Zapf|Helvetica/i;
for (const file of process.argv.slice(2)) {
  const raw = extractDocument(new Uint8Array(fs.readFileSync(file)));
  const fonts = new Map<string, Map<number, { n: number; sizes: Set<number>; pages: Set<number> }>>();
  for (const p of raw.pages) for (const g of p.glyphs) {
    if (textFont.test(g.font)) continue;
    if (!fonts.has(g.font)) fonts.set(g.font, new Map());
    const m = fonts.get(g.font)!;
    const e = m.get(g.code) ?? { n: 0, sizes: new Set(), pages: new Set() };
    e.n++; e.sizes.add(Math.round(g.size * 10) / 10); e.pages.add(p.index); m.set(g.code, e);
  }
  console.log("==", file, raw.producer, "|", raw.creator);
  for (const [f, m] of fonts) {
    console.log(" ", f);
    for (const [c, e] of [...m].sort((a, b) => a[0] - b[0])) console.log(`    ${c.toString(16).padStart(4)} '${String.fromCodePoint(c)}' x${e.n} sizes=${[...e.sizes].join(",")} pages=${[...e.pages].join(",")}`);
  }
}
