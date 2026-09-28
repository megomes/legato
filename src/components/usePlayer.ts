"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { PreviewNote } from "@/engine/convert";

type ToneModule = typeof import("tone");
type Instrument = { triggerAttackRelease: (note: string | number, dur: number, time: number, vel: number) => void; releaseAll: (time?: number) => void };

const SALAMANDER = "https://tonejs.github.io/audio/salamander/";
const SAMPLE_NOTES = ["A0", "C1", "D#1", "F#1", "A1", "C2", "D#2", "F#2", "A2", "C3", "D#3", "F#3", "A3", "C4", "D#4", "F#4", "A4", "C5", "D#5", "F#5", "A5", "C6", "D#6", "F#6", "A6", "C7", "D#7", "F#7", "A7", "C8"];

let tonePromise: Promise<ToneModule> | null = null;
let instrumentPromise: Promise<Instrument> | null = null;

/** Loads the Salamander grand piano once; falls back to a soft synth if the samples cannot be fetched. */
function loadInstrument(): Promise<Instrument> {
  instrumentPromise ??= (async () => {
    tonePromise ??= import("tone");
    const Tone = await tonePromise;
    const reverb = new Tone.Reverb({ decay: 2.4, wet: 0.16 }).toDestination();
    try {
      const urls = Object.fromEntries(SAMPLE_NOTES.map((n) => [n, `${n.replace("#", "s")}.mp3`]));
      const sampler = await Promise.race([
        new Promise<InstanceType<ToneModule["Sampler"]>>((resolve, reject) => {
          const s = new Tone.Sampler({ urls, baseUrl: SALAMANDER, release: 1.2, onload: () => resolve(s), onerror: (e) => reject(e) });
          s.volume.value = -4;
          s.connect(reverb);
        }),
        new Promise<never>((_, reject) => setTimeout(() => reject(new Error("timeout")), 15000)),
      ]);
      return sampler as unknown as Instrument;
    } catch {
      const synth = new Tone.PolySynth(Tone.Synth, { oscillator: { type: "triangle" }, envelope: { attack: 0.005, decay: 0.4, sustain: 0.25, release: 0.9 } });
      synth.volume.value = -10;
      synth.connect(reverb);
      return synth as unknown as Instrument;
    }
  })();
  return instrumentPromise;
}

export interface Player {
  playing: boolean;
  loading: boolean;
  time: number;
  speed: number;
  muted: { R: boolean; L: boolean };
  getTime: () => number;
  toggle: () => void;
  pause: () => void;
  seek: (t: number) => void;
  setSpeed: (s: number) => void;
  toggleHand: (h: "R" | "L") => void;
}

export function usePlayer(notes: PreviewNote[], duration: number): Player {
  const [playing, setPlaying] = useState(false);
  const [loading, setLoading] = useState(false);
  const [time, setTime] = useState(0);
  const [speed, setSpeedState] = useState(1);
  const [muted, setMuted] = useState({ R: false, L: false });

  const pos = useRef(0); // score seconds at `anchor`
  const anchor = useRef(0); // audio-context time when `pos` was captured
  const speedRef = useRef(1);
  const mutedRef = useRef(muted);
  const playingRef = useRef(false);
  const next = useRef(0);
  const timer = useRef<ReturnType<typeof setInterval> | null>(null);
  const tone = useRef<ToneModule | null>(null);
  const inst = useRef<Instrument | null>(null);
  const sorted = useRef<PreviewNote[]>([]);

  useEffect(() => {
    sorted.current = [...notes].sort((a, b) => a.t - b.t);
  }, [notes]);

  const now = () => tone.current?.now() ?? performance.now() / 1000;
  const getTime = useCallback(() => {
    if (!playingRef.current) return pos.current;
    return Math.min(duration, pos.current + (now() - anchor.current) * speedRef.current);
  }, [duration]);

  const firstIndexAt = (t: number) => {
    const arr = sorted.current;
    let lo = 0;
    let hi = arr.length;
    while (lo < hi) {
      const mid = (lo + hi) >> 1;
      if (arr[mid].t < t - 1e-6) lo = mid + 1;
      else hi = mid;
    }
    return lo;
  };

  const stopTimer = () => {
    if (timer.current) clearInterval(timer.current);
    timer.current = null;
  };

  const pause = useCallback(() => {
    if (!playingRef.current) return;
    pos.current = getTime();
    playingRef.current = false;
    stopTimer();
    inst.current?.releaseAll();
    setPlaying(false);
    setTime(pos.current);
  }, [getTime]);

  const schedule = useCallback(() => {
    const t = getTime();
    if (t >= duration - 0.01) {
      pause();
      pos.current = duration;
      setTime(duration);
      return;
    }
    const horizon = t + 0.35 * speedRef.current;
    const arr = sorted.current;
    while (next.current < arr.length && arr[next.current].t < horizon) {
      const n = arr[next.current++];
      if (n.t < t - 0.05) continue;
      if (mutedRef.current[n.h === 0 ? "R" : "L"]) continue;
      const at = anchor.current + (n.t - pos.current) / speedRef.current;
      inst.current?.triggerAttackRelease(440 * 2 ** ((n.m - 69) / 12), Math.max(0.05, n.d / speedRef.current), Math.max(now(), at), Math.min(1, n.v / 110));
    }
    setTime(t);
  }, [duration, getTime, pause]);

  const start = useCallback(async () => {
    setLoading(true);
    tonePromise ??= import("tone");
    tone.current = await tonePromise;
    await tone.current.start();
    inst.current = await loadInstrument();
    setLoading(false);
    if (pos.current >= duration - 0.01) pos.current = 0;
    anchor.current = now() + 0.08;
    next.current = firstIndexAt(pos.current);
    playingRef.current = true;
    setPlaying(true);
    stopTimer();
    timer.current = setInterval(schedule, 40);
    schedule();
  }, [duration, schedule]);

  const toggle = useCallback(() => {
    if (playingRef.current) pause();
    else void start();
  }, [pause, start]);

  const seek = useCallback(
    (t: number) => {
      const clamped = Math.max(0, Math.min(duration, t));
      const wasPlaying = playingRef.current;
      if (wasPlaying) inst.current?.releaseAll();
      pos.current = clamped;
      anchor.current = now() + (wasPlaying ? 0.05 : 0);
      next.current = firstIndexAt(clamped);
      setTime(clamped);
    },
    [duration],
  );

  const setSpeed = useCallback(
    (s: number) => {
      pos.current = getTime();
      anchor.current = now();
      speedRef.current = s;
      setSpeedState(s);
    },
    [getTime],
  );

  const toggleHand = useCallback((h: "R" | "L") => {
    setMuted((m) => {
      const nextMuted = { ...m, [h]: !m[h] };
      mutedRef.current = nextMuted;
      return nextMuted;
    });
  }, []);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.code === "Space" && !(e.target instanceof HTMLInputElement) && !(e.target instanceof HTMLButtonElement)) {
        e.preventDefault();
        toggle();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [toggle]);

  useEffect(
    () => () => {
      stopTimer();
      inst.current?.releaseAll();
    },
    [],
  );

  return { playing, loading, time, speed, muted, getTime, toggle, pause, seek, setSpeed, toggleHand };
}
