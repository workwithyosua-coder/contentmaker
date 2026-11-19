import { isAttachedAssetPath, listAttachedAssets } from "@/lib/attached-assets";
import { notFound, renderAuthorized } from "@/lib/render";
import { getObject } from "@/lib/storage";

// GET /api/render/:id/assets              → { props: ["sate-padang.png"], sfx: ["bgm.mp3"] } attached in the app
// GET /api/render/:id/assets?file=props/x.png → that file's bytes
// The renderer adds these to public/props and public/sfx before bundling (video/render.mts).
export async function GET(request: Request) {
  if (!renderAuthorized(request)) return notFound();
  const file = new URL(request.url).searchParams.get("file");
  if (!file) return Response.json(await listAttachedAssets());
  const path = `assets/${file}`;
  if (!isAttachedAssetPath(path)) return notFound();
  const data = await getObject(path);
  if (!data) return notFound();
  const type = path.endsWith(".png") ? "image/png" : path.endsWith(".wav") ? "audio/wav" : "audio/mpeg";
  return new Response(data, { headers: { "Content-Type": type, "Cache-Control": "no-store" } });
}
