import { notFound, renderAuthorized } from "@/lib/render";
import { putObject } from "@/lib/storage";

// POST /api/render/:id/video/part?upload=<uuid>&n=<0-based> (body: up to 4 MB of the MP4)
// Vercel caps request bodies at 4.5 MB, so the renderer sends the video in pieces; /complete joins them.
const MAX_PART = 4 * 1024 * 1024;

export async function POST(request: Request, ctx: RouteContext<"/api/render/[id]/video/part">) {
  if (!renderAuthorized(request)) return notFound();
  const { id } = await ctx.params;
  const url = new URL(request.url);
  const upload = url.searchParams.get("upload") ?? "";
  const n = Number(url.searchParams.get("n"));
  if (!/^[0-9a-f-]{36}$/.test(upload) || !Number.isInteger(n) || n < 0 || n > 200) return Response.json({ error: "Bad part." }, { status: 400 });
  const body = await request.arrayBuffer();
  if (!body.byteLength || body.byteLength > MAX_PART) return Response.json({ error: "Part must be 1 byte to 4 MB." }, { status: 413 });
  await putObject(`${id}/video/parts-${upload}/${String(n).padStart(4, "0")}`, body, "application/octet-stream");
  return Response.json({ ok: true, n, bytes: body.byteLength });
}
