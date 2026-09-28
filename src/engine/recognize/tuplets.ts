import { add, frac, mul } from "../util/frac";
import type { Chord, Frac, Rest, SystemSymbols, TupletMark } from "./types";

const RATIO: Record<number, [number, number]> = { 2: [3, 2], 3: [2, 3], 4: [3, 4], 5: [4, 5], 6: [4, 6], 7: [4, 7], 9: [8, 9] };

/** Durations a tuplet group may add up to once scaled: plain or dotted note values. */
function isSimple(f: Frac): boolean {
  const q = f.n / f.d;
  for (let e = -6; e <= 3; e++) {
    const v = 2 ** e;
    if (Math.abs(q - v) < 1e-9 || Math.abs(q - v * 1.5) < 1e-9) return true;
  }
  return false;
}

/**
 * Attaches tuplet numbers to their notes. A number sits over a bracket (which gives its horizontal span) or next to
 * a beam (whose chords are the members). Members are validated: the scaled group must add up to a normal value.
 */
export function applyTuplets(sy: SystemSymbols): TupletMark[] {
  const unattached: TupletMark[] = [];
  const sp = sy.staves[0].sp;
  for (const t of sy.tuplets) {
    const ratio = RATIO[t.n];
    let members: (Chord | Rest)[] = [];
    if (t.bracket) {
      const [x0, x1] = t.bracket;
      const cands = [...sy.chords, ...sy.rests.filter((r) => !r.measureRest)].filter((e) => e.anchor >= x0 - 0.3 && e.anchor <= x1 + 0.3);
      // the bracket belongs to the staff whose events are vertically nearest to it
      const dist = (e: Chord | Rest) => ("heads" in e ? Math.min(...e.heads.map((h) => Math.abs(h.y - t.y))) : Math.abs(e.y - t.y));
      const staff = cands.length ? cands.reduce((a, b) => (dist(a) < dist(b) ? a : b)).staff : t.staff;
      members = cands.filter((e) => e.staff === staff);
      const dirs = new Set(members.filter((e): e is Chord => "heads" in e && e.dir !== "none").map((c) => c.dir));
      if (dirs.size > 1) {
        const want = t.y < Math.min(...members.filter((e): e is Chord => "heads" in e).flatMap((c) => c.heads.map((h) => h.y))) ? "up" : "down";
        members = members.filter((e) => !("heads" in e) || e.dir === want);
      }
    } else {
      // Beams near the number, nearest first. The number sits outside its beam, away from the noteheads:
      // below the beam of a down-stem group, above the beam of an up-stem group.
      const beamYAt = (b: (typeof sy.beams)[number], x: number) => b.ya + ((b.yb - b.ya) * (x - b.xa)) / (b.xb - b.xa || 1);
      const beams = sy.beams
        .filter((b) => t.x >= b.xa - 0.5 * sp && t.x <= b.xb + 0.5 * sp)
        .map((b) => ({ b, d: Math.abs(beamYAt(b, t.x) - (t.y - 0.3 * sp)) }))
        .filter((c) => c.d < 3 * sp)
        .sort((p, q) => p.d - q.d);
      // Compare candidate groups under every nearby beam: a tuplet usually has exactly n notes of equal value.
      let best: { run: Chord[]; score: number } | null = null;
      for (const { b: beam, d } of beams.slice(0, 4)) {
        if (!ratio) break;
        const group = sy.chords
          .filter((c) => {
            if (!c.stem) return false;
            const tip = c.dir === "up" ? c.stem.y0 : c.stem.y1;
            return c.stem.x >= beam.xa - 0.5 && c.stem.x <= beam.xb + 0.5 && Math.abs(tip - beamYAt(beam, c.stem.x)) < 0.8 * sp;
          })
          .sort((a, b) => a.anchor - b.anchor);
        if (!group.length) continue;
        const up = group.filter((c) => c.dir === "up").length >= group.length / 2;
        const numberMid = t.y - 0.3 * sp;
        if (up ? numberMid > beamYAt(beam, t.x) + 0.3 * sp : numberMid < beamYAt(beam, t.x) - 0.3 * sp) continue;
        // A beam group may hold more than the tuplet (e.g. a sixteenth triplet beamed with eighths):
        // consider every contiguous run centred under the number whose scaled total is a normal note value.
        for (let i = 0; i < group.length; i++)
          for (let j = i; j < group.length; j++) {
            const run = group.slice(i, j + 1);
            const x0 = run[0].anchor;
            const x1 = run[run.length - 1].anchor;
            if (t.x < x0 - 1.2 * sp || t.x > x1 + 1.2 * sp) continue;
            const centre = Math.abs((x0 + x1) / 2 - t.x);
            if (centre > 1.5 * sp) continue;
            const total = run.reduce((s, e) => add(s, e.base), frac(0));
            if (!isSimple(mul(total, frac(ratio[0], ratio[1])))) continue;
            const equal = run.every((e) => e.base.n * run[0].base.d === run[0].base.n * e.base.d);
            const score = centre + (run.length === t.n ? 0 : 1.5 * sp) + (equal ? 0 : 0.5 * sp) + (run.length < 2 ? sp : 0) + 0.3 * d;
            if (!best || score < best.score) best = { run, score };
          }
      }
      if (best) members = best.run;
    }
    if (!ratio || !members.length) {
      // Probably a measure number or fingering. Ignoring a real tuplet would make its measure too long, which the
      // rhythm check rejects, so this cannot slip through silently.
      unattached.push(t);
      continue;
    }
    const total = members.reduce((s, e) => add(s, e.base), frac(0));
    const scaled = mul(total, frac(ratio[0], ratio[1]));
    if (!isSimple(scaled)) {
      sy.problems.push({ x: t.x, staff: t.staff, message: `Tuplet ${t.n} group does not add up (${total.n}/${total.d})`, severity: "error" });
      continue;
    }
    for (const e of members) {
      if (e.tuplet) sy.problems.push({ x: t.x, staff: t.staff, message: "Nested tuplets are not supported", severity: "error" });
      e.tuplet = { num: ratio[0], den: ratio[1] };
    }
  }
  return unattached;
}
