import type { DocumentLayout } from "../layout/document";
import type { GrandSystem, PageLayout } from "../layout/types";
import { solveMeasure, type TimedEvent } from "../recognize/rhythm";
import { readSystemSymbols } from "../recognize/symbols";
import { applyTuplets } from "../recognize/tuplets";
import type { Chord, ClefType, Frac, Head, Rest, StaffIndex, SystemSymbols, TupletMark } from "../recognize/types";
import { add, frac } from "../util/frac";
import type { MeasureModel, NoteEvent } from "./types";

const BOTTOM_LINE_STEP: Record<ClefType, number> = { G: 30, G8vb: 23, G8va: 37, F: 18, F8vb: 11, C: 24, tenorC: 22 };
const SHARP_ORDER = [3, 0, 4, 1, 5, 2, 6];
const FLAT_ORDER = [6, 2, 5, 1, 4, 0, 3];
const PC = [0, 2, 4, 5, 7, 9, 11];
const ALTER: Record<NonNullable<Head["accidental"]>, number> = { sharp: 1, flat: -1, natural: 0, dsharp: 2, dflat: -2 };

export const midiOf = (step: number, alter: number) => 12 * (Math.floor(step / 7) + 1) + PC[((step % 7) + 7) % 7] + alter;

function keyAlter(fifths: number, step: number): number {
  const letter = ((step % 7) + 7) % 7;
  if (fifths > 0) return SHARP_ORDER.slice(0, fifths).includes(letter) ? 1 : 0;
  if (fifths < 0) return FLAT_ORDER.slice(0, -fifths).includes(letter) ? -1 : 0;
  return 0;
}

const val = (f: Frac) => f.n / f.d;

export interface SystemRecord {
  page: PageLayout;
  sys: GrandSystem;
  sy: SystemSymbols;
  measures: MeasureModel[];
}

export interface BuildResult {
  measures: MeasureModel[];
  systems: SystemRecord[];
  notes: NoteEvent[];
  /** global start of each measure in quarter notes */
  measureStart: Frac[];
  documentProblems: string[];
}

interface HeadInfo {
  head: Head;
  chord: Chord;
  measure: MeasureModel;
  onset: Frac;
  duration: Frac;
  step: number;
  note?: NoteEvent;
}

export function buildMeasures(layout: DocumentLayout): BuildResult {
  const measures: MeasureModel[] = [];
  const systems: SystemRecord[] = [];
  const documentProblems: string[] = [];
  let time: { num: number; den: number } | null = null;
  const keyState: [number, number] = [0, 0];
  const clefState: [ClefType, ClefType] = ["G", "F"];
  const headInfos: HeadInfo[] = [];
  const graceInfos: { chord: Chord; measure: MeasureModel; system: SystemRecord }[] = [];

  const pendingDigits: { page: number; t: TupletMark; sy: SystemSymbols }[] = [];
  const usedDigits = new Set<string>();
  for (const page of layout.pages) {
    for (const sys of page.systems) {
      const sy = readSystemSymbols(page, sys);
      const loose = applyTuplets(sy);
      // A tuplet number may be seen by two neighbouring systems; it only matters if no system could use it.
      for (const t of loose) pendingDigits.push({ page: page.page, t, sy });
      for (const t of sy.tuplets) if (!loose.includes(t)) usedDigits.add(`${page.page}:${t.x.toFixed(1)}:${t.y.toFixed(1)}`);
      const rec: SystemRecord = { page, sys, sy, measures: [] };
      systems.push(rec);
      const sp = sys.upper.sp;

      let stubStart: MeasureModel["startBar"] | null = null;
      for (let i = 0; i + 1 < sys.bars.length; i++) {
        const left = sys.bars[i];
        const right = sys.bars[i + 1];
        const xa = i === 0 ? sys.x0 : left.x1;
        const xb = right.x0;
        const ts = sy.times.find((t) => t.x > xa - 0.5 && t.x < xb);
        if (ts) time = { num: ts.num, den: ts.den };
        const inside = (x: number) => x > xa && x < xb;
        const chords = sy.chords.filter((c) => inside(c.anchor));
        const rests = sy.rests.filter((r) => inside(r.anchor));
        const measureRests = [...new Set(rests.filter((r) => r.measureRest).map((r) => r.staff))];
        // A repeat barline right after the clef/key signature creates an empty stub at the system start.
        if (i === 0 && !chords.length && !rests.length && sys.bars.length > 2 && xb - xa < 16 * sp) {
          stubStart = right.style;
          continue;
        }
        const expected = time ? frac(time.num * 4, time.den) : frac(4);
        const m: MeasureModel = {
          index: measures.length,
          page: page.page,
          system: systems.length - 1,
          x0: xa,
          x1: xb,
          time: time ?? { num: 4, den: 4 },
          expected,
          length: expected,
          startBar: i === 1 && stubStart ? stubStart : left.style,
          endBar: right.style,
          keyFifths: [...keyState],
          notes: [],
          restCount: rests.length,
          ok: true,
          problems: [],
          warnings: [],
          measureRests,
        };
        if (!time) m.problems.push("No time signature before this measure");
        if (!chords.length && !rests.length) m.problems.push("Empty measure (no notes or rests)");
        for (const p of sy.problems) {
          if (p.x < xa - 0.2 || p.x >= xb) continue;
          (p.severity === "error" ? m.problems : m.warnings).push(p.message);
        }
        const events: TimedEvent[] = [
          ...chords.map((c) => ({ kind: "chord" as const, ev: c })),
          ...rests.filter((r) => !r.measureRest).map((r) => ({ kind: "rest" as const, ev: r })),
        ];
        const restStaves = new Set<StaffIndex>(measureRests);
        const opts = { colTol: 0.3 * sp, mergeTol: 2.8 * sp, restTol: 0.6 * sp, allowShort: false, restStaves };
        let timing = solveMeasure(events, expected, opts);
        if ("reason" in timing) {
          const short = solveMeasure(events, expected, { ...opts, allowShort: true });
          if (!("reason" in short)) timing = short;
        }
        if ("reason" in timing) {
          m.problems.push(timing.reason);
        } else {
          m.length = events.length ? timing.length : expected;
          if (timing.merges) m.warnings.push(`${timing.merges} voice collision(s) resolved`);
          for (const c of chords) {
            const onset = timing.onsets.get(c.id)!;
            const duration = durationOf(c);
            for (const h of c.heads) headInfos.push({ head: h, chord: c, measure: m, onset, duration, step: 0 });
          }
        }
        for (const g of sy.graceChords) if (inside(g.anchor)) graceInfos.push({ chord: g, measure: m, system: rec });
        m.ok = m.problems.length === 0;
        measures.push(m);
        rec.measures.push(m);
      }

      // Track clef/key state across systems (each system restates them, but keep a fallback).
      for (const s of [0, 1] as StaffIndex[]) {
        const lastClef = sy.clefs.filter((c) => c.staff === s).sort((a, b) => b.x - a.x)[0];
        if (lastClef) clefState[s] = lastClef.clef;
        const lastKey = sy.keys.filter((k) => k.staff === s).sort((a, b) => b.x - a.x)[0];
        if (lastKey) keyState[s] = lastKey.fifths;
      }
      // Key changes inside the system update the measures that follow them.
      for (const m of rec.measures)
        for (const s of [0, 1] as StaffIndex[]) {
          const k = sy.keys.filter((k) => k.staff === s && k.x < m.x1).sort((a, b) => b.x - a.x)[0];
          if (k) m.keyFifths[s] = k.fifths;
        }
    }
  }

  // A tuplet number nobody could attach means some tuplet was not understood: never guess past it.
  for (const { page, t, sy } of pendingDigits) {
    if (usedDigits.has(`${page}:${t.x.toFixed(1)}:${t.y.toFixed(1)}`)) continue;
    const rec = systems.find((r) => r.sy === sy)!;
    const m = rec.measures.find((m) => t.x >= m.x0 && t.x < m.x1) ?? rec.measures[rec.measures.length - 1];
    if (!m) continue;
    m.problems.push(`Tuplet number ${t.n} could not be matched to its notes`);
    m.ok = false;
  }

  // Short measures are only legitimate at the start (pickup), the end, or around repeats.
  measures.forEach((m, i) => {
    if (!m.ok || val(m.length) >= val(m.expected)) return;
    const nearRepeat = m.startBar.startsWith("repeat") || m.endBar.startsWith("repeat") || m.endBar === "double" || m.startBar === "double";
    if (i === 0 || i === measures.length - 1 || nearRepeat) m.warnings.push("Short measure (pickup or split measure)");
    else {
      m.problems.push(`Measure adds up to ${m.length.n}/${m.length.d} instead of ${m.expected.n}/${m.expected.d} quarter notes`);
      m.ok = false;
    }
  });

  const measureStart: Frac[] = [];
  let acc = frac(0);
  for (const m of measures) {
    measureStart.push(acc);
    acc = add(acc, m.length);
  }

  // ---- pitches (steps first; ties need them, alterations need ties) -------------------------------
  const infosBySystem = new Map<SystemRecord, HeadInfo[]>();
  for (const info of headInfos) {
    const rec = systems[info.measure.system];
    if (!infosBySystem.has(rec)) infosBySystem.set(rec, []);
    infosBySystem.get(rec)!.push(info);
  }
  const clefFor = (rec: SystemRecord, staff: StaffIndex, x: number, fallback: ClefType): ClefType => {
    const c = rec.sy.clefs.filter((c) => c.staff === staff && c.x < x).sort((a, b) => b.x - a.x)[0];
    return c?.clef ?? fallback;
  };
  let clefCarry: [ClefType, ClefType] = ["G", "F"];
  for (const rec of systems) {
    for (const info of infosBySystem.get(rec) ?? []) {
      const clef = clefFor(rec, info.head.staff, info.head.x, clefCarry[info.head.staff]);
      info.step = BOTTOM_LINE_STEP[clef] + info.head.pos;
    }
    for (const s of [0, 1] as StaffIndex[]) clefCarry[s] = clefFor(rec, s, Infinity, clefCarry[s]);
  }

  const globalOnset = (i: HeadInfo) => add(measureStart[i.measure.index], i.onset);
  const tiePrev = new Map<HeadInfo, HeadInfo>();
  const tieNext = new Map<HeadInfo, HeadInfo>();
  let pendingOpen: HeadInfo[] = [];
  for (const rec of systems) {
    const infos = infosBySystem.get(rec) ?? [];
    const sp = rec.sys.upper.sp;
    const firstEventX = Math.min(...infos.map((i) => i.head.x), Infinity);
    const lastBar = rec.sys.bars[rec.sys.bars.length - 1];
    const newOpen: HeadInfo[] = [];
    for (const c of rec.sy.curves) {
      const w = (h: Head) => h.xr - h.x;
      const lefts = infos.filter((i) => c.left[0] >= i.head.x + 0.2 * w(i.head) && c.left[0] <= i.head.xr + 1.6 * sp && Math.abs(c.left[1] - i.head.y) < 1.3 * sp);
      const rights = infos.filter((i) => c.right[0] >= i.head.x - 1.6 * sp && c.right[0] <= i.head.x + 0.8 * w(i.head) && Math.abs(c.right[1] - i.head.y) < 1.3 * sp);
      let best: [HeadInfo, HeadInfo] | null = null;
      let bestScore = Infinity;
      for (const L of lefts)
        for (const R of rights) {
          if (L === R || L.head.staff !== R.head.staff || L.step !== R.step) continue;
          if (val(globalOnset(R)) !== val(add(globalOnset(L), L.duration))) continue;
          if (tieNext.has(L) || tiePrev.has(R)) continue;
          const score = Math.abs(c.left[1] - L.head.y) + Math.abs(c.right[1] - R.head.y);
          if (score < bestScore) {
            best = [L, R];
            bestScore = score;
          }
        }
      if (best) {
        tieNext.set(best[0], best[1]);
        tiePrev.set(best[1], best[0]);
        continue;
      }
      // tie leaving the system to the right
      if (c.right[0] > lastBar.x0 - 0.5 * sp && c.width < 12 * sp) {
        const L = lefts.filter((l) => !tieNext.has(l)).sort((a, b) => Math.abs(c.left[1] - a.head.y) - Math.abs(c.left[1] - b.head.y))[0];
        if (L && Math.abs(c.left[1] - L.head.y) < 1.1 * sp) newOpen.push(L);
        continue;
      }
      // tie arriving from the previous system
      if (c.left[0] < firstEventX - 0.2 * sp) {
        const R = rights.filter((r) => !tiePrev.has(r)).sort((a, b) => Math.abs(c.right[1] - a.head.y) - Math.abs(c.right[1] - b.head.y))[0];
        if (!R) continue;
        const L = pendingOpen.find((o) => o.head.staff === R.head.staff && o.step === R.step && val(add(globalOnset(o), o.duration)) === val(globalOnset(R)));
        if (L) {
          tieNext.set(L, R);
          tiePrev.set(R, L);
          pendingOpen = pendingOpen.filter((o) => o !== L);
        }
      }
    }
    pendingOpen = newOpen;
  }

  // ---- alterations ------------------------------------------------------------------------------
  const notes: NoteEvent[] = [];
  const byMeasure = new Map<MeasureModel, HeadInfo[]>();
  for (const i of headInfos) {
    if (!byMeasure.has(i.measure)) byMeasure.set(i.measure, []);
    byMeasure.get(i.measure)!.push(i);
  }
  for (const m of measures) {
    const infos = (byMeasure.get(m) ?? []).sort((a, b) => a.head.x - b.head.x);
    const memory: [Map<number, number>, Map<number, number>] = [new Map(), new Map()];
    // grace note accidentals also count for the rest of the measure
    const graces = graceInfos.filter((g) => g.measure === m);
    const graceHeads = graces.flatMap((g) => g.chord.heads.map((h) => ({ h, g })));
    const ordered: ({ t: "n"; i: HeadInfo } | { t: "g"; h: Head; g: (typeof graceInfos)[number] })[] = [
      ...infos.map((i) => ({ t: "n" as const, i })),
      ...graceHeads.map(({ h, g }) => ({ t: "g" as const, h, g })),
    ].sort((a, b) => (a.t === "n" ? a.i.head.x : a.h.x) - (b.t === "n" ? b.i.head.x : b.h.x));
    for (const o of ordered) {
      if (o.t === "g") continue; // handled below with their principal note
      const i = o.i;
      const s = i.head.staff;
      const prev = tiePrev.get(i);
      let alter: number;
      if (prev?.note) {
        alter = prev.note.alter;
      } else if (i.head.accidental) {
        alter = ALTER[i.head.accidental];
        memory[s].set(i.step, alter);
      } else if (memory[s].has(i.step)) alter = memory[s].get(i.step)!;
      else alter = keyAlter(m.keyFifths[s], i.step);
      const note: NoteEvent = {
        id: i.head.id,
        staff: s,
        step: i.step,
        alter,
        midi: midiOf(i.step, alter),
        measure: m.index,
        onset: i.onset,
        duration: i.duration,
        voice: i.chord.dir,
        grace: false,
        hand: s === 0 ? "R" : "L",
        handSource: "staff",
        page: m.page,
        x: i.head.x,
        y: i.head.y,
        chordId: i.chord.id,
      };
      if (prev?.note) {
        note.tiePrev = prev.note.id;
        prev.note.tieNext = note.id;
      }
      i.note = note;
      notes.push(note);
      m.notes.push(note);
    }
  }
  // Tie continuations are resolved in score order, so a later pass fixes ties that crossed measures backwards.
  for (const [R, L] of tiePrev) {
    if (L.note && R.note && R.note.midi !== L.note.midi) {
      R.note.alter = L.note.alter;
      R.note.midi = L.note.midi;
    }
  }

  // ---- grace notes ------------------------------------------------------------------------------
  for (const { chord, measure, system } of graceInfos) {
    const rec = system;
    // principal: next chord in the same staff to the right
    const principal = rec.sy.chords
      .filter((c) => c.staff === chord.staff && c.anchor > chord.anchor)
      .sort((a, b) => a.anchor - b.anchor)[0];
    const principalInfo = principal && headInfos.find((i) => i.chord === principal);
    if (!principalInfo) {
      measure.warnings.push("Grace note without a following note was skipped");
      continue;
    }
    const siblings = graceInfos.filter((g) => g.system === rec && g.chord.staff === chord.staff && g.chord.anchor > chord.anchor && g.chord.anchor < principal.anchor);
    const k = siblings.length + 1; // position counted back from the principal note
    const pm = principalInfo.measure;
    for (const h of chord.heads) {
      const clef = clefFor(rec, h.staff, h.x, "G");
      const step = BOTTOM_LINE_STEP[clef] + h.pos;
      const alter = h.accidental ? ALTER[h.accidental] : keyAlter(pm.keyFifths[h.staff], step);
      const note: NoteEvent = {
        id: h.id,
        staff: h.staff,
        step,
        alter,
        midi: midiOf(step, alter),
        measure: pm.index,
        onset: add(principalInfo.onset, frac(-k, 8)),
        duration: frac(1, 8),
        voice: chord.dir,
        grace: true,
        hand: h.staff === 0 ? "R" : "L",
        handSource: "staff",
        page: pm.page,
        x: h.x,
        y: h.y,
        chordId: chord.id,
      };
      notes.push(note);
      pm.notes.push(note);
    }
  }

  if (!measures.length) documentProblems.push("No grand-staff piano systems were found.");
  return { measures, systems, notes, measureStart, documentProblems };
}

function durationOf(c: Chord | Rest): Frac {
  const t = c.tuplet;
  return t ? frac(c.base.n * t.num, c.base.d * t.den) : c.base;
}
