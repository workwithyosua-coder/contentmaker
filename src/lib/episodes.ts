import "server-only";
import { db } from "./db";
import type { ConceptOutline, Script } from "./agents/writers-room";

export type EpisodeRow = { id: string; title: string | null; status: string; created_at: Date; direction: string | null };

export async function listEpisodes(userId: string) {
  return db()<EpisodeRow[]>`
    SELECT p.id, p.title, p.status, p.created_at, d.prompt AS direction
    FROM content_projects p LEFT JOIN content_directions d ON d.id = p.direction_id
    WHERE p.user_id = ${userId} ORDER BY p.created_at DESC LIMIT 50`;
}

export type ConceptRow = {
  id: string;
  title: string;
  hook: string;
  hook_type: string | null;
  outline: ConceptOutline;
  rationale: string | null;
  is_selected: boolean;
};
export type ScriptRow = Script & { id: string; version: number; fact_sheet: string | null; feedback: string | null; approved_at: Date | null };
export type CaptionRow = { platform: string; caption: string; hashtags: string[]; title: string | null };

export async function getEpisode(userId: string, id: string) {
  const sql = db();
  const [project] = await sql<{ id: string; title: string | null; status: string; direction: string | null; created_at: Date }[]>`
    SELECT p.id, p.title, p.status, d.prompt AS direction, p.created_at
    FROM content_projects p LEFT JOIN content_directions d ON d.id = p.direction_id
    WHERE p.id = ${id} AND p.user_id = ${userId}`;
  if (!project) return null;
  const [concepts, scripts, captions] = await Promise.all([
    sql<ConceptRow[]>`SELECT id, title, hook, hook_type, outline, rationale, is_selected FROM concepts
                      WHERE project_id = ${id} ORDER BY is_selected DESC, rank`,
    sql<ScriptRow[]>`SELECT id, version, title, target_duration_s, lines, sources, fact_sheet, feedback, approved_at
                     FROM scripts WHERE project_id = ${id} ORDER BY version DESC`,
    sql<CaptionRow[]>`SELECT platform, caption, hashtags, title FROM caption_options WHERE project_id = ${id}
                      ORDER BY array_position(ARRAY['tiktok','instagram','youtube','facebook']::platform_t[], platform)`,
  ]);
  return { project, concepts, latestScript: scripts[0] ?? null, scriptVersions: scripts.length, captions };
}
