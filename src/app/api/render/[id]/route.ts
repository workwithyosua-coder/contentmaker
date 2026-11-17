import { notFound, renderAuthorized, renderSource } from "@/lib/render";

// GET /api/render/:id → everything the renderer needs to animate an episode (script lines + which lines have audio).
export async function GET(request: Request, ctx: RouteContext<"/api/render/[id]">) {
  if (!renderAuthorized(request)) return notFound();
  const { id } = await ctx.params;
  const src = await renderSource(id);
  if (!src?.script) return notFound();
  const recorded = new Set(src.takes.map((t) => t.line_index));
  return Response.json({
    projectId: src.project.id,
    title: src.script.title || src.project.title,
    scriptId: src.script.id,
    version: src.script.version,
    targetDurationS: src.script.target_duration_s,
    lines: src.script.lines.map((l, index) => ({ ...l, index, hasAudio: recorded.has(index) })),
  });
}
