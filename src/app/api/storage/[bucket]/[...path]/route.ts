import { publicRedirect } from "@/lib/storage";

// GET /api/storage/<bucket>/<path>: the permanent URL of a public-area asset (studio-assets: angry sprites, the urgent
// BGM; custom-assets: uploaded props and SFX) when storage is on Cloudflare R2. The bucket is private, so every request
// is redirected to a fresh presigned R2 URL (or, for an older asset not copied to R2 yet, to its Supabase public URL).
// No login needed (the renderer on GitHub and the in-app player load these, as they did from the public Supabase
// buckets); the private recordings area is never served here.
export async function GET(_request: Request, ctx: RouteContext<"/api/storage/[bucket]/[...path]">) {
  const { bucket, path } = await ctx.params;
  const target = await publicRedirect(bucket, path.map(decodeURIComponent).join("/")).catch((e) => {
    console.error(`[storage] redirect ${bucket}/${path.join("/")} failed:`, e);
    return undefined;
  });
  if (target === undefined) return new Response("Storage is unavailable right now.", { status: 503 });
  if (!target) return new Response("Not found", { status: 404 });
  // short-lived: the presigned URL behind it expires (6 h); browsers re-ask after 5 minutes
  return new Response(null, { status: 302, headers: { Location: target, "Cache-Control": "private, max-age=300" } });
}
