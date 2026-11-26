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
// Only node: built-ins at the top. The `plan` job checks out THIS FILE ALONE (sparse checkout), so the stage modules
// (Edge TTS, props, progress; they pull in video/src and src/lib) load inside `prepare`, which runs in the fully
// checked-out `produce` job. tests/unit/scheduler-plan.test.mts runs `plan` from a sparse copy to keep it that way.

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
    const [{ edgeStage }, { propStage }, { progressReporter }, { progressAt }] = await Promise.all([
      import("./edge-stage.mts"),
      import("./prop-stage.mts"),
      import("./slot-progress.mts"),
      import("../src/lib/slotProgress.ts"),
    ]);
    // the card's progress bar (real counts only; a failed report never stops the episode)
    const report = progressReporter({ base, token, slotId, log: (m) => log(`warning: ${m}`) });
    await report("scripting", 5, "Writing Show Bible script...", { force: true });
    const s = await post<{ episodeId: string; title: string; reused: boolean; lines: number }>(`slots/${slotId}/script`);
    log(`${s.reused ? "kept the script of" : "wrote"} "${s.title}" (episode ${s.episodeId})`);
    await report("scripting", 15, `Script ready (${s.lines} lines)`, { force: true });
    // the episode's fresh props (Gemini image model in the app → cut-out here → upload); a failed one drops to none
    // (a reused script only makes the props still pending)
    const props = await propStage({
      slotId: slotId!,
      post,
      log,
      base,
      onStep: (i, n, phase) => report("props", progressAt("props", i - (phase === "generating" ? 1 : 0.5), n), `${phase === "generating" ? "Generating" : "Cutting out"} prop ${i} of ${n}`, { force: i === n && phase === "cutting" }),
    });
    if (props.done.length || props.dropped.length) log(`props: ${props.done.length} ready${props.dropped.length ? `, ${props.dropped.length} dropped to none` : ""}`);
    // Own Voice → Edge TTS in this worker (then RVC); Gemini TTS → Gemini, with Edge TTS taking over on a 429
    for (let round = 0; round < 10; round++) {
      const v = await post<{ voiced: number; remaining: number; total: number; rvc: boolean; engine: "gemini" | "edge"; note: string | null }>(`slots/${slotId}/voice`);
      log(`voice: ${v.voiced} new Gemini TTS take(s), ${v.remaining} line(s) without a take`);
      const voicedSoFar = v.total - v.remaining;
      await report("voicing", progressAt("voicing", voicedSoFar, v.total, v.rvc), `Voicing line ${Math.min(v.total, voicedSoFar + (v.remaining ? 1 : 0))} of ${v.total}`, { force: round === 0 });
      if (v.note) log(v.note);
      if (!v.remaining) break;
      if (v.engine === "edge") {
        const e = await edgeStage({
          slotId: slotId!,
          post,
          log,
          onLine: (done, n) => report("voicing", progressAt("voicing", voicedSoFar + done, v.total, v.rvc), `Voicing line ${Math.min(v.total, voicedSoFar + done)} of ${v.total}`, { force: done === n }),
        });
        log(`edge-tts: ${e.voiced} take(s) stored`);
        if (!e.voiced) throw new Error(`Edge TTS couldn't voice the remaining ${v.remaining} line(s).`);
        continue; // the next voice call confirms nothing is left
      }
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
  const message = e instanceof Error ? e.message : String(e);
  console.error(message);
  // a failure in the worker itself (Edge TTS, ffmpeg, an upload) fails the slot with its real reason; a step the app
  // already failed is left as it is (the app ignores a second report)
  if ((cmd === "prepare" || cmd === "finish") && slotId) await post(`slots/${slotId}/fail`, { error: message.slice(0, 900) }).catch(() => {});
  process.exit(1);
}
