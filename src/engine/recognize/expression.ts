import type { BuildResult, SystemRecord } from "../score/build";
import type { Direction, NoteEvent } from "../score/types";
import { phrases } from "./directions";

/**
 * Written expression that does not change which notes are played but how: hairpins, slurs, articulations,
 * fermatas and pedal. Positions are converted from page x to score time (quarter notes from the start of the
 * score, in written order) using the notes of the same system as a ruler.
 */
export interface ExpressionMarks {
  hairpins: { start: number; end: number; kind: "cresc" | "dim" }[];
  dynamics: { time: number; value: string }[];
  slurs: { staff: 0 | 1; start: number; end: number }[];
  /** "marked" = explicit Ped./* signs, "adlib" = the score asks for pedal without marking it, "none" */
  pedal: "marked" | "adlib" | "none";
  pedalMarks: { time: number; down: boolean }[];
  counts: { hairpins: number; slurs: number; accents: number; staccatos: number; fermatas: number };
}

const val = (f: { n: number; d: number }) => f.n / f.d;

export function readExpression(built: BuildResult, directions: Direction[]): ExpressionMarks {
  const start = built.measureStart.map(val);
  const noteTime = (n: NoteEvent) => start[n.measure] + val(n.onset);
  const bySystem = new Map<SystemRecord, NoteEvent[]>();
  for (const m of built.measures) {
    const rec = built.systems[m.system];
    if (!bySystem.has(rec)) bySystem.set(rec, []);
    bySystem.get(rec)!.push(...m.notes.filter((n) => !n.grace));
  }
  /** Score time at a horizontal position of a system: the onset of the first note at or after x. */
  const timeAtX = (rec: SystemRecord, x: number, side: "start" | "end"): number | null => {
    const notes = bySystem.get(rec) ?? [];
    if (!notes.length) return null;
    const sp = rec.sys.upper.sp;
    if (side === "start") {
      const after = notes.filter((n) => n.x >= x - 0.6 * sp).sort((a, b) => a.x - b.x)[0];
      return after ? noteTime(after) : null;
    }
    const before = notes.filter((n) => n.x <= x + 0.6 * sp).sort((a, b) => b.x - a.x)[0];
    return before ? noteTime(before) + val(before.duration) : null;
  };

  const marks: ExpressionMarks = { hairpins: [], dynamics: [], slurs: [], pedal: "none", pedalMarks: [], counts: { hairpins: 0, slurs: 0, accents: 0, staccatos: 0, fermatas: 0 } };

  for (const rec of built.systems) {
    const { page, sys, sy } = rec;
    const sp = sys.upper.sp;
    const inSys = (y: number) => y > sys.upper.top - 8 * sp && y < sys.lower.bottom + 8 * sp;

    // ---- hairpins: two straight lines meeting at a point, opening by about one staff space -----------
    const lines = page.otherLines.filter((l) => {
      const dx = Math.abs(l.x2 - l.x1);
      return dx > 2 * sp && Math.abs(l.y2 - l.y1) < dx * 0.25 && l.x1 > sys.x0 - sp && l.x1 < sys.x1 + sp && inSys((l.y1 + l.y2) / 2);
    });
    const used = new Set<(typeof lines)[number]>();
    for (const a of lines) {
      if (used.has(a)) continue;
      for (const b of lines) {
        if (a === b || used.has(b)) continue;
        const ends = (l: typeof a) => (l.x1 < l.x2 ? [[l.x1, l.y1], [l.x2, l.y2]] : [[l.x2, l.y2], [l.x1, l.y1]]);
        const [aL, aR] = ends(a);
        const [bL, bR] = ends(b);
        const apexLeft = Math.hypot(aL[0] - bL[0], aL[1] - bL[1]) < 1 && Math.abs(aR[0] - bR[0]) < 1.5;
        const apexRight = Math.hypot(aR[0] - bR[0], aR[1] - bR[1]) < 1 && Math.abs(aL[0] - bL[0]) < 1.5;
        if (!apexLeft && !apexRight) continue;
        const opening = apexLeft ? Math.abs(aR[1] - bR[1]) : Math.abs(aL[1] - bL[1]);
        if (opening < 0.4 * sp || opening > 2.5 * sp) continue;
        used.add(a).add(b);
        const x0 = Math.min(aL[0], bL[0]);
        const x1 = Math.max(aR[0], bR[0]);
        const t0 = timeAtX(rec, x0, "start");
        const t1 = timeAtX(rec, x1, "end");
        if (t0 !== null && t1 !== null && t1 > t0) marks.hairpins.push({ start: t0, end: t1, kind: apexLeft ? "cresc" : "dim" });
      }
    }

    // ---- slurs: curves that are not ties and start and end near notes -------------------------------
    for (const c of sy.curves) {
      if (built.tieCurves.has(c) || c.width < 3 * sp) continue;
      const notes = bySystem.get(rec) ?? [];
      const near = (x: number, y: number) =>
        notes.filter((n) => Math.abs(n.x - x) < 2.5 * sp && Math.abs(n.y - y) < 3 * sp).sort((p, q) => Math.abs(p.x - x) - Math.abs(q.x - x))[0];
      const L = near(c.left[0], c.left[1]) ?? (c.left[0] < sys.x0 + 10 * sp ? undefined : null);
      const R = near(c.right[0], c.right[1]) ?? (c.right[0] > sys.x1 - 2 * sp ? undefined : null);
      if (L === null || R === null) continue;
      const staff = (L ?? R)?.staff;
      if (staff === undefined) continue;
      const t0 = L ? noteTime(L) : timeAtX(rec, sys.x0, "start");
      const t1 = R ? noteTime(R) + val(R.duration) : timeAtX(rec, sys.x1, "end");
      if (t0 === null || t1 === null || t1 <= t0) continue;
      marks.slurs.push({ staff, start: t0, end: t1 });
    }

    // ---- articulations and fermatas attach to the chord right above/below them -----------------------
    const chordNotes = new Map<number, NoteEvent[]>();
    for (const n of bySystem.get(rec) ?? []) {
      if (!chordNotes.has(n.chordId)) chordNotes.set(n.chordId, []);
      chordNotes.get(n.chordId)!.push(n);
    }
    for (const g of page.glyphs) {
      if ((g.kind !== "articulation" && g.kind !== "fermata") || !inSys(g.y) || g.x < sys.x0 || g.x > sys.x1) continue;
      const cx = g.x + g.adv / 2;
      let best: NoteEvent[] | null = null;
      let bestD = Infinity;
      for (const ns of chordNotes.values()) {
        const hx = ns[0].x + (g.adv ? 0 : 0);
        const w = sp * 1.2;
        if (Math.abs(hx + w / 2 - cx) > 1.1 * sp) continue;
        const dy = Math.min(...ns.map((n) => Math.abs(n.y - g.y)));
        const limit = g.kind === "fermata" ? 7 * sp : 3.5 * sp;
        if (dy < limit && dy < bestD) {
          best = ns;
          bestD = dy;
        }
      }
      if (!best) continue;
      for (const n of best) {
        if (g.kind === "fermata") n.fermata = true;
        else n.articulation = g.value as NoteEvent["articulation"];
      }
      if (g.kind === "fermata") marks.counts.fermatas++;
      else if (g.value === "staccato") marks.counts.staccatos++;
      else marks.counts.accents++;
    }
  }

  // ---- dynamics in score time --------------------------------------------------------------------
  for (const d of directions) {
    if (d.kind !== "dynamic" || d.x === undefined) continue;
    const rec = built.systems[built.measures[d.measure].system];
    const t = timeAtX(rec, d.x, "start");
    if (t !== null) marks.dynamics.push({ time: t, value: d.value! });
  }
  marks.dynamics.sort((a, b) => a.time - b.time);

  // ---- pedal ----------------------------------------------------------------------------------------
  const pedalGlyphs = built.systems.flatMap((r) => r.page.glyphs.filter((g) => g.kind === "pedal"));
  const pedalWords = [...new Set(built.systems.map((r) => r.page))].flatMap((p) => phrases(p.words)).filter((w) => /^ped\b/i.test(w.text.trim()));
  if (pedalGlyphs.some((g) => g.value === "up")) marks.pedal = "marked";
  else if (pedalWords.length || pedalGlyphs.length) marks.pedal = "adlib";

  marks.counts.hairpins = marks.hairpins.length;
  marks.counts.slurs = marks.slurs.length;
  return marks;
}
