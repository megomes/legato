import { add, frac } from "../util/frac";
import type { Chord, Frac, Rest, StaffIndex } from "./types";

export type TimedEvent = { kind: "chord"; ev: Chord } | { kind: "rest"; ev: Rest };

export interface MeasureTiming {
  /** onset of each event (by id), in quarter notes from the start of the measure */
  onsets: Map<number, Frac>;
  /** actual length of the measure content */
  length: Frac;
  merges: number;
}

export interface TimingFailure {
  reason: string;
}

const val = (f: Frac) => f.n / f.d;
const eq = (a: Frac, b: Frac) => a.n * b.d === b.n * a.d;

export const durationOf = (e: TimedEvent): Frac => {
  const base = e.ev.base;
  const t = e.ev.tuplet;
  return t ? frac(base.n * t.num, base.d * t.den) : base;
};

const anchorOf = (e: TimedEvent) => e.ev.anchor;
const staffOf = (e: TimedEvent): StaffIndex => e.ev.staff;

/**
 * Assigns onsets without knowing voices. In well-formed notation every voice is a gap-free chain of notes and
 * rests, so the next onset (left to right) is always the earliest end among the events still sounding.
 */
function assign(columns: TimedEvent[][]): Map<number, Frac> | null {
  const onsets = new Map<number, Frac>();
  let t = frac(0);
  const ends: Frac[] = [];
  for (let k = 0; k < columns.length; k++) {
    if (k > 0) {
      const next = ends.filter((e) => val(e) > val(t) + 1e-9).sort((a, b) => val(a) - val(b))[0];
      if (!next) return null;
      t = next;
    }
    for (const e of columns[k]) {
      onsets.set(e.ev.id, t);
      ends.push(add(t, durationOf(e)));
    }
  }
  return onsets;
}

interface Check {
  ok: boolean;
  reason?: string;
  length: Frac;
}

function validate(events: TimedEvent[], onsets: Map<number, Frac>, expected: Frac, allowShort: boolean, restStaves: Set<StaffIndex>): Check {
  let maxEnd = frac(0);
  const staffEnd: Record<number, Frac> = {};
  for (const e of events) {
    const end = add(onsets.get(e.ev.id)!, durationOf(e));
    if (val(end) > val(expected) + 1e-9) return { ok: false, reason: "Notes run past the end of the measure", length: end };
    if (val(end) > val(maxEnd)) maxEnd = end;
    const s = staffOf(e);
    if (!staffEnd[s] || val(end) > val(staffEnd[s])) staffEnd[s] = end;
  }
  // every event that ends early must be followed by something in the same staff (voices have no gaps)
  for (const e of events) {
    const end = add(onsets.get(e.ev.id)!, durationOf(e));
    if (val(end) >= val(maxEnd) - 1e-9) continue;
    const continued = events.some((f) => staffOf(f) === staffOf(e) && eq(onsets.get(f.ev.id)!, end));
    if (!continued) return { ok: false, reason: "A voice stops before the end of the measure", length: maxEnd };
  }
  // Chords of one voice never overlap: within a staff, stem direction identifies the voice when voices are
  // written apart, and a single voice never overlaps itself either.
  for (const s of [0, 1] as StaffIndex[])
    for (const dir of ["up", "down"] as const) {
      const chain = events
        .filter((e): e is Extract<TimedEvent, { kind: "chord" }> => e.kind === "chord" && e.ev.staff === s && e.ev.dir === dir)
        .map((e) => ({ start: val(onsets.get(e.ev.id)!), end: val(add(onsets.get(e.ev.id)!, durationOf(e))) }))
        .sort((a, b) => a.start - b.start);
      for (let i = 0; i + 1 < chain.length; i++)
        if (chain[i + 1].start > chain[i].start + 1e-9 && chain[i].end > chain[i + 1].start + 1e-9)
          return { ok: false, reason: "Notes of one voice overlap", length: maxEnd };
    }
  for (const s of [0, 1] as StaffIndex[]) {
    if (restStaves.has(s)) continue;
    const end = staffEnd[s];
    if (end && !eq(end, maxEnd)) return { ok: false, reason: `Staff ${s === 0 ? "upper" : "lower"} does not fill the measure`, length: maxEnd };
  }
  if (!eq(maxEnd, expected) && !(allowShort && val(maxEnd) < val(expected))) {
    return { ok: false, reason: `Measure adds up to ${fmt(maxEnd)} instead of ${fmt(expected)} quarter notes`, length: maxEnd };
  }
  return { ok: true, length: maxEnd };
}

const fmt = (f: Frac) => (f.d === 1 ? `${f.n}` : `${f.n}/${f.d}`);

/**
 * Solves the timing of one measure. Events are grouped into columns by x; when two voices collide the engraver
 * shifts one of them sideways, so nearby columns may really be simultaneous. We try the plain reading first and
 * then merge the closest column pairs; the reading must be unique among the smallest number of merges.
 */
export function solveMeasure(
  events: TimedEvent[],
  expected: Frac,
  opts: { colTol: number; mergeTol: number; restTol: number; allowShort: boolean; restStaves: Set<StaffIndex> },
): MeasureTiming | TimingFailure {
  if (!events.length) return { onsets: new Map(), length: expected, merges: 0 };
  const sorted = [...events].sort((a, b) => anchorOf(a) - anchorOf(b));
  const columns: TimedEvent[][] = [];
  for (const e of sorted) {
    const last = columns[columns.length - 1];
    if (last && anchorOf(e) - anchorOf(last[0]) <= opts.colTol) last.push(e);
    else columns.push([e]);
  }
  const colX = (c: TimedEvent[]) => c.reduce((s, e) => s + anchorOf(e), 0) / c.length;

  // candidate merges: adjacent columns close enough to be a voice collision shift
  const mergeable: number[] = [];
  for (let k = 0; k + 1 < columns.length; k++) {
    if (colX(columns[k + 1]) - colX(columns[k]) > opts.mergeTol) continue;
    // An engraver shifts a voice sideways only when its notes would collide with the other voice's notes
    // (unison, second, or crossing), so both columns must hold opposed chords of one staff within a step.
    const collide = (a: TimedEvent, b: TimedEvent) => {
      if (a.kind !== "chord" || b.kind !== "chord" || a.ev.staff !== b.ev.staff || a.ev.dir === b.ev.dir) return false;
      const pa = a.ev.heads.map((h) => h.pos);
      const pb = b.ev.heads.map((h) => h.pos);
      const up = a.ev.dir === "up" ? pa : pb;
      const down = a.ev.dir === "up" ? pb : pa;
      // voices cross, or the lowest upper-voice note is within a second of the highest lower-voice note
      return Math.min(...up) - Math.max(...down) <= 2;
    };
    const opposed = columns[k].some((a) => columns[k + 1].some((b) => collide(a, b)));
    // Rest glyphs are centred differently in some fonts: a lone rest may belong to the neighbouring column.
    const restSnap = colX(columns[k + 1]) - colX(columns[k]) <= opts.restTol && (columns[k].every((e) => e.kind === "rest") || columns[k + 1].every((e) => e.kind === "rest"));
    if (opposed || restSnap) mergeable.push(k);
  }

  let firstFailure = "Rhythm could not be resolved";
  const maxMerges = Math.min(mergeable.length, 3);
  for (let m = 0; m <= maxMerges; m++) {
    const found: { onsets: Map<number, Frac>; length: Frac }[] = [];
    for (const subset of combinations(mergeable, m)) {
      const merged: TimedEvent[][] = [];
      for (let k = 0; k < columns.length; k++) {
        if (subset.includes(k - 1) && merged.length) merged[merged.length - 1] = [...merged[merged.length - 1], ...columns[k]];
        else merged.push([...columns[k]]);
      }
      const onsets = assign(merged);
      if (!onsets) continue;
      const check = validate(events, onsets, expected, opts.allowShort, opts.restStaves);
      if (check.ok) found.push({ onsets, length: check.length });
      else if (m === 0 && check.reason) firstFailure = check.reason;
    }
    if (found.length === 1) return { ...found[0], merges: m };
    if (found.length > 1) {
      const same = found.every((f) => [...f.onsets].every(([id, t]) => eq(t, found[0].onsets.get(id)!)));
      if (same) return { ...found[0], merges: m };
      return { reason: "Rhythm is ambiguous (several readings fit)" };
    }
  }
  return { reason: firstFailure };
}

function* combinations(items: number[], k: number, start = 0, acc: number[] = []): Generator<number[]> {
  if (acc.length === k) {
    yield acc;
    return;
  }
  for (let i = start; i < items.length; i++) yield* combinations(items, k, i + 1, [...acc, items[i]]);
}
