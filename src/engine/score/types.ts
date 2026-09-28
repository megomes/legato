import type { BarStyle } from "../layout/types";
import type { Frac, StaffIndex } from "../recognize/types";

export type Hand = "R" | "L";

export interface NoteEvent {
  id: number;
  staff: StaffIndex;
  /** diatonic step number (C0 = 0, C4 = 28) */
  step: number;
  alter: number;
  midi: number;
  measure: number;
  onset: Frac;
  duration: Frac;
  voice: "up" | "down" | "none";
  grace: boolean;
  /** id of the note this one is tied to (continuation), if any */
  tieNext?: number;
  tiePrev?: number;
  hand: Hand;
  /** how the hand was decided */
  handSource: "staff" | "marking" | "texture";
  page: number;
  x: number;
  y: number;
  chordId: number;
}

export interface Direction {
  kind:
    | "segno"
    | "coda"
    | "toCoda"
    | "dalSegno"
    | "daCapo"
    | "fine"
    | "tempo"
    | "tempoText"
    | "rit"
    | "aTempo"
    | "dynamic"
    | "hand"
    | "volta"
    | "fermata"
    | "pedal";
  measure: number;
  /** position inside the measure, 0..1 of the measure width */
  at: number;
  staff?: StaffIndex;
  value?: string;
  bpm?: number;
  /** quarter-note beat unit multiplier for metronome marks (dotted quarter = 1.5) */
  unit?: number;
  hand?: Hand;
  endings?: number[];
  x?: number;
  y?: number;
  page?: number;
}

export interface MeasureModel {
  index: number;
  page: number;
  system: number;
  x0: number;
  x1: number;
  time: { num: number; den: number };
  /** nominal length from the time signature, in quarter notes */
  expected: Frac;
  /** actual content length (shorter for pickups) */
  length: Frac;
  startBar: BarStyle;
  endBar: BarStyle;
  keyFifths: [number, number];
  notes: NoteEvent[];
  restCount: number;
  ok: boolean;
  problems: string[];
  warnings: string[];
  /** staves showing a full-measure rest */
  measureRests: StaffIndex[];
}

export interface Score {
  title: string;
  composer: string;
  measures: MeasureModel[];
  directions: Direction[];
  producer: string;
  fontFamily: string;
}
