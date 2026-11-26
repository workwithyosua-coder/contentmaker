import "server-only";
import { db } from "./db";
import { WORKER_WORKFLOW, canTransition, dispatchPayload, isActiveJob, missingModelMessage, normalizeStatus, rvcPlan } from "./renderWorker";
import { asProvider } from "./voice/acting";

// "Render video": the app asks GitHub Actions to run .github/workflows/render-worker.yml, which (for the Own Voice
// provider) first converts the Gemini base takes with RVC (video/rvc-stage.mts), then renders the episode with
// video/render.mts, uploads it through /api/render/:id/video/*, and reports progress to /api/render/:id/job:
// queued → converting_voice → rendering → done / failed.
// Needs GITHUB_DISPATCH_TOKEN in Vercel: a fine-grained token for this repository with "Actions: read and write".
const REPO = () => process.env.GITHUB_REPO?.trim() || "workwithyosua-coder/contentmaker";
const STALE_MS = 90 * 60 * 1000; // the workflow times out after 90 minutes

export const renderButtonConfigured = () => Boolean(process.env.GITHUB_DISPATCH_TOKEN?.trim());

export type RenderJob = {
  id: string;
  status: "queued" | "converting_voice" | "rendering" | "running" | "done" | "failed";
  error: string | null;
  run_url: string | null;
  progress: number | null;
  stage: string | null;
  started_at: Date | null;
  created_at: Date;
  updated_at: Date;
};

export async function latestRenderJob(projectId: string): Promise<RenderJob | null> {
  const [j] = await db()<RenderJob[]>`
    SELECT id, status, error, run_url, progress, stage, started_at, created_at, updated_at FROM render_jobs WHERE project_id = ${projectId} ORDER BY created_at DESC LIMIT 1`;
  if (!j) return null;
  if (isActiveJob(j.status) && Date.now() - j.created_at.getTime() > STALE_MS) {
    return { ...j, status: "failed", error: j.error ?? "The render didn't finish within 90 minutes." };
  }
  return j;
}

export async function startRender(projectId: string) {
  const token = process.env.GITHUB_DISPATCH_TOKEN?.trim();
  if (!token) throw new Error("GITHUB_DISPATCH_TOKEN isn't set in Vercel yet.");
  const running = await latestRenderJob(projectId);
  if (running && isActiveJob(running.status)) throw new Error("A render is already in progress.");
  // Own Voice: the worker converts the Gemini takes not converted yet (Stage B); every speaker involved needs a model
  const voice = await ownVoicePlan(projectId);
  if (voice.missing.length) throw new Error(missingModelMessage(voice.missing));
  const sql = db();
  const [job] = await sql<{ id: string }[]>`INSERT INTO render_jobs (project_id) VALUES (${projectId}) RETURNING id`;
  const res = await fetch(`https://api.github.com/repos/${REPO()}/actions/workflows/${WORKER_WORKFLOW}/dispatches`, {
    method: "POST",
    headers: { Authorization: `Bearer ${token}`, Accept: "application/vnd.github+json", "X-GitHub-Api-Version": "2022-11-28" },
    body: JSON.stringify(dispatchPayload({ projectId, jobId: job.id, voice: voice.convert.length ? "rvc" : "none" })),
  });
  if (!res.ok) {
    const msg = `GitHub refused to start the render (${res.status}): ${(await res.text()).slice(0, 200)}`;
    await sql`UPDATE render_jobs SET status = 'failed', error = ${msg}, updated_at = now() WHERE id = ${job.id}`;
    throw new Error(res.status === 401 || res.status === 403 || res.status === 404 ? "GitHub rejected the token. Check GITHUB_DISPATCH_TOKEN (Actions: read and write on this repository)." : msg);
  }
  return job.id;
}

export async function updateRenderJob(
  projectId: string,
  jobId: string,
  status: string,
  error?: string | null,
  runUrl?: string | null,
  progress?: number | null,
  stage?: string | null,
) {
  const next = normalizeStatus(status);
  if (!next || next === "queued") throw new Error("Bad status.");
  const pct = typeof progress === "number" && Number.isFinite(progress) ? Math.max(0, Math.min(100, Math.round(progress))) : null;
  const [cur] = await db()<{ status: string }[]>`SELECT status FROM render_jobs WHERE id = ${jobId} AND project_id = ${projectId}`;
  if (!cur) throw new Error("Unknown render job.");
  // done / failed are final; out-of-order reports (e.g. a late "converting_voice") are ignored, not errors
  if (!canTransition(cur.status, next)) return;
  const active = next === "converting_voice" || next === "rendering";
  await db()`
    UPDATE render_jobs SET status = ${next}, error = ${error ?? null}, run_url = COALESCE(${runUrl ?? null}, run_url),
      progress = CASE WHEN ${next} = 'done' THEN 100 ELSE COALESCE(${pct}, progress) END,
      stage = CASE WHEN ${active} THEN COALESCE(${stage ?? null}, stage) ELSE NULL END,
      started_at = COALESCE(started_at, CASE WHEN ${active} THEN now() END), updated_at = now()
    WHERE id = ${jobId} AND project_id = ${projectId} AND status NOT IN ('done', 'failed')`;
}

/**
 * Stage B for an episode: when its voice provider is Own Voice, the lines whose selected take still needs RVC, and
 * the characters among them without a .pth model. Other providers: nothing to convert.
 */
export async function ownVoicePlan(projectId: string) {
  const sql = db();
  const [p] = await sql<{ provider: string | null }[]>`SELECT to_jsonb(c) ->> 'voice_provider' AS provider FROM content_projects c WHERE id = ${projectId}`;
  const none = { convert: [] as ReturnType<typeof rvcPlan>["convert"], missing: [] as ("uco" | "ocu")[], scriptId: null as string | null };
  if (asProvider(p?.provider) !== "gemini_tts_rvc") return none;
  const [script] = await sql<{ id: string; lines: { speaker: string }[] }[]>`
    SELECT id, lines FROM scripts WHERE project_id = ${projectId} ORDER BY version DESC LIMIT 1`;
  if (!script) return none;
  const takes = await sql<{ id: string; line_index: number; source: string; ai_prompt: string | null }[]>`
    SELECT id, line_index, source, ai_prompt FROM recordings WHERE script_id = ${script.id} AND is_selected`;
  const { rvcModelStatus } = await import("./studio-assets");
  return { ...rvcPlan(script.lines, takes, await rvcModelStatus()), scriptId: script.id };
}
