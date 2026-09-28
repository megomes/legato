import type { GrandSystem, MusicGlyph, PageLayout, Word } from "../layout/types";
import type { Direction, MeasureModel } from "../score/types";

/** Default beats per minute for tempo words when no metronome mark is printed. */
const TEMPO_WORDS: [RegExp, number][] = [
  [/prestissimo/i, 200],
  [/presto/i, 176],
  [/vivace|vivo/i, 152],
  [/allegro\s+moderato/i, 120],
  [/allegretto/i, 112],
  [/allegro/i, 132],
  [/moderato|moderately/i, 104],
  [/andantino/i, 92],
  [/andante|walking/i, 84],
  [/adagietto/i, 76],
  [/adagio/i, 66],
  [/larghetto/i, 62],
  [/lento|slowly|slow/i, 56],
  [/largo/i, 50],
  [/grave/i, 42],
];

const DYNAMICS = new Set(["ppp", "pp", "p", "mp", "mf", "f", "ff", "fff", "sfz", "sf", "fp", "sfp", "rfz", "fz"]);

export interface DirectionContext {
  page: PageLayout;
  systems: { sys: GrandSystem; measures: MeasureModel[] }[];
}

interface Phrase {
  text: string;
  x: number;
  x1: number;
  y: number;
  size: number;
  italic: boolean;
  bold: boolean;
}

/** Joins words on the same baseline into phrases ("D.S. al Coda", "right hand"). */
export function phrases(words: Word[]): Phrase[] {
  const sorted = [...words].sort((a, b) => a.y - b.y || a.x - b.x);
  const out: Phrase[] = [];
  for (const w of sorted) {
    const last = out[out.length - 1];
    if (last && Math.abs(last.y - w.y) < w.size * 0.3 && w.x - last.x1 < w.size * 1.6 && w.x > last.x) {
      last.text += " " + w.text;
      last.x1 = w.x1;
      last.italic ||= w.italic;
      last.bold ||= w.bold;
    } else out.push({ text: w.text, x: w.x, x1: w.x1, y: w.y, size: w.size, italic: w.italic, bold: w.bold });
  }
  return out;
}

/**
 * Finds the system and measure an (x, y) point belongs to. Tempo, navigation and ending texts are engraved above
 * the system they govern, so in the gap between two systems they go to the one below.
 */
function locate(ctx: DirectionContext, x: number, y: number, above = false) {
  let best: { sys: GrandSystem; measures: MeasureModel[] } | null = null;
  let bestD = Infinity;
  if (above) {
    const below = ctx.systems.filter((s) => s.sys.upper.top > y && s.sys.upper.top - y < 12 * s.sys.upper.sp).sort((a, b) => a.sys.upper.top - b.sys.upper.top)[0];
    const inside = ctx.systems.find((s) => y >= s.sys.upper.top && y <= s.sys.lower.bottom);
    if (below && !inside) {
      best = below;
      bestD = 0;
    }
  }
  for (const s of bestD === 0 ? [] : ctx.systems) {
    // distance to the staves themselves; text between two systems goes to the nearer one
    const top = s.sys.upper.top;
    const bottom = s.sys.lower.bottom;
    const d = y < top ? top - y : y > bottom ? (y - bottom) * 1.05 : 0;
    if (d < bestD) {
      bestD = d;
      best = s;
    }
  }
  if (!best || bestD > 12 * best.sys.upper.sp) return null;
  const m = best.measures.find((m) => x >= m.x0 - 1 && x < m.x1) ?? (x < best.measures[0]?.x0 ? best.measures[0] : best.measures[best.measures.length - 1]);
  if (!m) return null;
  const staff: 0 | 1 = y < (best.sys.upper.bottom + best.sys.lower.top) / 2 ? 0 : 1;
  return { system: best, measure: m, at: Math.min(1, Math.max(0, (x - m.x0) / (m.x1 - m.x0 || 1))), staff };
}

export function readDirections(ctx: DirectionContext): Direction[] {
  const out: Direction[] = [];
  const page = ctx.page;
  const ABOVE = new Set<Direction["kind"]>(["tempo", "tempoText", "aTempo", "rit", "segno", "coda", "toCoda", "dalSegno", "daCapo", "fine", "volta"]);
  const push = (d: Omit<Direction, "measure" | "at">, x: number, y: number) => {
    const loc = locate(ctx, x, y, ABOVE.has(d.kind));
    if (!loc) return;
    out.push({ ...d, measure: loc.measure.index, at: loc.at, staff: d.staff ?? loc.staff, x, y, page: page.page });
  };

  // ---- symbols ---------------------------------------------------------------------------------
  const glyphs = page.glyphs;
  for (const g of glyphs) {
    if (g.kind === "segno") push({ kind: "segno" }, g.x, g.y);
    if (g.kind === "fermata") push({ kind: "fermata" }, g.x, g.y);
    if (g.kind === "pedal") push({ kind: "pedal", value: g.value }, g.x, g.y);
  }
  // Coda signs: the first one in the score marks the jump ("To Coda"), a later one at a system start the Coda itself.
  for (const g of glyphs.filter((g) => g.kind === "coda")) push({ kind: "coda" }, g.x, g.y);

  // dynamics written with music-text glyphs (p, m, f, s, z)
  const dyn = glyphs.filter((g) => g.kind === "dynamic").sort((a, b) => a.y - b.y || a.x - b.x);
  const groups: MusicGlyph[][] = [];
  for (const g of dyn) {
    const last = groups[groups.length - 1];
    const prev = last?.[last.length - 1];
    if (prev && Math.abs(prev.y - g.y) < 1 && g.x - (prev.x + prev.adv) < prev.size * 0.3) last.push(g);
    else groups.push([g]);
  }
  for (const grp of groups) {
    const v = grp.map((g) => g.value).join("");
    if (DYNAMICS.has(v)) push({ kind: "dynamic", value: v }, grp[0].x, grp[0].y);
  }

  // ---- metronome marks -------------------------------------------------------------------------
  const texts = page.text;
  for (const n of glyphs.filter((g) => g.kind === "metronomeNote")) {
    const lineY = n.y;
    const tol = Math.max(2, n.size * 0.4);
    const digitsMusic = glyphs.filter((g) => g.kind === "digit" && Math.abs(g.y - lineY) < tol && g.x > n.x && g.x - n.x < n.size * 6).map((g) => ({ x: g.x, ch: g.value }));
    const digitsText = texts.filter((t) => /[0-9]/.test(t.ch) && Math.abs(t.y - lineY) < tol && t.x > n.x && t.x - n.x < n.size * 6).map((t) => ({ x: t.x, ch: t.ch }));
    const digits = [...digitsMusic, ...digitsText].sort((a, b) => a.x - b.x);
    let num = "";
    let lastX = -Infinity;
    for (const d of digits) {
      if (num && d.x - lastX > n.size * 0.9) break;
      num += d.ch;
      lastX = d.x;
    }
    const bpm = Number(num);
    if (!(bpm >= 20 && bpm <= 400)) continue;
    const dotted = glyphs.some((g) => g.kind === "dot" && Math.abs(g.y - lineY) < tol && g.x > n.x && g.x - n.x < n.size * 1.2) ||
      texts.some((t) => t.ch === "." && Math.abs(t.y - lineY) < tol && t.x > n.x && t.x - n.x < n.size * 1.2);
    const base = n.value === "half" ? 2 : n.value === "eighth" ? 0.5 : 1;
    const symbol = (n.value === "half" ? "𝅗𝅥" : n.value === "eighth" ? "♪" : "♩") + (dotted ? "." : "");
    push({ kind: "tempo", bpm, unit: base * (dotted ? 1.5 : 1), value: `${symbol} = ${num}` }, n.x, n.y);
  }

  // ---- words -----------------------------------------------------------------------------------
  for (const p of phrases(page.words)) {
    const t = p.text.trim();
    const loc = locate(ctx, p.x, p.y, true);
    if (!loc) continue;
    const norm = t.toLowerCase().replace(/\s+/g, " ");
    if (/^(d\.?\s?s\.?|dal segno)\b/i.test(t)) {
      push({ kind: "dalSegno", value: /coda/i.test(t) ? "coda" : /fine/i.test(t) ? "fine" : "" }, p.x1, p.y);
      continue;
    }
    if (/^(d\.?\s?c\.?|da capo)\b/i.test(t)) {
      push({ kind: "daCapo", value: /coda/i.test(t) ? "coda" : /fine/i.test(t) ? "fine" : "" }, p.x1, p.y);
      continue;
    }
    if (/^(to|al) coda\b/i.test(t)) {
      push({ kind: "toCoda" }, p.x1, p.y);
      continue;
    }
    if (/^fine\.?$/i.test(t)) {
      push({ kind: "fine" }, p.x, p.y);
      continue;
    }
    if (/^(right hand|r\.\s?h\.?|rh|m\.\s?d\.?|mano destra|main droite|rechte hand|mão direita)$/i.test(norm)) {
      push({ kind: "hand", hand: "R" }, p.x, p.y);
      continue;
    }
    if (/^(left hand|l\.\s?h\.?|lh|m\.\s?s\.?|mano sinistra|main gauche|linke hand|mão esquerda)$/i.test(norm)) {
      push({ kind: "hand", hand: "L" }, p.x, p.y);
      continue;
    }
    if (/^(a tempo|tempo i|tempo primo|in tempo)\b/i.test(t)) {
      push({ kind: "aTempo" }, p.x, p.y);
      continue;
    }
    if (/^(rit|ritard|ritardando|rall|rallentando|allarg|allargando|poco rit|poco rall|molto rit|molto rall)\b/i.test(t)) {
      // the extension dashes end where the slowing ends
      push({ kind: "rit", value: t }, p.x, p.y);
      continue;
    }
    if (/^\d+\.(\s*,?\s*\d+\.)*$/.test(t) && p.y < loc.system.sys.upper.top) {
      const endings = t.match(/\d+/g)!.map(Number);
      push({ kind: "volta", endings, value: t }, p.x, p.y);
      continue;
    }
    if (DYNAMICS.has(norm.replace(/\s/g, "")) && p.italic) {
      push({ kind: "dynamic", value: norm.replace(/\s/g, "") }, p.x, p.y);
      continue;
    }
    for (const [re, bpm] of TEMPO_WORDS) {
      if (re.test(t) && p.y < loc.system.sys.upper.top) {
        push({ kind: "tempoText", bpm, value: t }, p.x, p.y);
        break;
      }
    }
  }
  return out;
}
