/**
 * Benchmark: MusicXML (ground truth) → MuseScore → PDF → Legato → notes, compared semantically.
 * Usage: npx tsx bench/run.ts [cases=20] [fonts=Leland,Bravura,...]
 * Writes bench/results.json and prints a summary.
 */
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { convertPdf } from "../src/engine/convert";
import { PPQ } from "../src/engine/util/frac";
import { generateCase, type TruthNote } from "./generate";

const N = Number(process.argv[2] ?? 20);
const FONTS = (process.argv[3] ?? "Leland,Bravura,Petaluma,Finale Maestro,Gonville,Emmentaler").split(",");
const TEXT_FONT: Record<string, string> = { Leland: "Leland Text", Bravura: "Bravura Text", Petaluma: "Petaluma Text", "Finale Maestro": "Finale Maestro Text", Gonville: "Gonville Text", Emmentaler: "Emmentaler Text" };
const dir = path.resolve("bench/tmp");
fs.mkdirSync(dir, { recursive: true });

interface Key {
  hand: "R" | "L";
  midi: number;
  start: number;
  end: number;
}

/** Same normalisation the MIDI writer applies: unisons merged, overlapping repeats of a pitch shortened. */
function normalise(notes: Key[]): Key[] {
  const sorted = [...notes].sort((a, b) => a.start - b.start || a.midi - b.midi);
  const out: Key[] = [];
  const last = new Map<string, Key>();
  for (const n of sorted) {
    const k = `${n.hand}:${n.midi}`;
    const p = last.get(k);
    if (p && p.start === n.start) {
      p.end = Math.max(p.end, n.end);
      continue;
    }
    if (p && p.end > n.start) p.end = n.start;
    const c = { ...n };
    out.push(c);
    last.set(k, c);
  }
  return out;
}

const truthKeys = (notes: TruthNote[]): Key[] =>
  normalise(notes.map((n) => ({ hand: n.staff === 0 ? "R" : "L", midi: n.midi, start: Math.round(n.start * PPQ), end: Math.round(n.end * PPQ) })));

interface CaseResult {
  font: string;
  name: string;
  features: string[];
  status: "exact" | "rejected" | "mismatch" | "render-failed";
  truth: number;
  got: number;
  exact: number;
  pitchErrors: number;
  timingErrors: number;
  handErrors: number;
  missing: number;
  extra: number;
  reason?: string;
}

const results: CaseResult[] = [];
for (const font of FONTS) {
  const style = path.join(dir, `style-${font.replace(/\s/g, "")}.mss`);
  fs.writeFileSync(
    style,
    `<?xml version="1.0" encoding="UTF-8"?>\n<museScore version="4.70"><Style><musicalSymbolFont>${font}</musicalSymbolFont><musicalTextFont>${TEXT_FONT[font] ?? font + " Text"}</musicalTextFont></Style></museScore>\n`,
  );
  const cases = Array.from({ length: N }, (_, i) => generateCase(i + 1, `Bench ${i + 1}`));
  const job = cases.map((c, i) => {
    const xml = path.join(dir, `case-${i + 1}.musicxml`);
    fs.writeFileSync(xml, c.xml);
    return { in: xml, out: path.join(dir, `case-${i + 1}-${font.replace(/\s/g, "")}.pdf`) };
  });
  for (const j of job) if (fs.existsSync(j.out)) fs.unlinkSync(j.out);
  const jobFile = path.join(dir, `job-${font.replace(/\s/g, "")}.json`);
  fs.writeFileSync(jobFile, JSON.stringify(job));
  try {
    execFileSync("mscore", ["-S", style, "-j", jobFile], { stdio: "ignore", timeout: 600_000 });
  } catch {
    /* mscore may exit non-zero on warnings; check outputs below */
  }
  for (let i = 0; i < cases.length; i++) {
    const c = cases[i];
    const pdf = job[i].out;
    const base = { font, name: c.name, features: c.features, truth: truthKeys(c.notes).length, got: 0, exact: 0, pitchErrors: 0, timingErrors: 0, handErrors: 0, missing: 0, extra: 0 };
    if (!fs.existsSync(pdf)) {
      results.push({ ...base, status: "render-failed" });
      continue;
    }
    const r = await convertPdf(new Uint8Array(fs.readFileSync(pdf)), { includeTimeline: true });
    if (!r.ok || !r.timeline) {
      results.push({ ...base, status: "rejected", reason: `${r.error?.message} ${r.error?.details.slice(0, 2).join(" | ")}` });
      continue;
    }
    const truth = truthKeys(c.notes);
    const got: Key[] = r.timeline.notes.map((n) => ({ hand: n.hand, midi: n.midi, start: n.start, end: n.end }));
    const key = (n: Key) => `${n.hand}:${n.midi}:${n.start}:${n.end}`;
    const gotSet = new Map<string, number>();
    for (const g of got) gotSet.set(key(g), (gotSet.get(key(g)) ?? 0) + 1);
    let exact = 0;
    const unmatchedTruth: Key[] = [];
    for (const t of truth) {
      const k = key(t);
      if (gotSet.get(k)) {
        exact++;
        gotSet.set(k, gotSet.get(k)! - 1);
      } else unmatchedTruth.push(t);
    }
    const unmatchedGot = got.filter((g) => {
      const k = key(g);
      if (gotSet.get(k)) {
        gotSet.set(k, gotSet.get(k)! - 1);
        return true;
      }
      return false;
    });
    // classify leftovers
    let pitchErrors = 0;
    let timingErrors = 0;
    let handErrors = 0;
    const pool = [...unmatchedGot];
    const take = (pred: (g: Key) => boolean) => {
      const i = pool.findIndex(pred);
      return i >= 0 ? pool.splice(i, 1)[0] : null;
    };
    for (const t of unmatchedTruth) {
      if (take((g) => g.midi === t.midi && g.start === t.start && g.end === t.end && g.hand !== t.hand)) handErrors++;
      else if (take((g) => g.hand === t.hand && g.start === t.start && g.end === t.end)) pitchErrors++;
      else if (take((g) => g.hand === t.hand && g.midi === t.midi && Math.abs(g.start - t.start) < PPQ * 4)) timingErrors++;
    }
    const missing = unmatchedTruth.length - pitchErrors - timingErrors - handErrors;
    const extra = pool.length;
    const status = exact === truth.length && got.length === truth.length ? "exact" : "mismatch";
    results.push({ ...base, status, got: got.length, exact, pitchErrors, timingErrors, handErrors, missing, extra });
  }
  const mine = results.filter((r) => r.font === font);
  const count = (s: string) => mine.filter((r) => r.status === s).length;
  console.log(`${font.padEnd(16)} exact=${count("exact")} rejected=${count("rejected")} mismatch=${count("mismatch")} render-failed=${count("render-failed")}`);
}

const tot = (s: string) => results.filter((r) => r.status === s).length;
const converted = results.filter((r) => r.status === "exact" || r.status === "mismatch");
const notesTruth = converted.reduce((s, r) => s + r.truth, 0);
const notesExact = converted.reduce((s, r) => s + r.exact, 0);
console.log(`\nTOTAL cases=${results.length} exact=${tot("exact")} rejected=${tot("rejected")} mismatch(silent errors)=${tot("mismatch")} render-failed=${tot("render-failed")}`);
console.log(`note accuracy on converted scores: ${notesExact}/${notesTruth} = ${((100 * notesExact) / Math.max(1, notesTruth)).toFixed(3)}%`);
for (const r of results.filter((r) => r.status === "mismatch")) console.log(`  MISMATCH ${r.font} ${r.name}: exact ${r.exact}/${r.truth} got ${r.got} pitch=${r.pitchErrors} timing=${r.timingErrors} hand=${r.handErrors} missing=${r.missing} extra=${r.extra} [${r.features.join(", ")}]`);
for (const r of results.filter((r) => r.status === "rejected").slice(0, 30)) console.log(`  REJECTED ${r.font} ${r.name}: ${r.reason}`);
fs.writeFileSync("bench/results.json", JSON.stringify({ date: new Date().toISOString(), results }, null, 1));
