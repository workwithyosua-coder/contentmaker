"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { after } from "next/server";
import { claudeConfigured } from "@/lib/agents/claude";
import { factCheck, generateIdeas, writeCaptions, writeScript, type ConceptOutline, type Script } from "@/lib/agents/writers-room";
import { db } from "@/lib/db";
import { getOwner } from "@/lib/queries";
import { recordingProgress } from "@/lib/recordings";

export type StepResult = { ok: boolean; message: string } | null;
const ALL_PLATFORMS = ["tiktok", "instagram", "youtube", "facebook"];

async function owner() {
  const o = await account();
  if (!claudeConfigured()) throw new Error("ANTHROPIC_API_KEY is not set in Vercel.");
  return o;
}

/** The signed-in owner, for steps that don't call Claude (publishing, rendering, Drive, line edits). */
async function account() {
  const o = await getOwner();
  if (!o) throw new Error("No user found.");
  return o;
}

async function setStatus(projectId: string, status: string, error: string | null = null) {
  await db()`UPDATE content_projects SET status = ${status}::project_status_t, last_error = ${error}, updated_at = now()
             WHERE id = ${projectId}`;
}

const message = (err: unknown) => (err instanceof Error ? err.message : String(err));

/**
 * Long agent steps (30–120 s) run in the background with `after()`: the action returns right away, the page shows
 * progress and refreshes itself. Closing the app or locking the phone doesn't interrupt the work.
 * On failure the episode goes back to `fallbackStatus` with the error saved for the page to show.
 */
function inBackground(projectId: string, fallbackStatus: string, work: () => Promise<void>) {
  after(async () => {
    try {
      await work();
    } catch (err) {
      console.error("[create] background step failed:", projectId, message(err));
      await setStatus(projectId, fallbackStatus, message(err)).catch(() => {});
    }
  });
}

/** New episode: save the direction, then the Strategist pitches 5 ideas (in the background). */
export async function createEpisodeAction(_prev: StepResult, form: FormData): Promise<StepResult> {
  const direction = String(form.get("direction") ?? "").trim();
  if (direction.length < 3) return { ok: false, message: "Write a topic or direction first." };
  let projectId: string;
  try {
    const o = await owner();
    const sql = db();
    const [brand] = await sql<{ id: string }[]>`SELECT id FROM brand_kits WHERE user_id = ${o.id} ORDER BY is_default DESC LIMIT 1`;
    const [d] = await sql<{ id: string }[]>`
      INSERT INTO content_directions (user_id, brand_kit_id, title, prompt, platforms, formats)
      VALUES (${o.id}, ${brand?.id ?? null}, ${direction.slice(0, 80)}, ${direction}, ${ALL_PLATFORMS}::platform_t[], '{short_video}')
      RETURNING id`;
    const [p] = await sql<{ id: string }[]>`
      INSERT INTO content_projects (user_id, direction_id, title, format, target_platforms, status)
      VALUES (${o.id}, ${d.id}, ${direction.slice(0, 80)}, 'short_video', ${ALL_PLATFORMS}::platform_t[], 'ideating')
      RETURNING id`;
    projectId = p.id;
    const userId = o.id;
    inBackground(projectId, "draft", async () => {
      await generateIdeas({ userId, projectId, direction });
      await setStatus(projectId, "awaiting_concept");
    });
  } catch (err) {
    return { ok: false, message: message(err) };
  }
  revalidatePath("/create");
  redirect(`/create/${projectId}`);
}

/** Retry ideas after a failure, or ask for different ones. */
export async function moreIdeasAction(projectId: string): Promise<StepResult> {
  try {
    const o = await owner();
    const [d] = await db()<{ prompt: string }[]>`
      SELECT d.prompt FROM content_projects p JOIN content_directions d ON d.id = p.direction_id WHERE p.id = ${projectId}`;
    const [{ n }] = await db()<{ n: number }[]>`SELECT count(*)::int AS n FROM concepts WHERE project_id = ${projectId}`;
    await setStatus(projectId, "ideating");
    inBackground(projectId, n ? "awaiting_concept" : "draft", async () => {
      await generateIdeas({
        userId: o.id,
        projectId,
        direction: n ? `${d?.prompt ?? ""}\n(Give completely different ideas from before.)` : (d?.prompt ?? ""),
      });
      await setStatus(projectId, "awaiting_concept");
    });
    revalidatePath(`/create/${projectId}`);
    return { ok: true, message: "Brainstorming…" };
  } catch (err) {
    return { ok: false, message: message(err) };
  }
}

async function loadConcept(projectId: string) {
  const [c] = await db()<{ id: string; title: string; outline: ConceptOutline }[]>`
    SELECT id, title, outline FROM concepts WHERE project_id = ${projectId} AND is_selected LIMIT 1`;
  if (!c) throw new Error("Pick an idea first.");
  return c;
}

async function saveScript(projectId: string, conceptId: string, script: Script, factSheet: string, feedback: string | null) {
  const sql = db();
  const [{ v }] = await sql<{ v: number }[]>`SELECT COALESCE(max(version), 0) + 1 AS v FROM scripts WHERE project_id = ${projectId}`;
  await sql`
    INSERT INTO scripts (project_id, concept_id, version, title, target_duration_s, lines, fact_sheet, sources, feedback)
    VALUES (${projectId}, ${conceptId}, ${v}, ${script.title}, ${script.target_duration_s}, ${sql.json(script.lines)},
            ${factSheet}, ${sql.json(script.sources)}, ${feedback})`;
  await sql`UPDATE content_projects SET title = ${script.title} WHERE id = ${projectId}`;
}

/** Pick an idea → fact check (web search) → first script draft, in the background. */
export async function pickIdeaAction(projectId: string, conceptId: string): Promise<StepResult> {
  try {
    const o = await owner();
    const sql = db();
    await sql`UPDATE concepts SET is_selected = (id = ${conceptId}) WHERE project_id = ${projectId}`;
    await sql`UPDATE content_projects SET selected_concept_id = ${conceptId} WHERE id = ${projectId}`;
    await setStatus(projectId, "scripting");
    inBackground(projectId, "awaiting_concept", async () => {
      const c = await loadConcept(projectId);
      const facts = await factCheck({ userId: o.id, projectId, title: c.title, outline: c.outline });
      const script = await writeScript({ userId: o.id, projectId, title: c.title, outline: c.outline, factSheet: facts });
      await saveScript(projectId, c.id, script, facts, null);
      await setStatus(projectId, "awaiting_script_approval");
    });
    revalidatePath(`/create/${projectId}`);
    return { ok: true, message: "Writing started." };
  } catch (err) {
    return { ok: false, message: message(err) };
  }
}

/** Choose a different idea after a failed or unwanted pick (only before any script exists). */
export async function unpickIdeaAction(projectId: string): Promise<StepResult> {
  await db()`UPDATE concepts SET is_selected = false WHERE project_id = ${projectId}`;
  await db()`UPDATE content_projects SET selected_concept_id = NULL WHERE id = ${projectId}`;
  await setStatus(projectId, "awaiting_concept");
  revalidatePath(`/create/${projectId}`);
  return { ok: true, message: "Pick another idea." };
}

/** Revise the script with the owner's notes (keeps the same fact sheet), in the background. */
export async function reviseScriptAction(projectId: string, _prev: StepResult, form: FormData): Promise<StepResult> {
  const feedback = String(form.get("feedback") ?? "").trim();
  if (!feedback) return { ok: false, message: "Write what you'd like changed." };
  // A full script pasted here would be read as a note; send it to the import tab instead.
  if ((feedback.match(/^\s*(?:[#\d]+[.)]?\s*)?(?:\*\*)?\s*(UCO|OCU)\b/gim) ?? []).length >= 3) {
    return { ok: false, message: "This looks like a full script. Use the Paste / Import script tab so your lines are kept as written." };
  }
  try {
    const o = await owner();
    await setStatus(projectId, "scripting");
    inBackground(projectId, "awaiting_script_approval", async () => {
      const c = await loadConcept(projectId);
      const [prev] = await db()<(Script & { fact_sheet: string })[]>`
        SELECT title, target_duration_s, lines, sources, fact_sheet FROM scripts WHERE project_id = ${projectId}
        ORDER BY version DESC LIMIT 1`;
      const script = await writeScript({
        userId: o.id, projectId, title: c.title, outline: c.outline, factSheet: prev?.fact_sheet ?? "", feedback, previous: prev,
      });
      await saveScript(projectId, c.id, script, prev?.fact_sheet ?? "", feedback);
      await setStatus(projectId, "awaiting_script_approval");
    });
    revalidatePath(`/create/${projectId}`);
    return { ok: true, message: "Rewriting started." };
  } catch (err) {
    return { ok: false, message: message(err) };
  }
}

/** Approve the latest script → the Copywriter writes captions for all 4 platforms (about 20 s, in the background). */
export async function approveScriptAction(projectId: string): Promise<StepResult> {
  try {
    const o = await owner();
    await setStatus(projectId, "captioning");
    inBackground(projectId, "awaiting_script_approval", async () => {
      const sql = db();
      const [s] = await sql<(Script & { id: string })[]>`
        SELECT id, title, target_duration_s, lines, sources FROM scripts WHERE project_id = ${projectId}
        ORDER BY version DESC LIMIT 1`;
      if (!s) throw new Error("No script yet.");
      await writeCaptions({ userId: o.id, projectId, script: s });
      await sql`UPDATE scripts SET approved_at = now() WHERE id = ${s.id}`;
      // Lines may already be recorded before approval; skip straight to "recorded" if all are done.
      const prog = await recordingProgress(projectId);
      await setStatus(projectId, prog.lines > 0 && prog.recorded >= prog.lines ? "recorded" : "awaiting_recording");
    });
    revalidatePath(`/create/${projectId}`);
    revalidatePath("/create");
    return { ok: true, message: "Writing captions…" };
  } catch (err) {
    return { ok: false, message: message(err) };
  }
}

export async function deleteEpisodeAction(projectId: string): Promise<StepResult> {
  const o = await getOwner();
  if (!o) return { ok: false, message: "No user found." };
  await db()`DELETE FROM content_projects WHERE id = ${projectId} AND user_id = ${o.id}`;
  revalidatePath("/create");
  redirect("/create");
}

/** Copies an episode's video into the connected Google Drive folder (also retries a failed copy). */
export async function saveVideoToDriveAction(projectId: string, videoId: string): Promise<StepResult> {
  try {
    await account();
    const { copyVideoToDrive } = await import("@/lib/drive");
    const done = await copyVideoToDrive(videoId);
    revalidatePath(`/create/${projectId}`);
    return done ? { ok: true, message: "Saved to Google Drive." } : { ok: false, message: "Connect Google Drive on the Accounts page first." };
  } catch (err) {
    revalidatePath(`/create/${projectId}`);
    return { ok: false, message: message(err) };
  }
}

/** Paste / import a pre-written script as the next version ("exact" keeps the Indonesian lines word for word). */
export async function importScriptAction(projectId: string, _prev: StepResult, form: FormData): Promise<StepResult> {
  try {
    const o = await owner();
    const { importScript } = await import("@/lib/script-import");
    const r = await importScript({
      ownerId: o.id,
      projectId,
      mode: form.get("mode") === "adapt" ? "adapt" : "exact",
      paste: String(form.get("script") ?? ""),
      notes: String(form.get("notes") ?? ""),
    });
    revalidatePath(`/create/${projectId}`);
    revalidatePath(`/create/${projectId}/record`);
    revalidatePath("/create");
    return { ok: true, message: `Saved as script v${r.version}: ${r.lines} lines.` };
  } catch (err) {
    return { ok: false, message: message(err) };
  }
}

/** Edits one line of a script in place, without creating a new version. */
export async function updateLineAction(projectId: string, scriptId: string, index: number, _prev: StepResult, form: FormData): Promise<StepResult> {
  try {
    const o = await account();
    const { updateScriptLine } = await import("@/lib/script-import");
    await updateScriptLine({
      ownerId: o.id,
      projectId,
      scriptId,
      index,
      patch: {
        text: String(form.get("text") ?? ""),
        subtitle: String(form.get("subtitle") ?? ""),
        expression: String(form.get("expression") ?? "calm"),
        visual: String(form.get("visual") ?? ""),
        on_screen_text: String(form.get("on_screen_text") ?? "") || null,
        thought_bubble: form.get("thought_bubble") === "on",
      },
    });
    revalidatePath(`/create/${projectId}`);
    revalidatePath(`/create/${projectId}/record`);
    return { ok: true, message: "Saved." };
  } catch (err) {
    return { ok: false, message: message(err) };
  }
}

/** "Render video": asks GitHub Actions to render the episode; the page shows progress and the video when it lands. */
export async function renderVideoAction(projectId: string): Promise<StepResult> {
  try {
    await account();
    const { startRender } = await import("@/lib/render-jobs");
    await startRender(projectId);
    revalidatePath(`/create/${projectId}`);
    return { ok: true, message: "Render started. It takes about 15–20 minutes; this page updates by itself." };
  } catch (err) {
    return { ok: false, message: message(err) };
  }
}

/** Publish panel: post now / schedule / retry failed / cancel the schedule, with the panel's per-platform settings. */
export async function publishAction(projectId: string, _prev: StepResult, form: FormData): Promise<StepResult> {
  try {
    const o = await account();
    const { handlePublish } = await import("@/lib/publish/requests");
    const { PUBLISH_PLATFORMS } = await import("@/lib/publish/captions");
    const mode = String(form.get("mode") ?? "now") as "now" | "schedule" | "retry" | "cancel";
    const settings: Record<string, Record<string, unknown>> = {};
    for (const p of PUBLISH_PLATFORMS) {
      if (!form.has(`${p}.present`)) continue; // only platforms shown in the panel
      const flag = (k: string) => form.get(`${p}.${k}`) === "on";
      const str = (k: string) => (form.get(`${p}.${k}`) as string | null)?.trim() || undefined;
      settings[p] = {
        enabled: flag("enabled"),
        title: str("title"),
        text: str("text"),
        privacy: str("privacy"),
        allowComments: flag("allowComments"),
        allowDuet: flag("allowDuet"),
        allowStitch: flag("allowStitch"),
        shareToFeed: flag("shareToFeed"),
        coverSecond: Number(form.get(`${p}.coverSecond`)) || 1,
      };
    }
    // the schedule picker is WIB (Asia/Jakarta, UTC+7, no daylight saving)
    const local = String(form.get("at") ?? "");
    const at = local ? `${local}:00+07:00` : null;
    const r = await handlePublish(o.id, projectId, { mode, at, settings: mode === "cancel" ? undefined : settings });
    revalidatePath(`/create/${projectId}`);
    return { ok: true, message: r.message };
  } catch (err) {
    return { ok: false, message: message(err) };
  }
}

/** "Auto-post on render complete" switch. */
export async function setAutoPublishAction(projectId: string, on: boolean): Promise<StepResult> {
  try {
    const o = await account();
    await db()`UPDATE content_projects SET auto_publish = ${on} WHERE id = ${projectId} AND user_id = ${o.id}`;
    revalidatePath(`/create/${projectId}`);
    return { ok: true, message: on ? "New renders will be posted automatically." : "Auto-post is off." };
  } catch (err) {
    return { ok: false, message: message(err) };
  }
}

/** Writes (or rewrites) the platform-specific captions for an already-approved script. */
export async function writePlatformCaptionsAction(projectId: string): Promise<StepResult> {
  try {
    const o = await owner();
    const [s] = await db()<(Script & { id: string })[]>`
      SELECT id, title, target_duration_s, lines, sources FROM scripts WHERE project_id = ${projectId} ORDER BY version DESC LIMIT 1`;
    if (!s) return { ok: false, message: "No script yet." };
    await writeCaptions({ userId: o.id, projectId, script: s });
    revalidatePath(`/create/${projectId}`);
    return { ok: true, message: "Platform captions written." };
  } catch (err) {
    return { ok: false, message: message(err) };
  }
}

/** Upload a finished video, step 1: a one-time URL the browser uploads the MP4 to directly. */
export async function startVideoUploadAction(projectId: string, size: number, type: string): Promise<{ ok: true; url: string; path: string } | { ok: false; message: string }> {
  try {
    const o = await account();
    const [p] = await db()<{ id: string }[]>`SELECT id FROM content_projects WHERE id = ${projectId} AND user_id = ${o.id}`;
    if (!p) return { ok: false, message: "Episode not found." };
    if (type !== "video/mp4") return { ok: false, message: "Upload an MP4 file (export it as MP4 from CapCut, Gemini or your phone)." };
    if (size > 49 * 1024 * 1024) return { ok: false, message: "That file is over 49 MB. Export it at 1080p (or a lower bitrate) and try again." };
    const path = `${projectId}/video/upload-${new Date().toISOString().replace(/[:.]/g, "-")}.mp4`;
    const { signedUploadUrl } = await import("@/lib/storage");
    return { ok: true, url: await signedUploadUrl(path), path };
  } catch (err) {
    return { ok: false, message: message(err) };
  }
}

/** Upload a finished video, step 2: register the uploaded file as the episode's video (publishable like a render). */
export async function finishVideoUploadAction(projectId: string, path: string, durationMs: number | null): Promise<StepResult> {
  try {
    const o = await account();
    if (!path.startsWith(`${projectId}/video/upload-`) || !path.endsWith(".mp4")) return { ok: false, message: "Unknown upload." };
    const sql = db();
    const [s] = await sql<{ id: string }[]>`
      SELECT s.id FROM scripts s JOIN content_projects p ON p.id = s.project_id
      WHERE s.project_id = ${projectId} AND p.user_id = ${o.id} ORDER BY s.version DESC LIMIT 1`;
    if (!s) return { ok: false, message: "This episode has no script yet. Write or import one first." };
    const { objectSize } = await import("@/lib/storage");
    const size = await objectSize(path);
    if (size === null) return { ok: false, message: "The upload didn't arrive. Try again." };
    await sql`
      INSERT INTO episode_videos (project_id, script_id, storage_path, size_bytes, duration_ms, renderer)
      VALUES (${projectId}, ${s.id}, ${path}, ${size}, ${durationMs}, 'upload')`;
    await sql`UPDATE content_projects SET status = 'awaiting_approval', updated_at = now() WHERE id = ${projectId}`;
    after(async () => {
      const { autoPublishAfterRender, drain } = await import("@/lib/publish/engine");
      const queued = await autoPublishAfterRender(projectId).catch(() => []);
      if (queued.length) await drain().catch(() => {});
    });
    revalidatePath(`/create/${projectId}`);
    return { ok: true, message: "Video added. It's now the episode video; publish it below." };
  } catch (err) {
    return { ok: false, message: message(err) };
  }
}
