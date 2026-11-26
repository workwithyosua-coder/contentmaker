// The GitHub Actions render worker (.github/workflows/render-worker.yml): job states, the dispatch payload and the
// Own-Voice (RVC) conversion plan. Pure code (no database, no network), shared by the app, the API and the tests.
//
// Two stages for the Own-Voice provider (gemini_tts_rvc):
//   Stage A, in the app's booth: Gemini TTS makes the acted base take of each line once (marked "[gemini_tts_rvc:base]")
//   Stage B, in the worker:       RVC converts every selected Gemini take that isn't converted yet into the user's
//                                  voice and stores it as the line's new selected take (marked "[rvc]"); converted
//                                  takes are never converted again, recorded / uploaded / ElevenLabs takes never at all

export const JOB_STATUSES = ["queued", "converting_voice", "rendering", "done", "failed"] as const;
export type JobStatus = (typeof JOB_STATUSES)[number];

/** Older workers report "running": it means rendering. */
export function normalizeStatus(s: string): JobStatus | null {
  if (s === "running") return "rendering";
  return (JOB_STATUSES as readonly string[]).includes(s) ? (s as JobStatus) : null;
}

export const isActiveJob = (s: string | null | undefined) => s === "queued" || s === "converting_voice" || s === "rendering" || s === "running";

const NEXT: Record<JobStatus, readonly JobStatus[]> = {
  queued: ["converting_voice", "rendering", "failed"],
  converting_voice: ["converting_voice", "rendering", "failed"],
  rendering: ["rendering", "done", "failed"],
  done: [],
  failed: [],
};

/** Whether a job may move from one state to another (progress updates repeat the same state; done / failed are final). */
export function canTransition(from: string, to: string): boolean {
  const f = normalizeStatus(from);
  const t = normalizeStatus(to);
  return Boolean(f && t && NEXT[f].includes(t));
}

/** What the episode page says for each state. */
export const STATUS_LABEL: Record<JobStatus, string> = {
  queued: "Waiting for GitHub to start the worker",
  converting_voice: "Converting voices to your own voice (RVC)",
  rendering: "Rendering the video",
  done: "Done",
  failed: "Failed",
};

export type VoiceStage = "none" | "rvc";

/** The workflow_dispatch body for one render (GitHub accepts only string inputs). */
export function dispatchPayload(p: { projectId: string; jobId: string; voice: VoiceStage; ref?: string }) {
  if (!/^[0-9a-f-]{36}$/.test(p.projectId) || !/^[0-9a-f-]{36}$/.test(p.jobId)) throw new Error("Bad episode or job id.");
  return { ref: p.ref ?? "main", inputs: { episode_id: p.projectId, job_id: p.jobId, voice: p.voice } };
}
export const WORKER_WORKFLOW = "render-worker.yml";

// ------------------------------------------------------------------ RVC plan
export const RVC_BASE_MARK = "[gemini_tts_rvc:base]";
export const RVC_DONE_MARK = "[rvc]";

type Take = { line_index: number; source: string; ai_prompt: string | null; id?: string };

/** A selected take RVC should convert: a Gemini TTS take (base or plain), not yet converted. */
export function needsConversion(t: Pick<Take, "source" | "ai_prompt">): boolean {
  if (t.source !== "ai" || !t.ai_prompt) return false;
  if (t.ai_prompt.startsWith(RVC_DONE_MARK)) return false;
  return t.ai_prompt.startsWith("[gemini_tts");
}

/** Where each character's voice model lives: the PRIVATE recordings bucket, never the public studio-assets bucket. */
export const VOICE_MODEL_BUCKET = "recordings";
export function voiceModelPath(who: "uco" | "ocu", ext: "pth" | "index"): { bucket: typeof VOICE_MODEL_BUCKET; path: string } {
  return { bucket: VOICE_MODEL_BUCKET, path: `studio-assets/voices/${who}-voice.${ext}` };
}

/**
 * Stage B's work for an episode: the lines whose selected take still needs converting, and which characters among
 * them have no .pth model yet (then the render stops with a clear message instead of silently using Gemini's voice).
 */
export function rvcPlan(
  lines: { speaker: string }[],
  takes: Take[],
  models: { uco: boolean; ocu: boolean },
): { convert: { lineIndex: number; speaker: "uco" | "ocu"; recordingId?: string }[]; missing: ("uco" | "ocu")[] } {
  const convert: { lineIndex: number; speaker: "uco" | "ocu"; recordingId?: string }[] = [];
  for (const t of takes) {
    const speaker = lines[t.line_index]?.speaker;
    if ((speaker === "uco" || speaker === "ocu") && needsConversion(t)) convert.push({ lineIndex: t.line_index, speaker, recordingId: t.id });
  }
  convert.sort((a, b) => a.lineIndex - b.lineIndex);
  const missing = (["uco", "ocu"] as const).filter((w) => convert.some((c) => c.speaker === w) && !models[w]);
  return { convert, missing };
}

/** The message for missing models, pointing at the page that fixes it. */
export function missingModelMessage(missing: ("uco" | "ocu")[]): string {
  const names = missing.map((w) => `${w === "uco" ? "Uco" : "Ocu"} (${w}-voice.pth)`).join(" and ");
  return `Own voice needs ${missing.length > 1 ? "voice models" : "a voice model"} for ${names}. Upload ${missing.length > 1 ? "them" : "it"} in Accounts → Studio Assets.`;
}

/** Supabase's Free plan caps a single stored file at 50 MB. */
export const SUPABASE_FREE_FILE_LIMIT = 50 * 1024 * 1024;
export const mb = (bytes: number) => `${(bytes / 1024 / 1024).toFixed(1)} MB`;
