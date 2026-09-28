import { analyzeLayout } from "./layout/document";
import type { PageLayout } from "./layout/types";
import { writeMidi } from "./midi/write";
import { extractDocument } from "./pdf/extract";
import { buildTimeline, tickToSeconds, type Timeline } from "./perform/timeline";
import { phrases, readDirections } from "./recognize/directions";
import { buildMeasures } from "./score/build";
import { assignHands } from "./score/hands";
import { unroll } from "./score/navigation";
import type { Direction } from "./score/types";

export const ENGINE_VERSION = "legato-vector-1.0.0";

export type StageId = "read" | "reconstruct" | "validate" | "hands" | "midi";
export const STAGES: { id: StageId; label: string }[] = [
  { id: "read", label: "Reading score" },
  { id: "reconstruct", label: "Reconstructing notation" },
  { id: "validate", label: "Validating score" },
  { id: "hands", label: "Assigning hands" },
  { id: "midi", label: "Generating MIDI" },
];

export interface MeasureDiagnostic {
  measure: number;
  page: number;
  problems: string[];
}

export interface ConversionError {
  code: "not-pdf" | "scanned" | "no-music" | "unsupported-font" | "not-piano" | "unreliable" | "navigation" | "ottava" | "internal";
  message: string;
  details: string[];
  measures?: MeasureDiagnostic[];
}

export interface ConversionStats {
  pages: number;
  musicPages: number;
  systems: number;
  measures: number;
  performedMeasures: number;
  notes: number;
  rightHandNotes: number;
  leftHandNotes: number;
  durationSeconds: number;
  tempo: string;
  tempoBpm: number;
  tempoEstimated: boolean;
  timeSignature: string;
  keySignature: string;
  keyFifths: number;
  ties: number;
  graceNotes: number;
  tuplets: number;
  font: string;
  producer: string;
  lowestNote: number;
  highestNote: number;
}

export interface Confidence {
  /** share of measures whose rhythm, pitch and structure passed every check */
  measures: number;
  hands: number;
  /** evidence counts behind the numbers */
  checkedMeasures: number;
  failedMeasures: number;
  warnings: number;
}

export interface PreviewNote {
  /** seconds */
  t: number;
  d: number;
  m: number;
  h: 0 | 1; // 0 = right, 1 = left
  v: number;
}

export interface ConversionResult {
  ok: boolean;
  engine: string;
  title: string;
  composer: string;
  error?: ConversionError;
  stats?: ConversionStats;
  confidence?: Confidence;
  navigation: string[];
  handNotes: string[];
  warnings: string[];
  preview?: { notes: PreviewNote[]; duration: number; measureStarts: number[]; measureNumbers: number[] };
  midi?: Uint8Array;
  timingsMs: Record<StageId, number>;
  timeline?: Timeline;
}

export interface ConvertOptions {
  onStage?: (stage: StageId, index: number) => void | Promise<void>;
  /** attach the tick-level timeline (used by the benchmark) */
  includeTimeline?: boolean;
}

const KEY_NAMES: Record<number, string> = { [-7]: "C♭ major", [-6]: "G♭ major", [-5]: "D♭ major", [-4]: "A♭ major", [-3]: "E♭ major", [-2]: "B♭ major", [-1]: "F major", 0: "C major", 1: "G major", 2: "D major", 3: "A major", 4: "E major", 5: "B major", 6: "F♯ major", 7: "C♯ major" };

function fail(code: ConversionError["code"], message: string, details: string[] = [], extra: Partial<ConversionResult> = {}): ConversionResult {
  return { ok: false, engine: ENGINE_VERSION, title: "", composer: "", error: { code, message, details }, navigation: [], handNotes: [], warnings: [], timingsMs: { read: 0, reconstruct: 0, validate: 0, hands: 0, midi: 0 }, ...extra };
}

function readTitle(pages: PageLayout[], metaTitle: string): { title: string; composer: string } {
  const first = pages.find((p) => p.systems.length) ?? pages[0];
  if (!first) return { title: metaTitle, composer: "" };
  const top = first.systems[0]?.upper.top ?? first.height / 3;
  const lines = phrases(first.words.filter((w) => w.y < top - 10)).filter((l) => !/musicnotes|copyright|©|www\.|\.com|arrangement|=/i.test(l.text) && l.text.length > 1);
  const clean = (s: string) => s.replace(/\s+/g, " ").trim();
  const titleLine = [...lines].sort((a, b) => b.size - a.size)[0];
  const title = clean(metaTitle && metaTitle.length > 1 && !/untitled|^\s*$/i.test(metaTitle) ? metaTitle : titleLine?.text ?? "");
  const byline = /^(words and music by|music and lyrics by|music by|composed by|by)\b[:\s]*/i;
  const others = lines.filter((l) => l !== titleLine).sort((a, b) => a.y - b.y);
  let composer = "";
  const by = others.find((l) => byline.test(l.text));
  if (by) {
    const rest = clean(by.text.replace(byline, ""));
    composer = rest || clean(others.find((l) => l.y > by.y && Math.abs(l.x1 - by.x1) < 30)?.text ?? "");
  }
  if (!composer) {
    const right = others.filter((l) => l.x > first.width * 0.5 && !/^(allegro|andante|moderato|adagio|lento|presto|tempo)/i.test(l.text));
    composer = clean(right[0]?.text ?? "");
  }
  return { title, composer };
}

export async function convertPdf(data: Uint8Array, opts: ConvertOptions = {}): Promise<ConversionResult> {
  const timings: Record<StageId, number> = { read: 0, reconstruct: 0, validate: 0, hands: 0, midi: 0 };
  let t0 = performance.now();
  const stage = async (id: StageId) => {
    await opts.onStage?.(id, STAGES.findIndex((s) => s.id === id));
  };
  const lap = (id: StageId) => {
    const now = performance.now();
    timings[id] = Math.round(now - t0);
    t0 = now;
  };

  // ---- 1. read ---------------------------------------------------------------------------------
  await stage("read");
  if (data.length < 5 || String.fromCharCode(...data.slice(0, 5)) !== "%PDF-") return fail("not-pdf", "This file is not a PDF.");
  let raw;
  try {
    raw = extractDocument(data);
  } catch (e) {
    return fail("not-pdf", "This PDF could not be opened.", [String(e)]);
  }
  const textless = raw.pages.filter((p) => p.glyphs.length < 5 && p.images > 0).length;
  if (raw.pages.every((p) => p.glyphs.length < 5 && p.lines.length < 20)) {
    return fail(textless ? "scanned" : "no-music", textless ? "This PDF appears to contain scanned pages." : "This PDF does not contain any vector music notation.", [
      `${raw.pageCount} page(s), ${textless} made only of images.`,
      "Only PDFs exported from notation software (MuseScore, Sibelius, Finale, Dorico, LilyPond…) are supported.",
    ]);
  }
  const layout = analyzeLayout(raw);
  const musicFonts = [...layout.profiles.values()].filter((p) => p.role !== "text");
  lap("read");

  // ---- 2. reconstruct --------------------------------------------------------------------------
  await stage("reconstruct");
  const systemsTotal = layout.pages.reduce((s, p) => s + p.systems.length, 0);
  if (!systemsTotal) {
    if (!musicFonts.length) {
      const scanned = raw.pages.some((p) => p.images > 0);
      return fail(scanned ? "scanned" : "unsupported-font", scanned ? "This PDF appears to contain scanned pages." : "No music font was found in this PDF.", [
        "Music notation software embeds a music font (Bravura, Leland, Opus, Helsinki, Maestro…). None was found.",
      ]);
    }
    return fail("not-piano", "No piano grand staff was found.", ["Only two-staff piano systems (treble + bass joined by a brace) are supported."]);
  }
  const unsupportedFonts = musicFonts.filter((p) => p.table === "none").map((p) => p.name);
  if (!musicFonts.some((p) => p.role === "music")) {
    return fail("unsupported-font", "The music font in this PDF is not supported yet.", [`Fonts: ${[...layout.profiles.keys()].join(", ")}`]);
  }
  const built = buildMeasures(layout);
  const directions: Direction[] = [];
  for (const page of layout.pages) {
    const systems = built.systems.filter((s) => s.page === page).map((s) => ({ sys: s.sys, measures: s.measures }));
    if (systems.length) directions.push(...readDirections({ page, systems }));
  }
  const { title, composer } = readTitle(layout.pages, raw.title);
  lap("reconstruct");

  // ---- 3. validate -----------------------------------------------------------------------------
  await stage("validate");
  const failed = built.measures.filter((m) => !m.ok);
  // unknown symbols inside a system are a reason to stop: we would be guessing what they mean
  const unknownInStaff = layout.issues.unknownGlyphs.filter((g) =>
    layout.pages.some((p) => p.systems.some((s) => g.x > s.x0 && g.x < s.x1 && g.y > s.upper.top - 3 * s.upper.sp && g.y < s.lower.bottom + 3 * s.upper.sp)),
  );
  // Octave lines (8va, 8vb, 15ma…) shift pitches over a span we do not read yet: refuse instead of playing them wrong.
  const ottavas: string[] = [];
  for (const p of layout.pages) {
    const inSystem = (y: number) => p.systems.some((s) => y > s.upper.top - 10 * s.upper.sp && y < s.lower.bottom + 10 * s.upper.sp);
    for (const g of p.glyphs) if (g.kind === "ottava" && inSystem(g.y)) ottavas.push(`${g.value} on page ${p.page + 1}`);
    for (const w of phrases(p.words)) if (/^(8\s?va|8\s?vb|8\s?ba|8va bassa|15\s?ma|15\s?mb|ottava)\b/i.test(w.text.trim()) && inSystem(w.y)) ottavas.push(`"${w.text.trim()}" on page ${p.page + 1}`);
  }
  const nav = unroll(built.measures, directions);
  if (ottavas.length) {
    lap("validate");
    const r = fail("ottava", "This score uses octave lines (8va / 8vb), which are not supported yet.", [
      `Found: ${ottavas.slice(0, 5).join(", ")}`,
      "Notes under an octave line sound an octave away from where they are written; converting them without reading the line would give wrong pitches.",
    ]);
    r.title = title;
    r.composer = composer;
    r.timingsMs = timings;
    return r;
  }
  const warnings: string[] = [];
  for (const m of built.measures) for (const w of new Set(m.warnings)) if (!/voice collision/.test(w)) warnings.push(`Measure ${m.index + 1}: ${w}`);
  const measureDiag = failed.map((m) => ({ measure: m.index + 1, page: m.page + 1, problems: [...new Set(m.problems)] }));
  lap("validate");
  if (unknownInStaff.length || failed.length || nav.problems.length) {
    const details: string[] = [];
    if (unknownInStaff.length) details.push(`${unknownInStaff.length} unrecognised symbol(s) inside the staves (font ${unknownInStaff[0].font}, code U+${unknownInStaff[0].code.toString(16).toUpperCase()}).`);
    for (const d of measureDiag.slice(0, 12)) details.push(`Measure ${d.measure} (page ${d.page}): ${d.problems.join("; ")}`);
    if (measureDiag.length > 12) details.push(`…and ${measureDiag.length - 12} more measure(s).`);
    details.push(...nav.problems);
    const first = measureDiag[0];
    const message = nav.problems.length && !failed.length
      ? "The repeat/jump structure of this score could not be resolved reliably."
      : first
        ? `Measure ${first.measure} contains notation that could not be reconstructed reliably.`
        : "This score contains symbols that could not be recognised.";
    const r = fail(nav.problems.length && !failed.length ? "navigation" : "unreliable", message, details);
    r.title = title;
    r.composer = composer;
    r.error!.measures = measureDiag;
    r.confidence = { measures: 1 - failed.length / built.measures.length, hands: 0, checkedMeasures: built.measures.length, failedMeasures: failed.length, warnings: warnings.length };
    r.timingsMs = timings;
    return r;
  }

  // ---- 4. hands --------------------------------------------------------------------------------
  await stage("hands");
  const hands = assignHands(built.measures, directions);
  lap("hands");

  // ---- 5. MIDI ---------------------------------------------------------------------------------
  await stage("midi");
  const tl = buildTimeline(built.measures, nav.order, directions);
  const midi = writeMidi(tl, title);
  const secs = (tick: number) => tickToSeconds(tick, tl.tempos);
  const previewNotes: PreviewNote[] = tl.notes.map((n) => {
    const t = secs(n.start);
    return { t: +t.toFixed(4), d: +(secs(n.end) - t).toFixed(4), m: n.midi, h: n.hand === "R" ? 0 : 1, v: n.velocity };
  });
  const duration = secs(tl.totalTicks);
  lap("midi");

  const allNotes = built.measures.flatMap((m) => m.notes);
  const first = built.measures[0];
  const pitches = tl.notes.map((n) => n.midi);
  return {
    ok: true,
    engine: ENGINE_VERSION,
    title,
    composer,
    stats: {
      pages: raw.pageCount,
      musicPages: layout.pages.filter((p) => p.systems.length).length,
      systems: systemsTotal,
      measures: built.measures.length,
      performedMeasures: nav.order.length,
      notes: tl.notes.length,
      rightHandNotes: tl.notes.filter((n) => n.hand === "R").length,
      leftHandNotes: tl.notes.filter((n) => n.hand === "L").length,
      durationSeconds: Math.round(duration * 10) / 10,
      tempo: tl.tempoText,
      tempoBpm: Math.round(tl.baseTempo),
      tempoEstimated: tl.tempoEstimated,
      timeSignature: `${first.time.num}/${first.time.den}`,
      keySignature: KEY_NAMES[first.keyFifths[0]] ?? "",
      keyFifths: first.keyFifths[0],
      ties: allNotes.filter((n) => n.tieNext).length,
      graceNotes: allNotes.filter((n) => n.grace).length,
      tuplets: 0,
      font: musicFonts.find((p) => p.role === "music")?.name ?? "",
      producer: [raw.creator, raw.producer].filter(Boolean).join(" · "),
      lowestNote: Math.min(...pitches),
      highestNote: Math.max(...pitches),
    },
    confidence: { measures: 1, hands: hands.confidence, checkedMeasures: built.measures.length, failedMeasures: 0, warnings: warnings.length },
    navigation: nav.notes,
    handNotes: hands.notes.concat(unsupportedFonts.length ? [`Unsupported fonts ignored: ${unsupportedFonts.join(", ")}`] : []),
    warnings,
    preview: {
      notes: previewNotes,
      duration,
      measureStarts: tl.measureTicks.map((m) => +secs(m.tick).toFixed(3)),
      measureNumbers: tl.measureTicks.map((m) => m.measure + 1),
    },
    midi,
    timingsMs: timings,
    timeline: opts.includeTimeline ? tl : undefined,
  };
}
