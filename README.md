# Legato

Drop a born-digital piano PDF, get a MIDI for Synthesia with the right and left hands on separate tracks. If any measure cannot be reconstructed with certainty, Legato refuses and says where.

- **Engine:** own vector parser (`src/engine`) on top of mupdf.js. It reads music-font glyphs and vector paths, solves rhythm per measure, validates everything, resolves repeats and D.S./D.C./Coda, assigns hands and writes an SMF (PPQ 960, tracks `Right Hand` / `Left Hand`).
- **App:** Next.js 16 on Vercel. `POST /api/convert` streams the five stages as NDJSON; the page shows a Synthesia-style preview with piano playback.
- **Database:** Neon Postgres stores conversion metadata, diagnostics and the generated MIDI (never the PDF). History is per browser.

Research and the architecture decision: [`docs/research/pdf-to-midi-research.md`](docs/research/pdf-to-midi-research.md).

## Run

```bash
npm install
cp .env.example .env.local   # set DATABASE_URL (optional; without it there is no history)
npm run dev
```

## Command line

```bash
npx tsx scripts/convert.ts path/to/score.pdf      # writes fixtures/out/<name>.mid
npx tsx scripts/debug-measures.ts path/to/score.pdf
npx tsx bench/run.ts 20 "Leland,Bravura"            # benchmark, needs MuseScore (mscore) on PATH
```

Debug overlays (`scripts/debug-symbols.ts`, `scripts/debug-pitches.ts`) draw what the engine read on top of a rendered page.

## Supported

Grand-staff piano scores exported from Sibelius, MuseScore, Finale, Dorico or Musicnotes: chords, several voices, accidentals, key and time changes, clef changes, ties, triplets and other simple tuplets, grace notes, repeats, 1st/2nd endings, Segno/Coda/D.S./D.C./Fine, tempo marks, rit./a tempo, dynamics, hand markings.

Not yet: scanned PDFs (by design), nested tuplets, tremolos, 8va lines, multi-measure rests, non-piano ensembles. These are rejected with a reason rather than converted wrongly.
