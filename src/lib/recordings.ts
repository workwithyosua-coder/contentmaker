import "server-only";
import { db } from "./db";
import type { Script } from "./agents/writers-room";
import { signedUrls } from "./storage";

export type BoothLine = Script["lines"][number] & { index: number };
export type RecordedTake = { take: number; url: string; durationMs: number | null; source: string };

/** The approved script of an episode (or the latest draft if none is approved yet) plus its selected takes. */
export async function getBooth(userId: string, projectId: string) {
  const sql = db();
  const [project] = await sql<{ id: string; title: string | null; status: string }[]>`
    SELECT id, title, status FROM content_projects WHERE id = ${projectId} AND user_id = ${userId}`;
  if (!project) return null;
  const [script] = await sql<(Script & { id: string; version: number; approved_at: Date | null })[]>`
    SELECT id, version, title, target_duration_s, lines, sources, approved_at FROM scripts
    WHERE project_id = ${projectId} ORDER BY (approved_at IS NOT NULL) DESC, version DESC LIMIT 1`;
  if (!script) return { project, script: null, lines: [], recorded: {} as Record<number, RecordedTake> };
  const rows = await sql<{ line_index: number; take: number; storage_path: string; duration_ms: number | null; source: string }[]>`
    SELECT line_index, take, storage_path, duration_ms, source FROM recordings
    WHERE script_id = ${script.id} AND is_selected`;
  const urls = await signedUrls(rows.map((r) => r.storage_path));
  const recorded: Record<number, RecordedTake> = {};
  for (const r of rows) recorded[r.line_index] = { take: r.take, url: urls[r.storage_path], durationMs: r.duration_ms, source: r.source };
  return { project, script, lines: script.lines.map((l, index) => ({ ...l, index })), recorded };
}

export async function recordingProgress(projectId: string) {
  const [r] = await db()<{ lines: number; recorded: number }[]>`
    SELECT jsonb_array_length(s.lines) AS lines,
           (SELECT count(DISTINCT line_index)::int FROM recordings r WHERE r.script_id = s.id AND r.is_selected) AS recorded
    FROM scripts s WHERE s.project_id = ${projectId}
    ORDER BY (s.approved_at IS NOT NULL) DESC, s.version DESC LIMIT 1`;
  return r ?? { lines: 0, recorded: 0 };
}
