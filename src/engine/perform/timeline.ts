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
  /** tick where each performed measure starts */
  measureTicks: { measure: number; tick: number }[];
  totalTicks: number;
  baseTempo: number;
  tempoEstimated: boolean;
  tempoText: string;
}

const VELOCITY: Record<string, number> = { ppp: 28, pp: 38, p: 50, mp: 62, mf: 74, f: 88, ff: 100, fff: 112, sfz: 104, sf: 100, fz: 100, rfz: 96, fp: 88, sfp: 100 };
const val = (f: { n: number; d: number }) => f.n / f.d;

export function buildTimeline(measures: MeasureModel[], order: number[], directions: Direction[]): Timeline {
  // ---- base tempo ------------------------------------------------------------------------------
  const tempoMarks = directions.filter((d) => d.kind === "tempo").sort((a, b) => a.measure + a.at - (b.measure + b.at));
  const tempoTexts = directions.filter((d) => d.kind === "tempoText").sort((a, b) => a.measure + a.at - (b.measure + b.at));
  const first = tempoMarks[0];
  let baseTempo = first ? first.bpm! * (first.unit ?? 1) : tempoTexts[0]?.bpm ?? 100;
  // compound meters: a dotted-quarter feel defaults to a slower quarter pulse when only words are given
  const tempoEstimated = !first;
  const tempoText = first ? first.value ?? `♩ = ${first.bpm}` : tempoTexts[0]?.value ?? "";
  if (!first && measures[0] && measures[0].time.den === 8 && measures[0].time.num % 3 === 0) baseTempo = Math.round(baseTempo * 1.5);

  // ---- per-measure tick positions --------------------------------------------------------------
  const notes: PerformedNote[] = [];
  const measureTicks: { measure: number; tick: number }[] = [];
  const timeSigs: TimeSigPoint[] = [];
  const tempos: TempoPoint[] = [{ tick: 0, bpm: baseTempo }];
  let tick = 0;
  let lastSig = "";
  const byId = new Map<number, NoteEvent>();
  for (const m of measures) for (const n of m.notes) byId.set(n.id, n);

  // dynamics per staff in score order, applied by position
  const dyn = directions.filter((d) => d.kind === "dynamic").sort((a, b) => a.measure + a.at - (b.measure + b.at));
  const velocityAt = (measure: number, at: number) => {
    let v = 74;
    for (const d of dyn) {
      if (d.measure + d.at > measure + at + 0.02) break;
      v = VELOCITY[d.value!] ?? v;
    }
    return v;
  };

  // open notes waiting for a tied continuation: key = source note id
  const openTies = new Map<number, PerformedNote>();
  let currentBase = baseTempo;
  for (let k = 0; k < order.length; k++) {
    const m = measures[order[k]];
    measureTicks.push({ measure: m.index, tick });
    const sig = `${m.time.num}/${m.time.den}`;
    if (sig !== lastSig) {
      timeSigs.push({ tick, num: m.time.num, den: m.time.den });
      lastSig = sig;
    }
    const mTicks = toTicks(m.length)!;
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

    for (const n of m.notes) {
      const onset = toTicks(n.onset);
      const dur = toTicks(n.duration);
      if (onset === null || dur === null) continue;
      const start = tick + onset;
      const end = start + dur;
      const velocity = velocityAt(m.index, val(n.onset) / val(m.length));
      if (n.tiePrev) {
        const prev = openTies.get(n.tiePrev);
        if (prev && prev.end === start && prev.midi === n.midi) {
          prev.end = end;
          openTies.delete(n.tiePrev);
          if (n.tieNext) openTies.set(n.id, prev);
          continue;
        }
      }
      const pn: PerformedNote = { midi: n.midi, hand: n.hand, start, end, velocity: n.grace ? Math.max(30, velocity - 12) : velocity, measure: m.index, grace: n.grace, sourceId: n.id };
      notes.push(pn);
      if (n.tieNext) openTies.set(n.id, pn);
    }
    tick += mTicks;
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
      continue;
    }
    if (prev && prev.end > n.start) prev.end = n.start;
    cleaned.push(n);
    lastOf.set(key, n);
  }
  // grace notes may start before zero when they open the piece
  const shift = Math.max(0, -Math.min(0, ...cleaned.map((n) => n.start)));
  if (shift) for (const n of cleaned) {
    n.start += shift;
    n.end += shift;
  }

  // collapse tempo points on the same tick (last wins) and sort
  const tmap = new Map<number, number>();
  for (const t of tempos.sort((a, b) => a.tick - b.tick)) tmap.set(t.tick + (t.tick ? shift : 0), t.bpm);
  return {
    notes: cleaned.filter((n) => n.end > n.start),
    tempos: [...tmap].map(([tick, bpm]) => ({ tick, bpm })).sort((a, b) => a.tick - b.tick),
    timeSigs: timeSigs.map((t) => ({ ...t, tick: t.tick ? t.tick + shift : 0 })),
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
