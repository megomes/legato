import type { GrandSystem, HLine, PageLayout, Staff } from "../layout/types";
import { phrases } from "./directions";

/** A stretch of one staff, inside one system, that sounds `octaves` octaves away from where it is written. */
export interface OttavaSpan {
  sys: GrandSystem;
  staff: 0 | 1;
  x0: number;
  x1: number;
  octaves: number;
}

interface Marker {
  x: number;
  /** right edge of the marker text */
  xr: number;
  /** vertical centre of the marker, where its line is drawn */
  cy: number;
  size: number;
  size_: number;
  label: string;
  /** +1 up, -1 down, 0 = decided by placement */
  dir: number;
  octaves: number;
}

const TEXT = /^(8|8va|8vb|8ba|8va bassa|8 ?va|8 ?vb|15|15ma|15mb|22|22ma|22mb|ottava|ottava bassa)$/i;

function parseLabel(label: string): { dir: number; octaves: number } {
  const l = label.toLowerCase().replace(/\s+/g, "");
  const octaves = l.startsWith("22") ? 3 : l.startsWith("15") ? 2 : 1;
  const dir = /(vb|mb|ba|bassa)$/.test(l) ? -1 : /(va|ma|alta)$/.test(l) ? 1 : 0;
  return { dir, octaves };
}

/** Staves of a page in order, with the system each belongs to. */
function staves(page: PageLayout) {
  return page.systems.flatMap((sys) => [
    { sys, staff: 0 as const, st: sys.upper },
    { sys, staff: 1 as const, st: sys.lower },
  ]);
}

/** Follows a (possibly dashed) horizontal line starting near `x` at height `y`; returns its right end. */
function followLine(hlines: HLine[], x: number, y: number, sp: number, reach: number): number | null {
  const onRow = hlines.filter((l) => Math.abs(l.y - y) < 0.45 * sp && l.x1 - l.x0 < 400);
  let cur = onRow.filter((l) => l.x0 >= x - 1.5 * sp && l.x0 <= x + reach).sort((a, b) => a.x0 - b.x0)[0];
  if (!cur) return null;
  let end = cur.x1;
  for (;;) {
    const next = onRow.filter((l) => l.x0 > end - 0.5 && l.x0 - end < 2.2 * sp).sort((a, b) => a.x0 - b.x0)[0];
    if (!next) break;
    end = Math.max(end, next.x1);
    cur = next;
  }
  return end;
}

export function readOttavas(pages: PageLayout[]): { spans: OttavaSpan[]; problems: string[] } {
  const spans: OttavaSpan[] = [];
  const problems: string[] = [];
  // the last span of the previous system, when its line ran off the right edge
  let pending: { staff: 0 | 1; octaves: number; offset: number } | null = null;

  for (const page of pages) {
    const markers: Marker[] = [];
    for (const g of page.glyphs) {
      if (g.kind !== "ottava") continue;
      const { dir, octaves } = parseLabel(g.value);
      markers.push({ x: g.x, xr: g.x + g.adv, cy: g.y - g.size * 0.38, size: g.size, size_: g.size, label: g.value, dir, octaves });
    }
    for (const p of phrases(page.words)) {
      const t = p.text.trim();
      if (!TEXT.test(t)) continue;
      const { dir, octaves } = parseLabel(t);
      markers.push({ x: p.x, xr: p.x1, cy: p.y - p.size * 0.35, size: p.size, size_: p.size, label: t, dir, octaves });
    }
    markers.sort((a, b) => a.cy - b.cy || a.x - b.x);
    const all = staves(page);

    for (const sys of page.systems) {
      const sp = sys.upper.sp;
      const mine = markers.filter((m) => m.cy > sys.upper.top - 9 * sp && m.cy < sys.lower.bottom + 9 * sp && m.x > sys.x0 - sp && m.x < sys.x1);
      let continued = false;

      for (const m of mine) {
        // decide direction and the staff it governs
        const above = all.filter((s) => s.sys === sys && s.st.top > m.cy).sort((a, b) => a.st.top - b.st.top)[0];
        const below = all.filter((s) => s.sys === sys && s.st.bottom < m.cy).sort((a, b) => b.st.bottom - a.st.bottom)[0];
        let dir = m.dir;
        if (dir === 0) {
          // a bare number: above a staff means 8va, below means 8vb
          const dA = above ? above.st.top - m.cy : Infinity;
          const dB = below ? m.cy - below.st.bottom : Infinity;
          dir = dA <= dB ? 1 : -1;
        }
        const target = dir > 0 ? above : below;
        if (!target) {
          problems.push(`Octave sign "${m.label}" on page ${page.page + 1} is not next to a staff`);
          continue;
        }
        // plain "8"/"15" text is only an octave sign if a line follows it (otherwise it may be a fingering)
        // lines are drawn through the middle of the sign (8va) or along its baseline (8vb)
        const heights = dir > 0 ? [m.cy, m.cy + m.size * 0.38] : [m.cy + m.size * 0.38, m.cy];
        let end: number | null = null;
        let lineY = m.cy;
        for (const y of heights) {
          end = followLine(page.hlines, m.xr, y, sp, 3 * sp);
          if (end !== null) {
            lineY = y;
            break;
          }
        }
        if (end === null) {
          if (m.dir === 0 && !page.glyphs.some((g) => g.kind === "ottava" && Math.abs(g.x - m.x) < 1)) continue;
          problems.push(`Octave sign "${m.label}" on page ${page.page + 1}: its extension line could not be found`);
          continue;
        }
        const startsAtSystem = m.x < sys.x0 + 8 * sp;
        if (startsAtSystem && pending && pending.staff === target.staff) continued = true;
        spans.push({ sys, staff: target.staff, x0: m.x - 0.6 * sp, x1: end + 0.6 * sp, octaves: dir * m.octaves });
        pending = null;
        // a line that reaches the system edge continues on the next system unless it ends with a hook
        const hooked = page.vlines.some((v) => Math.abs(v.x - end!) < 1 && v.y1 - v.y0 < 2 * sp && Math.min(Math.abs(v.y0 - lineY), Math.abs(v.y1 - lineY)) < 0.5 * sp);
        if (end >= sys.x1 - 1.5 * sp && !hooked) pending = { staff: target.staff, octaves: dir * m.octaves, offset: lineY - target.st.top };
      }

      // a line carried over from the previous system without a new sign: look for it at the system start
      if (pending && !continued && !mine.length) {
        const st: Staff = pending.staff === 0 ? sys.upper : sys.lower;
        const y = st.top + pending.offset;
        const end = followLine(page.hlines, sys.x0, y, sp, 14 * sp);
        if (end === null) {
          problems.push(`An octave line ends at a system break on page ${page.page + 1} without a visible end`);
          pending = null;
        } else {
          spans.push({ sys, staff: pending.staff, x0: sys.x0, x1: end + 0.6 * sp, octaves: pending.octaves });
          if (end < sys.x1 - 1.5 * sp) pending = null;
        }
      } else if (pending && mine.length && !spans.some((s) => s.sys === sys)) {
        problems.push(`An octave line crosses a system break on page ${page.page + 1} and could not be followed`);
        pending = null;
      }
    }
  }
  return { spans, problems };
}
