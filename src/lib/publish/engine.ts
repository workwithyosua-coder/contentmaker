import "server-only";
import { db } from "../db";
import { ADAPTERS, type PlatformSettings, type PublicationRow } from "./adapters";
import { PUBLISH_PLATFORMS, defaultText, type PlatformCaptions, type PublishPlatform } from "./captions";

// Publishing queue. queuePublish() creates one episode_publications row per platform for the episode's latest video;
// tick() claims due rows with a lock (FOR UPDATE SKIP LOCKED) and advances each one step. "Post now" runs a tick right
// away (in the background); the every-minute worker (/api/cron/process-scheduled-posts) handles schedules and polling.

export type PublishSettings = Partial<Record<PublishPlatform, PlatformSettings>>;
const MAX_TICKS = 90; // ~30 minutes of processing polls before giving up
const LOCK = "4 minutes";

export type Publication = {
  id: string;
  platform: PublishPlatform;
  status: "idle" | "queued" | "uploading" | "processing" | "published" | "failed";
  external_post_url: string | null;
  error: string | null;
  run_after: Date;
  published_at: Date | null;
  step: { note?: string } & Record<string, unknown>;
  video_id: string;
};

export async function publicationsFor(projectId: string): Promise<Publication[]> {
  return db()<Publication[]>`
    SELECT DISTINCT ON (platform) id, platform, status, external_post_url, error, run_after, published_at, step, video_id
    FROM episode_publications WHERE project_id = ${projectId} ORDER BY platform, created_at DESC`;
}

async function latestVideo(projectId: string) {
  const [v] = await db()<{ id: string }[]>`SELECT id FROM episode_videos WHERE project_id = ${projectId} ORDER BY created_at DESC LIMIT 1`;
  return v ?? null;
}

/**
 * Queue the episode's latest video on each enabled platform with a connected account.
 * Already published or in-flight platforms are never queued again; `onlyFailed` re-runs just the failed ones.
 */
export async function queuePublish(p: { userId: string; projectId: string; at?: Date | null; onlyFailed?: boolean; settings?: PublishSettings }) {
  const sql = db();
  const [project] = await sql<{ platform_captions: PlatformCaptions | null; publish_settings: PublishSettings }[]>`
    SELECT platform_captions, publish_settings FROM content_projects WHERE id = ${p.projectId} AND user_id = ${p.userId}`;
  if (!project) throw new Error("Episode not found.");
  if (!project.platform_captions) throw new Error("Approve the script first: that step writes the platform captions.");
  const video = await latestVideo(p.projectId);
  if (!video) throw new Error("Render the video first.");
  const settings: PublishSettings = { ...project.publish_settings, ...(p.settings ?? {}) };
  if (p.settings) await sql`UPDATE content_projects SET publish_settings = ${sql.json(settings as never)} WHERE id = ${p.projectId}`;

  const accounts = await sql<{ id: string; platform: PublishPlatform }[]>`
    SELECT DISTINCT ON (platform) id, platform FROM social_accounts
    WHERE user_id = ${p.userId} AND is_active AND external_account_id NOT LIKE 'demo-%' ORDER BY platform, created_at DESC`;
  const runAfter = p.at ?? new Date();
  const queued: PublishPlatform[] = [];
  for (const platform of PUBLISH_PLATFORMS) {
    const s = settings[platform] ?? {};
    const acct = accounts.find((a) => a.platform === platform);
    if (!acct || s.enabled === false) continue;
    const d = defaultText(platform, project.platform_captions);
    const caption = {
      title: s.title?.trim() || d.title,
      text: s.text?.trim() || d.text,
      ...(platform === "youtube" ? { tags: project.platform_captions.youtube.tags } : {}),
    };
    const rows = await sql<{ id: string }[]>`
      INSERT INTO episode_publications (project_id, video_id, platform, social_account_id, status, caption, settings, run_after)
      VALUES (${p.projectId}, ${video.id}, ${platform}, ${acct.id}, 'queued', ${sql.json(caption as never)}, ${sql.json(s as never)}, ${runAfter})
      ON CONFLICT (video_id, platform) DO UPDATE
        SET status = 'queued', caption = EXCLUDED.caption, settings = EXCLUDED.settings, social_account_id = EXCLUDED.social_account_id,
            step = '{}', error = NULL, attempts = 0, run_after = EXCLUDED.run_after, locked_until = NULL, updated_at = now()
        WHERE episode_publications.status ${p.onlyFailed ? sql`= 'failed'` : sql`IN ('failed', 'idle', 'queued')`}
      RETURNING id`;
    if (rows.length) queued.push(platform);
  }
  await sql`UPDATE content_projects SET publish_at = ${p.at ?? null}, updated_at = now() WHERE id = ${p.projectId}`;
  return queued;
}

/** Stops scheduled (not yet started) posts. */
export async function cancelScheduled(projectId: string) {
  await db()`DELETE FROM episode_publications WHERE project_id = ${projectId} AND status = 'queued' AND run_after > now()`;
  await db()`UPDATE content_projects SET publish_at = NULL WHERE id = ${projectId}`;
}

/** Claims due publications and advances each one step. Safe to run concurrently: rows are locked while worked on. */
export async function tick(limit = 8) {
  const sql = db();
  const rows = await sql<(Omit<PublicationRow, "video"> & { storage_path: string; size_bytes: number | null; project_id: string })[]>`
    UPDATE episode_publications e SET locked_until = now() + ${LOCK}::interval, attempts = e.attempts + 1,
      status = CASE WHEN e.status = 'queued' THEN 'uploading' ELSE e.status END, updated_at = now()
    FROM episode_videos v
    WHERE v.id = e.video_id AND e.id IN (
      SELECT id FROM episode_publications
      WHERE status IN ('queued', 'uploading', 'processing') AND run_after <= now() AND (locked_until IS NULL OR locked_until < now())
      ORDER BY run_after LIMIT ${limit} FOR UPDATE SKIP LOCKED)
    RETURNING e.id, e.platform, e.social_account_id, e.caption, e.settings, e.step, e.attempts, e.project_id, v.storage_path, v.size_bytes`;
  const results = await Promise.all(
    rows.map(async (r) => {
      const pub: PublicationRow = { ...r, video: { storage_path: r.storage_path, size_bytes: r.size_bytes } };
      try {
        if (!r.social_account_id) throw new Error("No connected account for this platform.");
        if (r.attempts > MAX_TICKS) throw new Error("The platform is still processing after 30 minutes. Check the account, then retry.");
        const a = await ADAPTERS[r.platform](pub);
        if (a.status === "published") {
          await sql`
            UPDATE episode_publications SET status = 'published', step = ${sql.json(a.step as never)}, external_post_id = ${a.externalId},
              external_post_url = ${a.externalUrl}, error = NULL, published_at = now(), locked_until = NULL, updated_at = now()
            WHERE id = ${r.id}`;
        } else if (a.status === "failed") {
          await sql`
            UPDATE episode_publications SET status = 'failed', step = ${sql.json(a.step as never)}, error = ${a.error.slice(0, 1000)},
              locked_until = NULL, updated_at = now() WHERE id = ${r.id}`;
        } else {
          const step = a.note ? { ...a.step, note: a.note } : a.step;
          await sql`
            UPDATE episode_publications SET status = ${a.status}, step = ${sql.json(step as never)},
              run_after = now() + make_interval(secs => ${a.retryInSec}), locked_until = NULL, updated_at = now() WHERE id = ${r.id}`;
        }
        return { id: r.id, platform: r.platform, status: a.status };
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        await sql`UPDATE episode_publications SET status = 'failed', error = ${message.slice(0, 1000)}, locked_until = NULL, updated_at = now() WHERE id = ${r.id}`;
        return { id: r.id, platform: r.platform, status: "failed", error: message };
      }
    }),
  );
  return results;
}

/** Keeps ticking for up to ~4 minutes while there is work that is due now (used right after "Post now"). */
export async function drain(deadlineMs = 240_000) {
  const until = Date.now() + deadlineMs;
  while (Date.now() < until) {
    const done = await tick();
    if (!done.length) {
      const [{ n }] = await db()<{ n: number }[]>`
        SELECT count(*)::int AS n FROM episode_publications
        WHERE status IN ('queued', 'uploading', 'processing') AND run_after <= now() + interval '25 seconds'`;
      if (!n) return;
      await new Promise((r) => setTimeout(r, 10_000));
    }
  }
}

/** Called when a render lands: posts automatically if the episode has auto-publish on and approved captions. */
export async function autoPublishAfterRender(projectId: string) {
  const [p] = await db()<{ user_id: string; auto_publish: boolean; platform_captions: unknown }[]>`
    SELECT user_id, auto_publish, platform_captions FROM content_projects WHERE id = ${projectId}`;
  if (!p?.auto_publish || !p.platform_captions) return [];
  return queuePublish({ userId: p.user_id, projectId });
}
