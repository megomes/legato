import type { MusicGlyph, Staff } from "../layout/types";
import type { Point } from "../pdf/types";

export type StaffIndex = 0 | 1; // 0 = upper staff, 1 = lower staff

export type ClefType = "G" | "F" | "C" | "G8vb" | "G8va" | "F8vb" | "tenorC";

export interface Head {
  id: number;
  glyph: MusicGlyph;
  staff: StaffIndex;
  x: number;
  /** right edge */
  xr: number;
  y: number;
  /** staff position: 0 = bottom line, 8 = top line, half-space units */
  pos: number;
  type: "black" | "half" | "whole" | "breve";
  grace: boolean;
  /** attached accidental, if any */
  accidental?: "sharp" | "flat" | "natural" | "dsharp" | "dflat";
  /** set when the accidental is enclosed in parentheses (courtesy) */
  courtesy?: boolean;
}

export interface Stem {
  x: number;
  y0: number;
  y1: number;
}

export interface Beam {
  xa: number;
  ya: number;
  xb: number;
  yb: number;
  thickness: number;
}

export interface Chord {
  id: number;
  staff: StaffIndex;
  heads: Head[];
  stem: Stem | null;
  dir: "up" | "down" | "none";
  /** x used to align simultaneous events across voices and staves (notehead centre on the normal side of the stem) */
  anchor: number;
  beams: number;
  flags: number;
  dots: number;
  grace: boolean;
  /** quarter-note based duration before tuplet scaling, as a fraction numerator/denominator */
  base: Frac;
  /** tuplet ratio applied (actual = base * num/den) */
  tuplet?: { num: number; den: number };
  /** beam group id for tuplet association */
  beamGroup?: number;
}

export interface Rest {
  id: number;
  staff: StaffIndex;
  glyph: MusicGlyph;
  x: number;
  anchor: number;
  y: number;
  value: string;
  dots: number;
  measureRest: boolean;
  base: Frac;
  tuplet?: { num: number; den: number };
}

export interface ClefMark {
  staff: StaffIndex;
  x: number;
  clef: ClefType;
  small: boolean;
}

export interface KeyMark {
  staff: StaffIndex;
  x: number;
  fifths: number;
}

export interface TimeMark {
  x: number;
  num: number;
  den: number;
}

export interface TupletMark {
  x: number;
  y: number;
  n: number;
  staff: StaffIndex;
  /** horizontal range when a bracket is drawn */
  bracket?: [number, number];
}

export interface Curve {
  left: Point;
  right: Point;
  width: number;
  height: number;
  /** true when the arc bulges upward (above its endpoints) */
  above: boolean;
}

/** A fraction of a quarter note, kept exact. */
export interface Frac {
  n: number;
  d: number;
}

export interface SystemSymbols {
  staves: [Staff, Staff];
  heads: Head[];
  chords: Chord[];
  graceChords: Chord[];
  rests: Rest[];
  clefs: ClefMark[];
  keys: KeyMark[];
  times: TimeMark[];
  tuplets: TupletMark[];
  curves: Curve[];
  beams: Beam[];
  /** problems found while reading symbols; each one lowers confidence or rejects the measure */
  problems: { x: number; staff?: StaffIndex; message: string; severity: "error" | "warning" }[];
}
