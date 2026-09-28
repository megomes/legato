/** Converts PDFs to MIDI from the command line and re-reads the result with an independent parser. */
import fs from "node:fs";
import path from "node:path";
import toneMidi from "@tonejs/midi";
import { convertPdf } from "../src/engine/convert";

const { Midi } = toneMidi as unknown as typeof import("@tonejs/midi");
for (const file of process.argv.slice(2)) {
  const t = performance.now();
  const r = await convertPdf(new Uint8Array(fs.readFileSync(file)));
  const ms = Math.round(performance.now() - t);
  console.log(`\n== ${path.basename(file)}  (${ms} ms)  ok=${r.ok}  "${r.title}" / "${r.composer}"`);
  if (!r.ok) {
    console.log("  ERROR", r.error?.code, r.error?.message);
    for (const d of r.error?.details ?? []) console.log("   -", d);
    continue;
  }
  console.log("  stats", JSON.stringify(r.stats));
  console.log("  confidence", JSON.stringify(r.confidence));
  console.log("  navigation", r.navigation, "hands", r.handNotes);
  console.log("  warnings", r.warnings.length, r.warnings.slice(0, 5));
  const out = path.join("fixtures/out", path.basename(file, ".pdf") + ".mid");
  fs.writeFileSync(out, r.midi!);
  const midi = new Midi(fs.readFileSync(out));
  console.log(`  re-read: ppq=${midi.header.ppq} tracks=${midi.tracks.map((t) => `${t.name}[ch${t.channel}]:${t.notes.length}`).join(", ")} tempos=${midi.header.tempos.length} dur=${midi.duration.toFixed(1)}s`);
}
