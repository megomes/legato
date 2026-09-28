/**
 * Music font knowledge.
 *
 * Legacy engraving fonts (Sibelius Opus/Helsinki/Inkpen/Reprise, Finale Maestro/Petrucci, Musicnotes Doremi…)
 * all descend from Adobe Sonata's character layout, which was defined on the Mac Roman code page. PDFs expose
 * those bytes through ToUnicode maps that decode them either as Mac Roman (Sibelius) or as Latin‑1 (Musicnotes).
 * We normalise every glyph back to its Mac Roman–decoded character so a single table can describe the family.
 *
 * SMuFL fonts (Bravura, Leland, Petaluma, Finale Maestro SMuFL…) use Private Use Area code points and get their own table.
 */

export type FontRole = "music" | "special" | "musictext" | "text";
export type Scheme = "macroman" | "latin1" | "smufl";

const MAC_ROMAN_HIGH =
  "ÄÅÇÉÑÖÜáàâäãåçéèêëíìîïñóòôöõúùûü†°¢£§•¶ß®©™´¨≠ÆØ∞±≤≥¥µ∂∑∏π∫ªºΩæø¿¡¬√ƒ≈∆«»… ÀÃÕŒœ–—“”‘’÷◊ÿŸ⁄€‹›ﬁﬂ‡·‚„‰ÂÊÁËÈÍÎÏÌÓÔÒÚÛÙıˆ˜¯˘˙˚¸˝˛ˇ";

const macRomanToByte = new Map<number, number>();
for (let i = 0; i < 128; i++) macRomanToByte.set(MAC_ROMAN_HIGH.codePointAt(i)!, 0x80 + i);

/** Byte in the font's own code page. */
export function toByte(code: number, scheme: Scheme): number | null {
  if (code >= 0xf000 && code <= 0xf0ff) return code - 0xf000; // symbol-font PUA mirror
  if (code < 0x80) return code;
  if (scheme === "latin1") return code <= 0xff ? code : null;
  return macRomanToByte.get(code) ?? null;
}

/** Character of the Sonata layout for a byte (Mac Roman decoding). */
export function sonataChar(byte: number): string {
  return byte < 0x80 ? String.fromCharCode(byte) : MAC_ROMAN_HIGH[byte - 0x80];
}

const MUSIC_FONT = /^(Opus|Helsinki|Inkpen2|Reprise|Norfolk|Pori|Tamburo|Maestro|Petrucci|Jazz|Engraver|Broadway|Doremi|Sonata|Bravura|Leland|Petaluma|Emmentaler|Gonville|MScore|MuseJazz|Finale|November|Sebastian|Leipzig|Musicnotes|Golden ?Age|Aruvarb)/i;
const SMUFL_FONT = /^(Bravura|Leland|Petaluma|FinaleMaestro|Finale ?Maestro|FinaleBroadway|Finale ?Broadway|Sebastian|MuseJazz|Gonville|Emmentaler|Leipzig|Golden ?Age|Aruvarb)/i;

export function fontRole(name: string): FontRole {
  if (!MUSIC_FONT.test(name)) return "text";
  if (/Special|Extra|Symbols|Special/i.test(name)) return "special";
  if (/Text/i.test(name)) return "musictext";
  return "music";
}

export function isSmuflFont(name: string): boolean {
  return SMUFL_FONT.test(name) && !/Text/i.test(name);
}

export type GlyphKind =
  | "notehead"
  | "clef"
  | "accidental"
  | "rest"
  | "flag"
  | "dot"
  | "timesig"
  | "segno"
  | "coda"
  | "fermata"
  | "brace"
  | "paren"
  | "arpeggio"
  | "repeatDots"
  | "dynamic"
  | "digit"
  | "metronomeNote"
  | "ornament"
  | "articulation"
  | "pedal"
  | "ignore";

export interface GlyphMeaning {
  kind: GlyphKind;
  /** e.g. notehead: black|half|whole|breve; clef: G|F|C|G8vb; accidental: sharp|flat|natural|dsharp|dflat;
   *  rest: whole|half|quarter|eighth|16th|32nd|64th; flag: 1u|1d|2u|2d; digit: '0'..'9'; dynamic: letter. */
  value: string;
}

const m = (kind: GlyphKind, value = ""): GlyphMeaning => ({ kind, value });

/** Sonata layout, keyed by Mac Roman–decoded character. Only symbols verified on real scores are listed. */
const SONATA_MUSIC: Record<string, GlyphMeaning> = {
  "œ": m("notehead", "black"),
  "˙": m("notehead", "half"),
  w: m("notehead", "whole"),
  W: m("notehead", "breve"),
  "&": m("clef", "G"),
  "?": m("clef", "F"),
  B: m("clef", "C"),
  V: m("clef", "G8vb"),
  "#": m("accidental", "sharp"),
  b: m("accidental", "flat"),
  n: m("accidental", "natural"),
  "∑": m("rest", "whole"),
  "Ó": m("rest", "half"),
  "Œ": m("rest", "quarter"),
  "‰": m("rest", "eighth"),
  "≈": m("rest", "16th"),
  "®": m("rest", "32nd"),
  j: m("flag", "1u"),
  J: m("flag", "1d"),
  r: m("flag", "2u"),
  R: m("flag", "2d"),
  k: m("dot"),
  "0": m("timesig", "0"),
  "1": m("timesig", "1"),
  "2": m("timesig", "2"),
  "3": m("timesig", "3"),
  "4": m("timesig", "4"),
  "5": m("timesig", "5"),
  "6": m("timesig", "6"),
  "7": m("timesig", "7"),
  "8": m("timesig", "8"),
  "9": m("timesig", "9"),
  c: m("timesig", "common"),
  C: m("timesig", "cut"),
  "%": m("segno"),
  "ﬁ": m("coda"),
  U: m("fermata", "above"),
  u: m("fermata", "below"),
  ">": m("articulation", "accent"),
  ".": m("articulation", "staccato"),
  "{": m("brace"),
};

const SONATA_SPECIAL: Record<string, GlyphMeaning> = {
  "™": m("dot"),
  "{": m("brace"),
  "<": m("paren", "left"),
  ">": m("paren", "right"),
  "∏": m("arpeggio"),
  "“": m("ignore"),
  "”": m("ignore"),
  "‘": m("ignore"),
  "ﬁ": m("ignore", "grace-slash"),
};

const SONATA_MUSICTEXT: Record<string, GlyphMeaning> = {
  p: m("dynamic", "p"),
  m: m("dynamic", "m"),
  f: m("dynamic", "f"),
  s: m("dynamic", "s"),
  z: m("dynamic", "z"),
  q: m("metronomeNote", "quarter"),
  h: m("metronomeNote", "half"),
  e: m("metronomeNote", "eighth"),
  "=": m("ignore", "="),
  ".": m("dot"),
  " ": m("ignore"),
  "(": m("ignore"),
  ")": m("ignore"),
};
for (const d of "0123456789") SONATA_MUSICTEXT[d] = m("digit", d);

/** Musicnotes' Doremi: Sonata-like but with its own clefs, rests and dots. */
const DOREMI: Record<string, GlyphMeaning> = {
  ...SONATA_MUSIC,
  G: m("clef", "G"),
  F: m("clef", "F"),
  "´": m("rest", "eighth"),
  ".": m("dot"),
  ":": m("repeatDots"),
  "}": m("brace"),
  q: m("metronomeNote", "quarter"),
  "Ǻ": m("ignore"),
};

/** SMuFL code points (https://w3c.github.io/smufl/latest/). */
const SMUFL: Record<number, GlyphMeaning> = {
  0xe0a4: m("notehead", "black"),
  0xe0a3: m("notehead", "half"),
  0xe0a2: m("notehead", "whole"),
  0xe0a0: m("notehead", "breve"),
  0xe050: m("clef", "G"),
  0xe07a: m("clef", "G"),
  0xe052: m("clef", "G8vb"),
  0xe062: m("clef", "F"),
  0xe07c: m("clef", "F"),
  0xe05c: m("clef", "C"),
  0xe262: m("accidental", "sharp"),
  0xe260: m("accidental", "flat"),
  0xe261: m("accidental", "natural"),
  0xe263: m("accidental", "dsharp"),
  0xe264: m("accidental", "dflat"),
  0xe4e3: m("rest", "whole"),
  0xe4e4: m("rest", "half"),
  0xe4e5: m("rest", "quarter"),
  0xe4e6: m("rest", "eighth"),
  0xe4e7: m("rest", "16th"),
  0xe4e8: m("rest", "32nd"),
  0xe4e9: m("rest", "64th"),
  0xe240: m("flag", "1u"),
  0xe241: m("flag", "1d"),
  0xe242: m("flag", "2u"),
  0xe243: m("flag", "2d"),
  0xe244: m("flag", "3u"),
  0xe245: m("flag", "3d"),
  0xe1e7: m("dot"),
  0xe047: m("segno"),
  0xe048: m("coda"),
  0xe4c0: m("fermata", "above"),
  0xe4c1: m("fermata", "below"),
  0xe000: m("brace"),
  0xe043: m("repeatDots"),
  0xe044: m("repeatDots"),
  0xe26a: m("paren", "left"),
  0xe26b: m("paren", "right"),
  0xe63c: m("arpeggio"),
  0xeaa9: m("arpeggio"),
  0xe4a0: m("articulation", "accent"),
  0xe4a1: m("articulation", "accent"),
  0xe4a2: m("articulation", "staccato"),
  0xe4a3: m("articulation", "staccato"),
  0xe520: m("dynamic", "p"),
  0xe521: m("dynamic", "m"),
  0xe522: m("dynamic", "f"),
  0xe524: m("dynamic", "s"),
  0xe525: m("dynamic", "z"),
  0xe650: m("pedal", "down"),
  0xe655: m("pedal", "up"),
  0xe1d5: m("metronomeNote", "quarter"),
  0xe1d3: m("metronomeNote", "half"),
  0xe1d7: m("metronomeNote", "eighth"),
};
for (let d = 0; d <= 9; d++) {
  SMUFL[0xe080 + d] = m("timesig", String(d));
  SMUFL[0xe880 + d] = m("digit", String(d));
}
SMUFL[0xe08a] = m("timesig", "common");
SMUFL[0xe08b] = m("timesig", "cut");

export interface FontProfile {
  name: string;
  role: FontRole;
  scheme: Scheme;
  table: "sonata" | "doremi" | "smufl" | "none";
}

export function classify(profile: FontProfile, code: number): GlyphMeaning | null {
  if (profile.role === "text" || profile.table === "none") return null;
  if (profile.table === "smufl") return SMUFL[code] ?? null;
  const byte = toByte(code, profile.scheme);
  if (byte === null) return null;
  const ch = sonataChar(byte);
  if (profile.table === "doremi") return DOREMI[ch] ?? null;
  if (profile.role === "special") return SONATA_SPECIAL[ch] ?? null;
  if (profile.role === "musictext") return SONATA_MUSICTEXT[ch] ?? null;
  return SONATA_MUSIC[ch] ?? null;
}

/**
 * Decides, per font, how its code points should be read. The most frequent glyph of any real score is the
 * black notehead (Sonata byte 0xCF), which settles Mac Roman vs Latin‑1 for the document.
 */
export function buildProfiles(glyphCodes: Map<string, number[]>): Map<string, FontProfile> {
  let macVotes = 0;
  let latinVotes = 0;
  for (const [name, codes] of glyphCodes) {
    if (fontRole(name) === "text" || isSmuflFont(name)) continue;
    for (const c of codes) {
      if (c === 0x153) macVotes++;
      else if (c === 0xcf) latinVotes++;
    }
  }
  const docScheme: Scheme = latinVotes > macVotes ? "latin1" : "macroman";
  const out = new Map<string, FontProfile>();
  for (const name of glyphCodes.keys()) {
    const role = fontRole(name);
    if (role === "text") {
      out.set(name, { name, role, scheme: docScheme, table: "none" });
    } else if (isSmuflFont(name)) {
      out.set(name, { name, role, scheme: "smufl", table: "smufl" });
    } else {
      out.set(name, { name, role, scheme: docScheme, table: /Doremi/i.test(name) ? "doremi" : "sonata" });
    }
  }
  return out;
}
