import type { GrandSystem, MusicGlyph, PageLayout, Staff } from "../layout/types";
import { frac, mul } from "../util/frac";
import type { Beam, Chord, ClefMark, ClefType, Curve, Frac, Head, KeyMark, Rest, StaffIndex, Stem, SystemSymbols, TimeMark, TupletMark } from "./types";

/** Staff positions (0 = bottom line) of key-signature accidentals on a treble staff, in order. */
const SHARP_POS_TREBLE = [8, 5, 9, 6, 3, 7, 4];
const FLAT_POS_TREBLE = [4, 7, 3, 6, 2, 5, 1];
/** Offset of a clef's staff positions relative to treble for key signature placement. */
const KEY_POS_OFFSET: Record<ClefType, number> = { G: 0, G8vb: 0, G8va: 0, F: -2, F8vb: -2, C: -1, tenorC: 1 };

const REST_BASE: Record<string, Frac> = {
  whole: frac(4),
  half: frac(2),
  quarter: frac(1),
  eighth: frac(1, 2),
  "16th": frac(1, 4),
  "32nd": frac(1, 8),
  "64th": frac(1, 16),
};

let idCounter = 1;
const nextId = () => idCounter++;

const posOf = (st: Staff, y: number) => (st.bottom - y) / (st.sp / 2);

const dotted = (base: Frac, dots: number): Frac => (dots === 0 ? base : mul(base, frac(2 ** (dots + 1) - 1, 2 ** dots)));

export const inkWidth = (page: PageLayout, g: MusicGlyph) => g.adv * (page.headInkRatios[`${g.font}|${g.code}`] ?? page.headInkRatio);

const ownerCache = new WeakMap<PageLayout, Map<MusicGlyph, number>>();

/**
 * Decides which system every music glyph belongs to. Glyphs between two systems go to the system whose ledger
 * lines they sit on (low bass notes can reach far below their own staff); other symbols follow the nearest notehead.
 */
function glyphOwners(page: PageLayout): Map<MusicGlyph, number> {
  const cached = ownerCache.get(page);
  if (cached) return cached;
  const owners = new Map<MusicGlyph, number>();
  const systems = page.systems;
  const ledgerAt = (y: number, cx: number, sp: number) =>
    page.hlines.some((l) => l.x1 - l.x0 < 4 * sp && Math.abs(l.y - y) < 0.2 * sp && l.x0 - 0.2 <= cx && l.x1 + 0.2 >= cx);
  const between = (y: number) => {
    for (let i = 0; i + 1 < systems.length; i++) if (y > systems[i].lower.bottom && y < systems[i + 1].upper.top) return i;
    return -1;
  };
  const nearest = (y: number) => {
    let best = 0;
    let bestD = Infinity;
    systems.forEach((s, i) => {
      const d = y < s.upper.top ? s.upper.top - y : y > s.lower.bottom ? y - s.lower.bottom : 0;
      if (d < bestD) {
        bestD = d;
        best = i;
      }
    });
    return best;
  };
  const heads = page.glyphs.filter((g) => g.kind === "notehead");
  for (const g of heads) {
    const i = between(g.y);
    if (i < 0) {
      owners.set(g, nearest(g.y));
      continue;
    }
    const a = systems[i];
    const b = systems[i + 1];
    const cx = g.x + inkWidth(page, g) / 2;
    const aLedger = g.y > a.lower.bottom + 0.9 * a.lower.sp ? ledgerAt(a.lower.bottom + a.lower.sp, cx, a.lower.sp) : g.y - a.lower.bottom < b.upper.top - g.y;
    const bLedger = g.y < b.upper.top - 0.9 * b.upper.sp ? ledgerAt(b.upper.top - b.upper.sp, cx, b.upper.sp) : b.upper.top - g.y < g.y - a.lower.bottom;
    owners.set(g, aLedger && !bLedger ? i : bLedger && !aLedger ? i + 1 : nearest(g.y));
  }
  for (const g of page.glyphs) {
    if (g.kind === "notehead") continue;
    const i = between(g.y);
    if (i < 0) {
      owners.set(g, nearest(g.y));
      continue;
    }
    const sp = systems[i].lower.sp;
    if (g.kind === "flag") {
      // a flag sits at the free end of a stem: follow that stem to the note at its other end
      const up = g.value.endsWith("u");
      const stem = page.vlines.find((v) => Math.abs(v.x - g.x) < 0.6 * sp && Math.abs((up ? v.y0 : v.y1) - g.y) < 0.6 * sp);
      const end = stem ? (up ? stem.y1 : stem.y0) : null;
      const head = stem && end !== null
        ? heads.find((h) => Math.abs(h.y - end) < 1.2 * sp && (Math.abs(h.x - stem.x) < 0.6 * sp || Math.abs(h.x + inkWidth(page, h) - stem.x) < 0.6 * sp))
        : undefined;
      if (head) {
        owners.set(g, owners.get(head)!);
        continue;
      }
    }
    const near = heads
      .filter((h) => Math.abs(h.y - g.y) < 1.2 * sp && Math.abs(h.x - g.x) < 5 * sp)
      .sort((p, q) => Math.abs(p.x - g.x) - Math.abs(q.x - g.x))[0];
    owners.set(g, near ? owners.get(near)! : nearest(g.y));
  }
  ownerCache.set(page, owners);
  return owners;
}

export function readSystemSymbols(page: PageLayout, sys: GrandSystem): SystemSymbols {
  const staves: [Staff, Staff] = [sys.upper, sys.lower];
  const sp = sys.upper.sp;
  const owners = glyphOwners(page);
  const sysIndex = page.systems.indexOf(sys);
  const problems: SystemSymbols["problems"] = [];
  const glyphs = page.glyphs.filter((g) => owners.get(g) === sysIndex && g.x >= sys.x0 - 2 * sp && g.x <= sys.x1 + 2 * sp);
  // vertical band covering everything this system owns (used for lines and shapes)
  const ys = glyphs.map((g) => g.y);
  const bandTop = Math.min(sys.upper.top - 6 * sp, ...ys.map((y) => y - 2 * sp));
  const bandBottom = Math.max(sys.lower.bottom + 6 * sp, ...ys.map((y) => y + 2 * sp));
  const gapMid = (sys.upper.bottom + sys.lower.top) / 2;

  const ledgers = page.hlines.filter((l) => l.x1 - l.x0 < 4 * sp && l.y > bandTop && l.y < bandBottom);
  const ledgerAt = (y: number, cx: number) => ledgers.some((l) => Math.abs(l.y - y) < 0.2 * sp && l.x0 - 0.2 <= cx && l.x1 + 0.2 >= cx);

  const staffOf = (y: number): StaffIndex => (y < gapMid ? 0 : 1);
  /** Noteheads in the gap between staves belong to the staff whose ledger lines they sit on. */
  const headStaff = (y: number, cx: number): StaffIndex => {
    const u = sys.upper;
    const l = sys.lower;
    if (y <= u.bottom + 1.1 * u.sp) return 0;
    if (y >= l.top - 1.1 * l.sp) return 1;
    const upperLedger = ledgerAt(u.bottom + u.sp, cx);
    const lowerLedger = ledgerAt(l.top - l.sp, cx);
    if (upperLedger && !lowerLedger) return 0;
    if (lowerLedger && !upperLedger) return 1;
    if (upperLedger && lowerLedger) problems.push({ x: cx, message: "Notehead between staves has ledger lines from both staves", severity: "warning" });
    return staffOf(y);
  };

  // ---- noteheads -------------------------------------------------------------------------------
  const heads: Head[] = [];
  for (const g of glyphs) {
    if (g.kind !== "notehead") continue;
    const cx = g.x + inkWidth(page, g) / 2;
    const staff = headStaff(g.y, cx);
    const st = staves[staff];
    const p = posOf(st, g.y);
    const pos = Math.round(p);
    if (Math.abs(p - pos) > 0.22) problems.push({ x: g.x, staff, message: `Notehead not aligned to a staff position (${p.toFixed(2)})`, severity: "error" });
    // ledger lines must exist for notes outside the staff
    if (!g.small) {
      const needBelow = pos <= -2 ? Math.floor(-pos / 2) : 0;
      const needAbove = pos >= 10 ? Math.floor((pos - 8) / 2) : 0;
      for (let k = 1; k <= needBelow; k++)
        if (!ledgerAt(st.bottom + k * st.sp, cx)) problems.push({ x: g.x, staff, message: `Missing ledger line below note`, severity: "warning" });
      for (let k = 1; k <= needAbove; k++)
        if (!ledgerAt(st.top - k * st.sp, cx)) problems.push({ x: g.x, staff, message: `Missing ledger line above note`, severity: "warning" });
    }
    heads.push({ id: nextId(), glyph: g, staff, x: g.x, xr: g.x + inkWidth(page, g), y: g.y, pos, type: g.value as Head["type"], grace: g.small });
  }

  // ---- stems -----------------------------------------------------------------------------------
  const barXs = sys.bars.map((b) => [b.x0 - 0.5, b.x1 + 0.5] as const);
  const onBar = (x: number) => barXs.some(([a, b]) => x >= a && x <= b);
  const stems: Stem[] = page.vlines
    .filter((v) => v.x > sys.x0 && v.x < sys.x1 + 0.5 && v.y1 > bandTop && v.y0 < bandBottom && v.y1 - v.y0 >= 1.2 * sp && v.width < 0.35 * sp)
    .filter((v) => !(onBar(v.x) && v.y0 <= sys.upper.top + 0.3 * sp && v.y1 >= sys.upper.bottom - 0.3 * sp))
    .map((v) => ({ x: v.x, y0: v.y0, y1: v.y1 }));

  // ---- beams -----------------------------------------------------------------------------------
  const beams: Beam[] = [];
  for (const s of page.shapes) {
    if (s.kind !== "fill" || s.hasCurves || s.subpaths.length !== 1) continue;
    const [bx0, by0, bx1, by1] = s.bbox;
    if (by1 < bandTop || by0 > bandBottom || bx1 < sys.x0 || bx0 > sys.x1 + 1) continue;
    const pts = s.subpaths[0];
    const uniq = pts.filter((p, i) => pts.findIndex((q) => Math.abs(q[0] - p[0]) < 0.01 && Math.abs(q[1] - p[1]) < 0.01) === i);
    if (uniq.length !== 4) continue;
    const byX = [...uniq].sort((a, b) => a[0] - b[0]);
    const L = byX.slice(0, 2);
    const R = byX.slice(2);
    if (Math.abs(L[0][0] - L[1][0]) > 0.3 || Math.abs(R[0][0] - R[1][0]) > 0.3) continue;
    const tL = Math.abs(L[0][1] - L[1][1]);
    const tR = Math.abs(R[0][1] - R[1][1]);
    if (Math.abs(tL - tR) > 0.1 * sp || tL < 0.25 * sp || tL > 0.8 * sp) continue;
    const xa = (L[0][0] + L[1][0]) / 2;
    const xb = (R[0][0] + R[1][0]) / 2;
    if (xb - xa < 0.5 * sp) continue;
    beams.push({ xa, ya: (L[0][1] + L[1][1]) / 2, xb, yb: (R[0][1] + R[1][1]) / 2, thickness: tL });
  }
  for (const l of page.otherLines) {
    if (l.width < 0.25 * sp || l.width > 0.8 * sp) continue;
    const [a, b] = l.x1 < l.x2 ? [[l.x1, l.y1], [l.x2, l.y2]] : [[l.x2, l.y2], [l.x1, l.y1]];
    if (a[1] < bandTop || a[1] > bandBottom || b[0] - a[0] < 0.5 * sp) continue;
    if (Math.abs(b[1] - a[1]) > (b[0] - a[0]) * 1.2) continue;
    beams.push({ xa: a[0], ya: a[1], xb: b[0], yb: b[1], thickness: l.width });
  }
  const beamY = (b: Beam, x: number) => b.ya + ((b.yb - b.ya) * (x - b.xa)) / (b.xb - b.xa || 1);

  // ---- chords ----------------------------------------------------------------------------------
  const tol = Math.max(0.6, 0.12 * sp);
  const chords: Chord[] = [];
  const graceChords: Chord[] = [];
  const stemmed = new Set<Head>();
  for (const stem of stems) {
    let attached = heads.filter(
      (h) => (Math.abs(stem.x - h.x) < tol || Math.abs(stem.x - h.xr) < tol) && h.y >= stem.y0 - 0.7 * sp && h.y <= stem.y1 + 0.7 * sp && h.type !== "whole" && h.type !== "breve",
    );
    if (!attached.length) continue;
    {
      // Up-stems carry their heads on the left, down-stems on the right. Heads on the other side are only
      // part of the chord when they form a second with it (displaced noteheads); otherwise they belong to
      // another voice that happens to touch this stem.
      const left = attached.filter((h) => Math.abs(stem.x - h.xr) < tol);
      const right = attached.filter((h) => Math.abs(stem.x - h.x) < tol && !left.includes(h));
      const t = Math.min(...attached.map((h) => h.y));
      const b = Math.max(...attached.map((h) => h.y));
      const upLike = Math.abs(stem.y1 - b) < 1.0 * sp;
      const [normal, other] = upLike ? [left, right] : [right, left];
      if (normal.length) {
        // In a second the upper note goes right of an up-stem and the lower note left of a down-stem.
        const step = upLike ? 1 : -1;
        attached = [...normal, ...other.filter((h) => normal.some((n) => n.staff === h.staff && h.pos - n.pos === step))];
      }
      void t;
    }
    const top = Math.min(...attached.map((h) => h.y));
    const bottom = Math.max(...attached.map((h) => h.y));
    let dir: Chord["dir"];
    if (Math.abs(stem.y1 - bottom) < 1.0 * sp && stem.y0 < top - 0.8 * sp) dir = "up";
    else if (Math.abs(stem.y0 - top) < 1.0 * sp && stem.y1 > bottom + 0.8 * sp) dir = "down";
    else continue; // a line touching noteheads without a free end is not a stem (e.g. a barline next to a note)
    // Heads close to the free end of the stem belong to another voice that the stem happens to reach.
    const freeGap = (attached.every((h) => h.grace) ? 1.1 : 1.8) * sp;
    attached = attached.filter((h) => (dir === "up" ? h.y - stem.y0 : stem.y1 - h.y) >= freeGap);
    if (!attached.length) continue;
    const grace = attached.every((h) => h.grace);
    // Heads on the normal side of the stem define the alignment column.
    const normal = attached.filter((h) => (dir === "up" ? Math.abs(stem.x - h.xr) < tol : Math.abs(stem.x - h.x) < tol));
    const ref = normal.length ? normal : attached;
    const anchor = ref.reduce((s, h) => s + (h.x + h.xr) / 2, 0) / ref.length;
    const staffVotes = attached.reduce((s, h) => s + h.staff, 0) / attached.length;
    const staff: StaffIndex = staffVotes > 0.5 ? 1 : 0;
    if (attached.some((h) => h.staff !== staff))
      problems.push({ x: stem.x, staff, message: "Chord spans both staves", severity: "warning" });
    attached.forEach((h) => stemmed.add(h));

    // beams stacked from the free end of the stem
    const tip = dir === "up" ? stem.y0 : stem.y1;
    const crossing = beams
      .filter((b) => stem.x >= b.xa - 0.4 && stem.x <= b.xb + 0.4)
      .map((b) => ({ b, d: dir === "up" ? beamY(b, stem.x) - tip : tip - beamY(b, stem.x) }))
      .filter((c) => c.d > -0.6 * sp && c.d < 4 * sp)
      .sort((p, q) => p.d - q.d);
    let beamCount = 0;
    let last = -Infinity;
    for (const c of crossing) {
      if (beamCount === 0) {
        if (c.d > 0.7 * sp) break;
      } else if (c.d - last > 1.15 * sp || c.d - last < 0.4 * sp) break;
      beamCount++;
      last = c.d;
    }
    const chord: Chord = {
      id: nextId(),
      staff,
      heads: attached.sort((a, b) => b.y - a.y),
      stem,
      dir,
      anchor,
      beams: beamCount,
      flags: 0,
      dots: 0,
      grace,
      base: frac(1),
    };
    (grace ? graceChords : chords).push(chord);
  }
  // Each flag belongs to exactly one stem: same direction, tip closest to the flag's origin.
  for (const g of glyphs.filter((g) => g.kind === "flag")) {
    const dir = g.value.endsWith("u") ? "up" : "down";
    const owner = [...chords, ...graceChords]
      .filter((c) => c.stem && c.dir === dir && Math.abs(g.x - c.stem.x) < 0.6 * sp)
      .map((c) => ({ c, d: Math.abs(g.y - (dir === "up" ? c.stem!.y0 : c.stem!.y1)) }))
      .filter((o) => o.d < 2.5 * sp)
      .sort((a, b) => a.d - b.d)[0];
    if (owner) owner.c.flags += Number(g.value[0]);
    else problems.push({ x: g.x, staff: staffOf(g.y), message: "Flag not attached to any stem", severity: "error" });
  }
  // Stemless noteheads: whole notes and breves, clustered by position.
  const loose = heads.filter((h) => !stemmed.has(h)).sort((a, b) => a.x - b.x);
  const clusters: Head[][] = [];
  for (const h of loose) {
    if (h.type !== "whole" && h.type !== "breve") {
      problems.push({ x: h.x, staff: h.staff, message: "Notehead without a stem", severity: "error" });
      continue;
    }
    const c = clusters.find((cl) => cl[0].staff === h.staff && cl.some((o) => h.x <= o.xr + 0.3 * sp && h.xr >= o.x - 0.3 * sp));
    if (c) c.push(h);
    else clusters.push([h]);
  }
  for (const cl of clusters) {
    const minX = Math.min(...cl.map((h) => h.x));
    const w = cl[0].xr - cl[0].x;
    chords.push({
      id: nextId(),
      staff: cl[0].staff,
      heads: cl.sort((a, b) => b.y - a.y),
      stem: null,
      dir: "none",
      anchor: minX + w / 2,
      beams: 0,
      flags: 0,
      dots: 0,
      grace: cl.every((h) => h.grace),
      base: frac(1),
    });
  }

  // ---- rests -----------------------------------------------------------------------------------
  /** Rests inside a staff belong to it; rests in the gap follow the nearest notes around them. */
  const restStaff = (g: MusicGlyph): StaffIndex => {
    if (g.y <= sys.upper.bottom + 0.5 * sp) return 0;
    if (g.y >= sys.lower.top - 0.5 * sp) return 1;
    const near = heads
      .filter((h) => Math.abs(h.x - g.x) < 8 * sp && !h.grace)
      .map((h) => ({ h, d: Math.hypot((h.x - g.x) / 3, h.y - g.y) }))
      .sort((a, b) => a.d - b.d)[0];
    return near ? near.h.staff : staffOf(g.y);
  };
  const rests: Rest[] = glyphs
    .filter((g) => g.kind === "rest" && !g.small)
    .map((g) => ({
      id: nextId(),
      staff: restStaff(g),
      glyph: g,
      x: g.x,
      anchor: g.x + g.adv / 2,
      y: g.y,
      value: g.value,
      dots: 0,
      measureRest: g.value === "whole",
      base: REST_BASE[g.value],
    }));

  // ---- augmentation dots -------------------------------------------------------------------------
  const repeatBars = sys.bars.filter((b) => b.style.startsWith("repeat"));
  const dotGlyphs = glyphs.filter((g) => g.kind === "dot" && !repeatBars.some((b) => g.x > b.x0 - 2 * sp && g.x < b.x1 + 2 * sp));
  const dotOwners = new Map<Chord | Rest, MusicGlyph[]>();
  for (const d of dotGlyphs) {
    let best: Chord | Rest | null = null;
    let bestDx = Infinity;
    for (const c of [...chords, ...graceChords]) {
      const right = Math.max(...c.heads.map((h) => h.xr));
      const dx = d.x - right;
      if (dx <= 0 || dx > 2.4 * sp) continue;
      const dy = Math.min(...c.heads.map((h) => Math.abs(h.y - d.y)));
      if (dy > 0.8 * sp) continue;
      if (dx < bestDx) {
        best = c;
        bestDx = dx;
      }
    }
    for (const r of rests) {
      const dx = d.x - (r.x + r.glyph.adv);
      if (dx <= -0.2 || dx > 1.6 * sp || Math.abs(d.y - r.y) > 2 * sp) continue;
      if (dx < bestDx) {
        best = r;
        bestDx = dx;
      }
    }
    if (best) {
      if (!dotOwners.has(best)) dotOwners.set(best, []);
      dotOwners.get(best)!.push(d);
    }
  }
  for (const [owner, ds] of dotOwners) {
    // dots on the same row count as double/triple dots
    const rows: MusicGlyph[][] = [];
    for (const d of ds) {
      const row = rows.find((r) => Math.abs(r[0].y - d.y) < 0.3 * sp);
      if (row) row.push(d);
      else rows.push([d]);
    }
    owner.dots = Math.max(...rows.map((r) => r.length));
  }

  // ---- durations -------------------------------------------------------------------------------
  for (const c of [...chords, ...graceChords]) {
    const type = c.heads[0].type;
    if (c.heads.some((h) => h.type !== type)) problems.push({ x: c.anchor, staff: c.staff, message: "Chord mixes notehead types", severity: "error" });
    let base: Frac;
    if (type === "breve") base = frac(8);
    else if (type === "whole") base = frac(4);
    else if (type === "half") {
      base = frac(2);
      if (c.beams || c.flags) problems.push({ x: c.anchor, staff: c.staff, message: "Half note with beams (tremolo) is not supported", severity: "error" });
    } else base = frac(1, 2 ** (c.beams + c.flags));
    c.base = dotted(base, c.dots);
  }
  for (const r of rests) r.base = dotted(r.base, r.dots);

  // ---- clefs -----------------------------------------------------------------------------------
  const clefs: ClefMark[] = [];
  for (const g of glyphs.filter((g) => g.kind === "clef")) {
    const staff = staffOf(g.y);
    const st = staves[staff];
    const p = Math.round(posOf(st, g.y));
    let clef = g.value as ClefType;
    const expected = clef === "F" ? 6 : clef === "C" ? 4 : 2;
    if (clef === "C" && p === 6) clef = "tenorC";
    else if (p !== expected) {
      problems.push({ x: g.x, staff, message: `Clef on an unexpected line (${p})`, severity: "error" });
      continue;
    }
    // small "8" above/below a clef makes it an octave clef
    const eight = glyphs.find((d) => (d.kind === "digit" || d.kind === "timesig") && d.value === "8" && Math.abs(d.x - (g.x + g.adv / 2)) < 1.5 * sp && d.size < g.size * 0.7);
    if (eight) {
      if (eight.y < st.top) clef = clef === "G" ? "G8va" : clef;
      else if (eight.y > st.bottom) clef = clef === "G" ? "G8vb" : clef === "F" ? "F8vb" : clef;
    }
    clefs.push({ staff, x: g.x, clef, small: g.small });
  }
  for (const s of [0, 1] as StaffIndex[])
    if (!clefs.some((c) => c.staff === s && c.x < sys.x0 + 5 * sp)) problems.push({ x: sys.x0, staff: s, message: "No clef at the start of the system", severity: "error" });

  // ---- time signatures --------------------------------------------------------------------------
  const times: TimeMark[] = [];
  const tsGlyphs = glyphs.filter((g) => g.kind === "timesig");
  const perStaff: { staff: StaffIndex; x: number; num: number; den: number }[] = [];
  for (const s of [0, 1] as StaffIndex[]) {
    const st = staves[s];
    const mine = tsGlyphs.filter((g) => staffOf(g.y) === s).sort((a, b) => a.x - b.x);
    const groups: MusicGlyph[][] = [];
    for (const g of mine) {
      const last = groups[groups.length - 1];
      if (last && g.x - last[last.length - 1].x < 1.6 * sp) last.push(g);
      else groups.push([g]);
    }
    const center = (st.top + st.bottom) / 2;
    for (const grp of groups) {
      if (grp.some((g) => g.y < st.top - 0.5 * st.sp || g.y > st.bottom + 2.5 * st.sp)) {
        problems.push({ x: grp[0].x, staff: s, message: "Number outside the staff (multi-measure rest?)", severity: "error" });
        continue;
      }
      const sym = grp.find((g) => g.value === "common" || g.value === "cut");
      if (sym) {
        perStaff.push({ staff: s, x: grp[0].x, num: sym.value === "common" ? 4 : 2, den: sym.value === "common" ? 4 : 2 });
        continue;
      }
      const top = grp.filter((g) => g.y < center + 0.5 * st.sp).map((g) => g.value).join("");
      const bot = grp.filter((g) => g.y >= center + 0.5 * st.sp).map((g) => g.value).join("");
      const num = Number(top);
      const den = Number(bot);
      if (!top || !bot || ![1, 2, 4, 8, 16, 32].includes(den) || !(num > 0)) {
        problems.push({ x: grp[0].x, staff: s, message: `Unreadable time signature ${top}/${bot}`, severity: "error" });
        continue;
      }
      perStaff.push({ staff: s, x: grp[0].x, num, den });
    }
  }
  for (const t of perStaff.filter((t) => t.staff === 0)) {
    const other = perStaff.find((o) => o.staff === 1 && Math.abs(o.x - t.x) < 2 * sp);
    if (!other || other.num !== t.num || other.den !== t.den) {
      problems.push({ x: t.x, message: "Time signature differs between staves", severity: "error" });
      continue;
    }
    times.push({ x: Math.min(t.x, other.x), num: t.num, den: t.den });
  }

  // ---- key signatures and accidentals -----------------------------------------------------------
  const clefAt = (staff: StaffIndex, x: number): ClefType => {
    const c = clefs.filter((c) => c.staff === staff && c.x <= x).sort((a, b) => b.x - a.x)[0];
    return c?.clef ?? "G";
  };
  const accGlyphs = glyphs.filter((g) => g.kind === "accidental").sort((a, b) => a.x - b.x);
  const used = new Set<MusicGlyph>();
  const keys: KeyMark[] = [];

  /** Reads a run of key signature accidentals; returns fifths or null if the run does not follow the standard order. */
  const readKeyRun = (run: MusicGlyph[], staff: StaffIndex): number | null => {
    const st = staves[staff];
    const signed = run.filter((g) => g.value !== "natural");
    if (!signed.length) return 0;
    const kind = signed[0].value;
    if (signed.some((g) => g.value !== kind) || (kind !== "sharp" && kind !== "flat")) return null;
    const clef = clefAt(staff, run[0].x);
    const order = (kind === "sharp" ? SHARP_POS_TREBLE : FLAT_POS_TREBLE).map((p) => p + KEY_POS_OFFSET[clef]);
    for (let i = 0; i < signed.length; i++) {
      const p = Math.round(posOf(st, signed[i].y));
      // some engravers place the same pitch an octave apart; compare modulo 7
      if (i >= order.length || ((p - order[i]) % 7 + 7) % 7 !== 0) return null;
    }
    return kind === "sharp" ? signed.length : -signed.length;
  };

  const firstEventX = (staff: StaffIndex, after: number) =>
    Math.min(
      ...chords.filter((c) => c.staff === staff && c.anchor > after).map((c) => Math.min(...c.heads.map((h) => h.x))),
      ...rests.filter((r) => r.staff === staff && r.x > after).map((r) => r.x),
      Infinity,
    );

  // Key signature at the start of the system: the longest evenly spaced prefix that follows the standard order.
  // Accidentals after it belong to the first notes. Both staves must agree.
  const startKeys = ([0, 1] as StaffIndex[]).map((s) => {
    const startClef = clefs.filter((c) => c.staff === s).sort((a, b) => a.x - b.x)[0];
    const from = startClef ? startClef.x : sys.x0;
    const limit = Math.min(firstEventX(s, from), ...times.map((t) => t.x), sys.bars[1]?.x ?? Infinity);
    const run = accGlyphs.filter((g) => staffOf(g.y) === s && g.x > from && g.x < limit);
    const prefixes: { run: MusicGlyph[]; fifths: number }[] = [{ run: [], fifths: 0 }];
    for (let n = 1; n <= run.length; n++) {
      const pre = run.slice(0, n);
      if (n > 1 && pre[n - 1].x - pre[n - 2].x > 1.6 * sp) break;
      const f = readKeyRun(pre, s);
      if (f === null) break;
      prefixes.push({ run: pre, fifths: f });
    }
    return { s, from, run, prefixes };
  });
  const common = startKeys[0].prefixes.filter((p) => startKeys[1].prefixes.some((q) => q.fifths === p.fifths)).map((p) => p.fifths);
  // the largest signature both staves can read, as long as leftovers can be attached to notes
  const attachable = (g: MusicGlyph, s: StaffIndex) => heads.some((h) => h.staff === s && Math.abs(h.y - g.y) < 0.3 * sp && h.x > g.x && h.x - g.x < 6 * sp);
  const chosen = common
    .sort((a, b) => Math.abs(b) - Math.abs(a))
    .find((f) =>
      startKeys.every((k) => {
        const p = k.prefixes.find((q) => q.fifths === f)!;
        return k.run.slice(p.run.length).every((g) => attachable(g, k.s));
      }),
    );
  if (chosen === undefined) {
    problems.push({ x: sys.x0, message: "Key signature does not follow the standard order", severity: "error" });
  } else {
    for (const k of startKeys) {
      const p = k.prefixes.find((q) => q.fifths === chosen)!;
      p.run.forEach((g) => used.add(g));
      keys.push({ staff: k.s, x: k.from, fifths: chosen });
    }
  }
  // Key changes after a barline: an accidental run in both staves at the same place, not attached to notes.
  for (const bar of sys.bars.slice(1)) {
    const runs = ([0, 1] as StaffIndex[]).map((s) => {
      const after = accGlyphs.filter((g) => !used.has(g) && staffOf(g.y) === s && g.x > bar.x1 && g.x < bar.x1 + 12 * sp).sort((a, b) => a.x - b.x);
      const run: MusicGlyph[] = [];
      for (const g of after) {
        const prev = run[run.length - 1];
        if (!prev ? g.x - bar.x1 < 2 * sp : g.x - prev.x < 1.6 * sp) run.push(g);
        else break;
      }
      // the run ends where a note follows closely at the same pitch: that last accidental belongs to the note
      while (run.length) {
        const last = run[run.length - 1];
        const owner = heads.some((h) => h.staff === s && Math.abs(h.y - last.y) < 0.3 * sp && h.x > last.x && h.x - last.x < 2.2 * sp);
        const nextAcc = accGlyphs.some((g) => g !== last && staffOf(g.y) === s && g.x > last.x && g.x - last.x < 1.6 * sp);
        if (owner && !nextAcc) run.pop();
        else break;
      }
      return run;
    });
    if (!runs[0].length || !runs[1].length || Math.abs(runs[0][0].x - runs[1][0].x) > 1.5 * sp) continue;
    const f0 = readKeyRun(runs[0], 0);
    const f1 = readKeyRun(runs[1], 1);
    if (f0 === null || f1 === null || f0 !== f1) continue;
    runs.flat().forEach((g) => used.add(g));
    keys.push({ staff: 0, x: runs[0][0].x, fifths: f0 }, { staff: 1, x: runs[1][0].x, fifths: f1 });
  }
  // Remaining accidentals belong to the nearest notehead on their right at the same staff position.
  const parens = glyphs.filter((g) => g.kind === "paren");
  for (const g of accGlyphs) {
    if (used.has(g)) continue;
    const candidates = heads
      .filter((h) => Math.abs(h.y - g.y) < 0.3 * sp && h.x > g.x && h.x - g.x < 6 * sp && h.grace === g.small)
      .sort((a, b) => a.x - b.x);
    const target = candidates.find((h) => !h.accidental);
    if (!target) {
      // Beyond the last barline of a system (courtesy key signature) nothing needs to be read.
      const lastBar = sys.bars[sys.bars.length - 1];
      if (g.x > lastBar.x1) continue;
      problems.push({ x: g.x, staff: staffOf(g.y), message: `Accidental (${g.value}) not attached to any note`, severity: "error" });
      continue;
    }
    target.accidental = g.value as Head["accidental"];
    target.courtesy = parens.some((p) => Math.abs(p.y - g.y) < 0.6 * sp && Math.abs(p.x - g.x) < 1.5 * sp);
  }

  // ---- tuplets ---------------------------------------------------------------------------------
  const tuplets: TupletMark[] = [];
  // Tuplet numbers come from the music text font, or (MuseScore, Dorico…) from an italic text font.
  const digitTop = sys.upper.top - 10 * sp;
  const digitBottom = sys.lower.bottom + 10 * sp;
  const italicDigits: MusicGlyph[] = page.text
    .filter((t) => t.italic && /^[2-9]$/.test(t.ch) && t.y > digitTop && t.y < digitBottom && t.x > sys.x0 && t.x < sys.x1)
    .filter((t) => !page.text.some((o) => o !== t && Math.abs(o.y - t.y) < t.size * 0.3 && Math.abs(o.x - t.x) < t.size * 0.9 && o.ch.trim() !== ""))
    .map((t) => ({ kind: "digit", value: t.ch, x: t.x, y: t.y, size: t.size, adv: t.adv, font: t.font, code: t.ch.charCodeAt(0), small: false }));
  const digits = [...glyphs.filter((g) => g.kind === "digit"), ...italicDigits];
  const metronomeNotes = page.glyphs.filter((g) => g.kind === "metronomeNote");
  for (const g of digits) {
    // digits of a metronome mark (♩ = 138) or of any multi-digit number are not tuplet numbers
    if (metronomeNotes.some((m) => Math.abs(m.y - g.y) < 0.6 * sp && g.x > m.x && g.x - m.x < 12 * sp)) continue;
    if (digits.some((d) => d !== g && Math.abs(d.y - g.y) < 0.2 * sp && Math.abs(d.x - g.x) < g.size * 0.8)) continue;
    const n = Number(g.value);
    if (![2, 3, 4, 5, 6, 7, 9].includes(n)) continue;
    // Digits in a tuplet are italic numbers set between/above beams; find an optional bracket around it.
    const midY = g.y - g.size * 0.35;
    const left = [...page.hlines, ...page.otherLines.map((l) => ({ y: (l.y1 + l.y2) / 2, x0: Math.min(l.x1, l.x2), x1: Math.max(l.x1, l.x2), width: l.width }))].filter(
      (l) => Math.abs(l.y - midY) < 1.2 * sp && l.x1 <= g.x + 0.2 && g.x - l.x1 < 1.5 * sp && l.x1 - l.x0 < 10 * sp,
    );
    const right = [...page.hlines, ...page.otherLines.map((l) => ({ y: (l.y1 + l.y2) / 2, x0: Math.min(l.x1, l.x2), x1: Math.max(l.x1, l.x2), width: l.width }))].filter(
      (l) => Math.abs(l.y - midY) < 1.2 * sp && l.x0 >= g.x + g.adv - 0.2 && l.x0 - (g.x + g.adv) < 1.5 * sp && l.x1 - l.x0 < 10 * sp,
    );
    const bracket: [number, number] | undefined = left.length && right.length ? [Math.min(...left.map((l) => l.x0)), Math.max(...right.map((l) => l.x1))] : undefined;
    // measure numbers sit above the upper staff next to a barline or the system start
    const nearBar = sys.bars.some((b) => Math.abs(g.x - b.x) < 2.5 * sp) || g.x < sys.x0 + 3 * sp;
    if (g.y < sys.upper.top - 0.5 * sp && nearBar && !bracket) continue;
    tuplets.push({ x: g.x + g.adv / 2, y: g.y, n, staff: staffOf(g.y), bracket });
  }

  // ---- curves (ties and slurs) -------------------------------------------------------------------
  const curves: Curve[] = [];
  for (const s of page.shapes) {
    // Some producers (e.g. Skia) flatten curves into many-sided polygons.
    const flattenedArc = !s.hasCurves && s.subpaths.length === 1 && s.subpaths[0].length >= 10 && s.bbox[2] - s.bbox[0] > 1.5 * sp;
    if (!s.hasCurves && !flattenedArc) continue;
    const [bx0, by0, bx1, by1] = s.bbox;
    if (by1 < bandTop || by0 > bandBottom || bx1 < sys.x0 - sp || bx0 > sys.x1 + 2 * sp) continue;
    const pts = s.subpaths.flat();
    const left = pts.reduce((a, b) => (b[0] < a[0] ? b : a));
    const right = pts.reduce((a, b) => (b[0] > a[0] ? b : a));
    const endY = (left[1] + right[1]) / 2;
    const above = by0 < endY - 0.1 && Math.abs(by0 - endY) > Math.abs(by1 - endY);
    curves.push({ left, right, width: bx1 - bx0, height: by1 - by0, above });
  }

  return { staves, heads, chords, graceChords, rests, clefs, keys, times, tuplets, curves, beams, problems };
}
