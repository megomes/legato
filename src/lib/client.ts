"use client";

import type { StageId } from "@/engine/convert";
import type { ClientResult, HistoryItem, StreamEvent } from "./protocol";

/** Anonymous id for this browser, so history shows only conversions made here. */
export function clientId(): string {
  try {
    let id = localStorage.getItem("legato.client");
    if (!id) {
      id = crypto.randomUUID();
      localStorage.setItem("legato.client", id);
    }
    return id;
  } catch {
    return "anonymous";
  }
}

export async function convertOnServer(file: File, onStage: (stage: StageId, index: number) => void): Promise<ClientResult> {
  const body = new FormData();
  body.append("file", file);
  body.append("clientId", clientId());
  const res = await fetch("/api/convert", { method: "POST", body });
  if (!res.ok || !res.body) {
    const msg = await res.json().catch(() => ({ error: "" }));
    throw new Error(msg.error || `O servidor respondeu ${res.status}.`);
  }
  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  let result: ClientResult | null = null;
  for (;;) {
    const { value, done } = await reader.read();
    if (value) buffer += decoder.decode(value, { stream: true });
    let nl: number;
    while ((nl = buffer.indexOf("\n")) >= 0) {
      const line = buffer.slice(0, nl).trim();
      buffer = buffer.slice(nl + 1);
      if (!line) continue;
      const ev = JSON.parse(line) as StreamEvent;
      if (ev.type === "stage") onStage(ev.stage, ev.index);
      else if (ev.type === "result") result = ev.result;
      else if (ev.type === "error") throw new Error(ev.message);
    }
    if (done) break;
  }
  if (!result) throw new Error("A conversão terminou sem resposta.");
  return result;
}

export async function loadHistory(): Promise<{ items: HistoryItem[]; enabled: boolean }> {
  try {
    const res = await fetch(`/api/history?client=${encodeURIComponent(clientId())}`, { cache: "no-store" });
    return await res.json();
  } catch {
    return { items: [], enabled: false };
  }
}

export function downloadBytes(base64: string, name: string) {
  const bin = atob(base64);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  const url = URL.createObjectURL(new Blob([bytes], { type: "audio/midi" }));
  const a = document.createElement("a");
  a.href = url;
  a.download = name;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 2000);
}

export const midiFileName = (r: { title: string; fileName: string }) =>
  `${(r.title || r.fileName.replace(/\.pdf$/i, "")).replace(/[\\/:*?"<>|]+/g, "").trim() || "partitura"}.mid`;
