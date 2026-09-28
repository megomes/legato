import { db } from "@/lib/db";

export const runtime = "nodejs";

const safeName = (s: string) => s.replace(/\.pdf$/i, "").replace(/[^\p{L}\p{N} ._()-]+/gu, "").trim() || "partitura";

export async function GET(request: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const clientId = new URL(request.url).searchParams.get("client") ?? "";
  const sql = db();
  if (!sql || !/^[0-9a-f-]{36}$/i.test(id)) return new Response("Not found", { status: 404 });
  const rows = await sql`select file_name, title, midi from conversions where id = ${id} and client_id = ${clientId} and ok limit 1`;
  const row = rows[0];
  if (!row?.midi) return new Response("Not found", { status: 404 });
  const bytes: Uint8Array = row.midi instanceof Uint8Array ? row.midi : Buffer.from(String(row.midi).replace(/^\\x/, ""), "hex");
  const name = `${safeName(row.title || row.file_name)}.mid`;
  return new Response(Buffer.from(bytes), {
    headers: {
      "Content-Type": "audio/midi",
      "Content-Disposition": `attachment; filename="${name.normalize("NFD").replace(/[^\x20-\x7e]/g, "")}"; filename*=UTF-8''${encodeURIComponent(name)}`,
      "Cache-Control": "private, no-store",
    },
  });
}
