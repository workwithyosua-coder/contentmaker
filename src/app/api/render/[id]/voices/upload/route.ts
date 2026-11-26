import { notFound, renderAuthorized } from "@/lib/render";
import { db } from "@/lib/db";
import { signedUploadUrl } from "@/lib/storage";

// POST /api/render/:id/voices/upload { lineIndex } → a one-time URL the worker PUTs one RVC-converted take (WAV) to,
// in the private recordings bucket next to the line's other takes.
export async function POST(request: Request, ctx: RouteContext<"/api/render/[id]/voices/upload">) {
  if (!renderAuthorized(request)) return notFound();
  const { id } = await ctx.params;
  const b = (await request.json().catch(() => ({}))) as { lineIndex?: number };
  const [s] = await db()<{ id: string; speaker: string | null }[]>`
    SELECT id, lines -> ${Number(b.lineIndex)}::int ->> 'speaker' AS speaker FROM scripts WHERE project_id = ${id} ORDER BY version DESC LIMIT 1`;
  if (!s || !Number.isInteger(b.lineIndex) || !s.speaker) return Response.json({ error: "Unknown line." }, { status: 400 });
  const path = `${id}/${s.id}/line-${String(b.lineIndex! + 1).padStart(2, "0")}-${s.speaker}-rvc-${Date.now()}.wav`;
  return Response.json({ url: await signedUploadUrl(path), path });
}
