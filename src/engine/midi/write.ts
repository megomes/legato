import type { Timeline } from "../perform/timeline";
import { PPQ } from "../util/frac";

/**
 * Standard MIDI File (type 1) writer tuned for Synthesia:
 *  track 0 – conductor: title, tempo map, time signatures
 *  track 1 – "Right Hand", channel 1, Acoustic Grand Piano
 *  track 2 – "Left Hand",  channel 2, Acoustic Grand Piano
 * Synthesia separates parts by track/channel and auto-detects hands when a song has two tracks.
 */

interface Ev {
  tick: number;
  order: number; // at equal ticks: meta, note-off, note-on
  bytes: number[];
}

function vlq(n: number): number[] {
  const out = [n & 0x7f];
  n >>= 7;
  while (n > 0) {
    out.unshift((n & 0x7f) | 0x80);
    n >>= 7;
  }
  return out;
}

const text = (s: string) => [...new TextEncoder().encode(s)];
const u32 = (n: number) => [(n >>> 24) & 0xff, (n >>> 16) & 0xff, (n >>> 8) & 0xff, n & 0xff];
const u16 = (n: number) => [(n >>> 8) & 0xff, n & 0xff];

function meta(type: number, data: number[]): number[] {
  return [0xff, type, ...vlq(data.length), ...data];
}

function trackChunk(events: Ev[]): number[] {
  events.sort((a, b) => a.tick - b.tick || a.order - b.order);
  const body: number[] = [];
  let last = 0;
  for (const e of events) {
    body.push(...vlq(e.tick - last), ...e.bytes);
    last = e.tick;
  }
  body.push(0, 0xff, 0x2f, 0x00);
  return [...text("MTrk"), ...u32(body.length), ...body];
}

export function writeMidi(tl: Timeline, title: string): Uint8Array {
  const conductor: Ev[] = [{ tick: 0, order: 0, bytes: meta(0x03, text(title || "Piano")) }];
  for (const t of tl.tempos) {
    const us = Math.round(60_000_000 / t.bpm);
    conductor.push({ tick: t.tick, order: 1, bytes: meta(0x51, [(us >> 16) & 0xff, (us >> 8) & 0xff, us & 0xff]) });
  }
  for (const s of tl.timeSigs) {
    const dd = Math.round(Math.log2(s.den));
    const clocks = s.den === 8 && s.num % 3 === 0 ? 36 : 24;
    conductor.push({ tick: s.tick, order: 1, bytes: meta(0x58, [s.num, dd, clocks, 8]) });
  }
  const end = Math.max(tl.totalTicks, ...tl.notes.map((n) => n.end));
  conductor.push({ tick: end, order: 9, bytes: [] });

  const hand = (h: "R" | "L", name: string, channel: number): Ev[] => {
    const evs: Ev[] = [
      { tick: 0, order: 0, bytes: meta(0x03, text(name)) },
      { tick: 0, order: 0, bytes: meta(0x04, text("Acoustic Grand Piano")) },
      { tick: 0, order: 1, bytes: [0xc0 | channel, 0] },
      { tick: 0, order: 1, bytes: [0xb0 | channel, 7, 100] },
    ];
    for (const n of tl.notes) {
      if (n.hand !== h) continue;
      evs.push({ tick: n.start, order: 3, bytes: [0x90 | channel, n.midi, Math.min(127, Math.max(1, n.velocity))] });
      evs.push({ tick: n.end, order: 2, bytes: [0x80 | channel, n.midi, 64] });
    }
    return evs;
  };

  // drop the empty end marker (it only fixes the conductor length)
  const cond = conductor.filter((e) => e.bytes.length);
  cond.push({ tick: end, order: 9, bytes: meta(0x01, text("end")) });
  const chunks = [trackChunk(cond), trackChunk(hand("R", "Right Hand", 0)), trackChunk(hand("L", "Left Hand", 1))];
  const header = [...text("MThd"), ...u32(6), ...u16(1), ...u16(chunks.length), ...u16(PPQ)];
  return new Uint8Array([...header, ...chunks.flat()]);
}
