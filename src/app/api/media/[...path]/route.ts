import { readLocalObject } from "@/lib/storage";

// Serves files from the local storage driver during development/tests only (STORAGE_DRIVER=local).
// In production files are served by Supabase Storage through signed URLs, and this route returns 404.
export async function GET(request: Request, ctx: RouteContext<"/api/media/[...path]">) {
  const { path } = await ctx.params;
  const u = new URL(request.url);
  const data = await readLocalObject(path.join("/"), Number(u.searchParams.get("exp")), u.searchParams.get("sig") ?? "");
  if (!data) return new Response("Not found", { status: 404 });
  const ext = path.at(-1)?.split(".").pop();
  const type = ext === "mp4" || ext === "m4a" ? "audio/mp4" : ext === "mp3" ? "audio/mpeg" : ext === "wav" ? "audio/wav" : "audio/webm";
  return new Response(new Uint8Array(data), { headers: { "Content-Type": type, "Cache-Control": "private, max-age=600" } });
}
