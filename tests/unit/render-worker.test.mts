// PR 3: the Own Voice (gemini_tts_rvc) provider, the GitHub Actions render worker's dispatch payload and job states,
// and where the private voice models live. Pure code: no database, no network, no AI. Run: npm run test:unit
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { test } from "node:test";
import { PROVIDER_LABEL, STUDIO_ASSETS_HREF, routeVoice } from "../../src/lib/voice/acting.ts";
import {
  JOB_STATUSES,
  RVC_BASE_MARK,
  RVC_DONE_MARK,
  SUPABASE_FREE_FILE_LIMIT,
  WORKER_WORKFLOW,
  canTransition,
  dispatchPayload,
  isActiveJob,
  mb,
  missingModelMessage,
  needsConversion,
  normalizeStatus,
  rvcPlan,
  voiceModelPath,
} from "../../src/lib/renderWorker.ts";
import { STUDIO_BUCKET, isStudioObjectPath, studioSlot, studioVideoUrls } from "../../src/lib/studioAssets.ts";
import { ROOT, pathTo } from "./importGraph.mts";

const ENV = { geminiKey: true, elevenLabsKey: false, elevenLabsVoices: false };
const EP = "0807a4db-c22a-40fb-a534-27c078f40744";
const JOB = "11fabaaa-553b-4dc6-bedc-cc0e2f4a840d";

test("Own Voice is gated on each speaking character's .pth model, with a link to Studio Assets (no silent fallback)", () => {
  assert.equal(PROVIDER_LABEL.gemini_tts_rvc, "Own Voice (Gemini + RVC)");
  const none = routeVoice("gemini_tts_rvc", { ...ENV, rvcModels: { uco: false, ocu: false } });
  assert.equal(none.ok, false);
  assert.match((none as { message: string }).message, /voice models for Uco \(uco-voice\.pth\) and Ocu \(ocu-voice\.pth\).*Accounts → Studio Assets/);
  assert.equal((none as { href?: string }).href, STUDIO_ASSETS_HREF);
  // only the characters whose lines are voiced need a model
  assert.deepEqual(routeVoice("gemini_tts_rvc", { ...ENV, rvcModels: { uco: false, ocu: true } }, ["ocu"]), { ok: true, engine: "gemini", rvc: true });
  assert.equal(routeVoice("gemini_tts_rvc", { ...ENV, rvcModels: { uco: false, ocu: true } }, ["uco"]).ok, false);
  // models present: Stage A uses Gemini for the acted base take, marked for RVC
  assert.deepEqual(routeVoice("gemini_tts_rvc", { ...ENV, rvcModels: { uco: true, ocu: true } }), { ok: true, engine: "gemini", rvc: true });
  // Gemini still needed for the base take
  assert.match((routeVoice("gemini_tts_rvc", { ...ENV, geminiKey: false, rvcModels: { uco: true, ocu: true } }) as { message: string }).message, /GEMINI_API_KEY/);
  assert.equal(missingModelMessage(["ocu"]), "Own voice needs a voice model for Ocu (ocu-voice.pth). Upload it in Accounts → Studio Assets.");
});

test("Stage B converts only Gemini takes not converted yet; recorded, uploaded and ElevenLabs takes are never touched", () => {
  assert.equal(needsConversion({ source: "ai", ai_prompt: `${RVC_BASE_MARK} Bacakan…` }), true);
  assert.equal(needsConversion({ source: "ai", ai_prompt: "[gemini_tts] Bacakan…" }), true, "an earlier Gemini take is converted too");
  assert.equal(needsConversion({ source: "ai", ai_prompt: `${RVC_DONE_MARK} converted from x` }), false, "converted once, never again");
  assert.equal(needsConversion({ source: "ai", ai_prompt: "[angry] [fast] Badak!" }), false, "ElevenLabs");
  assert.equal(needsConversion({ source: "booth", ai_prompt: null }), false);
  assert.equal(needsConversion({ source: "upload", ai_prompt: null }), false);
  const lines = [{ speaker: "uco" }, { speaker: "ocu" }, { speaker: "uco" }, { speaker: "ocu" }];
  const takes = [
    { id: "a", line_index: 0, source: "ai", ai_prompt: `${RVC_BASE_MARK} x` },
    { id: "b", line_index: 1, source: "ai", ai_prompt: `${RVC_DONE_MARK} converted from z` },
    { id: "c", line_index: 2, source: "booth", ai_prompt: null },
    { id: "d", line_index: 3, source: "ai", ai_prompt: `${RVC_BASE_MARK} y` },
  ];
  const plan = rvcPlan(lines, takes, { uco: true, ocu: false });
  assert.deepEqual(plan.convert, [
    { lineIndex: 0, speaker: "uco", recordingId: "a" },
    { lineIndex: 3, speaker: "ocu", recordingId: "d" },
  ]);
  assert.deepEqual(plan.missing, ["ocu"], "Ocu has a line to convert but no model: the render stops with a message");
  assert.deepEqual(rvcPlan(lines, takes.filter((t) => t.id !== "d"), { uco: true, ocu: false }).missing, [], "no Ocu line to convert, no Ocu model needed");
  assert.deepEqual(rvcPlan(lines, [takes[1], takes[2]], { uco: true, ocu: true }).convert, [], "everything cached: nothing to convert");
});

test("the dispatch payload starts render-worker.yml with string inputs only", () => {
  assert.equal(WORKER_WORKFLOW, "render-worker.yml");
  assert.deepEqual(dispatchPayload({ projectId: EP, jobId: JOB, voice: "rvc" }), { ref: "main", inputs: { episode_id: EP, job_id: JOB, voice: "rvc" } });
  assert.deepEqual(dispatchPayload({ projectId: EP, jobId: JOB, voice: "none" }).inputs.voice, "none");
  assert.throws(() => dispatchPayload({ projectId: "../etc", jobId: JOB, voice: "none" }), /Bad episode/);
  // the workflow declares exactly those inputs and the choice values
  const yml = fs.readFileSync(path.join(ROOT, ".github/workflows/render-worker.yml"), "utf8");
  for (const k of ["episode_id:", "job_id:", "voice:", "options: [none, rvc]"]) assert.ok(yml.includes(k), k);
  assert.ok(!fs.existsSync(path.join(ROOT, ".github/workflows/render.yml")), "one worker, not two");
  assert.ok(!/SUPABASE_SERVICE_ROLE_KEY|SUPABASE_SECRET_KEY/.test(yml), "no Supabase keys in GitHub");
});

test("job states: queued → converting_voice → rendering → done / failed, final states stay final", () => {
  assert.deepEqual([...JOB_STATUSES], ["queued", "converting_voice", "rendering", "done", "failed"]);
  const ok: [string, string][] = [
    ["queued", "converting_voice"],
    ["queued", "rendering"],
    ["converting_voice", "converting_voice"],
    ["converting_voice", "rendering"],
    ["rendering", "rendering"],
    ["rendering", "done"],
    ["queued", "failed"],
    ["converting_voice", "failed"],
    ["rendering", "failed"],
    ["converting_voice", "running"], // render.mts reports "running" = rendering
  ];
  const bad: [string, string][] = [
    ["rendering", "converting_voice"],
    ["done", "rendering"],
    ["failed", "rendering"],
    ["done", "failed"],
    ["queued", "done"],
    ["queued", "queued"],
    ["rendering", "nonsense"],
  ];
  for (const [f, t] of ok) assert.equal(canTransition(f, t), true, `${f} → ${t}`);
  for (const [f, t] of bad) assert.equal(canTransition(f, t), false, `${f} → ${t}`);
  assert.equal(normalizeStatus("running"), "rendering");
  assert.equal(normalizeStatus("bogus"), null);
  for (const s of ["queued", "converting_voice", "rendering", "running"]) assert.equal(isActiveJob(s), true, s);
  for (const s of ["done", "failed", null, undefined]) assert.equal(isActiveJob(s), false, String(s));
});

test("voice models resolve to the PRIVATE recordings bucket, never the public studio-assets bucket", () => {
  for (const who of ["uco", "ocu"] as const) {
    for (const ext of ["pth", "index"] as const) {
      const loc = voiceModelPath(who, ext);
      assert.equal(loc.bucket, "recordings");
      assert.notEqual(loc.bucket, STUDIO_BUCKET);
      assert.equal(loc.path, `studio-assets/voices/${who}-voice.${ext}`);
      assert.equal(isStudioObjectPath(loc.path), true);
      const slot = studioSlot(`${who}-voice-${ext}`)!;
      assert.equal(slot.path, loc.path, "the uploader and the worker agree on the key");
      assert.equal(slot.bucket, "private");
    }
  }
  assert.deepEqual(studioVideoUrls([{ key: "ocu-voice-pth", url: "https://x", updatedAt: 1, originalUrl: null, removeWhite: true }]), { cast: {}, sfx: {} });
  // the worker's model endpoint signs private URLs; it never builds a public studio-assets URL
  const route = fs.readFileSync(path.join(ROOT, "src/app/api/render/[id]/voices/route.ts"), "utf8");
  assert.match(route, /signedUrl\(voiceModelPath\(who, "pth"\)\.path\)/);
  assert.doesNotMatch(route, /publicObjectUrl|STUDIO_BUCKET/);
  // and the render worker path never reaches a TTS provider (Stage A happens only in the booth)
  assert.equal(pathTo("src/app/api/render/[id]/voices/route.ts", [/src\/lib\/voice\/(elevenlabs|gemini|providers)\.ts$/]), null);
});

test("the 50 MB guardrail: Supabase Free's per-file cap, sizes shown in MB", () => {
  assert.equal(SUPABASE_FREE_FILE_LIMIT, 50 * 1024 * 1024);
  assert.equal(mb(57_400_000), "54.7 MB");
});
