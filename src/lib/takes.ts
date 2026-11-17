import "server-only";
import { revalidatePath } from "next/cache";
import { db } from "./db";
import { putObject, signedUrl } from "./storage";

export type SaveResult =
  | { ok: true; lineIndex: number; take: number; url: string; durationMs: number | null; complete: boolean }
  | { ok: false; message: string };

/** Saves bytes as the newest, selected take of one line and updates the episode status. Shared by the booth and AI voices. */
export async function storeTake(t: {
  ownerId: string;
  projectId: string;
  scriptId: string;
  lineIndex: number;
  data: ArrayBuffer;
  mime: string;
  ext: string;
  durationMs: number | null;
  source: "booth" | "upload" | "ai";
  aiPrompt?: string;
}): Promise<SaveResult> {
  const { projectId, scriptId, lineIndex, mime, durationMs, source } = t;
  const sql = db();
  const [script] = await sql<{ id: string; speaker: string | null }[]>`
    SELECT s.id, s.lines -> ${lineIndex}::int ->> 'speaker' AS speaker
    FROM scripts s JOIN content_projects p ON p.id = s.project_id
    WHERE s.id = ${scriptId} AND s.project_id = ${projectId} AND p.user_id = ${t.ownerId}`;
  if (!script || !Number.isInteger(lineIndex) || !script.speaker) return { ok: false, message: "That line doesn't exist anymore. Reload the page." };

  const [{ take }] = await sql<{ take: number }[]>`
    SELECT COALESCE(max(take), 0) + 1 AS take FROM recordings WHERE script_id = ${scriptId} AND line_index = ${lineIndex}`;
  const path = `${projectId}/${scriptId}/line-${String(lineIndex + 1).padStart(2, "0")}-${script.speaker}-take-${take}${source === "ai" ? "-ai" : ""}.${t.ext}`;
  await putObject(path, t.data, mime);

  await sql.begin(async (tx) => {
    await tx`UPDATE recordings SET is_selected = false WHERE script_id = ${scriptId} AND line_index = ${lineIndex}`;
    await tx`
      INSERT INTO recordings (project_id, script_id, line_index, speaker, take, storage_path, mime_type, size_bytes, duration_ms, source, ai_prompt)
      VALUES (${projectId}, ${scriptId}, ${lineIndex}, ${script.speaker}, ${take}, ${path}, ${mime}, ${t.data.byteLength}, ${durationMs}, ${source}, ${t.aiPrompt ?? null})`;
  });

  // Episode is "recorded" once every line has a selected take.
  const [prog] = await sql<{ lines: number; recorded: number }[]>`
    SELECT jsonb_array_length(s.lines) AS lines,
           (SELECT count(DISTINCT line_index)::int FROM recordings r WHERE r.script_id = s.id AND r.is_selected) AS recorded
    FROM scripts s WHERE s.id = ${scriptId}`;
  const complete = prog.recorded >= prog.lines;
  await sql`
    UPDATE content_projects SET status = ${complete ? "recorded" : "awaiting_recording"}::project_status_t, updated_at = now()
    WHERE id = ${projectId} AND status IN ('awaiting_recording', 'recorded')`;
  revalidatePath(`/create/${projectId}`);
  revalidatePath(`/create/${projectId}/record`);
  revalidatePath("/create");
  return { ok: true, lineIndex, take, url: await signedUrl(path), durationMs, complete };
}
