"use server";

import { revalidatePath } from "next/cache";
import { db } from "@/lib/db";
import { getOwner } from "@/lib/queries";
import { baseMime, putObject, signedUrl } from "@/lib/storage";

export type SaveResult =
  | { ok: true; lineIndex: number; take: number; url: string; durationMs: number | null; complete: boolean }
  | { ok: false; message: string };

const MAX_BYTES = 20 * 1024 * 1024;
const EXT: Record<string, string> = {
  "audio/webm": "webm",
  "audio/ogg": "ogg",
  "audio/mp4": "m4a",
  "audio/x-m4a": "m4a",
  "audio/m4a": "m4a",
  "audio/aac": "aac",
  "audio/mpeg": "mp3",
  "audio/wav": "wav",
  "audio/x-wav": "wav",
};

/** Saves one take for one line: uploads the audio privately, makes it the line's selected take. */
export async function saveRecordingAction(projectId: string, form: FormData): Promise<SaveResult> {
  try {
    const owner = await getOwner();
    if (!owner) return { ok: false, message: "No user found." };
    const scriptId = String(form.get("scriptId") ?? "");
    const lineIndex = Number(form.get("lineIndex"));
    const durationMs = Number(form.get("durationMs")) || null;
    const source = form.get("source") === "upload" ? "upload" : "booth";
    const file = form.get("file");
    if (!(file instanceof Blob) || file.size === 0) return { ok: false, message: "The recording is empty. Try again." };
    if (file.size > MAX_BYTES) return { ok: false, message: "That file is over 20 MB. Record or upload a shorter clip." };
    const mime = baseMime(file.type || "audio/webm");
    const ext = EXT[mime];
    if (!ext) return { ok: false, message: `Unsupported audio type (${mime}). Use m4a, mp3, wav, ogg or webm.` };

    const sql = db();
    const [script] = await sql<{ id: string; speaker: string | null }[]>`
      SELECT s.id, s.lines -> ${lineIndex}::int ->> 'speaker' AS speaker
      FROM scripts s JOIN content_projects p ON p.id = s.project_id
      WHERE s.id = ${scriptId} AND s.project_id = ${projectId} AND p.user_id = ${owner.id}`;
    if (!script || !Number.isInteger(lineIndex) || !script.speaker) return { ok: false, message: "That line doesn't exist anymore. Reload the page." };

    const [{ take }] = await sql<{ take: number }[]>`
      SELECT COALESCE(max(take), 0) + 1 AS take FROM recordings WHERE script_id = ${scriptId} AND line_index = ${lineIndex}`;
    const path = `${projectId}/${scriptId}/line-${String(lineIndex + 1).padStart(2, "0")}-${script.speaker}-take-${take}.${ext}`;
    await putObject(path, await file.arrayBuffer(), mime);

    await sql.begin(async (tx) => {
      await tx`UPDATE recordings SET is_selected = false WHERE script_id = ${scriptId} AND line_index = ${lineIndex}`;
      await tx`
        INSERT INTO recordings (project_id, script_id, line_index, speaker, take, storage_path, mime_type, size_bytes, duration_ms, source)
        VALUES (${projectId}, ${scriptId}, ${lineIndex}, ${script.speaker}, ${take}, ${path}, ${mime}, ${file.size}, ${durationMs}, ${source})`;
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
    revalidatePath("/create");
    return { ok: true, lineIndex, take, url: await signedUrl(path), durationMs, complete };
  } catch (err) {
    console.error("[record] save failed:", err);
    return { ok: false, message: err instanceof Error ? err.message : String(err) };
  }
}
