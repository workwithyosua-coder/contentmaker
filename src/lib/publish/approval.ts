import "server-only";
import { db } from "../db";
import { recordingProgress } from "../recordings";
import type { PlatformCaptions } from "./captions";
import { hookLine, manualCaptions, statusAfterApproval } from "./manualCaptions";

// Script approval and caption storage without AI. Nothing here (or below it) imports the writers' room or the
// Anthropic client: approving without AI, editing captions and posting work with a $0 Anthropic balance.

/** Stores an episode's per-platform captions (the publish panel's defaults) and the Captions card's rows. */
export async function saveCaptions(projectId: string, captions: PlatformCaptions) {
  const sql = db();
  await sql`UPDATE content_projects SET platform_captions = ${sql.json(captions as never)} WHERE id = ${projectId}`;
  await sql`DELETE FROM caption_options WHERE project_id = ${projectId}`;
  const rows: { platform: string; caption: string; hashtags: string[]; title: string | null }[] = [
    { platform: "tiktok", caption: captions.tiktok.caption, hashtags: captions.tiktok.hashtags, title: null },
    {
      platform: "instagram",
      caption: [captions.instagram.hook, captions.instagram.context, captions.instagram.comment_prompt].filter(Boolean).join("\n\n"),
      hashtags: captions.instagram.hashtags,
      title: null,
    },
    { platform: "facebook", caption: captions.facebook.description, hashtags: [], title: captions.facebook.title },
    { platform: "youtube", caption: captions.youtube.description, hashtags: captions.youtube.tags, title: `${captions.youtube.title} #Shorts` },
  ];
  for (const r of rows) {
    await sql`
      INSERT INTO caption_options (project_id, platform, caption, hashtags, title, is_selected, rank)
      VALUES (${projectId}, ${r.platform}, ${r.caption}, ${r.hashtags}, ${r.title}, true, 1)`;
  }
}

/**
 * Approves the latest script version with default captions written by fixed rules (no AI): marks the version
 * approved, fills each platform's editable title and caption (keeping captions that already exist), clears the last
 * step's error and moves the episode on. Returns the approved version number.
 */
export async function approveWithoutAi(p: { userId: string; projectId: string }): Promise<{ version: number; wroteCaptions: boolean }> {
  const sql = db();
  const [project] = await sql<{ id: string; status: string; title: string | null; platform_captions: PlatformCaptions | null }[]>`
    SELECT id, status, title, platform_captions FROM content_projects WHERE id = ${p.projectId} AND user_id = ${p.userId}`;
  if (!project) throw new Error("Episode not found.");
  const [s] = await sql<{ id: string; version: number; title: string | null; lines: { text?: string }[] }[]>`
    SELECT id, version, title, lines FROM scripts WHERE project_id = ${p.projectId} ORDER BY version DESC LIMIT 1`;
  if (!s) throw new Error("No script yet. Write or paste one first.");
  const wroteCaptions = !project.platform_captions;
  if (wroteCaptions) await saveCaptions(p.projectId, manualCaptions({ title: s.title || project.title || "", hook: hookLine(s.lines) }));
  await sql`UPDATE scripts SET approved_at = COALESCE(approved_at, now()) WHERE id = ${s.id}`;
  const next = statusAfterApproval(project.status, await recordingProgress(p.projectId));
  await sql`UPDATE content_projects SET status = ${next}::project_status_t, last_error = NULL, updated_at = now() WHERE id = ${p.projectId}`;
  return { version: s.version, wroteCaptions };
}
