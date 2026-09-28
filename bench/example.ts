/**
 * Writes the MusicXML of "Estudo em Lá menor", an original short piece used as the app's built-in example.
 * Render: mscore -o public/exemplo.pdf bench/tmp/exemplo.musicxml
 */
import fs from "node:fs";

const DIV = 12;
type N = { p?: string; d: number; tie?: "start" | "stop" | "both"; tri?: "start" | "mid" | "stop"; dot?: boolean; type: string };
const q = (p: string, extra: Partial<N> = {}): N => ({ p, d: DIV, type: "quarter", ...extra });
const e = (p: string, extra: Partial<N> = {}): N => ({ p, d: DIV / 2, type: "eighth", ...extra });
const h = (p: string, extra: Partial<N> = {}): N => ({ p, d: DIV * 2, type: "half", ...extra });
const hd = (p: string, extra: Partial<N> = {}): N => ({ p, d: DIV * 3, type: "half", dot: true, ...extra });
const w = (p: string, extra: Partial<N> = {}): N => ({ p, d: DIV * 4, type: "whole", ...extra });
const t3 = (a: string, b: string, c: string): N[] => [
  { p: a, d: DIV / 3, type: "eighth", tri: "start" },
  { p: b, d: DIV / 3, type: "eighth", tri: "mid" },
  { p: c, d: DIV / 3, type: "eighth", tri: "stop" },
];
const r = (d: number, type: string): N => ({ d, type });

// right hand, one array per measure
const RH: N[][] = [
  [q("E5"), e("D5"), e("C5"), q("B4"), q("C5")],
  [hd("A4"), q("C5")],
  [q("G4"), q("E5"), e("D5"), e("C5"), q("D5")],
  [h("B4", { tie: "start" }), h("B4", { tie: "stop" })],
  [q("E5"), e("D5"), e("C5"), q("B4"), q("A4")],
  [q("F5"), ...t3("E5", "D5", "C5"), h("D5")],
  [q("B4"), q("G#4"), q("B4"), q("D5")],
  [h("C5", { tie: "start" }), q("C5", { tie: "stop" }), r(DIV, "quarter")],
  [q("A5"), q("G5"), q("F5"), q("E5")],
  [h("D5"), h("B4")],
  [q("E5"), q("C5"), h("A4")],
  [w("G#4")],
  [q("A4"), q("C5"), q("E5"), q("A5")],
  [h("F5"), q("E5"), q("D5")],
  [h("B4"), h("G#4")],
  [w("A4")],
];

const CHORDS: [string, string, string][] = [
  ["A2", "E3", "C4"],
  ["F2", "C3", "A3"],
  ["C3", "G3", "E4"],
  ["G2", "D3", "B3"],
  ["A2", "E3", "C4"],
  ["D2", "A2", "F3"],
  ["E2", "B2", "G#3"],
  ["A2", "E3", "C4"],
  ["F2", "C3", "A3"],
  ["G2", "D3", "B3"],
  ["A2", "E3", "C4"],
  ["E2", "B2", "G#3"],
  ["A2", "E3", "C4"],
  ["D2", "A2", "F3"],
  ["E2", "B2", "G#3"],
];
const LH: N[][] = CHORDS.map(([root, fifth, third]) => {
  const up = (p: string) => p.replace(/\d$/, (o) => String(Number(o) + 1));
  return [root, fifth, up(root), third, up(fifth), third, up(root), fifth].map((p) => e(p));
});
LH.push([{ p: "A2", d: DIV * 4, type: "whole" }]);

function pitch(p: string) {
  const m = /^([A-G])(#|b)?(\d)$/.exec(p)!;
  const alter = m[2] === "#" ? 1 : m[2] === "b" ? -1 : 0;
  return `<pitch><step>${m[1]}</step>${alter ? `<alter>${alter}</alter>` : ""}<octave>${m[3]}</octave></pitch>`;
}

function note(n: N, staff: number, voice: number, chord = false): string {
  if (!n.p) return `<note><rest/><duration>${n.d}</duration><voice>${voice}</voice><type>${n.type}</type><staff>${staff}</staff></note>`;
  const ties = n.tie === "start" ? `<tie type="start"/>` : n.tie === "stop" ? `<tie type="stop"/>` : "";
  const tied = n.tie === "start" ? `<tied type="start"/>` : n.tie === "stop" ? `<tied type="stop"/>` : "";
  const tm = n.tri ? `<time-modification><actual-notes>3</actual-notes><normal-notes>2</normal-notes></time-modification>` : "";
  const tup = n.tri === "start" ? `<tuplet type="start" bracket="no"/>` : n.tri === "stop" ? `<tuplet type="stop"/>` : "";
  const acc = n.p.includes("#") ? "<accidental>sharp</accidental>" : "";
  const notations = tied || tup ? `<notations>${tied}${tup}</notations>` : "";
  return `<note>${chord ? "<chord/>" : ""}${pitch(n.p)}<duration>${n.d}</duration>${ties}<voice>${voice}</voice><type>${n.type}</type>${n.dot ? "<dot/>" : ""}${acc}${tm}<staff>${staff}</staff>${notations}</note>`;
}

const dyn = (d: string, staff = 1) => `<direction placement="below"><direction-type><dynamics><${d}/></dynamics></direction-type><staff>${staff}</staff></direction>`;
const words = (t: string) => `<direction placement="above"><direction-type><words font-style="italic">${t}</words></direction-type><staff>1</staff></direction>`;

const out: string[] = [
  `<?xml version="1.0" encoding="UTF-8"?>`,
  `<!DOCTYPE score-partwise PUBLIC "-//Recordare//DTD MusicXML 4.0 Partwise//EN" "http://www.musicxml.org/dtds/partwise.dtd">`,
  `<score-partwise version="4.0"><work><work-title>Estudo em Lá menor</work-title></work><identification><creator type="composer">Legato (exemplo)</creator></identification>`,
  `<part-list><score-part id="P1"><part-name>Piano</part-name></score-part></part-list><part id="P1">`,
];
for (let m = 0; m < 16; m++) {
  out.push(`<measure number="${m + 1}">`);
  if (m === 0) {
    out.push(`<attributes><divisions>${DIV}</divisions><key><fifths>0</fifths><mode>minor</mode></key><time><beats>4</beats><beat-type>4</beat-type></time><staves>2</staves><clef number="1"><sign>G</sign><line>2</line></clef><clef number="2"><sign>F</sign><line>4</line></clef></attributes>`);
    out.push(`<direction placement="above"><direction-type><metronome><beat-unit>quarter</beat-unit><per-minute>84</per-minute></metronome></direction-type><sound tempo="84"/></direction>`);
    out.push(dyn("mp"));
  }
  if (m === 8) {
    out.push(`<barline location="left"><bar-style>heavy-light</bar-style><repeat direction="forward"/></barline>`);
    out.push(dyn("mf"));
  }
  if (m === 12) out.push(dyn("p"));
  if (m === 14) out.push(words("rit."));
  for (const n of RH[m]) out.push(note(n, 1, 1));
  out.push(`<backup><duration>${DIV * 4}</duration></backup>`);
  for (const n of LH[m]) out.push(note(n, 2, 5));
  if (m === 15) out.push(note({ p: "E3", d: DIV * 4, type: "whole" }, 2, 5, true));
  if (m === 11) out.push(`<barline location="right"><bar-style>light-heavy</bar-style><repeat direction="backward"/></barline>`);
  if (m === 15) out.push(`<barline location="right"><bar-style>light-heavy</bar-style></barline>`);
  out.push(`</measure>`);
}
out.push(`</part></score-partwise>`);
fs.mkdirSync("bench/tmp", { recursive: true });
fs.writeFileSync("bench/tmp/exemplo.musicxml", out.join("\n"));
console.log("ok");
