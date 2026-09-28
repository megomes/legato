import { neon, type NeonQueryFunction } from "@neondatabase/serverless";

/**
 * Neon keeps a record of each conversion (metadata, diagnostics and the generated MIDI).
 * Uploaded PDFs are never stored. Without DATABASE_URL the app still works, just without history.
 */

let sql: NeonQueryFunction<false, false> | null = null;
let ready: Promise<void> | null = null;

export function db(): NeonQueryFunction<false, false> | null {
  const url = process.env.DATABASE_URL;
  if (!url) return null;
  sql ??= neon(url);
  return sql;
}

export function ensureSchema(): Promise<void> {
  const q = db();
  if (!q) return Promise.resolve();
  ready ??= (async () => {
    await q`
      create table if not exists conversions (
        id uuid primary key default gen_random_uuid(),
        created_at timestamptz not null default now(),
        client_id text not null,
        file_name text not null,
        file_size integer not null,
        engine text not null,
        ok boolean not null,
        error_code text,
        error_message text,
        title text,
        composer text,
        pages integer,
        measures integer,
        failed_measures integer,
        notes integer,
        duration_seconds real,
        hand_confidence real,
        tempo text,
        font text,
        producer text,
        timings jsonb,
        diagnostics jsonb,
        summary jsonb,
        midi bytea
      )`;
    await q`create index if not exists conversions_client_idx on conversions (client_id, created_at desc)`;
  })().catch((e) => {
    ready = null;
    throw e;
  });
  return ready;
}
