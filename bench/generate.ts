/**
 * Synthetic benchmark generator: random but well-formed piano scores written as MusicXML, together with the exact
 * list of notes they contain (the ground truth). MuseScore renders them to PDF; the converter must read them back.
 */

export interface TruthNote {
  staff: 0 | 1;
  midi: number;
  /** in quarter notes from the start of the performance */
  start: number;
  end: number;
}

export interface Case {
  name: string;
  xml: string;
  notes: TruthNote[];
  measures: number;
  features: string[];
}

class Rng {
  constructor(private s: number) {}
  next() {
    this.s = (this.s * 1664525 + 1013904223) % 4294967296;
    return this.s / 4294967296;
  }
  pick<T>(a: T[]): T {
    return a[Math.floor(this.next() * a.length)];
  }
  chance(p: number) {
    return this.next() < p;
  }
  int(a: number, b: number) {
    return a + Math.floor(this.next() * (b - a + 1));
  }
}

const DIV = 48; // divisions per quarter
const STEPS = "CDEFGAB";
const PC = [0, 2, 4, 5, 7, 9, 11];
const SHARPS = [3, 0, 4, 1, 5, 2, 6];
const FLATS = [6, 2, 5, 1, 4, 0, 3];

interface Pitch {
  step: number; // diatonic number, C4 = 28
  alter: number;
}
const midiOf = (p: Pitch) => 12 * (Math.floor(p.step / 7) + 1) + PC[p.step % 7] + p.alter;
const keyAlter = (fifths: number, step: number) =>
  fifths > 0 ? (SHARPS.slice(0, fifths).includes(step % 7) ? 1 : 0) : fifths < 0 ? (FLATS.slice(0, -fifths).includes(step % 7) ? -1 : 0) : 0;

interface Ev {
  dur: number; // in divisions (actual, after tuplet)
  written: string; // note type
  dots: number;
  tuplet?: "start" | "stop" | "mid";
  rest: boolean;
  pitches: Pitch[];
  tieStart?: boolean;
  tieStop?: boolean;
}

const TYPES: [string, number][] = [
  ["whole", 4 * DIV],
  ["half", 2 * DIV],
  ["quarter", DIV],
  ["eighth", DIV / 2],
  ["16th", DIV / 4],
];

function fillVoice(rng: Rng, total: number, beat: number, opts: { dotted: boolean; tuplets: boolean; sixteenths: boolean; restP: number }): Omit<Ev, "pitches">[] {
  const out: Omit<Ev, "pitches">[] = [];
  let t = 0;
  while (t < total) {
    const left = total - t;
    // triplet of eighths on a quarter beat (simple meters only)
    if (opts.tuplets && beat === DIV && t % DIV === 0 && left >= DIV && rng.chance(0.12)) {
      for (let i = 0; i < 3; i++)
        out.push({ dur: DIV / 3, written: "eighth", dots: 0, tuplet: i === 0 ? "start" : i === 2 ? "stop" : "mid", rest: false });
      t += DIV;
      continue;
    }
    const cands: { written: string; dots: number; dur: number }[] = [];
    for (const [w, d] of TYPES) {
      if (w === "16th" && !opts.sixteenths && left >= DIV / 2) continue;
      if (d <= left) cands.push({ written: w, dots: 0, dur: d });
      if (opts.dotted && d * 1.5 <= left && w !== "16th") cands.push({ written: w, dots: 1, dur: d * 1.5 });
    }
    // keep sixteenths and dotted values aligned so the engraving stays sensible
    const aligned = cands.filter((c) => (t % (DIV / 2) === 0 ? true : c.dur <= DIV / 2) && (c.written !== "whole" || t === 0));
    const c = rng.pick(aligned.length ? aligned : cands);
    out.push({ ...c, rest: rng.chance(opts.restP) });
    t += c.dur;
  }
  return out;
}

export function generateCase(seed: number, name: string): Case {
  const rng = new Rng(seed * 7919 + 17);
  const time = rng.pick([
    [4, 4],
    [3, 4],
    [2, 4],
    [6, 8],
    [4, 4],
    [3, 4],
  ]);
  const fifths = rng.int(-5, 5);
  const nMeasures = rng.int(10, 18);
  const measureLen = (time[0] * 4 * DIV) / time[1];
  const beat = time[1] === 8 ? DIV * 1.5 : DIV;
  const tempo = rng.pick([72, 88, 96, 108, 120, 132]);
  const twoVoiceP = rng.pick([0, 0.25, 0.4]);
  const chordP = rng.pick([0.15, 0.3, 0.45]);
  const accP = rng.pick([0.05, 0.15, 0.25]);
  const tieP = rng.pick([0, 0.1, 0.2]);
  const features = new Set<string>([`${time[0]}/${time[1]}`, `key ${fifths}`]);
  const clefChange = rng.chance(0.3);
  const useRepeat = rng.chance(0.35);
  const useVolta = useRepeat && rng.chance(0.5);

  // measures[m][staff][voice] = events
  const music: Ev[][][][] = [];
  const pendingTie: (Pitch | null)[] = [null, null];
  for (let m = 0; m < nMeasures; m++) {
    const staves: Ev[][][] = [];
    for (const staff of [0, 1] as const) {
      const lowerTreble = staff === 1 && clefChange && m >= Math.floor(nMeasures / 2) && m < Math.floor(nMeasures / 2) + 2;
      const range: [number, number] = staff === 0 ? [26, 43] : lowerTreble ? [26, 38] : [14, 30]; // A3–C7 / A1–C4 diatonic
      const voices = rng.chance(twoVoiceP) ? 2 : 1;
      const vs: Ev[][] = [];
      for (let v = 0; v < voices; v++) {
        const rhythm = fillVoice(rng, measureLen, beat, { dotted: true, tuplets: time[1] === 4, sixteenths: rng.chance(0.5), restP: voices === 2 ? 0.2 : 0.1 });
        const voiceRange: [number, number] = voices === 2 ? (v === 0 ? [Math.floor((range[0] + range[1]) / 2) + 1, range[1]] : [range[0], Math.floor((range[0] + range[1]) / 2) - 1]) : range;
        const evs: Ev[] = [];
        for (let i = 0; i < rhythm.length; i++) {
          const r = rhythm[i];
          if (r.rest) {
            evs.push({ ...r, pitches: [] });
            if (v === 0) pendingTie[staff] = null;
            continue;
          }
          let pitches: Pitch[];
          const prev = evs[evs.length - 1];
          const tieFrom = i === 0 && v === 0 ? pendingTie[staff] : prev?.tieStart && prev.pitches.length === 1 ? prev.pitches[0] : null;
          if (tieFrom) {
            pitches = [tieFrom];
          } else {
            const base = rng.int(voiceRange[0], voiceRange[1]);
            const count = r.tuplet ? 1 : rng.chance(chordP) ? rng.int(2, 3) : 1;
            const steps = new Set<number>([base]);
            for (let tries = 0; steps.size < count && tries < 12; tries++) {
              const s = base + rng.pick([2, 3, 4, 5, 7]);
              if (s <= voiceRange[1] + 2) steps.add(s);
            }
            pitches = [...steps].sort((a, b) => a - b).map((s) => ({ step: s, alter: rng.chance(accP) ? rng.pick([-1, 1, 0]) : keyAlter(fifths, s) }));
            if (pitches.some((p) => p.alter !== keyAlter(fifths, p.step))) features.add("accidentals");
          }
          const ev: Ev = { ...r, pitches, tieStop: !!tieFrom };
          if (tieFrom) features.add(i === 0 ? "ties across barlines" : "ties");
          // tie forward (single notes only, not inside tuplets)
          const canTie = pitches.length === 1 && !r.tuplet && rng.chance(tieP);
          const isLast = i === rhythm.length - 1;
          if (canTie && (!isLast || v === 0) && (!isLast || m < nMeasures - 1)) {
            const next = rhythm[i + 1];
            if (isLast || (next && !next.rest && !next.tuplet)) ev.tieStart = true;
          }
          evs.push(ev);
          if (v === 0) pendingTie[staff] = isLast && ev.tieStart ? pitches[0] : null;
          if (pitches.length > 1) features.add("chords");
          if (r.tuplet) features.add("triplets");
          if (r.dots) features.add("dotted");
        }
        if (voices === 2) features.add("two voices");
        vs.push(evs);
      }
      if (lowerTreble) features.add("clef change");
      staves.push(vs);
    }
    music.push(staves);
  }
  // a tie cannot enter a repeat boundary cleanly: drop ties into repeat/volta targets
  const repeatStart = useRepeat ? rng.int(1, Math.max(1, Math.floor(nMeasures / 3))) : -1;
  const repeatEnd = useRepeat ? Math.min(nMeasures - 2, repeatStart + rng.int(2, 4)) : -1;
  if (useRepeat) {
    features.add(useVolta ? "repeat with 1st/2nd endings" : "repeat");
    for (const staff of [0, 1])
      for (const mi of [repeatStart - 1, repeatEnd, repeatEnd - 1, repeatEnd + 1]) {
        if (mi < 0 || mi >= nMeasures) continue;
        const vs = music[mi][staff];
        const last = vs[0][vs[0].length - 1];
        if (last?.tieStart) last.tieStart = false;
        const nxt = music[mi + 1]?.[staff]?.[0]?.[0];
        if (nxt?.tieStop) nxt.tieStop = false;
      }
  }

  // ---- ground truth in playing order -----------------------------------------------------------
  const order: number[] = [];
  for (let m = 0; m < nMeasures; m++) {
    if (useVolta && m === repeatEnd + 1 && order.filter((x) => x === repeatEnd).length === 0) continue;
    order.push(m);
    if (m === repeatEnd && useRepeat && order.filter((x) => x === repeatEnd).length === 1) {
      // replay from the repeat start; with voltas the first ending is `repeatEnd`, the second `repeatEnd + 1`
      for (let k = repeatStart; k < repeatEnd; k++) order.push(k);
      if (!useVolta) order.push(repeatEnd);
    }
  }
  // with voltas: pass 1 plays repeatEnd (ending 1), pass 2 skips it and plays repeatEnd+1 (ending 2)
  const finalOrder = useVolta
    ? [...Array(repeatEnd + 1).keys(), ...Array.from({ length: repeatEnd - repeatStart }, (_, i) => repeatStart + i), ...Array.from({ length: nMeasures - repeatEnd - 1 }, (_, i) => repeatEnd + 1 + i)]
    : order;

  const notes: TruthNote[] = [];
  const open = new Map<string, TruthNote>();
  let t0 = 0;
  for (const m of finalOrder) {
    for (const staff of [0, 1] as const)
      music[m][staff].forEach((evs, v) => {
        let t = t0;
        for (const e of evs) {
          const q = e.dur / DIV;
          for (const p of e.pitches) {
            const midi = midiOf(p);
            const key = `${staff}:${v}:${midi}`;
            const prev = open.get(key);
            if (e.tieStop && prev && Math.abs(prev.end - t) < 1e-9) prev.end = t + q;
            else {
              const n = { staff, midi, start: t, end: t + q };
              notes.push(n);
              open.set(key, n);
            }
          }
          t += q;
        }
      });
    t0 += measureLen / DIV;
  }

  // ---- MusicXML --------------------------------------------------------------------------------
  const x: string[] = [];
  x.push(`<?xml version="1.0" encoding="UTF-8"?>`);
  x.push(`<!DOCTYPE score-partwise PUBLIC "-//Recordare//DTD MusicXML 4.0 Partwise//EN" "http://www.musicxml.org/dtds/partwise.dtd">`);
  x.push(`<score-partwise version="4.0"><work><work-title>${name}</work-title></work><identification><creator type="composer">Legato Bench</creator></identification>`);
  x.push(`<part-list><score-part id="P1"><part-name>Piano</part-name></score-part></part-list><part id="P1">`);
  for (let m = 0; m < nMeasures; m++) {
    x.push(`<measure number="${m + 1}">`);
    if (m === repeatStart && useRepeat) x.push(`<barline location="left"><bar-style>heavy-light</bar-style><repeat direction="forward"/></barline>`);
    if (useVolta && m === repeatEnd) x.push(`<barline location="left"><ending number="1" type="start">1.</ending></barline>`);
    if (useVolta && m === repeatEnd + 1) x.push(`<barline location="left"><ending number="2" type="start">2.</ending></barline>`);
    if (m === 0) {
      x.push(`<attributes><divisions>${DIV}</divisions><key><fifths>${fifths}</fifths></key><time><beats>${time[0]}</beats><beat-type>${time[1]}</beat-type></time><staves>2</staves>`);
      x.push(`<clef number="1"><sign>G</sign><line>2</line></clef><clef number="2"><sign>F</sign><line>4</line></clef></attributes>`);
      x.push(`<direction placement="above"><direction-type><metronome><beat-unit>quarter</beat-unit><per-minute>${tempo}</per-minute></metronome></direction-type><sound tempo="${tempo}"/></direction>`);
    }
    if (clefChange && m === Math.floor(nMeasures / 2)) x.push(`<attributes><clef number="2"><sign>G</sign><line>2</line></clef></attributes>`);
    if (clefChange && m === Math.floor(nMeasures / 2) + 2) x.push(`<attributes><clef number="2"><sign>F</sign><line>4</line></clef></attributes>`);
    let first = true;
    for (const staff of [0, 1] as const)
      music[m][staff].forEach((evs, v) => {
        if (!first) x.push(`<backup><duration>${measureLen}</duration></backup>`);
        first = false;
        const voice = staff * 4 + v + 1;
        for (const e of evs) {
          const stem = music[m][staff].length === 2 ? `<stem>${v === 0 ? "up" : "down"}</stem>` : "";
          const tm = e.tuplet ? `<time-modification><actual-notes>3</actual-notes><normal-notes>2</normal-notes></time-modification>` : "";
          const tupletNot = e.tuplet === "start" ? `<tuplet type="start" bracket="no"/>` : e.tuplet === "stop" ? `<tuplet type="stop"/>` : "";
          const dots = "<dot/>".repeat(e.dots);
          if (e.rest) {
            x.push(`<note><rest/><duration>${e.dur}</duration><voice>${voice}</voice><type>${e.written}</type>${dots}${tm}<staff>${staff + 1}</staff>${tupletNot ? `<notations>${tupletNot}</notations>` : ""}</note>`);
            continue;
          }
          e.pitches.forEach((p, i) => {
            const tie = (e.tieStop ? `<tie type="stop"/>` : "") + (e.tieStart ? `<tie type="start"/>` : "");
            const tied = (e.tieStop ? `<tied type="stop"/>` : "") + (e.tieStart ? `<tied type="start"/>` : "");
            const notations = tied || (i === 0 && tupletNot) ? `<notations>${tied}${i === 0 ? tupletNot : ""}</notations>` : "";
            x.push(
              `<note>${i > 0 ? "<chord/>" : ""}<pitch><step>${STEPS[p.step % 7]}</step>${p.alter ? `<alter>${p.alter}</alter>` : ""}<octave>${Math.floor(p.step / 7)}</octave></pitch><duration>${e.dur}</duration>${tie}<voice>${voice}</voice><type>${e.written}</type>${dots}${tm}${stem}<staff>${staff + 1}</staff>${notations}</note>`,
            );
          });
        }
      });
    if (useVolta && m === repeatEnd) x.push(`<barline location="right"><bar-style>light-heavy</bar-style><ending number="1" type="stop"/><repeat direction="backward"/></barline>`);
    else if (useRepeat && m === repeatEnd) x.push(`<barline location="right"><bar-style>light-heavy</bar-style><repeat direction="backward"/></barline>`);
    if (useVolta && m === repeatEnd + 1) x.push(`<barline location="right"><ending number="2" type="discontinue"/></barline>`);
    if (m === nMeasures - 1) x.push(`<barline location="right"><bar-style>light-heavy</bar-style></barline>`);
    x.push(`</measure>`);
  }
  x.push(`</part></score-partwise>`);
  return { name, xml: x.join("\n"), notes, measures: nMeasures, features: [...features] };
}
