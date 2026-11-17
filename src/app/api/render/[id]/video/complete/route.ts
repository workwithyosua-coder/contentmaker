import { revalidatePath } from "next/cache";
import { db } from "@/lib/db";
import { notFound, renderAuthorized, renderSource } from "@/lib/render";
import { deleteObjects, getObject, putObject } from "@/lib/storage";

export const maxDuration = 120;
const MAX_BYTES = 49 * 1024 * 1024; // Supabase free plan: 50 MB per file

// POST /api/render/:id/video/complete { upload, parts, durationMs } → joins the parts into the episode MP4.
export async function POST(request: Request, ctx: RouteContext<"/api/render/[id]/video/complete">) {
  if (!renderAuthorized(request)) return notFound();
  const { id } = await ctx.params;
  const src = await renderSource(id);
  if (!src?.script) return notFound();
  const { upload, parts, durationMs } = (await request.json()) as { upload: string; parts: number; durationMs?: number };
  if (!/^[0-9a-f-]{36}$/.test(upload) || !Number.isInteger(parts) || parts < 1 || parts > 200) return Response.json({ error: "Bad upload." }, { status: 400 });

  const paths = Array.from({ length: parts }, (_, n) => `${id}/video/parts-${upload}/${String(n).padStart(4, "0")}`);
  const chunks = await Promise.all(paths.map((p) => getObject(p)));
  const missing = chunks.findIndex((c) => !c);
  if (missing >= 0) return Response.json({ error: `Part ${missing} is missing.` }, { status: 400 });
  const size = chunks.reduce((s, c) => s + c!.byteLength, 0);
  if (size > MAX_BYTES) {
    await deleteObjects(paths);
    return Response.json({ error: "Video is over 49 MB. Render at a higher crf." }, { status: 413 });
  }
  const whole = new Uint8Array(size);
  let at = 0;
  for (const c of chunks) {
    whole.set(new Uint8Array(c!), at);
    at += c!.byteLength;
  }

  const path = `${id}/video/v${src.script.version}-${new Date().toISOString().replace(/[:.]/g, "-")}.mp4`;
  await putObject(path, whole.buffer, "video/mp4");
  await deleteObjects(paths);
  const sql = db();
  const [row] = await sql<{ id: string }[]>`
    INSERT INTO episode_videos (project_id, script_id, storage_path, size_bytes, duration_ms)
    VALUES (${id}, ${src.script.id}, ${path}, ${size}, ${Number(durationMs) || null}) RETURNING id`;
  await sql`UPDATE content_projects SET status = 'awaiting_approval', updated_at = now() WHERE id = ${id}`;
  revalidatePath(`/create/${id}`);
  revalidatePath("/create");
  return Response.json({ ok: true, id: row.id, path, bytes: size });
}
