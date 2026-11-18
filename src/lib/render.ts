import "server-only";
import { safeEqual } from "./auth";
import { db } from "./db";
import type { Script } from "./agents/writers-room";

// The video renderer (video/render.mts, run on a laptop, this server or a GitHub Actions job) talks to the app
// through /api/render/* with `Authorization: Bearer <RENDER_TOKEN>`. It never needs database or storage keys.
// Fails closed when RENDER_TOKEN is unset.
export function renderAuthorized(request: Request) {
  const expected = process.env.RENDER_TOKEN?.trim();
  const given = (request.headers.get("authorization") ?? "").replace(/^Bearer\s+/i, "");
  return Boolean(expected) && safeEqual(given, expected!);
}

export const notFound = () => new Response("Not found", { status: 404 });

/** The script that gets animated (the approved one, else the latest) and its selected takes. */
export async function renderSource(projectId: string) {
  const sql = db();
  const [project] = await sql<{ id: string; title: string | null }[]>`SELECT id, title FROM content_projects WHERE id = ${projectId}`;
  if (!project) return null;
  const [script] = await sql<(Script & { id: string; version: number })[]>`
    SELECT id, version, title, target_duration_s, lines, sources FROM scripts
    WHERE project_id = ${projectId} ORDER BY version DESC LIMIT 1`;
  if (!script) return { project, script: null, takes: [] };
  const takes = await sql<{ line_index: number; storage_path: string; mime_type: string; duration_ms: number | null }[]>`
    SELECT line_index, storage_path, mime_type, duration_ms FROM recordings
    WHERE script_id = ${script.id} AND is_selected ORDER BY line_index`;
  return { project, script, takes };
}

/** The newest rendered video of an episode, with a playback URL. */
export async function latestVideo(projectId: string) {
  const [v] = await db()<
    { id: string; storage_path: string; duration_ms: number | null; created_at: Date; script_id: string; drive_url: string | null; drive_error: string | null }[]
  >`
    SELECT id, storage_path, duration_ms, created_at, script_id, drive_url, drive_error FROM episode_videos
    WHERE project_id = ${projectId} ORDER BY created_at DESC LIMIT 1`;
  if (!v) return null;
  const { signedUrl } = await import("./storage");
  return { ...v, url: await signedUrl(v.storage_path, 6 * 3600) };
}
