import { db, ensureSchema } from "@/lib/db";
import type { HistoryItem } from "@/lib/protocol";

export const runtime = "nodejs";

/** Recent conversions made from this browser (identified by an anonymous id kept in localStorage). */
export async function GET(request: Request) {
  const clientId = new URL(request.url).searchParams.get("client") ?? "";
  const sql = db();
  if (!sql || !clientId) return Response.json({ items: [], enabled: !!sql });
  try {
    await ensureSchema();
    const rows = await sql`
      select id, created_at, file_name, title, composer, ok, error_message, measures, notes, duration_seconds, hand_confidence
      from conversions where client_id = ${clientId} order by created_at desc limit 8`;
    const items: HistoryItem[] = rows.map((r) => ({
      id: r.id,
      createdAt: new Date(r.created_at).toISOString(),
      fileName: r.file_name,
      title: r.title,
      composer: r.composer,
      ok: r.ok,
      errorMessage: r.error_message,
      measures: r.measures,
      notes: r.notes,
      durationSeconds: r.duration_seconds,
      handConfidence: r.hand_confidence,
    }));
    return Response.json({ items, enabled: true });
  } catch (e) {
    console.error("history read failed", e);
    return Response.json({ items: [], enabled: false });
  }
}
