import type { Barline, BarStyle, GrandSystem, MusicGlyph, Staff, VLine } from "./types";

const spans = (v: VLine, s: Staff) => v.y0 <= s.top + 0.3 * s.sp && v.y1 >= s.bottom - 0.3 * s.sp;

/** A vertical line touching a notehead edge is a stem, not a barline. */
function touchesNotehead(v: VLine, glyphs: MusicGlyph[], sp: number, ink: (g: MusicGlyph) => number): boolean {
  return glyphs.some(
    (g) =>
      g.kind === "notehead" &&
      (Math.abs(g.x - v.x) < 0.12 * sp || Math.abs(g.x + ink(g) - v.x) < 0.12 * sp) &&
      g.y >= v.y0 - 0.6 * sp &&
      g.y <= v.y1 + 0.6 * sp,
  );
}

interface Stroke {
  x: number;
  width: number;
}

function hasRepeatDots(side: "left" | "right", x: number, sys: GrandSystem, glyphs: MusicGlyph[]): boolean {
  const s = sys.upper;
  const lo = side === "left" ? x - 2 * s.sp : x;
  const hi = side === "left" ? x : x + 2 * s.sp;
  const near = glyphs.filter((g) => (g.kind === "repeatDots" || g.kind === "dot") && g.x >= lo - 0.3 && g.x + g.adv * 0.5 <= hi + 0.3);
  const inStaff = (st: Staff) =>
    near.some((g) => g.kind === "repeatDots" && g.y > st.top && g.y < st.bottom + st.sp) ||
    near.filter((g) => g.kind === "dot" && g.y > st.top && g.y < st.bottom).length >= 2;
  return inStaff(sys.upper) && inStaff(sys.lower);
}

export function detectBarlines(sys: GrandSystem, vlines: VLine[], glyphs: MusicGlyph[], ink: (g: MusicGlyph) => number): Barline[] {
  const sp = sys.upper.sp;
  const candidates = vlines.filter(
    (v) => v.x >= sys.x0 - 0.6 && v.x <= sys.x1 + 0.6 && (spans(v, sys.upper) || spans(v, sys.lower)) && !touchesNotehead(v, glyphs, sp, ink),
  );
  // Group pieces that share an x (per-staff barline pieces) and require both staves to be crossed.
  const byX: { x: number; width: number; upper: boolean; lower: boolean }[] = [];
  for (const v of candidates.sort((a, b) => a.x - b.x)) {
    const g = byX.find((b) => Math.abs(b.x - v.x) < 0.4);
    const target = g ?? { x: v.x, width: v.width, upper: false, lower: false };
    if (!g) byX.push(target);
    target.upper ||= spans(v, sys.upper);
    target.lower ||= spans(v, sys.lower);
    target.width = Math.max(target.width, v.width);
  }
  const strokes: Stroke[] = byX.filter((b) => b.upper && b.lower).map((b) => ({ x: b.x, width: b.width }));
  if (!strokes.length) return [];
  const thin = Math.min(...strokes.map((s) => s.width));

  // Merge strokes closer than ~1.2 staff spaces into one barline (double, final, repeat barlines).
  const groups: Stroke[][] = [];
  for (const s of strokes) {
    const last = groups[groups.length - 1];
    if (last && s.x - last[last.length - 1].x < 1.3 * sp) last.push(s);
    else groups.push([s]);
  }

  const bars: Barline[] = [];
  for (const g of groups) {
    const x0 = g[0].x - g[0].width / 2;
    const x1 = g[g.length - 1].x + g[g.length - 1].width / 2;
    const pattern = g.map((s) => (s.width > thin * 1.8 && s.width > 0.25 * sp ? "K" : "t")).join("");
    const dotsL = hasRepeatDots("left", x0, sys, glyphs);
    const dotsR = hasRepeatDots("right", x1, sys, glyphs);
    let style: BarStyle = "single";
    if (dotsL && dotsR) style = "repeat-both";
    else if (dotsL) style = "repeat-end";
    else if (dotsR) style = "repeat-start";
    else if (pattern === "tt") style = "double";
    else if (pattern.endsWith("K") && pattern.length > 1) style = "final";
    else if (pattern.includes("K")) style = "heavy";
    bars.push({ x: (x0 + x1) / 2, x0, x1, style });
  }

  // The line at the very left of a system just joins the staves; it is the start of the first measure.
  const out: Barline[] = [];
  if (bars[0].x0 > sys.x0 + 0.6 * sp) out.push({ x: sys.x0, x0: sys.x0, x1: sys.x0, style: "single" });
  out.push(...bars);
  return out;
}
