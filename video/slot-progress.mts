// Progress reports for a scheduled slot's card on the Schedule page (POST /api/scheduler/slots/:id/progress with
// RENDER_TOKEN). Non-fatal by design: a failed report logs a warning and never stops the episode. Throttled to one
// report per 4 s per stage unless the stage changes or the bar moves 5 points (src/lib/slotProgress.ts).
// Percentages come from real counts only (lines, props, Remotion's own render progress).
import { ProgressThrottle, type ProgressStage } from "../src/lib/slotProgress.ts";

export type Reporter = (stage: ProgressStage, percent: number | null, detail: string, opts?: { force?: boolean }) => Promise<void>;

export function progressReporter(p: {
  base: string;
  token: string | undefined;
  slotId: string | undefined;
  log?: (s: string) => void;
  fetchImpl?: typeof fetch;
  throttle?: ProgressThrottle;
}): Reporter {
  const throttle = p.throttle ?? new ProgressThrottle();
  const f = p.fetchImpl ?? fetch;
  const warn = p.log ?? ((s: string) => console.warn(s));
  return async (stage, percent, detail, opts = {}) => {
    if (!p.slotId || !p.token || !/^[0-9a-f-]{36}$/.test(p.slotId)) return;
    if (!opts.force && !throttle.shouldSend(stage, percent)) return;
    if (opts.force) throttle.shouldSend(stage, percent, Date.now()); // still counts as the last report
    try {
      const res = await f(`${p.base.replace(/\/$/, "")}/api/scheduler/slots/${p.slotId}/progress`, {
        method: "POST",
        headers: { Authorization: `Bearer ${p.token}`, "Content-Type": "application/json" },
        body: JSON.stringify({ stage, percent, detail }),
        signal: AbortSignal.timeout(8000),
      });
      if (!res.ok) warn(`progress report skipped (${res.status}): ${stage} ${percent ?? "-"}%`);
    } catch (e) {
      warn(`progress report skipped (${e instanceof Error ? e.message : String(e)}): ${stage} ${percent ?? "-"}%`);
    }
  };
}

/** The reporter for the current worker step, from the environment the workflow sets (SLOT_ID, RENDER_TOKEN, APP_URL). */
export const slotReporter = (base?: string) =>
  progressReporter({ base: base ?? process.env.APP_URL ?? "https://contentmaker-lime.vercel.app", token: process.env.RENDER_TOKEN?.trim(), slotId: process.env.SLOT_ID?.trim() });
