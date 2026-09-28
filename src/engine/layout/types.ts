import type { GlyphKind } from "../glyphs/fonts";
import type { RawShape } from "../pdf/types";

export interface MusicGlyph {
  kind: GlyphKind;
  value: string;
  x: number;
  y: number;
  size: number;
  adv: number;
  font: string;
  code: number;
  /** Rendered noticeably smaller than regular glyphs (grace/cue notes, clef changes). */
  small: boolean;
}

export interface TextGlyph {
  ch: string;
  x: number;
  y: number;
  size: number;
  adv: number;
  font: string;
  italic: boolean;
  bold: boolean;
}

export interface Word {
  text: string;
  x: number;
  y: number;
  x1: number;
  size: number;
  italic: boolean;
  bold: boolean;
}

export interface HLine {
  y: number;
  x0: number;
  x1: number;
  width: number;
}

export interface VLine {
  x: number;
  y0: number;
  y1: number;
  width: number;
  /** true when it comes from a filled rectangle (thick barline, some producers' stems). */
  filled: boolean;
}

export interface Staff {
  page: number;
  /** y of the five lines, top to bottom */
  lines: number[];
  top: number;
  bottom: number;
  /** staff space (distance between lines) */
  sp: number;
  x0: number;
  x1: number;
}

export type BarStyle = "single" | "double" | "final" | "heavy" | "repeat-start" | "repeat-end" | "repeat-both";

export interface Barline {
  x: number;
  /** x extent of the whole barline group (double/thick barlines) */
  x0: number;
  x1: number;
  style: BarStyle;
}

export interface GrandSystem {
  page: number;
  index: number;
  upper: Staff;
  lower: Staff;
  x0: number;
  x1: number;
  /** measure boundaries, left to right; first entry is the system start */
  bars: Barline[];
}

export interface PageLayout {
  page: number;
  width: number;
  height: number;
  systems: GrandSystem[];
  glyphs: MusicGlyph[];
  text: TextGlyph[];
  words: Word[];
  hlines: HLine[];
  vlines: VLine[];
  /** thin slanted or other straight lines (hairpins, tuplet brackets, beams drawn as strokes) */
  otherLines: { x1: number; y1: number; x2: number; y2: number; width: number }[];
  shapes: RawShape[];
  /** notehead ink width as a fraction of the glyph advance (calibrated per document from stem positions) */
  headInkRatio: number;
  /** per glyph ("font|code") ink ratios when they could be measured */
  headInkRatios: Record<string, number>;
}
