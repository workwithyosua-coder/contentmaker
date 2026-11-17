"use server";

import { getOwner } from "@/lib/queries";
import { baseMime } from "@/lib/storage";
import { storeTake, type SaveResult } from "@/lib/takes";

export type { SaveResult };

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

    return await storeTake({ ownerId: owner.id, projectId, scriptId, lineIndex, data: await file.arrayBuffer(), mime, ext, durationMs, source });
  } catch (err) {
    console.error("[record] save failed:", err);
    return { ok: false, message: err instanceof Error ? err.message : String(err) };
  }
}

