import { revalidatePath } from "next/cache";
import { notFound, renderAuthorized } from "@/lib/render";
import { db } from "@/lib/db";
import { RVC_DONE_MARK } from "@/lib/renderWorker";
import { objectSize } from "@/lib/storage";

// POST /api/render/:id/voices/finish { lineIndex, path, durationMs, fromRecordingId } → registers an uploaded
// RVC-converted take as the line's selected take ("[rvc]": never converted again; the Gemini base take stays).
export async function POST(request: Request, ctx: RouteContext<"/api/render/[id]/voices/finish">) {
  if (!renderAuthorized(request)) return notFound();
  const { id } = await ctx.params;
  const b = (await request.json().catch(() => ({}))) as { lineIndex?: number; path?: string; durationMs?: number; fromRecordingId?: string };
  const sql = db();
  const [s] = await sql<{ id: string; speaker: string | null }[]>`
    SELECT id, lines -> ${Number(b.lineIndex)}::int ->> 'speaker' AS speaker FROM scripts WHERE project_id = ${id} ORDER BY version DESC LIMIT 1`;
  const line = Number(b.lineIndex);
  if (!s || !Number.isInteger(line) || !s.speaker) return Response.json({ error: "Unknown line." }, { status: 400 });
  const prefix = `${id}/${s.id}/line-${String(line + 1).padStart(2, "0")}-${s.speaker}-rvc-`;
  if (!b.path || !b.path.startsWith(prefix) || !/^\d+\.wav$/.test(b.path.slice(prefix.length))) return Response.json({ error: "Unknown upload." }, { status: 400 });
  const size = await objectSize(b.path);
  if (!size) return Response.json({ error: "The converted take didn't arrive." }, { status: 400 });
  const durationMs = Number.isFinite(b.durationMs) ? Math.round(b.durationMs!) : null;
  await sql.begin(async (tx) => {
    const [{ take }] = await tx<{ take: number }[]>`SELECT COALESCE(max(take), 0) + 1 AS take FROM recordings WHERE script_id = ${s.id} AND line_index = ${line}`;
    await tx`UPDATE recordings SET is_selected = false WHERE script_id = ${s.id} AND line_index = ${line}`;
    await tx`
      INSERT INTO recordings (project_id, script_id, line_index, speaker, take, storage_path, mime_type, size_bytes, duration_ms, source, ai_prompt)
      VALUES (${id}, ${s.id}, ${line}, ${s.speaker}, ${take}, ${b.path!}, 'audio/wav', ${size}, ${durationMs}, 'ai', ${`${RVC_DONE_MARK} converted from ${b.fromRecordingId ?? "?"}`})`;
  });
  revalidatePath(`/create/${id}`);
  revalidatePath(`/create/${id}/record`);
  return Response.json({ ok: true });
}
