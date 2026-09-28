"use client";

import { useEffect, useMemo, useRef } from "react";
import type { PreviewNote } from "@/engine/convert";
import styles from "./Waterfall.module.css";

const BLACK = new Set([1, 3, 6, 8, 10]);
const isBlack = (m: number) => BLACK.has(m % 12);

interface Props {
  notes: PreviewNote[];
  duration: number;
  measureStarts: number[];
  measureNumbers: number[];
  getTime: () => number;
  playing: boolean;
  muted: { R: boolean; L: boolean };
  onSeek: (t: number) => void;
}

interface KeyGeo {
  midi: number;
  x: number;
  w: number;
  black: boolean;
}

/** Keyboard geometry for a pitch range, snapped outward to white keys, at least three octaves wide. */
function keyboard(lo: number, hi: number, width: number): { keys: KeyGeo[]; byMidi: Map<number, KeyGeo> } {
  let a = Math.max(21, lo - 2);
  let b = Math.min(108, hi + 2);
  while (b - a < 36) {
    if (a > 21) a--;
    if (b < 108) b++;
    if (a === 21 && b === 108) break;
  }
  while (isBlack(a)) a--;
  while (isBlack(b)) b++;
  const whites = [];
  for (let m = a; m <= b; m++) if (!isBlack(m)) whites.push(m);
  const ww = width / whites.length;
  const keys: KeyGeo[] = [];
  const byMidi = new Map<number, KeyGeo>();
  whites.forEach((m, i) => {
    const k = { midi: m, x: i * ww, w: ww, black: false };
    keys.push(k);
    byMidi.set(m, k);
  });
  for (let m = a; m <= b; m++) {
    if (!isBlack(m)) continue;
    const left = byMidi.get(m - 1);
    if (!left) continue;
    const bw = ww * 0.62;
    const k = { midi: m, x: left.x + left.w - bw / 2, w: bw, black: true };
    keys.push(k);
    byMidi.set(m, k);
  }
  return { keys, byMidi };
}

const COLORS = {
  R: { top: "#8ff0c4", bottom: "#2fbf83", deep: "#1b8a5c", glow: "rgba(94,230,168,0.55)", key: "#5ee6a8" },
  L: { top: "#a9bdff", bottom: "#5476ee", deep: "#3450c4", glow: "rgba(124,156,255,0.55)", key: "#7c9cff" },
};

function roundRect(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number) {
  const rr = Math.min(r, w / 2, h / 2);
  ctx.beginPath();
  ctx.moveTo(x + rr, y);
  ctx.arcTo(x + w, y, x + w, y + h, rr);
  ctx.arcTo(x + w, y + h, x, y + h, rr);
  ctx.arcTo(x, y + h, x, y, rr);
  ctx.arcTo(x, y, x + w, y, rr);
  ctx.closePath();
}

export function Waterfall({ notes, duration, measureStarts, measureNumbers, getTime, playing, muted, onSeek }: Props) {
  const canvas = useRef<HTMLCanvasElement>(null);
  const strip = useRef<HTMLCanvasElement>(null);
  const wrap = useRef<HTMLDivElement>(null);
  const range = useMemo(() => {
    let lo = 108;
    let hi = 21;
    for (const n of notes) {
      if (n.m < lo) lo = n.m;
      if (n.m > hi) hi = n.m;
    }
    return notes.length ? [lo, hi] : [48, 84];
  }, [notes]);
  const sorted = useMemo(() => [...notes].sort((a, b) => a.t - b.t), [notes]);
  const maxDur = useMemo(() => Math.max(0.1, ...notes.map((n) => n.d)), [notes]);
  const drag = useRef<{ y: number; t: number } | null>(null);
  const state = useRef({ muted, playing });
  state.current = { muted, playing };

  // ---- main waterfall ---------------------------------------------------------------------------
  useEffect(() => {
    const c = canvas.current;
    const w = wrap.current;
    if (!c || !w) return;
    const ctx = c.getContext("2d")!;
    let raf = 0;
    let lastT = -1;
    let lastW = 0;
    let lastH = 0;
    let geo = keyboard(range[0], range[1], 100);

    const draw = () => {
      raf = requestAnimationFrame(draw);
      const dpr = Math.min(2, window.devicePixelRatio || 1);
      const W = w.clientWidth;
      const H = w.clientHeight;
      const t = getTime();
      if (Math.abs(t - lastT) < 1e-4 && W === lastW && H === lastH && !state.current.playing) return;
      if (W !== lastW || H !== lastH) {
        c.width = Math.round(W * dpr);
        c.height = Math.round(H * dpr);
        c.style.width = `${W}px`;
        c.style.height = `${H}px`;
        geo = keyboard(range[0], range[1], W);
      }
      lastT = t;
      lastW = W;
      lastH = H;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.clearRect(0, 0, W, H);

      const kbH = Math.max(64, Math.min(118, H * 0.2));
      const fallH = H - kbH;
      const windowSecs = Math.max(2.4, Math.min(5, fallH / 110));
      const pps = fallH / windowSecs;

      // lanes: faint guides on C keys
      for (const k of geo.keys) {
        if (k.black) continue;
        if (k.midi % 12 === 0) {
          ctx.fillStyle = "rgba(255,255,255,0.035)";
          ctx.fillRect(k.x, 0, 1, fallH);
        }
      }
      // measure lines
      ctx.font = "500 10px var(--font-jetbrains), ui-monospace, monospace";
      for (let i = 0; i < measureStarts.length; i++) {
        const y = fallH - (measureStarts[i] - t) * pps;
        if (y < -10 || y > fallH) continue;
        ctx.fillStyle = "rgba(232,194,122,0.10)";
        ctx.fillRect(0, Math.round(y), W, 1);
        ctx.fillStyle = "rgba(236,231,220,0.34)";
        ctx.fillText(String(measureNumbers[i]), 8, Math.round(y) - 5);
      }

      // notes
      const active = new Map<number, "R" | "L">();
      let i = 0;
      let lo = 0;
      let hi = sorted.length;
      const from = t - maxDur;
      while (lo < hi) {
        const mid = (lo + hi) >> 1;
        if (sorted[mid].t < from) lo = mid + 1;
        else hi = mid;
      }
      i = lo;
      const mutedNow = state.current.muted;
      // Collect what is on screen, then paint white-key notes first and black-key notes on top (as Synthesia
      // does): a black-key lane overlaps its white neighbours, so painting by start time could hide notes.
      const visible: { n: PreviewNote; k: KeyGeo; top: number; bottom: number; sounding: boolean }[] = [];
      for (; i < sorted.length; i++) {
        const n = sorted[i];
        if (n.t > t + windowSecs) break;
        const end = n.t + n.d;
        if (end < t) continue;
        const k = geo.byMidi.get(n.m);
        if (!k) continue;
        const top = Math.max(-4, fallH - (end - t) * pps);
        const bottom = Math.min(fallH, fallH - (n.t - t) * pps);
        if (bottom - top < 1) continue;
        const sounding = n.t <= t && end > t;
        if (sounding) active.set(n.m, n.h === 0 ? "R" : "L");
        visible.push({ n, k, top, bottom, sounding });
      }
      for (const layer of [false, true])
        for (const { n, k, top, bottom, sounding } of visible) {
          if (k.black !== layer) continue;
          const hand = n.h === 0 ? "R" : "L";
          const col = COLORS[hand];
          const pad = k.black ? 1 : Math.max(1.5, k.w * 0.1);
          const x = k.x + pad;
          const nw = k.w - pad * 2;
          const dim = mutedNow[hand];
          ctx.globalAlpha = dim ? 0.18 : 1;
          const grad = ctx.createLinearGradient(0, top, 0, bottom);
          grad.addColorStop(0, k.black ? col.bottom : col.top);
          grad.addColorStop(1, k.black ? col.deep : col.bottom);
          ctx.shadowColor = sounding && !dim ? col.glow : "transparent";
          ctx.shadowBlur = sounding && !dim ? 18 : 0;
          ctx.fillStyle = grad;
          roundRect(ctx, x, top, nw, bottom - top, Math.min(6, nw / 2.5));
          ctx.fill();
          ctx.shadowBlur = 0;
          // a dark outline keeps notes readable where a black-key note crosses a white-key one
          ctx.strokeStyle = k.black ? "rgba(11,12,20,0.9)" : "rgba(11,12,20,0.4)";
          ctx.lineWidth = k.black ? 1.5 : 1;
          ctx.stroke();
          ctx.globalAlpha = 1;
        }

      // hit line
      const hit = ctx.createLinearGradient(0, 0, W, 0);
      hit.addColorStop(0, "rgba(232,194,122,0)");
      hit.addColorStop(0.5, "rgba(232,194,122,0.85)");
      hit.addColorStop(1, "rgba(232,194,122,0)");
      ctx.fillStyle = hit;
      ctx.fillRect(0, fallH - 1, W, 2);

      // keyboard
      const kbY = fallH + 2;
      for (const k of geo.keys) {
        if (k.black) continue;
        const a = active.get(k.midi);
        const g = ctx.createLinearGradient(0, kbY, 0, kbY + kbH);
        if (a && !mutedNow[a]) {
          g.addColorStop(0, COLORS[a].key);
          g.addColorStop(1, a === "R" ? "#bff7dc" : "#d3ddff");
        } else {
          g.addColorStop(0, "#d9d3c7");
          g.addColorStop(1, "#f4efe6");
        }
        ctx.fillStyle = g;
        roundRect(ctx, k.x + 0.75, kbY, k.w - 1.5, kbH - 2, 4);
        ctx.fill();
        if (k.midi === 60) {
          ctx.fillStyle = "rgba(11,12,20,0.35)";
          ctx.beginPath();
          ctx.arc(k.x + k.w / 2, kbY + kbH - 12, 2.2, 0, Math.PI * 2);
          ctx.fill();
        }
      }
      for (const k of geo.keys) {
        if (!k.black) continue;
        const a = active.get(k.midi);
        const g = ctx.createLinearGradient(0, kbY, 0, kbY + kbH * 0.62);
        if (a && !mutedNow[a]) {
          g.addColorStop(0, COLORS[a].bottom);
          g.addColorStop(1, COLORS[a].key);
        } else {
          g.addColorStop(0, "#1a1c28");
          g.addColorStop(1, "#2a2d3d");
        }
        ctx.fillStyle = g;
        roundRect(ctx, k.x, kbY - 1, k.w, kbH * 0.62, 3);
        ctx.fill();
      }
      // keyboard shadow under the hit line
      const sh = ctx.createLinearGradient(0, kbY, 0, kbY + 14);
      sh.addColorStop(0, "rgba(0,0,0,0.45)");
      sh.addColorStop(1, "rgba(0,0,0,0)");
      ctx.fillStyle = sh;
      ctx.fillRect(0, kbY, W, 14);
    };
    raf = requestAnimationFrame(draw);
    return () => cancelAnimationFrame(raf);
  }, [getTime, measureNumbers, measureStarts, range, sorted, maxDur]);

  // ---- overview strip (whole piece, also the seek bar) ----------------------------------------------
  useEffect(() => {
    const c = strip.current;
    if (!c) return;
    const ctx = c.getContext("2d")!;
    let raf = 0;
    let base: HTMLCanvasElement | null = null;
    let baseW = 0;
    const draw = () => {
      raf = requestAnimationFrame(draw);
      const dpr = Math.min(2, window.devicePixelRatio || 1);
      const W = c.clientWidth;
      const H = c.clientHeight;
      if (!W || !H) return;
      if (!base || baseW !== W) {
        baseW = W;
        c.width = Math.round(W * dpr);
        c.height = Math.round(H * dpr);
        base = document.createElement("canvas");
        base.width = c.width;
        base.height = c.height;
        const b = base.getContext("2d")!;
        b.setTransform(dpr, 0, 0, dpr, 0, 0);
        const [lo, hi] = [range[0] - 1, range[1] + 1];
        const ph = (H - 8) / (hi - lo);
        for (const n of notes) {
          const x = (n.t / duration) * W;
          const w = Math.max(1, (n.d / duration) * W);
          const y = 4 + (hi - n.m) * ph;
          b.fillStyle = n.h === 0 ? "rgba(94,230,168,0.85)" : "rgba(124,156,255,0.85)";
          b.fillRect(x, y, w, Math.max(1.2, ph));
        }
      }
      ctx.setTransform(1, 0, 0, 1, 0, 0);
      ctx.clearRect(0, 0, c.width, c.height);
      ctx.drawImage(base, 0, 0);
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      const t = getTime();
      const x = (t / duration) * W;
      ctx.fillStyle = "rgba(11,12,20,0.55)";
      ctx.fillRect(0, 0, x, H);
      ctx.fillStyle = "#e8c27a";
      ctx.fillRect(x - 1, 0, 2, H);
      ctx.beginPath();
      ctx.arc(x, 3, 3.5, 0, Math.PI * 2);
      ctx.fill();
    };
    raf = requestAnimationFrame(draw);
    return () => cancelAnimationFrame(raf);
  }, [notes, duration, range, getTime]);

  const seekFromStrip = (clientX: number) => {
    const r = strip.current!.getBoundingClientRect();
    onSeek(((clientX - r.left) / r.width) * duration);
  };

  return (
    <div className={styles.root}>
      <div
        ref={wrap}
        className={styles.fall}
        onWheel={(e) => onSeek(getTime() + e.deltaY * 0.004)}
        onPointerDown={(e) => {
          (e.target as HTMLElement).setPointerCapture(e.pointerId);
          drag.current = { y: e.clientY, t: getTime() };
        }}
        onPointerMove={(e) => {
          if (!drag.current) return;
          const h = wrap.current!.clientHeight;
          onSeek(drag.current.t + ((e.clientY - drag.current.y) / h) * 3.5);
        }}
        onPointerUp={() => (drag.current = null)}
        role="img"
        aria-label="Prévia das notas caindo sobre o teclado"
      >
        <canvas ref={canvas} />
      </div>
      <canvas
        ref={strip}
        className={styles.strip}
        onPointerDown={(e) => {
          (e.target as HTMLElement).setPointerCapture(e.pointerId);
          seekFromStrip(e.clientX);
        }}
        onPointerMove={(e) => {
          if (e.buttons) seekFromStrip(e.clientX);
        }}
        aria-label="Mapa da peça inteira; clique para ir a um ponto"
        role="slider"
        aria-valuemin={0}
        aria-valuemax={Math.round(duration)}
        aria-valuenow={0}
      />
    </div>
  );
}
