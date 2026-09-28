import type { ExpressionMarks } from "../recognize/expression";
import type { Direction, Hand, MeasureModel, NoteEvent } from "../score/types";
import { PPQ, toTicks } from "../util/frac";

export interface PerformedNote {
  midi: number;
  hand: Hand;
  start: number; // ticks
  end: number; // ticks
  velocity: number;
  measure: number; // score measure index
  grace: boolean;
  sourceId: number;
}

export interface TempoPoint {
  tick: number;
  bpm: number; // quarter notes per minute
}

export interface TimeSigPoint {
  tick: number;
  num: number;
  den: number;
}

export interface Timeline {
  notes: PerformedNote[];
  tempos: TempoPoint[];
  timeSigs: TimeSigPoint[];
  /** sustain pedal changes (CC64) */
  pedal: { tick: number; down: boolean }[];
  /** tick where each performed measure starts */
  measureTicks: { measure: number; tick: number }[];
  totalTicks: number;
  baseTempo: number;
  tempoEstimated: boolean;
  tempoText: string;
}

export interface TimelineOptions {
  /** add performance rules on top of what is written (voicing, phrasing, articulation lengths, pedal) */
  expressive: boolean;
  marks: ExpressionMarks;
  /** score time (quarter notes, written order) at which each measure starts */
  measureStart: number[];
}

const LEVEL: Record<string, number> = { ppp: 30, pp: 40, p: 52, mp: 64, mf: 76, f: 90, ff: 102, fff: 114, sfz: 104, sf: 100, fz: 100, rfz: 96, fp: 88, sfp: 100 };
const val = (f: { n: number; d: number }) => f.n / f.d;
const clamp = (v: number, a: number, b: number) => Math.max(a, Math.min(b, v));

interface Segment {
  t: number;
  v: number;
  /** linear ramp towards `to` until `until` (hairpins) */
  to?: number;
  until?: number;
}

/** Loudness through the score in written time: dynamic marks, with hairpins as ramps towards the next mark. */
function dynamicCurve(marks: ExpressionMarks): (t: number) => number {
  const events: ({ t: number; kind: "dyn"; v: number } | { t: number; kind: "hair"; end: number; up: boolean })[] = [
    ...marks.dynamics.filter((d) => LEVEL[d.value] !== undefined).map((d) => ({ t: d.time, kind: "dyn" as const, v: LEVEL[d.value] })),
    ...marks.hairpins.map((h) => ({ t: h.start, kind: "hair" as const, end: h.end, up: h.kind === "cresc" })),
  ].sort((a, b) => a.t - b.t || (a.kind === "dyn" ? -1 : 1));
  const segs: Segment[] = [{ t: -Infinity, v: 76 }];
  let cur = 76;
  for (const e of events) {
    if (e.kind === "dyn") {
      cur = e.v;
      segs.push({ t: e.t, v: cur });
      continue;
    }
    // aim at the dynamic printed at (or just after) the end of the hairpin, else one step up/down
    const target = marks.dynamics.find((d) => d.time >= e.end - 0.51 && d.time <= e.end + 2 && LEVEL[d.value] !== undefined);
    const to = target ? LEVEL[target.value] : clamp(cur + (e.up ? 14 : -14), 28, 116);
    segs.push({ t: e.t, v: cur, to, until: e.end });
    cur = to;
    if (!target) segs.push({ t: e.end, v: cur });
  }
  segs.sort((a, b) => a.t - b.t);
  return (t: number) => {
    let s = segs[0];
    for (const x of segs) {
      if (x.t <= t + 1e-6) s = x;
      else break;
    }
    if (s.to !== undefined && s.until !== undefined && t < s.until) return s.v + ((s.to - s.v) * (t - s.t)) / (s.until - s.t || 1);
    return s.to !== undefined ? s.to : s.v;
  };
}

export function buildTimeline(measures: MeasureModel[], order: number[], directions: Direction[], opts: TimelineOptions): Timeline {
  const { marks, expressive, measureStart } = opts;

  // ---- base tempo ------------------------------------------------------------------------------
  const tempoMarks = directions.filter((d) => d.kind === "tempo").sort((a, b) => a.measure + a.at - (b.measure + b.at));
  const tempoTexts = directions.filter((d) => d.kind === "tempoText").sort((a, b) => a.measure + a.at - (b.measure + b.at));
  const first = tempoMarks[0];
  let baseTempo = first ? first.bpm! * (first.unit ?? 1) : tempoTexts[0]?.bpm ?? 100;
  const tempoEstimated = !first;
  const tempoText = first ? first.value ?? `♩ = ${first.bpm}` : tempoTexts[0]?.value ?? "";
  if (!first && measures[0] && measures[0].time.den === 8 && measures[0].time.num % 3 === 0) baseTempo = Math.round(baseTempo * 1.5);

  const level = dynamicCurve(marks);
  const notes: PerformedNote[] = [];
  const measureTicks: { measure: number; tick: number }[] = [];
  const timeSigs: TimeSigPoint[] = [];
  const tempos: TempoPoint[] = [{ tick: 0, bpm: baseTempo }];
  /** tempo multipliers over tick spans (fermatas, phrase breaths), applied on top of the tempo marks */
  const factors: { from: number; to: number; f: number }[] = [];
  let tick = 0;
  let lastSig = "";

  // ---- expressive helpers ----------------------------------------------------------------------
  const inSlur = (staff: 0 | 1, t: number) => marks.slurs.find((s) => s.staff === staff && t >= s.start - 1e-6 && t < s.end - 1e-6);
  // melodic contour: compare each right-hand top note with its neighbours
  const melody = new Map<number, number>();
  if (expressive) {
    const tops = new Map<string, NoteEvent>();
    for (const m of measures)
      for (const n of m.notes) {
        if (n.hand !== "R" || n.grace) continue;
        const key = `${m.index}:${n.onset.n}/${n.onset.d}`;
        const cur = tops.get(key);
        if (!cur || n.midi > cur.midi) tops.set(key, n);
      }
    const seq = [...tops.values()];
    seq.forEach((n, i) => {
      const win = seq.slice(Math.max(0, i - 4), i + 5);
      const avg = win.reduce((s, x) => s + x.midi, 0) / win.length;
      melody.set(n.id, clamp((n.midi - avg) * 0.5, -4, 4));
    });
  }

  const openTies = new Map<number, PerformedNote>();
  let currentBase = baseTempo;
  const occurrences: { m: MeasureModel; tick: number; len: number }[] = [];
  for (let k = 0; k < order.length; k++) {
    const m = measures[order[k]];
    measureTicks.push({ measure: m.index, tick });
    const sig = `${m.time.num}/${m.time.den}`;
    if (sig !== lastSig) {
      timeSigs.push({ tick, num: m.time.num, den: m.time.den });
      lastSig = sig;
    }
    const mTicks = toTicks(m.length)!;
    occurrences.push({ m, tick, len: mTicks });
    const within = (at: number) => tick + Math.round(at * mTicks);

    // tempo directions in this measure
    const here = directions.filter((d) => d.measure === m.index).sort((a, b) => a.at - b.at);
    for (const d of here) {
      if (d.kind === "tempo" && d !== first) {
        currentBase = d.bpm! * (d.unit ?? 1);
        tempos.push({ tick: within(d.at), bpm: currentBase });
      } else if (d.kind === "aTempo") {
        tempos.push({ tick: within(d.at), bpm: currentBase });
      } else if (d.kind === "rit") {
        // slow down to 75% over the rest of this measure and the next one (or until a tempo mark)
        const startTick = within(d.at);
        const nextM = order[k + 1] !== undefined ? measures[order[k + 1]] : null;
        const nextHasTempo = nextM && directions.some((x) => x.measure === nextM.index && (x.kind === "aTempo" || x.kind === "tempo") && x.at < 0.2);
        const endTick = tick + mTicks + (nextM && !nextHasTempo ? toTicks(nextM.length)! : 0);
        const steps = Math.max(2, Math.round((endTick - startTick) / (PPQ / 2)));
        for (let s = 0; s <= steps; s++) {
          const f = s / steps;
          tempos.push({ tick: Math.round(startTick + f * (endTick - startTick)), bpm: currentBase * (1 - 0.25 * f) });
        }
        tempos.push({ tick: endTick, bpm: currentBase * 0.75 });
      }
    }

    // metric grid of this measure
    const beat = m.time.den === 8 && m.time.num % 3 === 0 ? 1.5 : 4 / m.time.den;
    const chords = new Map<string, NoteEvent[]>();
    for (const n of m.notes) {
      const key = `${n.hand}:${n.onset.n}/${n.onset.d}`;
      if (!chords.has(key)) chords.set(key, []);
      chords.get(key)!.push(n);
    }

    for (const n of m.notes) {
      const onset = toTicks(n.onset);
      const dur = toTicks(n.duration);
      if (onset === null || dur === null) continue;
      const start = tick + onset;
      const scoreT = measureStart[m.index] + val(n.onset);
      let velocity = level(scoreT);
      let lengthFactor = 1;

      if (expressive && !n.grace) {
        // metric weight: downbeat, beats, off-beats
        const pos = val(n.onset) / beat;
        velocity += val(n.onset) === 0 ? 4 : Math.abs(pos - Math.round(pos)) < 1e-6 ? 1.5 : -1.5;
        // voicing: the melody (top of the right hand) sings, inner notes and accompaniment step back
        const group = chords.get(`${n.hand}:${n.onset.n}/${n.onset.d}`)!;
        const top = Math.max(...group.map((g) => g.midi));
        const bottom = Math.min(...group.map((g) => g.midi));
        if (n.hand === "R") velocity += n.midi === top ? 6 : -4;
        else velocity += n.midi === bottom ? 1 : -6;
        velocity += melody.get(n.id) ?? 0;
        // phrase arch under a slur, legato inside it
        const slur = inSlur(n.staff, scoreT);
        if (slur) {
          const p = (scoreT - slur.start) / (slur.end - slur.start || 1);
          velocity += 3 * Math.sin(Math.PI * clamp(p, 0, 1)) - 1;
          lengthFactor = scoreT + val(n.duration) >= slur.end - 1e-6 ? 0.85 : 1;
        } else lengthFactor = 0.9;
      }
      // written articulations apply in both modes
      switch (n.articulation) {
        case "staccato":
          lengthFactor = 0.45;
          velocity -= 2;
          break;
        case "staccatissimo":
          lengthFactor = 0.3;
          break;
        case "tenuto":
          lengthFactor = 1;
          velocity += 3;
          break;
        case "accent":
          velocity += 12;
          break;
        case "marcato":
          velocity += 16;
          lengthFactor = Math.min(lengthFactor, 0.8);
          break;
      }
      if (n.grace) velocity -= 12;
      velocity = Math.round(clamp(velocity, 20, 120));

      // fermata: hold the note by slowing the clock while it sounds
      if (n.fermata && !n.grace) factors.push({ from: start, to: start + dur, f: 0.5 });

      const end = n.tieNext ? start + dur : start + Math.max(Math.min(dur, 60), Math.round(dur * lengthFactor));
      if (n.tiePrev) {
        const prev = openTies.get(n.tiePrev);
        if (prev && prev.midi === n.midi && Math.abs(prev.end - start) <= 1) {
          prev.end = end;
          openTies.delete(n.tiePrev);
          if (n.tieNext) openTies.set(n.id, prev);
          continue;
        }
      }
      const pn: PerformedNote = { midi: n.midi, hand: n.hand, start, end, velocity, measure: m.index, grace: n.grace, sourceId: n.id };
      notes.push(pn);
      if (n.tieNext) openTies.set(n.id, pn);
    }
    tick += mTicks;
  }

  // ---- phrase breathing and a gentle close (expressive only) ------------------------------------
  if (expressive) {
    for (const o of occurrences) {
      const ms = measureStart[o.m.index];
      const me = ms + val(o.m.length);
      for (const s of marks.slurs) {
        if (s.staff !== 0 || s.end - s.start < 2) continue;
        // the last half beat of a long phrase takes a little more time
        const b0 = Math.max(s.end - 0.5, ms);
        const b1 = Math.min(s.end, me);
        if (b1 > b0) factors.push({ from: o.tick + Math.round((b0 - ms) * PPQ), to: o.tick + Math.round((b1 - ms) * PPQ), f: 0.92 });
      }
    }
    const lastRit = directions.some((d) => d.kind === "rit" && d.measure >= measures.length - 3);
    if (!lastRit && tick > 2 * PPQ) factors.push({ from: tick - 2 * PPQ, to: tick, f: 0.9 });
  }

  // ---- pedal: the score asks for it (Ped. / Ped. ad lib) → change with the bass (expressive only) --------
  const pedal: { tick: number; down: boolean }[] = [];
  if (expressive && marks.pedal !== "none") {
    const lh = notes.filter((n) => n.hand === "L" && !n.grace).sort((a, b) => a.start - b.start);
    const measureStarts = new Set(measureTicks.map((m) => m.tick));
    let lastBass = -1;
    let down = false;
    for (let i = 0; i < lh.length; ) {
      const t = lh[i].start;
      let bass = lh[i].midi;
      while (i < lh.length && lh[i].start === t) bass = Math.min(bass, lh[i++].midi);
      if (bass % 12 !== lastBass % 12 || measureStarts.has(t)) {
        if (down) pedal.push({ tick: t, down: false });
        pedal.push({ tick: t + 40, down: true });
        down = true;
        lastBass = bass;
      }
    }
    if (down) pedal.push({ tick: Math.max(...notes.map((n) => n.end)), down: false });
  }

  // Same pitch in the same hand cannot overlap in MIDI: merge unisons and shorten the earlier note.
  notes.sort((a, b) => a.start - b.start || a.midi - b.midi);
  const cleaned: PerformedNote[] = [];
  const lastOf = new Map<string, PerformedNote>();
  for (const n of notes) {
    const key = `${n.hand}:${n.midi}`;
    const prev = lastOf.get(key);
    if (prev && prev.start === n.start) {
      prev.end = Math.max(prev.end, n.end);
      prev.velocity = Math.max(prev.velocity, n.velocity);
      continue;
    }
    if (prev && prev.end > n.start) prev.end = n.start;
    cleaned.push(n);
    lastOf.set(key, n);
  }
  // grace notes may start before zero when they open the piece
  const shift = Math.max(0, -Math.min(0, ...cleaned.map((n) => n.start)));
  if (shift)
    for (const n of cleaned) {
      n.start += shift;
      n.end += shift;
    }

  // ---- combine tempo marks with the multipliers ---------------------------------------------------
  const base = [...tempos].sort((a, b) => a.tick - b.tick);
  const baseAt = (t: number) => {
    let bpm = base[0].bpm;
    for (const p of base) {
      if (p.tick <= t) bpm = p.bpm;
      else break;
    }
    return bpm;
  };
  // one multiplier per span: a fermata over a four-note chord is still one fermata
  const unique = [...new Map(factors.map((f) => [`${f.from}:${f.to}:${f.f}`, f])).values()];
  factors.length = 0;
  factors.push(...unique);
  const cuts = new Set<number>(base.map((p) => p.tick));
  for (const f of factors) {
    cuts.add(f.from);
    cuts.add(f.to);
  }
  const combined = [...cuts]
    .sort((a, b) => a - b)
    .map((t) => ({ tick: t, bpm: baseAt(t) * factors.filter((f) => t >= f.from && t < f.to).reduce((p, f) => p * f.f, 1) }));
  const tmap = new Map<number, number>();
  for (const t of combined) tmap.set(t.tick + (t.tick ? shift : 0), Math.round(t.bpm * 100) / 100);
  return {
    notes: cleaned.filter((n) => n.end > n.start),
    tempos: [...tmap].map(([tick, bpm]) => ({ tick, bpm })).sort((a, b) => a.tick - b.tick),
    timeSigs: timeSigs.map((t) => ({ ...t, tick: t.tick ? t.tick + shift : 0 })),
    pedal: pedal.map((p) => ({ ...p, tick: p.tick + shift })),
    measureTicks: measureTicks.map((m) => ({ ...m, tick: m.tick + shift })),
    totalTicks: tick + shift,
    baseTempo,
    tempoEstimated,
    tempoText,
  };
}

/** Converts a tick position into seconds using the tempo map. */
export function tickToSeconds(tick: number, tempos: TempoPoint[]): number {
  let secs = 0;
  let prevTick = 0;
  let bpm = tempos[0]?.bpm ?? 120;
  for (const t of tempos) {
    if (t.tick >= tick) break;
    secs += ((t.tick - prevTick) / PPQ) * (60 / bpm);
    prevTick = t.tick;
    bpm = t.bpm;
  }
  return secs + ((tick - prevTick) / PPQ) * (60 / bpm);
}
