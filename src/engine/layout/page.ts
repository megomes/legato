import { classify, type FontProfile } from "../glyphs/fonts";
import type { RawPage, RawShape } from "../pdf/types";
import { detectStaves, pairSystems } from "./staves";
import type { HLine, MusicGlyph, PageLayout, TextGlyph, VLine, Word } from "./types";

function mode(values: number[]): number {
  const counts = new Map<number, number>();
  let best = 0;
  let bestN = 0;
  for (const v of values) {
    const k = Math.round(v * 10) / 10;
    const n = (counts.get(k) ?? 0) + 1;
    counts.set(k, n);
    if (n > bestN) {
      bestN = n;
      best = k;
    }
  }
  return best;
}

/** Axis-aligned filled rectangle → its bbox, else null. */
function asRect(s: RawShape): [number, number, number, number] | null {
  if (s.kind !== "fill" || s.hasCurves || s.subpaths.length !== 1) return null;
  const pts = s.subpaths[0];
  if (pts.length < 4 || pts.length > 6) return null;
  const [x0, y0, x1, y1] = s.bbox;
  const tol = 0.05;
  for (const [x, y] of pts) {
    const onX = Math.abs(x - x0) < tol || Math.abs(x - x1) < tol;
    const onY = Math.abs(y - y0) < tol || Math.abs(y - y1) < tol;
    if (!onX || !onY) return null;
  }
  return [x0, y0, x1, y1];
}

export interface PageIssues {
  unknownGlyphs: { font: string; code: number; x: number; y: number }[];
}

export function buildPageLayout(raw: RawPage, profiles: Map<string, FontProfile>, issues: PageIssues): PageLayout {
  const glyphs: MusicGlyph[] = [];
  const text: TextGlyph[] = [];
  for (const g of raw.glyphs) {
    const profile = profiles.get(g.font)!;
    const meaning = classify(profile, g.code);
    if (meaning) {
      if (meaning.kind === "ignore") continue;
      glyphs.push({ kind: meaning.kind, value: meaning.value, x: g.x, y: g.y, size: g.size, adv: g.adv, font: g.font, code: g.code, small: false });
      continue;
    }
    if (profile.role === "music" || profile.role === "special") {
      issues.unknownGlyphs.push({ font: g.font, code: g.code, x: g.x, y: g.y });
      continue;
    }
    text.push({
      ch: String.fromCodePoint(g.code || 0x20),
      x: g.x,
      y: g.y,
      size: g.size,
      adv: g.adv,
      font: g.font,
      italic: /Italic|Oblique|It\b/i.test(g.font),
      bold: /Bold|Black|Heavy/i.test(g.font),
    });
  }

  // Mark small (grace/cue) noteheads and clefs relative to the page's dominant size.
  for (const kind of ["notehead", "clef", "accidental", "rest", "flag", "dot"] as const) {
    const of = glyphs.filter((g) => g.kind === kind);
    if (!of.length) continue;
    const ref = mode(glyphs.filter((g) => g.kind === "notehead").map((g) => g.size)) || mode(of.map((g) => g.size));
    for (const g of of) g.small = g.size < ref * 0.85;
  }

  const hlines: HLine[] = [];
  const vlines: VLine[] = [];
  const otherLines: PageLayout["otherLines"] = [];
  for (const l of raw.lines) {
    const dx = Math.abs(l.x2 - l.x1);
    const dy = Math.abs(l.y2 - l.y1);
    if (dy <= 0.05 && dx > 0.5) hlines.push({ y: (l.y1 + l.y2) / 2, x0: Math.min(l.x1, l.x2), x1: Math.max(l.x1, l.x2), width: l.width });
    else if (dx <= 0.05 && dy > 0.5) vlines.push({ x: (l.x1 + l.x2) / 2, y0: Math.min(l.y1, l.y2), y1: Math.max(l.y1, l.y2), width: l.width, filled: false });
    else otherLines.push(l);
  }
  const shapes: RawShape[] = [];
  for (const s of raw.shapes) {
    const r = asRect(s);
    if (r) {
      const [x0, y0, x1, y1] = r;
      const w = x1 - x0;
      const h = y1 - y0;
      if (h < 1.2 && w > 4 * h) {
        hlines.push({ y: (y0 + y1) / 2, x0, x1, width: h });
        continue;
      }
      if (w < 3 && h > 4 * w) {
        vlines.push({ x: (x0 + x1) / 2, y0, y1, width: w, filled: true });
        continue;
      }
    }
    shapes.push(s);
  }

  const staves = detectStaves(raw.index, hlines);
  const systems = pairSystems(raw.index, staves, vlines, glyphs);

  return {
    page: raw.index,
    width: raw.width,
    height: raw.height,
    systems,
    glyphs,
    text,
    words: groupWords(text),
    hlines,
    vlines,
    otherLines,
    shapes,
    headInkRatio: 0.8,
    headInkRatios: {},
  };
}

/** Joins text glyphs into words (same baseline, small gaps). */
export function groupWords(text: TextGlyph[]): Word[] {
  const sorted = [...text].sort((a, b) => a.y - b.y || a.x - b.x);
  const rows: TextGlyph[][] = [];
  for (const g of sorted) {
    const row = rows.find((r) => Math.abs(r[0].y - g.y) < Math.max(0.5, g.size * 0.08) && Math.abs(r[0].size - g.size) < g.size * 0.2);
    if (row) row.push(g);
    else rows.push([g]);
  }
  const words: Word[] = [];
  for (const row of rows) {
    row.sort((a, b) => a.x - b.x);
    let cur: TextGlyph[] = [];
    const flush = () => {
      const chars = cur.filter((c) => c.ch.trim() !== "");
      if (chars.length) {
        const last = cur[cur.length - 1];
        // PDFs often omit space glyphs: a visible gap between letters is a space
        let joined = "";
        cur.forEach((c, i) => {
          const prev = cur[i - 1];
          if (prev && prev.ch !== " " && c.ch !== " " && c.x - (prev.x + (prev.adv || prev.size * 0.5)) > c.size * 0.18) joined += " ";
          joined += c.ch;
        });
        words.push({
          text: joined.replace(/\s+/g, " ").trim(),
          x: cur[0].x,
          y: cur[0].y,
          x1: last.x + (last.adv || last.size * 0.5),
          size: cur[0].size,
          italic: cur.some((c) => c.italic),
          bold: cur.some((c) => c.bold),
        });
      }
      cur = [];
    };
    for (const g of row) {
      if (cur.length) {
        const prev = cur[cur.length - 1];
        const prevEnd = prev.x + (prev.adv || prev.size * 0.5);
        // A gap of about one em starts a new word group (phrases like "D.S. al Coda" stay together).
        if (g.x - prevEnd > g.size * 0.9) flush();
      }
      cur.push(g);
    }
    flush();
  }
  return words;
}
