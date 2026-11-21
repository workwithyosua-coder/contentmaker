import { styleById } from "../../../../../video/src/styles/registry";
import { videoAssetUrls } from "@/lib/studio-assets";
import { notFound, renderAuthorized, renderSource } from "@/lib/render";

// GET /api/render/:id → everything the renderer needs to animate an episode (script lines + which lines have audio).
export async function GET(request: Request, ctx: RouteContext<"/api/render/[id]">) {
  if (!renderAuthorized(request)) return notFound();
  const { id } = await ctx.params;
  const src = await renderSource(id);
  if (!src?.script) return notFound();
  const recorded = new Set(src.takes.map((t) => t.line_index));
  // where each take came from ("ai" = ElevenLabs TTS, "upload", "booth"…): the renderer paces AI voices a little faster
  const sourceOf = new Map(src.takes.map((t) => [t.line_index, t.source]));
  return Response.json({
    projectId: src.project.id,
    title: src.script.title || src.project.title,
    videoStyle: styleById(src.project.video_style).id,
    scriptId: src.script.id,
    version: src.script.version,
    targetDurationS: src.script.target_duration_s,
    // custom scripts: direction / pacing notes, parsed by the renderer (video/src/direction.ts)
    direction: src.script.direction ?? null,
    custom: src.script.custom ?? false,
    // uploaded custom props / SFX (public Supabase bucket custom-assets) by name → HTTPS URL; Remotion loads them directly
    // custom props / SFX and the global Studio Assets (angry sprites, urgent BGM), as public URLs
    assetUrls: await videoAssetUrls(new URL(request.url).origin).catch(() => ({ props: {}, sfx: {}, cast: {} })),
    lines: src.script.lines.map((l, index) => ({ ...l, index, hasAudio: recorded.has(index), audioSource: sourceOf.get(index) ?? null })),
  });
}
