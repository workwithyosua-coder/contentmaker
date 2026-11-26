// Pipeline progress for scheduled slots: stage ranges (with and without RVC), Remotion progress in 75-95 %, throttling,
// the non-fatal worker reporter, the progress endpoint's auth and validation, milestones, freshness and the polling
// lifecycle. Pure code: no database, no network, no AI. Run: npm run test:unit
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { test } from "node:test";
import {
  ACTIVE_STAGES,
  POLL_MS,
  ProgressThrottle,
  freshness,
  milestones,
  normalizeProgress,
  progressAt,
  renderProgress,
  shouldPoll,
  stageRange,
} from "../../src/lib/slotProgress.ts";
import { progressReporter } from "../../video/slot-progress.mts";
import { ROOT, pathTo } from "./importGraph.mts";

test("stage ranges: script 5-15, props 15-30, voices 30-55 then RVC 55-75; without RVC voices span 30-75", () => {
  assert.deepEqual(stageRange("scripting", false), [5, 15]);
  assert.deepEqual(stageRange("props", true), [15, 30]);
  assert.deepEqual(stageRange("voicing", true), [30, 55]);
  assert.deepEqual(stageRange("converting_voice", true), [55, 75]);
  assert.deepEqual(stageRange("voicing", false), [30, 75], "no artificial jump over an RVC stage that doesn't run");
  assert.deepEqual(stageRange("rendering", false), [75, 95]);
  assert.deepEqual(stageRange("uploading", false), [95, 100]);
  // real counts only
  assert.equal(progressAt("voicing", 4, 15, true), 37);
  assert.equal(progressAt("voicing", 4, 15, false), 42);
  assert.equal(progressAt("voicing", 15, 15, true), 55);
  assert.equal(progressAt("voicing", 15, 15, false), 75);
  assert.equal(progressAt("converting_voice", 4, 15), 60);
  assert.equal(progressAt("props", 1, 3), 20);
  assert.equal(progressAt("props", 0, 0), 15, "nothing to count: the start of the stage");
  assert.equal(progressAt("voicing", 99, 15, false), 75, "never past the stage's end");
  // every stage starts where the previous one ended
  for (const rvc of [true, false]) {
    const chain = (["scripting", "props", "voicing", ...(rvc ? (["converting_voice"] as const) : []), "rendering", "uploading"] as const).map((s) => stageRange(s, rvc));
    for (let i = 1; i < chain.length; i++) assert.equal(chain[i][0], chain[i - 1][1], `rvc=${rvc} stage ${i}`);
  }
});

test("Remotion's render progress maps into 75-95 % with its own percentage in the detail", () => {
  assert.deepEqual(renderProgress(0), { percent: 75, detail: "Rendering video (0%)" });
  assert.deepEqual(renderProgress(0.48), { percent: 85, detail: "Rendering video (48%)" });
  assert.deepEqual(renderProgress(1), { percent: 95, detail: "Rendering video (100%)" });
  assert.deepEqual(renderProgress(1.7), { percent: 95, detail: "Rendering video (100%)" });
  assert.deepEqual(renderProgress(NaN), { percent: 75, detail: "Rendering video (0%)" });
  // render.mts wires renderMedia's onProgress to it, and reports the upload at 95 %
  const r = fs.readFileSync(path.join(ROOT, "video/render.mts"), "utf8");
  assert.match(r, /onProgress: \(\{ progress: done \}\) => \{[\s\S]*?const r = renderProgress\(done\);\s*void slotReport\("rendering", r\.percent, r\.detail\);/);
  assert.match(r, /slotReport\("uploading", 95, "Uploading MP4 & queueing posts\.\.\.", \{ force: true \}\)/);
});

test("throttle: at most one report per 4 s per stage, unless the stage changes or the bar moves 5 points", () => {
  const t = new ProgressThrottle();
  assert.equal(t.shouldSend("rendering", 75, 0), true, "first report");
  assert.equal(t.shouldSend("rendering", 76, 1000), false);
  assert.equal(t.shouldSend("rendering", 79, 3999), false);
  assert.equal(t.shouldSend("rendering", 80, 4000), true, "5 points");
  assert.equal(t.shouldSend("rendering", 81, 5000), false);
  assert.equal(t.shouldSend("rendering", 82, 8001), true, "4 s");
  assert.equal(t.shouldSend("uploading", 95, 8002), true, "a new stage always goes out");
  assert.equal(t.shouldSend("uploading", 100, 8003), true, "100 % always goes out");
});

test("the worker's reporter never stops the episode: failures are logged warnings", async () => {
  const warnings: string[] = [];
  const calls: { url: string; body: unknown; auth: string | null }[] = [];
  const slotId = "11111111-2222-4333-8444-555555555555";
  const ok = progressReporter({
    base: "https://app.test/",
    token: "tok",
    slotId,
    log: (m) => warnings.push(m),
    fetchImpl: (async (url: string, init: RequestInit) => {
      calls.push({ url, body: JSON.parse(String(init.body)), auth: new Headers(init.headers).get("authorization") });
      return new Response("{}", { status: 200 });
    }) as typeof fetch,
  });
  await ok("voicing", 37, "Voicing line 4 of 15", { force: true });
  assert.deepEqual(calls[0], { url: `https://app.test/api/scheduler/slots/${slotId}/progress`, body: { stage: "voicing", percent: 37, detail: "Voicing line 4 of 15" }, auth: "Bearer tok" });
  await ok("voicing", 38, "Voicing line 5 of 15");
  assert.equal(calls.length, 1, "throttled");
  // the endpoint down, or a 500: resolved, with a warning
  for (const fetchImpl of [
    (async () => {
      throw new Error("ECONNRESET");
    }) as unknown as typeof fetch,
    (async () => new Response("boom", { status: 500 })) as unknown as typeof fetch,
  ]) {
    const r = progressReporter({ base: "https://app.test", token: "tok", slotId, log: (m) => warnings.push(m), fetchImpl });
    await assert.doesNotReject(r("rendering", 80, "Rendering video (25%)", { force: true }));
  }
  assert.equal(warnings.length, 2);
  assert.match(warnings[0], /progress report skipped \(ECONNRESET\)/);
  assert.match(warnings[1], /progress report skipped \(500\)/);
  // a manual render (no SLOT_ID) sends nothing
  let sent = 0;
  const none = progressReporter({ base: "https://app.test", token: "tok", slotId: undefined, fetchImpl: (async () => (sent++, new Response("{}"))) as unknown as typeof fetch });
  await none("rendering", 80, "x", { force: true });
  assert.equal(sent, 0);
});

test("progress endpoint: RENDER_TOKEN first, a known stage, percent clamped to 0-100, a failed report never fails the slot", () => {
  assert.deepEqual(normalizeProgress({ stage: "rendering", percent: 140, detail: "Rendering video (64%)" }), { ok: true, value: { stage: "rendering", percent: 100, detail: "Rendering video (64%)" } });
  assert.deepEqual(normalizeProgress({ stage: "voicing", percent: -3 }), { ok: true, value: { stage: "voicing", percent: 0, detail: null } });
  assert.deepEqual(normalizeProgress({ stage: "starting", percent: null, detail: "  Starting GitHub worker...  " }), { ok: true, value: { stage: "starting", percent: null, detail: "Starting GitHub worker..." } });
  assert.equal((normalizeProgress({ stage: "voicing", percent: "37.6" }) as { value: { percent: number } }).value.percent, 38);
  assert.equal((normalizeProgress({ stage: "props", detail: "Prop — one" }) as { value: { detail: string } }).value.detail, "Prop, one", "no em dashes");
  for (const bad of [{}, { stage: "flying" }, { stage: 3 }, { stage: "voicing", percent: "lots" }, null]) {
    assert.equal(normalizeProgress(bad).ok, false, JSON.stringify(bad));
  }
  const route = fs.readFileSync(path.join(ROOT, "src/app/api/scheduler/slots/[id]/[step]/route.ts"), "utf8");
  const auth = route.indexOf("if (!renderAuthorized(request)) return notFound();");
  const progress = route.indexOf('if (step === "progress") {');
  assert.ok(auth > 0 && progress > auth, "authorized with RENDER_TOKEN before anything else");
  assert.ok(progress < route.indexOf("await failSlot("), "handled before the step error path: a bad report never fails the slot");
  assert.match(route, /if \(!v\.ok\) return Response\.json\(\{ error: v\.error \}, \{ status: 400 \}\);/);
  // the app applies a report only while the slot runs (or starts): a failed slot keeps the point where it stopped
  const srv = fs.readFileSync(path.join(ROOT, "src/lib/scheduler-server.ts"), "utf8");
  assert.match(srv, /WHERE id = \$\{id\} AND \(status IN \('scripting', 'voicing', 'rendering'\) OR \(status = 'queued' AND progress_stage = 'starting'\)\)/);
  const fail = srv.slice(srv.indexOf("export async function failSlot"), srv.indexOf("export async function failSlot") + 600);
  assert.doesNotMatch(fail, /progress_/, "failing keeps the last percent and stage");
  // queued / retried / regenerated slots reset; a manual run and the cron's claim start at "Starting GitHub worker..."
  assert.equal((srv.match(/progress_stage = 'starting', progress_detail = 'Starting GitHub worker\.\.\.'/g) ?? []).length, 3);
  assert.equal((srv.match(/progress_percent = NULL, progress_stage = NULL, progress_detail = NULL, progress_updated_at = NULL/g) ?? []).length, 3, "retry, regenerate, and a refused dispatch");
  const sql = fs.readFileSync(path.join(ROOT, "db/migrations/019_slot_progress.sql"), "utf8");
  for (const c of ["progress_percent integer", "progress_stage text", "progress_detail text", "progress_updated_at timestamptz"]) assert.ok(sql.includes(c), c);
  assert.match(sql, /progress_percent BETWEEN 0 AND 100/);
});

test("the 5-step strip and freshness say where the pipeline is, and where it stopped", () => {
  const strip = (stage: string | null, failed = false) => milestones(stage, failed).map((m) => `${m.label}:${m.state}`).join(" ");
  assert.equal(strip("starting"), "Script:todo Props:todo Voice:todo Render:todo Post:todo");
  assert.equal(strip("voicing"), "Script:done Props:done Voice:current Render:todo Post:todo");
  assert.equal(strip("converting_voice"), "Script:done Props:done Voice:current Render:todo Post:todo");
  assert.equal(strip("rendering", true), "Script:done Props:done Voice:done Render:failed Post:todo");
  assert.equal(strip("done"), "Script:done Props:done Voice:done Render:done Post:done");
  assert.equal(strip("starting", true), "Script:failed Props:todo Voice:todo Render:todo Post:todo", "failed before it started");
  const now = Date.parse("2026-11-27T10:00:00Z");
  assert.deepEqual(freshness("2026-11-27T09:59:54Z", now, true), { text: "Updated 6s ago", stale: false });
  assert.deepEqual(freshness("2026-11-27T09:56:59Z", now, true), { text: "No update for 3m+, check Run log", stale: true });
  assert.deepEqual(freshness("2026-11-27T09:50:00Z", now, false), { text: "Updated 10m ago", stale: false }, "a failed slot isn't stale");
  assert.equal(freshness(null, now, true), null);
});

test("polling: every 4 s only while a slot is running and the tab is visible; it stops when all are idle", () => {
  assert.equal(POLL_MS, 4000);
  const slot = (progressStage: string | null, status = "scripting") => ({ progressStage, status });
  for (const st of ACTIVE_STAGES) assert.equal(shouldPoll([slot(null, "queued"), slot(st)], "visible"), true, st);
  assert.equal(shouldPoll([slot("starting", "queued")], "visible"), true, "Run slot now: waiting for GitHub");
  assert.equal(shouldPoll([slot("rendering")], "hidden"), false, "paused while hidden");
  assert.equal(shouldPoll([slot(null, "queued"), slot("done", "ready_to_post"), slot("rendering", "failed")], "visible"), false, "idle, done or failed: no polling");
  assert.equal(shouldPoll([], "visible"), false);
  // the queue list wires it: interval only while polling, visibility tracked, the light JSON endpoint behind the login
  const ui = fs.readFileSync(path.join(ROOT, "src/components/scheduler.tsx"), "utf8");
  assert.match(ui, /const polling = shouldPoll\(live, visible \? "visible" : "hidden"\);/);
  assert.match(ui, /if \(!polling\) return;[\s\S]*?setInterval\(async \(\) => \{[\s\S]*?fetch\("\/api\/schedule\/queue"/);
  assert.match(ui, /document\.addEventListener\("visibilitychange", read\)/);
  const proxy = fs.readFileSync(path.join(ROOT, "src/proxy.ts"), "utf8");
  assert.doesNotMatch(proxy, /api\/schedule\|/, "/api/schedule/queue stays behind the login");
});

test("the last report of every counted stage is forced past the throttle (the bar never stops short)", () => {
  const rvc = fs.readFileSync(path.join(ROOT, "video/rvc-stage.mts"), "utf8");
  assert.match(rvc, /`Converting voice \$\{i\} of \$\{jobs\.length\}`, \{ force: i === 0 \|\| i === jobs\.length \}\)/);
  const step = fs.readFileSync(path.join(ROOT, "video/scheduler-step.mts"), "utf8");
  assert.match(step, /\{ force: done === n \}/);
  assert.match(step, /\{ force: i === n && phase === "cutting" \}/);
  assert.match(step, /report\("scripting", 15, `Script ready \(\$\{s\.lines\} lines\)`, \{ force: true \}\)/);
});

test("Run slot now / Retry / Regenerate: the Starting bar is saved before GitHub is asked, cleared if GitHub refuses", () => {
  const srv = fs.readFileSync(path.join(ROOT, "src/lib/scheduler-server.ts"), "utf8");
  const fn = srv.slice(srv.indexOf("export async function dispatchSlot"), srv.indexOf("export async function setProgress"));
  const starting = fn.indexOf("progress_stage = 'starting', progress_detail = 'Starting GitHub worker...', progress_updated_at = now()");
  assert.ok(starting > 0 && starting < fn.indexOf("await fetch("), "persisted before the dispatch request");
  assert.match(fn, /if \(!res\.ok\) \{\s*await db\(\)`UPDATE episode_queue SET progress_percent = NULL, progress_stage = NULL/);
  const actions = fs.readFileSync(path.join(ROOT, "src/app/schedule/actions.ts"), "utf8");
  for (const name of ["runSlotAction", "retrySlotAction", "regenerateSlotAction"]) {
    const body = actions.slice(actions.indexOf(`export async function ${name}`), actions.indexOf("\n}\n", actions.indexOf(`export async function ${name}`)));
    assert.match(body, /await dispatchSlot\(o\.id, id\);\s*revalidatePath\("\/schedule"\);/, `${name} starts the run and refreshes the page`);
  }
  // a queued slot that is starting counts as running: the Waiting bar shows and the page polls
  assert.equal(shouldPoll([{ progressStage: "starting", status: "queued" }], "visible"), true);
});

test("zero Anthropic in the progress path", () => {
  const AI = [/src\/lib\/agents\//, /@anthropic-ai\//, /^anthropic$/];
  for (const entry of ["src/lib/slotProgress.ts", "video/slot-progress.mts", "src/components/slot-progress.tsx", "src/app/api/schedule/queue/route.ts", "video/rvc-stage.mts", "video/render.mts", "video/scheduler-step.mts"]) {
    assert.equal(pathTo(entry, AI), null, `${entry} reaches AI via ${pathTo(entry, AI)?.join(" → ")}`);
  }
});
