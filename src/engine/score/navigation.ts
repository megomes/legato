import type { Direction, MeasureModel } from "./types";

export interface NavigationResult {
  /** measure indices in playing order */
  order: number[];
  /** measure index → endings (1, 2…) it belongs to */
  endings: Map<number, number[]>;
  notes: string[];
  problems: string[];
}

/**
 * Turns repeats, first/second endings, D.C./D.S., To Coda, Coda and Fine into a linear list of measures.
 * Conventions: repeats are taken once; after a D.C./D.S. jump repeats are not taken again; the jump to the Coda and
 * the stop at Fine only apply after the D.C./D.S. jump.
 */
export function unroll(measures: MeasureModel[], directions: Direction[]): NavigationResult {
  const n = measures.length;
  const notes: string[] = [];
  const problems: string[] = [];
  const of = (kind: Direction["kind"]) => directions.filter((d) => d.kind === kind).sort((a, b) => a.measure + a.at - (b.measure + b.at));

  // ---- endings (voltas) --------------------------------------------------------------------------
  const endings = new Map<number, number[]>();
  const voltas = of("volta");
  for (const v of voltas) {
    // a volta runs until the next repeat-end barline or the next volta, whichever comes first
    let end = v.measure;
    while (end < n - 1) {
      const m = measures[end];
      if (m.endBar === "repeat-end" || m.endBar === "repeat-both" || m.endBar === "double" || m.endBar === "final") break;
      if (voltas.some((o) => o !== v && o.measure === end + 1)) break;
      if (end - v.measure > 7) break;
      end++;
    }
    // the last ending usually lasts until the next non-repeat double bar, or one measure
    for (let i = v.measure; i <= end; i++) endings.set(i, v.endings ?? []);
  }

  // ---- jump markers ------------------------------------------------------------------------------
  const segno = of("segno")[0]?.measure;
  const fine = of("fine")[0]?.measure;
  const jump = [...of("dalSegno"), ...of("daCapo")].sort((a, b) => a.measure - b.measure)[0];
  const codaSigns = of("coda");
  const toCodaText = of("toCoda")[0];
  let toCoda: number | undefined;
  let codaStart: number | undefined;
  if (toCodaText) {
    toCoda = toCodaText.measure;
    codaStart = codaSigns.find((c) => c.measure > toCoda!)?.measure;
  } else if (codaSigns.length >= 2) {
    toCoda = codaSigns[0].measure;
    codaStart = codaSigns[codaSigns.length - 1].measure;
  } else if (codaSigns.length === 1 && jump && codaSigns[0].measure <= jump.measure) {
    toCoda = codaSigns[0].measure;
    codaStart = jump.measure + 1 < n ? jump.measure + 1 : undefined;
  } else if (codaSigns.length === 1 && jump) {
    codaStart = codaSigns[0].measure;
  }
  // a coda sign printed at the start of a measure marks where the Coda begins; at the end of the previous one, the jump
  if (codaStart !== undefined) {
    const sign = codaSigns.find((c) => c.measure === codaStart);
    if (sign && sign.at > 0.6 && codaStart + 1 < n) codaStart += 1;
  }

  if (jump) {
    const target = jump.kind === "dalSegno" ? segno : 0;
    if (target === undefined) problems.push(`D.S. at measure ${jump.measure + 1} but no Segno sign was found`);
    if (jump.value === "coda" && (toCoda === undefined || codaStart === undefined))
      problems.push(`"al Coda" at measure ${jump.measure + 1} but the To Coda / Coda signs could not be located`);
    if (jump.value === "fine" && fine === undefined) problems.push(`"al Fine" at measure ${jump.measure + 1} but no Fine was found`);
  }

  const isRepeatEnd = (i: number) => measures[i].endBar === "repeat-end" || measures[i].endBar === "repeat-both";
  const isRepeatStart = (i: number) => measures[i].startBar === "repeat-start" || measures[i].startBar === "repeat-both" || (i > 0 && measures[i - 1].endBar === "repeat-both");
  const repeatStartFor = (i: number) => {
    for (let k = i; k >= 0; k--) if (isRepeatStart(k)) return k;
    return 0;
  };

  const order: number[] = [];
  let i = 0;
  let pass = 1;
  let jumped = false;
  const taken = new Set<number>();
  const guard = n * 6 + 20;
  while (i < n && order.length < guard) {
    const e = endings.get(i);
    if (e && e.length && !e.includes(pass) && !jumped) {
      i++;
      continue;
    }
    if (e && e.length && jumped && !e.includes(Math.max(...[...endings.values()].flat()))) {
      // after D.S./D.C. play the last ending
      i++;
      continue;
    }
    order.push(i);
    if (jumped && jump?.value === "coda" && toCoda === i && codaStart !== undefined) {
      i = codaStart;
      continue;
    }
    if (jumped && jump?.value === "fine" && fine === i) break;
    if (isRepeatEnd(i) && !jumped && !taken.has(i)) {
      taken.add(i);
      pass++;
      i = repeatStartFor(i);
      continue;
    }
    if (isRepeatEnd(i)) pass = 1;
    if (jump && jump.measure === i && !jumped) {
      const target = jump.kind === "dalSegno" ? segno : 0;
      if (target !== undefined) {
        jumped = true;
        pass = 1;
        notes.push(`${jump.kind === "dalSegno" ? "D.S." : "D.C."} at measure ${i + 1} → measure ${target + 1}`);
        i = target;
        continue;
      }
    }
    // when there is a Coda that is only reached by jumping, the first pass skips it
    if (!jumped && jump && codaStart !== undefined && i === jump.measure) break;
    i++;
  }
  if (order.length >= guard) problems.push("Repeat structure loops forever");
  if (jumped && jump?.value === "coda" && codaStart !== undefined) notes.push(`To Coda at measure ${toCoda! + 1} → Coda at measure ${codaStart + 1}`);
  if (taken.size) notes.push(`${taken.size} repeat${taken.size > 1 ? "s" : ""} expanded`);
  return { order, endings, notes, problems };
}
