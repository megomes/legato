import fs from "node:fs";
import { extractDocument } from "../src/engine/pdf/extract";
import { analyzeLayout } from "../src/engine/layout/document";

for (const file of process.argv.slice(2)) {
  const raw = extractDocument(new Uint8Array(fs.readFileSync(file)));
  const layout = analyzeLayout(raw);
  console.log("==", file);
  console.log("profiles", [...layout.profiles.values()].filter((p) => p.role !== "text").map((p) => `${p.name}:${p.role}/${p.scheme}/${p.table}`).join(" "));
  let total = 0;
  for (const p of layout.pages) {
    const bars = p.systems.map((s) => s.bars.length - 1);
    total += bars.reduce((a, b) => a + b, 0);
    console.log(`page ${p.page}: systems=${p.systems.length} sp=${p.systems[0]?.upper.sp.toFixed(2)} measures=${bars.join(",")} styles=${p.systems.map((s) => s.bars.map((b) => b.style[0] + (b.style.includes("-") ? b.style.split("-")[1][0] : "")).join("")).join(" | ")}`);
  }
  console.log("total measures", total, "unknown glyphs", layout.issues.unknownGlyphs.length, layout.issues.unknownGlyphs.slice(0, 5));
}
