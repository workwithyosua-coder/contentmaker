import "server-only";
import { db } from "./db";

// "Render video": the app asks GitHub Actions to run .github/workflows/render.yml, which renders the episode with
// video/render.mts, uploads it through /api/render/:id/video/*, and reports progress to /api/render/:id/job.
// Needs GITHUB_DISPATCH_TOKEN in Vercel: a fine-grained token for this repository with "Actions: read and write".
const REPO = () => process.env.GITHUB_REPO?.trim() || "workwithyosua-coder/contentmaker";
const STALE_MS = 90 * 60 * 1000; // the workflow times out after 90 minutes

export const renderButtonConfigured = () => Boolean(process.env.GITHUB_DISPATCH_TOKEN?.trim());

export type RenderJob = {
  id: string;
  status: "queued" | "running" | "done" | "failed";
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
  if ((j.status === "queued" || j.status === "running") && Date.now() - j.created_at.getTime() > STALE_MS) {
    return { ...j, status: "failed", error: j.error ?? "The render didn't finish within 90 minutes." };
  }
  return j;
}

export async function startRender(projectId: string) {
  const token = process.env.GITHUB_DISPATCH_TOKEN?.trim();
  if (!token) throw new Error("GITHUB_DISPATCH_TOKEN isn't set in Vercel yet.");
  const running = await latestRenderJob(projectId);
  if (running && (running.status === "queued" || running.status === "running")) throw new Error("A render is already in progress.");
  const sql = db();
  const [job] = await sql<{ id: string }[]>`INSERT INTO render_jobs (project_id) VALUES (${projectId}) RETURNING id`;
  const res = await fetch(`https://api.github.com/repos/${REPO()}/actions/workflows/render.yml/dispatches`, {
    method: "POST",
    headers: { Authorization: `Bearer ${token}`, Accept: "application/vnd.github+json", "X-GitHub-Api-Version": "2022-11-28" },
    body: JSON.stringify({ ref: "main", inputs: { episode_id: projectId, job_id: job.id } }),
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
  if (!["running", "done", "failed"].includes(status)) throw new Error("Bad status.");
  const pct = typeof progress === "number" && Number.isFinite(progress) ? Math.max(0, Math.min(100, Math.round(progress))) : null;
  await db()`
    UPDATE render_jobs SET status = ${status}, error = ${error ?? null}, run_url = COALESCE(${runUrl ?? null}, run_url),
      progress = CASE WHEN ${status} = 'done' THEN 100 ELSE COALESCE(${pct}, progress) END,
      stage = CASE WHEN ${status} = 'running' THEN COALESCE(${stage ?? null}, stage) ELSE NULL END,
      started_at = COALESCE(started_at, CASE WHEN ${status} = 'running' THEN now() END), updated_at = now()
    WHERE id = ${jobId} AND project_id = ${projectId} AND status NOT IN ('done', 'failed')`;
}
