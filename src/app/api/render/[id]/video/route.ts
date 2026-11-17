import { revalidatePath } from "next/cache";
import { db } from "@/lib/db";
import { notFound, renderAuthorized, renderSource } from "@/lib/render";
import { putObject } from "@/lib/storage";

export const maxDuration = 120;
const MAX_BYTES = 95 * 1024 * 1024;

// POST /api/render/:id/video (body: the MP4, header x-duration-ms) → stores the finished episode video.
export async function POST(request: Request, ctx: RouteContext<"/api/render/[id]/video">) {
  if (!renderAuthorized(request)) return notFound();
  const { id } = await ctx.params;
  const src = await renderSource(id);
  if (!src?.script) return notFound();
  if (!(request.headers.get("content-type") ?? "").startsWith("video/mp4")) return Response.json({ error: "Send video/mp4." }, { status: 415 });
  const body = await request.arrayBuffer();
  if (!body.byteLength || body.byteLength > MAX_BYTES) return Response.json({ error: "Empty or over 95 MB." }, { status: 413 });

  const durationMs = Number(request.headers.get("x-duration-ms")) || null;
  const path = `${id}/video/v${src.script.version}-${new Date().toISOString().replace(/[:.]/g, "-")}.mp4`;
  await putObject(path, body, "video/mp4");
  const sql = db();
  const [row] = await sql<{ id: string }[]>`
    INSERT INTO episode_videos (project_id, script_id, storage_path, size_bytes, duration_ms)
    VALUES (${id}, ${src.script.id}, ${path}, ${body.byteLength}, ${durationMs}) RETURNING id`;
  await sql`UPDATE content_projects SET status = 'awaiting_approval', updated_at = now() WHERE id = ${id}`;
  revalidatePath(`/create/${id}`);
  revalidatePath("/create");
  return Response.json({ ok: true, id: row.id, path });
}
