// Pipeline progress for scheduled slots: the stage ranges the worker maps its real progress into, the throttle for
// reports, the validation the progress endpoint applies, and what the Schedule page shows (milestones, freshness,
// when to poll). Pure code: no database, no network, no AI. Percentages are only ever computed from real counts
// (lines voiced, props made, Remotion's own render progress), never from a timer.

export const PROGRESS_STAGES = ["starting", "scripting", "props", "voicing", "converting_voice", "rendering", "uploading", "done", "failed"] as const;
export type ProgressStage = (typeof PROGRESS_STAGES)[number];
/** Stages during which the worker is (or should be) working: the page polls while any slot is in one. */
export const ACTIVE_STAGES: readonly ProgressStage[] = ["starting", "scripting", "props", "voicing", "converting_voice", "rendering", "uploading"];
export const isActiveStage = (s: string | null | undefined): s is ProgressStage => Boolean(s && (ACTIVE_STAGES as readonly string[]).includes(s));

/**
 * The share of the bar each stage owns. Without Own Voice (no RVC) voicing stretches over 30-75 %, so the bar never
 * jumps over an RVC stage that doesn't happen.
 */
export function stageRange(stage: ProgressStage, rvc: boolean): [number, number] {
  switch (stage) {
    case "starting":
      return [0, 5];
    case "scripting":
      return [5, 15];
    case "props":
      return [15, 30];
    case "voicing":
      return rvc ? [30, 55] : [30, 75];
    case "converting_voice":
      return [55, 75];
    case "rendering":
      return [75, 95];
    case "uploading":
      return [95, 100];
    default:
      return [100, 100];
  }
}

/** `done` of `total` real units through a stage → the overall percentage (integer, inside the stage's range). */
export function progressAt(stage: ProgressStage, done: number, total: number, rvc = false): number {
  const [lo, hi] = stageRange(stage, rvc);
  const f = total > 0 ? Math.max(0, Math.min(1, done / total)) : 0;
  return Math.round(lo + (hi - lo) * f);
}

/** Remotion's renderMedia progress (0..1) → 75-95 % overall, with the render's own percentage for the detail. */
export function renderProgress(remotion: number): { percent: number; detail: string } {
  const p = Math.max(0, Math.min(1, Number.isFinite(remotion) ? remotion : 0));
  return { percent: Math.round(75 + 20 * p), detail: `Rendering video (${Math.round(p * 100)}%)` };
}

/**
 * Reports go out at most once every 4 s per stage, unless the stage changes or the bar moved 5 points or more.
 * The first report of a stage, and 100 %, always go out.
 */
export class ProgressThrottle {
  private last: { at: number; percent: number | null; stage: string } | null = null;
  constructor(
    private readonly minMs = 4000,
    private readonly minDelta = 5,
  ) {}
  shouldSend(stage: string, percent: number | null, now = Date.now()): boolean {
    const l = this.last;
    const send =
      !l || l.stage !== stage || percent === 100 || now - l.at >= this.minMs || (percent !== null && l.percent !== null && Math.abs(percent - l.percent) >= this.minDelta);
    if (send) this.last = { at: now, percent, stage };
    return send;
  }
}

export type ProgressUpdate = { stage: ProgressStage; percent: number | null; detail: string | null };

/** The progress endpoint's validation: a known stage, a 0-100 integer (clamped) or null, a short single-line detail. */
export function normalizeProgress(body: unknown): { ok: true; value: ProgressUpdate } | { ok: false; error: string } {
  const b = (body ?? {}) as { stage?: unknown; percent?: unknown; detail?: unknown };
  if (typeof b.stage !== "string" || !(PROGRESS_STAGES as readonly string[]).includes(b.stage)) {
    return { ok: false, error: `stage must be one of: ${PROGRESS_STAGES.join(", ")}` };
  }
  let percent: number | null = null;
  if (b.percent !== null && b.percent !== undefined && b.percent !== "") {
    const n = Number(b.percent);
    if (!Number.isFinite(n)) return { ok: false, error: "percent must be a number from 0 to 100, or null" };
    percent = Math.max(0, Math.min(100, Math.round(n)));
  }
  const detail = typeof b.detail === "string" ? b.detail.replace(/\s+/g, " ").replace(/\s*[—–]\s*/g, ", ").trim().slice(0, 160) || null : null;
  return { ok: true, value: { stage: b.stage as ProgressStage, percent, detail } };
}

// ------------------------------------------------------------------ what the card shows
export const STAGE_LABEL: Record<ProgressStage, string> = {
  starting: "Starting",
  scripting: "Writing the script",
  props: "Making props",
  voicing: "Voicing",
  converting_voice: "Converting to your voice",
  rendering: "Rendering",
  uploading: "Uploading",
  done: "Done",
  failed: "Failed",
};

export const MILESTONES = ["Script", "Props", "Voice", "Render", "Post"] as const;
export type MilestoneState = "done" | "current" | "todo" | "failed";
const MILESTONE_OF: Record<ProgressStage, number> = { starting: -1, scripting: 0, props: 1, voicing: 2, converting_voice: 2, rendering: 3, uploading: 4, done: 5, failed: -1 };

/** The 5-step strip: steps before the current one are done; when the slot failed, the step it stopped at is failed. */
export function milestones(stage: string | null | undefined, failed: boolean): { label: (typeof MILESTONES)[number]; state: MilestoneState }[] {
  const at = stage && stage in MILESTONE_OF ? MILESTONE_OF[stage as ProgressStage] : -1;
  return MILESTONES.map((label, i) => ({
    label,
    state: i < at ? "done" : i === at ? (failed ? "failed" : "current") : failed && at === -1 && i === 0 ? "failed" : "todo",
  }));
}

/** Active slots that haven't reported for this long get a "check the run log" hint. */
export const STALE_AFTER_MS = 3 * 60_000;

/** "Updated 6s ago", or the stale hint for an active slot quiet for over 3 minutes. */
export function freshness(updatedAt: Date | string | null, now: number, active: boolean): { text: string; stale: boolean } | null {
  if (!updatedAt) return null;
  const ms = Math.max(0, now - new Date(updatedAt).getTime());
  if (active && ms > STALE_AFTER_MS) return { text: "No update for 3m+, check Run log", stale: true };
  const s = Math.round(ms / 1000);
  const ago = s < 60 ? `${s}s` : s < 3600 ? `${Math.floor(s / 60)}m` : `${Math.floor(s / 3600)}h`;
  return { text: `Updated ${ago} ago`, stale: false };
}

/** The page polls only while a slot is running and the tab is visible. */
export function shouldPoll(slots: { progressStage: string | null; status: string }[], visibility: string): boolean {
  return visibility === "visible" && slots.some((s) => isActiveStage(s.progressStage) && s.status !== "failed" && s.status !== "published");
}

/** The polling interval while a slot is running. */
export const POLL_MS = 4000;
