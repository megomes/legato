import type { Direction, MeasureModel, NoteEvent } from "./types";

export interface HandReport {
  confidence: number;
  overrides: { from: number; to: number; staff: 0 | 1; hand: "R" | "L"; source: "marking" | "implied" }[];
  notes: string[];
}

const val = (f: { n: number; d: number }) => f.n / f.d;

/** Position in score order: measure index plus fraction of the measure. */
const posOf = (m: number, at: number) => m + at;

/**
 * Hand assignment as a semantic layer on top of the staves.
 *
 * Default: upper staff → right hand, lower staff → left hand. Printed hand markings ("right hand", "r.h.", "m.d.",
 * "left hand", "l.h.", "m.s.") move the upper voice of the lower staff to the right hand (or the lower voice of the
 * upper staff to the left hand) until the opposite marking or until the other staff starts playing again.
 * A "left hand" marking with no active override, printed while the upper staff is silent, means the passage since the
 * upper staff went quiet was played by the right hand (common in scores that only mark the return).
 */
export function assignHands(measures: MeasureModel[], directions: Direction[]): HandReport {
  const report: HandReport = { confidence: 1, overrides: [], notes: [] };
  const markings = directions.filter((d) => d.kind === "hand").sort((a, b) => posOf(a.measure, a.at) - posOf(b.measure, b.at));
  if (!markings.length) return report;

  // a staff holding a tied note is still busy
  const staffSilent = (m: MeasureModel, staff: 0 | 1) => !m.notes.some((n) => n.staff === staff && !n.grace);
  // first position after `from` where `staff` has a fresh note onset
  const resumes = (staff: 0 | 1, from: number): number => {
    for (const m of measures) {
      if (m.index + 1 <= from) continue;
      const onsets = m.notes
        .filter((n) => n.staff === staff && !n.grace && !n.tiePrev)
        .map((n) => posOf(m.index, val(n.onset) / val(m.length)))
        .filter((p) => p > from + 1e-6);
      if (onsets.length) return Math.min(...onsets);
    }
    return measures.length;
  };

  let active: { staff: 0 | 1; hand: "R" | "L"; from: number } | null = null;
  const close = (to: number, source: "marking" | "implied") => {
    if (!active) return;
    report.overrides.push({ from: active.from, to, staff: active.staff, hand: active.hand, source });
    active = null;
  };

  for (const mk of markings) {
    const at = posOf(mk.measure, mk.at);
    if (active && resumes(active.staff === 1 ? 0 : 1, active.from) < at) close(resumes(active.staff === 1 ? 0 : 1, active.from), "marking");
    if (mk.hand === "R") {
      if (active?.staff === 1) continue; // already there
      if (active?.staff === 0) {
        close(at, "marking");
        continue;
      }
      active = { staff: 1, hand: "R", from: at };
    } else {
      if (active?.staff === 1) {
        close(at, "marking");
        continue;
      }
      if (active?.staff === 0) continue;
      const m = measures[mk.measure];
      if (m && staffSilent(m, 0)) {
        // implied: walk back to where the upper staff went silent
        let start = mk.measure;
        while (start > 0 && staffSilent(measures[start - 1], 0)) start--;
        report.overrides.push({ from: start, to: at, staff: 1, hand: "R", source: "implied" });
        report.notes.push(`"left hand" at measure ${mk.measure + 1} implies the right hand played the lower staff's upper voice from measure ${start + 1}`);
      } else {
        active = { staff: 0, hand: "L", from: at };
      }
    }
  }
  if (active) {
    const a = active as { staff: 0 | 1; hand: "R" | "L"; from: number };
    close(resumes(a.staff === 1 ? 0 : 1, a.from), "marking");
  }

  // Apply overrides to the voice on the inner side of the staff.
  let uncertain = 0;
  let total = 0;
  for (const m of measures) for (const n of m.notes) if (!n.grace) total++;
  for (const o of report.overrides) {
    for (const m of measures) {
      if (m.index + 1 <= o.from || m.index >= o.to) continue;
      const staffNotes = m.notes.filter((n) => n.staff === o.staff);
      const wanted = o.staff === 1 ? "up" : "down";
      const multiVoice = staffNotes.some((n) => n.voice === "up") && staffNotes.some((n) => n.voice === "down");
      for (const n of staffNotes) {
        const p = posOf(m.index, val(n.onset) / val(m.length));
        if (p < o.from - 1e-6 || p >= o.to - 1e-6) continue;
        if (!multiVoice) {
          uncertain++;
          continue;
        }
        if (n.voice !== wanted) continue;
        n.hand = o.hand;
        n.handSource = o.source === "marking" ? "marking" : "texture";
        if (o.source === "implied") uncertain += 0.1;
      }
    }
  }
  // Tied continuations follow the hand of the note they continue.
  const byId = new Map<number, NoteEvent>();
  for (const m of measures) for (const n of m.notes) byId.set(n.id, n);
  for (const m of measures)
    for (const n of m.notes) {
      if (n.tiePrev) {
        const p = byId.get(n.tiePrev);
        if (p) n.hand = p.hand;
      }
    }
  report.confidence = total ? Math.max(0, 1 - uncertain / total) : 1;
  return report;
}
