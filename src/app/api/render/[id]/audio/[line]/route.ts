import { notFound, renderAuthorized, renderSource } from "@/lib/render";
import { getObject } from "@/lib/storage";

// GET /api/render/:id/audio/:line → the selected take of one line (0-based), streamed from private storage.
export async function GET(request: Request, ctx: RouteContext<"/api/render/[id]/audio/[line]">) {
  if (!renderAuthorized(request)) return notFound();
  const { id, line } = await ctx.params;
  const src = await renderSource(id);
  const take = src?.takes.find((t) => t.line_index === Number(line));
  if (!take) return notFound();
  const bytes = await getObject(take.storage_path);
  if (!bytes) return notFound();
  return new Response(bytes, { headers: { "Content-Type": take.mime_type, "Cache-Control": "no-store" } });
}
