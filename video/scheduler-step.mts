// The autonomous scheduler's steps in GitHub Actions (.github/workflows/autonomous-scheduler.yml). Talks to the app only
// through /api/scheduler/* with RENDER_TOKEN, like the render worker; no database, storage or Anthropic keys.
//
//   npx tsx scheduler-step.mts plan [slotId]       → claims the slots to produce now; writes slots=[...] to $GITHUB_OUTPUT
//   npx tsx scheduler-step.mts prepare <slotId>    → script (Gemini) → voices (Gemini TTS) → render job;
//                                                     writes episode_id, job_id, voice (rvc | none) to $GITHUB_OUTPUT
//   npx tsx scheduler-step.mts finish <slotId>     → after render.mts: queues the posts, TikTok hand-off
//   npx tsx scheduler-step.mts fail <slotId> [msg] → marks the slot failed
// Env: RENDER_TOKEN, APP_URL (default production), RUN_URL (the Actions run, shown on the Schedule page)
import { appendFileSync } from "node:fs";

const [cmd, slotId, ...rest] = process.argv.slice(2);
const base = (process.env.APP_URL ?? "https://contentmaker-lime.vercel.app").replace(/\/$/, "");
const token = process.env.RENDER_TOKEN?.trim();
const runUrl = process.env.RUN_URL ?? null;
if (!token || !["plan", "prepare", "finish", "fail"].includes(cmd ?? "") || (cmd !== "plan" && !/^[0-9a-f-]{36}$/.test(slotId ?? ""))) {
  console.error("Usage: RENDER_TOKEN=... npx tsx scheduler-step.mts plan|prepare|finish|fail [slotId]");
  process.exit(1);
}
const log = (s: string) => console.log(`[${new Date().toISOString().slice(11, 19)}] ${s}`);
const output = (key: string, value: string) => {
  if (process.env.GITHUB_OUTPUT) appendFileSync(process.env.GITHUB_OUTPUT, `${key}=${value}\n`);
  log(`${key}=${value}`);
};

async function post<T>(path: string, body: Record<string, unknown> = {}): Promise<T> {
  for (let attempt = 1; ; attempt++) {
    const res = await fetch(`${base}/api/scheduler/${path}`, {
      method: "POST",
      headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
      body: JSON.stringify({ runUrl, ...body }),
      signal: AbortSignal.timeout(310_000),
    }).catch((e: Error) => ({ ok: false, status: 0, text: async () => e.message, json: async () => ({}) }) as unknown as Response);
    if (res.ok) return (await res.json()) as T;
    const text = (await res.text()).slice(0, 500);
    // network errors and 5xx (a cold or busy function) are retried; 4xx means the step itself failed
    if ((res.status === 0 || res.status >= 500) && attempt < 3) {
      log(`${path} → ${res.status}, retrying`);
      await new Promise((r) => setTimeout(r, attempt * 10_000));
      continue;
    }
    let msg = text;
    try {
      msg = (JSON.parse(text) as { error?: string }).error ?? text;
    } catch {}
    throw new Error(`${path} → ${res.status}: ${msg}`);
  }
}

try {
  if (cmd === "plan") {
    const r = await post<{ slots: string[]; notes: string[] }>("tick", slotId ? { slotId } : {});
    for (const n of r.notes) log(n);
    log(r.slots.length ? `producing ${r.slots.length} slot(s)` : "nothing due now");
    output("slots", JSON.stringify(r.slots));
    output("count", String(r.slots.length));
  } else if (cmd === "prepare") {
    const s = await post<{ episodeId: string; title: string; reused: boolean }>(`slots/${slotId}/script`);
    log(`${s.reused ? "kept the script of" : "wrote"} "${s.title}" (episode ${s.episodeId})`);
    for (let round = 0; round < 10; round++) {
      const v = await post<{ voiced: number; remaining: number }>(`slots/${slotId}/voice`);
      log(`voiced ${v.voiced} line(s), ${v.remaining} left`);
      if (!v.remaining) break;
      if (round === 9) throw new Error("Voicing didn't finish after 10 rounds.");
    }
    const r = await post<{ episodeId: string; jobId: string; voice: "rvc" | "none" }>(`slots/${slotId}/render`);
    output("episode_id", r.episodeId);
    output("job_id", r.jobId);
    output("voice", r.voice);
  } else if (cmd === "finish") {
    const r = await post<{ status: string; handoff: { queued: string[]; postAt: string; notConnected: string[]; tiktokCaption: string | null } }>(`slots/${slotId}/finish`);
    log(`slot ${r.status}: posting to ${r.handoff.queued.join(", ") || "nothing"} at ${r.handoff.postAt}`);
    if (r.handoff.notConnected.length) log(`not connected: ${r.handoff.notConnected.join(", ")}`);
    if (r.handoff.tiktokCaption) log("TikTok hand-off ready on the Schedule page");
  } else {
    await post(`slots/${slotId}/fail`, { error: rest.join(" ") || "The worker failed. Open the run on GitHub for the log." });
    log("slot marked failed");
  }
} catch (e) {
  console.error(e instanceof Error ? e.message : String(e));
  process.exit(1);
}
