import { convertPdf, ENGINE_VERSION } from "@/engine/convert";
import { db, ensureSchema } from "@/lib/db";
import { MAX_UPLOAD_BYTES, type ClientResult, type StreamEvent } from "@/lib/protocol";

export const runtime = "nodejs";
export const maxDuration = 60;

const toBase64 = (bytes: Uint8Array) => Buffer.from(bytes).toString("base64");

export async function POST(request: Request) {
  let form: FormData;
  try {
    form = await request.formData();
  } catch {
    return Response.json({ error: "Envie o PDF como formulário (campo file)." }, { status: 400 });
  }
  const file = form.get("file");
  const clientId = String(form.get("clientId") ?? "anonymous").slice(0, 64);
  if (!(file instanceof File)) return Response.json({ error: "Nenhum arquivo recebido." }, { status: 400 });
  if (file.size > MAX_UPLOAD_BYTES) return Response.json({ error: "O PDF passa de 4 MB." }, { status: 413 });
  const data = new Uint8Array(await file.arrayBuffer());
  const fileName = file.name || "partitura.pdf";

  const encoder = new TextEncoder();
  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      const send = (e: StreamEvent) => controller.enqueue(encoder.encode(JSON.stringify(e) + "\n"));
      try {
        const result = await convertPdf(data, {
          onStage: async (stage, index) => {
            send({ type: "stage", stage, index });
            // give the stream a chance to flush so the browser sees real progress
            await new Promise((r) => setTimeout(r, 0));
          },
        });
        const { midi, timeline, variants, preview, ...rest } = result;
        void midi;
        void timeline;
        void preview;
        const client: ClientResult = {
          ...rest,
          fileName,
          variants: variants && {
            expressive: { midiBase64: toBase64(variants.expressive.midi), preview: variants.expressive.preview },
            exact: { midiBase64: toBase64(variants.exact.midi), preview: variants.exact.preview },
          },
        };
        client.jobId = await record(clientId, fileName, data.length, result).catch((e) => {
          console.error("history write failed", e);
          return undefined;
        });
        send({ type: "result", result: client });
      } catch (e) {
        console.error("conversion crashed", e);
        send({ type: "error", message: "O conversor encontrou um erro interno ao ler este PDF." });
      } finally {
        controller.close();
      }
    },
  });
  return new Response(stream, {
    headers: { "Content-Type": "application/x-ndjson; charset=utf-8", "Cache-Control": "no-store", "X-Engine": ENGINE_VERSION },
  });
}

async function record(clientId: string, fileName: string, size: number, r: Awaited<ReturnType<typeof convertPdf>>): Promise<string | undefined> {
  const sql = db();
  if (!sql) return undefined;
  await ensureSchema();
  const s = r.stats;
  const rows = await sql`
    insert into conversions (client_id, file_name, file_size, engine, ok, error_code, error_message, title, composer, pages,
      measures, failed_measures, notes, duration_seconds, hand_confidence, tempo, font, producer, timings, diagnostics, summary, midi)
    values (${clientId}, ${fileName}, ${size}, ${r.engine}, ${r.ok}, ${r.error?.code ?? null}, ${r.error?.message ?? null},
      ${r.title || null}, ${r.composer || null}, ${s?.pages ?? null}, ${s?.measures ?? r.confidence?.checkedMeasures ?? null},
      ${r.confidence?.failedMeasures ?? null}, ${s?.notes ?? null}, ${s?.durationSeconds ?? null}, ${r.confidence?.hands ?? null},
      ${s?.tempo ?? null}, ${s?.font ?? null}, ${s?.producer ?? null}, ${JSON.stringify(r.timingsMs)},
      ${JSON.stringify({ error: r.error ?? null, warnings: r.warnings, navigation: r.navigation, hands: r.handNotes })},
      ${JSON.stringify({ stats: s ?? null, confidence: r.confidence ?? null })},
      ${r.midi ? "\\x" + Buffer.from(r.midi).toString("hex") : null})
    returning id`;
  return rows[0]?.id as string | undefined;
}
