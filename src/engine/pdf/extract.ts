import * as mupdf from "mupdf";
import type { Point, RawDocument, RawGlyph, RawLine, RawPage, RawShape } from "./types";

type Matrix = [number, number, number, number, number, number];

const mul = (a: Matrix, b: Matrix): Matrix => [
  a[0] * b[0] + a[1] * b[2],
  a[0] * b[1] + a[1] * b[3],
  a[2] * b[0] + a[3] * b[2],
  a[2] * b[1] + a[3] * b[3],
  a[4] * b[0] + a[5] * b[2] + b[4],
  a[4] * b[1] + a[5] * b[3] + b[5],
];

const apply = (m: Matrix, x: number, y: number): Point => [x * m[0] + y * m[2] + m[4], x * m[1] + y * m[3] + m[5]];

const scaleOf = (m: Matrix) => Math.sqrt(Math.abs(m[0] * m[3] - m[1] * m[2]));

export function cleanFontName(name: string): string {
  return name.replace(/^[A-Z]{6}\+/, "");
}

function walkPath(path: mupdf.Path, ctm: Matrix) {
  const subpaths: Point[][] = [];
  let cur: Point[] | null = null;
  let hasCurves = false;
  let segments = 0;
  path.walk({
    moveTo(x, y) {
      cur = [apply(ctm, x, y)];
      subpaths.push(cur);
    },
    lineTo(x, y) {
      cur?.push(apply(ctm, x, y));
      segments++;
    },
    curveTo(x1, y1, x2, y2, x3, y3) {
      hasCurves = true;
      segments++;
      cur?.push(apply(ctm, x1, y1), apply(ctm, x2, y2), apply(ctm, x3, y3));
    },
    closePath() {
      if (cur && cur.length) cur.push(cur[0]);
    },
  });
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  for (const sp of subpaths)
    for (const [x, y] of sp) {
      if (x < x0) x0 = x;
      if (y < y0) y0 = y;
      if (x > x1) x1 = x;
      if (y > y1) y1 = y;
    }
  return { subpaths, hasCurves, segments, bbox: [x0, y0, x1, y1] as [number, number, number, number] };
}

/** Pulls every glyph, straight line and shape out of each page. Pure geometry, no music knowledge. */
export function extractDocument(data: Uint8Array): RawDocument {
  const doc = mupdf.Document.openDocument(data, "application/pdf");
  const pages: RawPage[] = [];
  const pageCount = doc.countPages();
  for (let i = 0; i < pageCount; i++) {
    const page = doc.loadPage(i);
    const [bx0, by0, bx1, by1] = page.getBounds();
    const glyphs: RawGlyph[] = [];
    const lines: RawLine[] = [];
    const shapes: RawShape[] = [];
    let images = 0;

    const pushPath = (path: mupdf.Path, ctm: Matrix, kind: "fill" | "stroke", width: number) => {
      const w = walkPath(path, ctm);
      if (!w.subpaths.length || !isFinite(w.bbox[0])) return;
      // A single straight stroked segment is by far the most common primitive: keep it cheap.
      if (kind === "stroke" && !w.hasCurves && w.subpaths.length === 1 && w.subpaths[0].length === 2) {
        const [[x1, y1], [x2, y2]] = w.subpaths[0];
        lines.push({ x1, y1, x2, y2, width });
        return;
      }
      // Some producers stroke polylines made of many independent segments; split them into lines.
      if (kind === "stroke" && !w.hasCurves && w.subpaths.every((sp) => sp.length === 2)) {
        for (const [[x1, y1], [x2, y2]] of w.subpaths) lines.push({ x1, y1, x2, y2, width });
        return;
      }
      shapes.push({ kind, subpaths: w.subpaths, hasCurves: w.hasCurves, bbox: w.bbox, width });
    };

    const device = new mupdf.Device({
      fillText(text: mupdf.Text, ctm: number[]) {
        text.walk({
          showGlyph(font: mupdf.Font, trm: number[], gid: number, unicode: number) {
            const m = mul(trm as Matrix, ctm as Matrix);
            const size = Math.hypot(m[2], m[3]);
            let adv = 0;
            try {
              adv = font.advanceGlyph(gid, 0) * size;
            } catch {
              adv = 0;
            }
            glyphs.push({
              font: cleanFontName(font.getName()),
              code: unicode,
              gid,
              x: m[4],
              y: m[5],
              size,
              adv,
            });
          },
        });
      },
      fillPath(path: mupdf.Path, _eo: boolean, ctm: number[]) {
        pushPath(path, ctm as Matrix, "fill", 0);
      },
      strokePath(path: mupdf.Path, stroke: mupdf.StrokeState, ctm: number[]) {
        pushPath(path, ctm as Matrix, "stroke", stroke.getLineWidth() * scaleOf(ctm as Matrix));
      },
      fillImage() {
        images++;
      },
      fillImageMask() {
        images++;
      },
    });
    page.run(device, mupdf.Matrix.identity);
    device.close();
    pages.push({ index: i, width: bx1 - bx0, height: by1 - by0, glyphs, lines, shapes, images });
  }
  const meta = (k: string) => {
    try {
      return doc.getMetaData(k) ?? "";
    } catch {
      return "";
    }
  };
  return {
    pageCount,
    pages,
    producer: meta("info:Producer"),
    creator: meta("info:Creator"),
    title: meta("info:Title"),
  };
}
