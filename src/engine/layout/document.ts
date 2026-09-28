import { buildProfiles, type FontProfile } from "../glyphs/fonts";
import type { RawDocument } from "../pdf/types";
import { buildPageLayout, type PageIssues } from "./page";
import { detectBarlines } from "./barlines";
import type { MusicGlyph, PageLayout } from "./types";

export interface DocumentLayout {
  pages: PageLayout[];
  profiles: Map<string, FontProfile>;
  issues: PageIssues;
  headInkRatio: number;
}

export function analyzeLayout(raw: RawDocument): DocumentLayout {
  const codes = new Map<string, number[]>();
  for (const p of raw.pages)
    for (const g of p.glyphs) {
      if (!codes.has(g.font)) codes.set(g.font, []);
      codes.get(g.font)!.push(g.code);
    }
  const profiles = buildProfiles(codes);
  const issues: PageIssues = { unknownGlyphs: [] };
  const pages = raw.pages.map((p) => buildPageLayout(p, profiles, issues));
  const { ratio, perGlyph } = calibrateHeadInk(pages);
  for (const p of pages) {
    p.headInkRatio = ratio;
    p.headInkRatios = perGlyph;
    const ink = (g: MusicGlyph) => g.adv * (perGlyph[`${g.font}|${g.code}`] ?? ratio);
    for (const sys of p.systems) sys.bars = detectBarlines(sys, p.vlines, p.glyphs, ink);
  }
  return { pages, profiles, issues, headInkRatio: ratio };
}

/**
 * Glyph advances include side bearings, so the notehead's visible right edge is found from the stems:
 * up-stems sit on the right edge, down-stems on the left edge. The two histogram peaks give the ink width.
 */
function calibrateHeadInk(pages: PageLayout[]): { ratio: number; perGlyph: Record<string, number> } {
  const samples = new Map<string, number[]>();
  for (const p of pages)
    for (const g of p.glyphs) {
      if (g.kind !== "notehead" || g.value === "whole" || g.value === "breve" || !g.adv) continue;
      const key = `${g.font}|${g.code}`;
      if (!samples.has(key)) samples.set(key, []);
      for (const v of p.vlines) {
        if (v.y1 - v.y0 < 3 || g.y < v.y0 - 3 || g.y > v.y1 + 3) continue;
        const d = (v.x - g.x) / g.adv;
        if (d > -0.2 && d < 1.2) samples.get(key)!.push(d);
      }
    }
  const solve = (ratios: number[]) => {
    const bucket = (lo: number, hi: number) => {
      const inRange = ratios.filter((r) => r >= lo && r < hi).sort((a, b) => a - b);
      return inRange.length >= 3 ? inRange[Math.floor(inRange.length / 2)] : null;
    };
    const left = bucket(-0.2, 0.25);
    const right = bucket(0.5, 1.2);
    return left === null || right === null ? null : right + Math.max(0, left);
  };
  const perGlyph: Record<string, number> = {};
  for (const [key, r] of samples) {
    const v = solve(r);
    if (v !== null) perGlyph[key] = v;
  }
  const ratio = solve([...samples.values()].flat()) ?? 0.8;
  return { ratio, perGlyph };
}
