import type { ConversionResult, StageId } from "@/engine/convert";

/** What the browser receives: the engine result with the MIDI as base64 and the stored job id. */
export type ClientResult = Omit<ConversionResult, "midi" | "timeline"> & {
  midiBase64?: string;
  jobId?: string;
  fileName: string;
};

export type StreamEvent =
  | { type: "stage"; stage: StageId; index: number }
  | { type: "result"; result: ClientResult }
  | { type: "error"; message: string };

export interface HistoryItem {
  id: string;
  createdAt: string;
  fileName: string;
  title: string | null;
  composer: string | null;
  ok: boolean;
  errorMessage: string | null;
  measures: number | null;
  notes: number | null;
  durationSeconds: number | null;
  handConfidence: number | null;
}

export const MAX_UPLOAD_BYTES = 4 * 1024 * 1024;
