import { videoAssetUrls } from "@/lib/studio-assets";
import { notFound, renderAuthorized, renderSource } from "@/lib/render";
import { renderManifest, serverError } from "@/lib/render-manifest";
import { getTunables } from "@/lib/insights/server";
import { DEFAULT_TUNABLES } from "@/lib/insights/tunables";

// GET /api/render/:id → everything the renderer needs to animate an episode (script lines + which lines have audio).
// Any unexpected failure answers with a readable JSON error (and its stack in the function log), never an empty 500:
// the worker prints it, and retries a 5xx.
export async function GET(request: Request, ctx: RouteContext<"/api/render/[id]">) {
  if (!renderAuthorized(request)) return notFound();
  const { id } = await ctx.params;
  let src: Awaited<ReturnType<typeof renderSource>>;
  try {
    src = await renderSource(id);
  } catch (err) {
    // the database (connection, pooler, query): retryable
    return serverError(`render manifest ${id}: loading the episode`, err, 503);
  }
  if (!src?.script) return notFound();
  try {
    const assetUrls = await videoAssetUrls(new URL(request.url).origin).catch((err) => {
      console.error(`[render manifest ${id}] uploaded assets unavailable, rendering without them:`, err);
      return { props: {}, sfx: {}, cast: {} };
    });
    // Live Studio Tunables (gaps, music under speech, motion energy); the defaults when they can't be read
    const tunables = await getTunables().catch((err) => {
      console.error(`[render manifest ${id}] studio tunables unavailable, using the defaults:`, err);
      return DEFAULT_TUNABLES;
    });
    return Response.json(renderManifest(src, assetUrls, tunables));
  } catch (err) {
    return serverError(`render manifest ${id}`, err);
  }
}
