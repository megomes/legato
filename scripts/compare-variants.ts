/** Prints how the expressive rendering differs from the exact one for each PDF. */
import fs from "node:fs";
import path from "node:path";
import { convertPdf, type Preview } from "../src/engine/convert";

const vel = (p: Preview) => {
  const vs = p.notes.map((n) => n.v);
  const avg = vs.reduce((a, b) => a + b, 0) / vs.length;
  const sd = Math.sqrt(vs.reduce((a, b) => a + (b - avg) ** 2, 0) / vs.length);
  return `vel ${Math.min(...vs)}–${Math.max(...vs)} (média ${avg.toFixed(0)}, desvio ${sd.toFixed(1)})`;
};
for (const f of process.argv.slice(2)) {
  const r = await convertPdf(new Uint8Array(fs.readFileSync(f)));
  if (!r.ok || !r.variants) {
    console.log(path.basename(f), "REJEITADA", r.error?.message);
    continue;
  }
  const { exact, expressive } = r.variants;
  console.log(`\n${path.basename(f)}  marcas: ${JSON.stringify(r.expression)}`);
  console.log(`  exata      ${vel(exact.preview)}  duração ${exact.preview.duration.toFixed(1)}s`);
  console.log(`  expressiva ${vel(expressive.preview)}  duração ${expressive.preview.duration.toFixed(1)}s`);
  fs.writeFileSync(path.join("fixtures/out", path.basename(f, ".pdf") + ".exata.mid"), exact.midi);
  fs.writeFileSync(path.join("fixtures/out", path.basename(f, ".pdf") + ".expressiva.mid"), expressive.midi);
}
