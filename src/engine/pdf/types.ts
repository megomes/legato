/** Raw graphical primitives pulled out of a vector PDF page. Coordinates are PDF points, y grows downward. */

export interface RawGlyph {
  /** Font name with the subset prefix (e.g. "ABCDEF+") removed. */
  font: string;
  /** Unicode code point reported by the PDF (via ToUnicode / encoding). */
  code: number;
  /** Glyph id inside the embedded font. */
  gid: number;
  /** Glyph origin (baseline, left). */
  x: number;
  y: number;
  /** Effective font size in points. */
  size: number;
  /** Advance width in points. */
  adv: number;
}

/** A straight stroked segment (staff lines, stems, barlines, ledger lines, hairpins...). */
export interface RawLine {
  x1: number;
  y1: number;
  x2: number;
  y2: number;
  width: number;
}

export type Point = [number, number];

/** Any other drawn shape: filled polygons (beams, thick barlines), curves (ties, slurs), brackets. */
export interface RawShape {
  kind: "fill" | "stroke";
  /** Flattened sub-paths; curve control points are kept in `curves`. */
  subpaths: Point[][];
  hasCurves: boolean;
  bbox: [number, number, number, number];
  width: number;
}

export interface RawPage {
  index: number;
  width: number;
  height: number;
  glyphs: RawGlyph[];
  lines: RawLine[];
  shapes: RawShape[];
  images: number;
}

export interface RawDocument {
  pageCount: number;
  pages: RawPage[];
  producer: string;
  creator: string;
  title: string;
}
