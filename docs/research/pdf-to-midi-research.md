# PDF → MIDI for piano: research and architecture decision

_Written 2026-09-27/28 while building Legato. Findings were checked against vendor docs and project pages where cited; reliability numbers come from our own benchmark (see the last section)._

## The question

> What is the most reliable, technically and legally viable way to turn a born-digital piano PDF into a structured score we can validate and export as MIDI?

## What a born-digital PDF actually contains

Inspecting the three reference scores with mupdf showed that notation-software PDFs are mostly **text in music fonts plus a few vector primitives**:

| Score | Producer | Music font | Encoding exposed by the PDF |
|---|---|---|---|
| Flume (Nicholas Bamberger) | Sibelius 23.8 (Qt 5.15) | Helsinki / HelsinkiSpecial / HelsinkiText | Sonata layout, Mac Roman ToUnicode |
| Breathe (Revisited) (Greg Maroney) | Sibelius 7.1.3 (Qt 4.8) | Opus / OpusSpecial / OpusText | Sonata layout, Mac Roman ToUnicode (CID fonts) |
| La Noyée (arr. Jing Li) | Musicnotes, printed by Chrome/Skia | Doremi | Sonata-like layout, Latin‑1 ToUnicode |

Every notehead, clef, accidental, rest, flag, dot and time-signature digit is a glyph with an exact position. Staff lines, stems and barlines are straight strokes; beams are filled parallelograms; ties and slurs are filled curves (or flattened polygons, in Skia output). MuseScore 4.7 exports SMuFL code points directly (Leland, Bravura, Petaluma, Finale Maestro, Gonville as "Gootville", Emmentaler as "MScore").

None of the three reference PDFs uses SMuFL, so a SMuFL-only parser would have failed on all of them.

## Candidate engines

| Engine | How it reads | Deployment | Licensing | Verdict |
|---|---|---|---|---|
| **PDFtoMusic Pro** (Myriad) | Vector + embedded fonts (closest to our needs) | Desktop app (Windows, macOS, Linux build tested on Ubuntu 18.04); a command-line mode (`p2mp`) and batch folder export exist | Closed source, per-user licence; nothing grants server or web-service use | Technically usable on a Linux VM, but legally unclear for a web backend and cannot run on Vercel. No API. |
| **Audiveris 5.10** | Raster OMR (renders the page, then recognises) | Java, Linux OK, `-batch -export` CLI, Docker-friendly | AGPL-3.0 | Designed around manual correction in its GUI; raster errors on dense piano writing. Good as a *second opinion*, not as the primary engine. |
| **End-to-end OMR models** (Ríos-Vila et al., full-page pianoform OMR, IJCV 2026; LEGATO 2, 2026) | Raster, transformer | GPU inference | Research code / model licences vary | Impressive, but still makes pitch and rhythm errors and gives no structural guarantee. Also raster, which throws away the exact vector data we have. |
| **Soundslice** scanner | Raster ML | SaaS only | Proprietary, no public conversion API | Not integrable. |
| PlayScore 2, ScanScore, SmartScore | Raster OMR | Mobile/desktop apps | Proprietary | Not integrable into a web backend. |
| MuseScore PDF import | Delegates to an Audiveris-based service | Desktop | GPL / service terms | Same raster limits as Audiveris. |
| Verovio, OpenSheetMusicDisplay | Renderers (MusicXML/MEI → SVG) | JS/WASM | LGPL/BSD | Useful for display only; they do not read PDFs. |
| **Own vector parser** (mupdf.js WASM) | Glyphs + paths, exactly as drawn | Node (Vercel Functions) or browser | mupdf.js is AGPL-3.0 (fine for this personal, open app; a commercial licence exists from Artifex) | Chosen. |

Synthesia: it separates parts by track, channel or instrument, and when a song has one or two tracks it assigns hands automatically. The MIDI therefore has a conductor track, then `Right Hand` (channel 1) and `Left Hand` (channel 2).

## Architectures considered

### A — Own vector parser on Vercel (chosen)

- **Engine:** TypeScript on top of mupdf.js. Font tables for the Sonata family (Sibelius, legacy Finale), Musicnotes Doremi and SMuFL.
- **Deployment:** a Next.js Route Handler on Vercel (Node runtime) that streams progress; Neon for history. No worker, no queue, no file storage.
- **Licensing:** our code; mupdf.js AGPL.
- **Expected accuracy:** exact on supported notation, because positions are exact. Unsupported notation is **rejected**, not guessed.
- **Complexity:** high up-front (layout, rhythm solver, validators), low operational.
- **Failure modes:** unknown fonts, unusual engraving (hidden rests, cross-voice beaming), constructs not implemented yet (nested tuplets, tremolos, 8va lines, multi-measure rests). Each one is detected and rejects the conversion.

### B — PDFtoMusic Pro worker (fallback)

- Linux VM running `p2mp` in batch mode → MusicXML → the same validators as A → MIDI.
- Requires a written licence from Myriad for server use, a VM outside Vercel and a job queue.
- Worth doing only if A cannot cover a notation program the user relies on.

### C — Raster OMR cross-check (experimental)

- Audiveris (or a transformer model) as an independent reading; compare pitch/onset/duration with A and accept only when both agree.
- Needs a container host (Fly.io / Cloud Run). Adds latency and cost.
- Not needed so far: A's own validation already produced zero silent errors in the benchmark below.

## How Legato validates (fail-closed)

1. **Layout:** five-line staves with identical extents; grand staves joined by brace or barlines; barlines must cross both staves and not touch a notehead.
2. **Symbols:** noteheads must sit on a staff position (±0.22 half-spaces); notehead ink width is calibrated per document and per glyph from stem positions; flags belong to one stem; displaced noteheads follow the second-interval rule.
3. **Rhythm:** per measure, onsets are solved without guessing voices (the next onset is always the earliest end among sounding notes). The reading must be **unique**; voice-collision shifts are only allowed between voices within a step; lone rests may snap to a neighbouring column only as a tested hypothesis.
4. **Checks:** every measure adds up to its time signature (pickups and repeat-split measures only where legitimate), every voice is continuous, notes of one voice never overlap, tuplet groups add up, and every tuplet number is used.
5. **Pitch:** clef + position, key signatures validated against the standard order and required to agree between staves, accidental persistence per staff and octave, tie continuations keep the tied pitch.
6. **Navigation:** repeats, 1st/2nd endings, Segno, To Coda, Coda, D.S., D.C. and Fine resolve to a linear order.
7. **Hands:** staff by default; "right hand"/"r.h."/"m.d." and "left hand"/"l.h."/"m.s." move the inner voice; the confidence reported is the share of notes whose hand was decided without guessing.

Any failure in steps 1–6 rejects the whole conversion and reports the measure and reason.

## Benchmark

`bench/generate.ts` writes random but well-formed piano scores as MusicXML (chords, accidentals, ties inside and across barlines, dotted values, triplets, two voices per staff, clef changes, repeats and 1st/2nd endings). MuseScore 4.7.5 renders each one to PDF in six music fonts, Legato converts it, and `bench/run.ts` compares every performed note (hand, MIDI pitch, onset tick, end tick) with the ground truth.

Latest run (20 scores × 6 fonts):

| Font | Exact | Rejected | Wrong but accepted |
|---|---|---|---|
| Leland | 15 | 5 | 0 |
| Bravura | 15 | 5 | 0 |
| Petaluma | 15 | 5 | 0 |
| Finale Maestro | 17 | 3 | 0 |
| Gonville | 17 | 3 | 0 |
| Emmentaler | 15 | 5 | 0 |
| **Total** | **94** | **26** | **0** |

18,254 of 18,254 notes correct in the converted scores. The benchmark found two silent errors during development (a missed triplet absorbed by a column merge, and a sixteenth read as a quarter); both led to new validation rules and are covered now.

Real scores: Flume 185/185 measures, Breathe 320/320, La Noyée 61/61 (their PDFs are not in the repository).

Run it: `npx tsx bench/run.ts 20 "Leland,Bravura,Petaluma,Finale Maestro,Gonville,Emmentaler"` (needs `mscore` on the PATH).

## Sources

- Myriad, PDFtoMusic Pro product page and manual: https://www.myriad-online.com/en/products/pdftomusicpro.htm, https://www.myriad-online.com/resources/docs/pdftomusicpro/english/printable.htm
- Audiveris CLI handbook: https://audiveris.github.io/audiveris/_pages/guides/advanced/cli/ ; Audiveris 5.10.2 release (Mar 2026)
- Ríos-Vila, Calvo-Zaragoza, Rizo, Paquet, "End-to-End Full-Page Optical Music Recognition for Pianoform Sheet Music": https://arxiv.org/abs/2405.12105
- LEGATO 2 (multimodal sheet music recognition), arXiv 2607.05769
- Soundslice scanner updates: https://www.soundslice.com/blog/music-scanning/
- Synthesia content-creator guide: https://www.synthesiagame.com/support/guide/contentcreators
- SMuFL specification: https://w3c.github.io/smufl/latest/
- mupdf.js: https://github.com/ArtifexSoftware/mupdf.js
