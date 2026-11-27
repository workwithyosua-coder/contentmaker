// The renderer's manifest for an episode (GET /api/render/:id) and the worker's job reports (POST /api/render/:id/job),
// as pure functions so both can be tested on real payloads without a database. No server-only imports.
import { styleById } from "../../video/src/styles/registry";
import { normalizeStatus } from "./renderWorker";
import { takeSource } from "./voice/edge";

type AssetUrls = { props: Record<string, string>; sfx: Record<string, string>; cast?: Record<string, string> };
export type ManifestSource = {
  project: { id: string; title: string | null; video_style: string | null };
  script: { id: string; title?: string | null; version: number; target_duration_s?: number | null; direction?: string | null; custom?: boolean | null; lines: unknown };
  takes: { line_index: number; source: string; ai_prompt: string | null }[];
};

/**
 * Everything the renderer needs to animate an episode. Episodes saved by any earlier version load as they are: lines
 * are passed through untouched (stat cards, card labels and voices are normalized by the renderer, not here), and a
 * script whose lines aren't a list renders as an empty episode instead of crashing the request.
 */
export function renderManifest(src: ManifestSource, assetUrls: AssetUrls) {
  const recorded = new Set(src.takes.map((t) => t.line_index));
  // where each take came from ("ai" = ElevenLabs, "ai_gemini", "ai_edge", "upload", "booth"…): only "ai" is sped up
  const sourceOf = new Map(src.takes.map((t) => [t.line_index, takeSource(t.source, t.ai_prompt)]));
  const lines = Array.isArray(src.script.lines) ? (src.script.lines as Record<string, unknown>[]) : [];
  return {
    projectId: src.project.id,
    title: src.script.title || src.project.title,
    videoStyle: styleById(src.project.video_style).id,
    scriptId: src.script.id,
    version: src.script.version,
    targetDurationS: src.script.target_duration_s ?? null,
    // custom scripts: direction / pacing notes, parsed by the renderer (video/src/direction.ts)
    direction: src.script.direction ?? null,
    custom: src.script.custom ?? false,
    // custom props / SFX and the global Studio Assets (angry sprites, urgent BGM), as public URLs
    assetUrls,
    lines: lines.map((l, index) => ({ ...l, index, hasAudio: recorded.has(index), audioSource: sourceOf.get(index) ?? null })),
  };
}

export type JobReport = { jobId: string; status: string; error?: string; runUrl?: string; progress?: number; stage?: string };

/**
 * A worker's job report (render-worker.yml and the scheduler both send these), validated: the job id, a known status,
 * and the optional error / run URL / progress / stage. Returns the report or why it can't be used.
 */
export function parseJobReport(body: unknown): { ok: true; report: JobReport } | { ok: false; error: string } {
  const b = (body && typeof body === "object" ? body : {}) as Record<string, unknown>;
  const str = (v: unknown) => (typeof v === "string" ? v : undefined);
  const jobId = str(b.jobId);
  const status = str(b.status);
  if (!jobId || !/^[0-9a-f-]{36}$/.test(jobId)) return { ok: false, error: "jobId (a uuid) is required." };
  if (!status || !normalizeStatus(status) || normalizeStatus(status) === "queued") return { ok: false, error: `Unknown status "${status ?? ""}".` };
  const progress = typeof b.progress === "number" && Number.isFinite(b.progress) ? b.progress : undefined;
  return { ok: true, report: { jobId, status, error: str(b.error)?.slice(0, 500), runUrl: str(b.runUrl), progress, stage: str(b.stage)?.slice(0, 80) } };
}

/** An unexpected server error as a readable JSON body (the worker prints it), with its stack in the function log. */
export function serverError(where: string, err: unknown, status = 500): Response {
  const message = err instanceof Error ? err.message : String(err);
  console.error(`[${where}]`, err instanceof Error ? err.stack ?? message : message);
  return Response.json({ error: `${where}: ${message}` }, { status });
}
