import type { GrandSystem, HLine, MusicGlyph, Staff, VLine } from "./types";

/** Merges collinear horizontal segments (staff lines are often drawn per measure). */
function mergeHLines(lines: HLine[]): HLine[] {
  const sorted = [...lines].sort((a, b) => a.y - b.y || a.x0 - b.x0);
  const out: HLine[] = [];
  for (const l of sorted) {
    const hit = out.find((o) => Math.abs(o.y - l.y) < 0.2 && l.x0 <= o.x1 + 3 && l.x1 >= o.x0 - 3);
    if (hit) {
      hit.x0 = Math.min(hit.x0, l.x0);
      hit.x1 = Math.max(hit.x1, l.x1);
    } else out.push({ ...l });
  }
  return out;
}

/** Staff lines of one staff share their horizontal extent almost exactly. */
const sameExtent = (a: HLine, b: HLine) => Math.abs(a.x0 - b.x0) < 2 && Math.abs(a.x1 - b.x1) < 2;

/** Finds five equally spaced long horizontal lines sharing the same horizontal extent. */
export function detectStaves(page: number, hlines: HLine[]): Staff[] {
  const long = mergeHLines(hlines).filter((l) => l.x1 - l.x0 > 60);
  const used = new Set<HLine>();
  const staves: Staff[] = [];
  for (let i = 0; i < long.length; i++) {
    const a = long[i];
    if (used.has(a)) continue;
    for (let j = i + 1; j < long.length; j++) {
      const b = long[j];
      const sp = b.y - a.y;
      if (sp < 2.5) continue;
      if (sp > 16) break;
      if (used.has(b) || !sameExtent(a, b)) continue;
      const group = [a, b];
      for (let k = 2; k < 5; k++) {
        const want = a.y + k * sp;
        const c = long.find((l) => !used.has(l) && Math.abs(l.y - want) < Math.max(0.25, sp * 0.06) && sameExtent(a, l));
        if (!c) break;
        group.push(c);
      }
      if (group.length === 5) {
        group.forEach((g) => used.add(g));
        const ys = group.map((g) => g.y);
        staves.push({
          page,
          lines: ys,
          top: ys[0],
          bottom: ys[4],
          sp: (ys[4] - ys[0]) / 4,
          x0: Math.min(...group.map((g) => g.x0)),
          x1: Math.max(...group.map((g) => g.x1)),
        });
        break;
      }
    }
  }
  return staves.sort((s, t) => s.top - t.top);
}

/**
 * Piano scores are laid out as grand staves: two staves joined by a brace and by barlines that cross the gap.
 * Staves that cannot be paired this way make the page unsupported.
 */
export function pairSystems(page: number, staves: Staff[], vlines: VLine[], glyphs: MusicGlyph[]): GrandSystem[] {
  const systems: GrandSystem[] = [];
  const used = new Set<Staff>();
  for (let i = 0; i + 1 < staves.length; i++) {
    const a = staves[i];
    const b = staves[i + 1];
    if (used.has(a) || used.has(b)) continue;
    const sameWidth = Math.abs(a.x0 - b.x0) < 2 * a.sp && Math.abs(a.x1 - b.x1) < 2 * a.sp;
    if (!sameWidth) continue;
    const joined = vlines.some((v) => v.y0 <= a.bottom + 0.3 * a.sp && v.y1 >= b.top - 0.3 * a.sp && v.x >= a.x0 - 3 * a.sp && v.x <= a.x1 + 0.5);
    const braced = glyphs.some((g) => g.kind === "brace" && g.x < a.x0 + a.sp && g.x > a.x0 - 6 * a.sp && g.y >= b.top - a.sp && g.y - g.size <= a.bottom + 4 * a.sp);
    if (joined || braced) {
      used.add(a);
      used.add(b);
      systems.push({ page, index: systems.length, upper: a, lower: b, x0: Math.min(a.x0, b.x0), x1: Math.max(a.x1, b.x1), bars: [] });
    }
  }
  return systems;
}
