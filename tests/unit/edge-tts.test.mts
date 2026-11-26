// Edge TTS in the scheduler worker: character + pose prosody, routing (Own Voice never calls Gemini TTS; Gemini TTS
// falls back to Edge TTS on 429), cached-audio protection, the take marks RVC and the renderer read, and zero
// Anthropic. Pure code: no database, no network, no AI. Run: npm run test:unit
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { test } from "node:test";
import { RVC_BASE_MARK, needsConversion } from "../../src/lib/renderWorker.ts";
import { EDGE_VOICE, edgeJobs, edgeMark, edgeProsody, isEdgeTake, isQuotaError, schedulerVoiceEngine, takeSource } from "../../src/lib/voice/edge.ts";
import { ROOT, pathTo } from "./importGraph.mts";

const P = (speaker: "uco" | "ocu", o: Record<string, unknown> = {}) => {
  const { pose, rate, pitch } = edgeProsody({ speaker, emotion: null, expression: null, thought_bubble: false, ...o });
  return [pose, rate, pitch];
};

test("Uco: faster and higher; hotter when angry / shocked / defensive, softer in thought", () => {
  assert.deepEqual(P("uco", { emotion: "triumphant" }), ["triumphant", "+10%", "+4Hz"]);
  assert.deepEqual(P("uco", { emotion: "phone" }), ["phone", "+10%", "+4Hz"]);
  assert.deepEqual(P("uco"), ["triumphant", "+10%", "+4Hz"], "no pose: Uco's usual");
  for (const pose of ["angry", "shocked", "defensive"]) assert.deepEqual(P("uco", { emotion: pose }), [pose, "+16%", "+8Hz"], pose);
  assert.deepEqual(P("uco", { emotion: null, expression: "furious" }), ["angry", "+16%", "+8Hz"], "from the expression");
  assert.deepEqual(P("uco", { emotion: "angry", thought_bubble: true }), ["thought", "-4%", "-2Hz"], "a thought wins over the pose");
  // poses Uco doesn't have still map: deadpan / explaining / inspecting / cta → Uco's base
  for (const pose of ["deadpan", "explaining", "inspecting", "cta"]) assert.deepEqual(P("uco", { emotion: pose }).slice(1), ["+10%", "+4Hz"], pose);
});

test("Ocu: steadier and deeper; flatter when deadpan / in thought, brighter when explaining / inspecting / cta", () => {
  assert.deepEqual(P("ocu"), ["deadpan", "-2%", "-6Hz"], "no pose: Ocu's usual deadpan");
  assert.deepEqual(P("ocu", { emotion: "deadpan" }), ["deadpan", "-2%", "-6Hz"]);
  assert.deepEqual(P("ocu", { thought_bubble: true, emotion: "explaining" }), ["thought", "-2%", "-6Hz"]);
  for (const pose of ["explaining", "inspecting", "cta"]) assert.deepEqual(P("ocu", { emotion: pose }), [pose, "+8%", "-2Hz"], pose);
  for (const pose of ["angry", "shocked", "defensive", "triumphant"]) assert.deepEqual(P("ocu", { emotion: pose }).slice(1), ["+5%", "-4Hz"], pose);
  // the two stay apart on every pose
  for (const pose of ["angry", "shocked", "defensive", "deadpan", "explaining", "inspecting", "cta"]) {
    assert.notDeepEqual(P("uco", { emotion: pose }).slice(1), P("ocu", { emotion: pose }).slice(1), pose);
  }
  assert.notDeepEqual(P("uco", { thought_bubble: true }).slice(1), P("ocu", { thought_bubble: true }).slice(1));
});

test("routing: Own Voice always uses the worker's Edge TTS; Gemini TTS slots hand over to it on a 429", () => {
  assert.equal(schedulerVoiceEngine("gemini_tts_rvc"), "edge");
  assert.equal(schedulerVoiceEngine("gemini_tts"), "gemini");
  for (const quota of [
    "Gemini TTS: the free Gemini TTS quota is used up for now (Quota exceeded for metric generate_content_free_tier_requests). Try again later.",
    "Gemini 429 (gemini-2.5-flash-preview-tts): RESOURCE_EXHAUSTED",
    "429 Too Many Requests",
    "rate limit reached",
  ]) {
    assert.equal(isQuotaError(quota), true, quota);
  }
  for (const other of ["Gemini TTS: the API key was rejected (403). Check GEMINI_API_KEY.", "GEMINI_API_KEY is not set in environment variables.", "Gemini TTS: no audio came back."]) {
    assert.equal(isQuotaError(other), false, other);
  }
  // the server code: Own Voice returns "edge" before Gemini TTS (voice/providers) is ever loaded; a quota error
  // returns "edge" with a logged note instead of throwing
  const src = fs.readFileSync(path.join(ROOT, "src/lib/scheduler-server.ts"), "utf8");
  const fn = src.slice(src.indexOf("export async function voiceSlot"), src.indexOf("// ------------------------------------------------------------------ step 2b"));
  assert.ok(fn.indexOf('schedulerVoiceEngine(v.provider) === "edge"') < fn.indexOf('import("./voice/providers")'), "Own Voice never reaches Gemini TTS");
  assert.match(fn, /if \(bad && isQuotaError\(bad\.message\)\) \{[\s\S]*?Edge TTS fallback used[\s\S]*?return \{ voiced, remaining: todo\.length - voiced, engine: "edge", note \}/);
  const step = fs.readFileSync(path.join(ROOT, "video/scheduler-step.mts"), "utf8");
  assert.match(step, /if \(v\.engine === "edge"\) \{\s*const e = await edgeStage\(/);
});

test("Edge TTS takes: Own Voice base takes go on to RVC, fallback takes don't, and the renderer doesn't speed them up twice", () => {
  const p = edgeProsody({ speaker: "uco", emotion: "shocked" });
  const base = edgeMark("gemini_tts_rvc", p);
  assert.equal(base, `${RVC_BASE_MARK} edge-tts ${EDGE_VOICE} rate=+16% pitch=+8Hz pose=shocked`);
  assert.equal(needsConversion({ source: "ai", ai_prompt: base }), true, "Stage B converts it");
  const fallback = edgeMark("gemini_tts", p);
  assert.match(fallback, /^\[edge_tts\] edge-tts id-ID-ArdiNeural/);
  assert.equal(needsConversion({ source: "ai", ai_prompt: fallback }), false);
  assert.equal(needsConversion({ source: "ai", ai_prompt: "[rvc] converted from x (edge-tts)" }), false, "converted once only");
  assert.equal(isEdgeTake("[rvc] converted from x (edge-tts)"), true);
  assert.equal(takeSource("ai", base), "ai_edge");
  assert.equal(takeSource("ai", "[rvc] converted from x (edge-tts)"), "ai_edge");
  assert.equal(takeSource("ai", "[gemini_tts] …"), "ai", "Gemini takes keep the renderer's AI pacing");
  assert.equal(takeSource("booth", null), "booth");
  // render.mts speeds up only source === "ai"
  assert.match(fs.readFileSync(path.join(ROOT, "video/render.mts"), "utf8"), /source === "ai" \? \(AI_SPEED\[speaker\] \?\? 1\)/);
});

test("cached audio is never voiced again; the voice reads the phonetic text, the script keeps its own", () => {
  const lines = [
    { index: 0, speaker: "uco" as const, text: "Uco & Ocu: skincare mahal itu investasi!", emotion: "triumphant" },
    { index: 1, speaker: "ocu" as const, text: "Investasi apa, Co?", emotion: "deadpan" },
    { index: 2, speaker: "uco" as const, text: "Investasi wajah!", emotion: "defensive" },
    { index: 3, speaker: "ocu" as const, text: "   ", emotion: "explaining" },
  ];
  const cached = new Set([1]);
  const jobs = edgeJobs(lines, (i) => cached.has(i));
  assert.deepEqual(jobs.map((j) => j.lineIndex), [0, 2], "the cached line and a blank one are skipped");
  assert.equal(jobs[0].text, "U-co dan Ocu: skincare mahal itu investasi!");
  assert.equal(lines[0].text, "Uco & Ocu: skincare mahal itu investasi!", "the stored line is untouched");
  assert.deepEqual([jobs[0].leadIn, jobs[1].leadIn], [true, false], "only Beat 1 keeps the lead-in pad");
  assert.deepEqual([jobs[1].rate, jobs[1].pitch], ["+16%", "+8Hz"]);
  assert.deepEqual(edgeJobs(lines.slice(0, 3), () => true), [], "a fully voiced episode makes no request");
  // the worker's upload is refused for a line that got a take meanwhile, and registering never replaces one
  const src = fs.readFileSync(path.join(ROOT, "src/lib/scheduler-server.ts"), "utf8");
  assert.match(src, /if \(booth\.recorded\[lineIndex\]\) return \{ skip: true \};/);
  assert.match(src, /if \(has\.n\) return; \/\/ cached audio wins/);
});

test("the Edge TTS path never reaches the Anthropic API, Gemini TTS, or a new secret", () => {
  const AI = [/src\/lib\/agents\//, /@anthropic-ai\//, /^anthropic$/];
  const TTS = [/src\/lib\/voice\/(elevenlabs|gemini|providers|profiles)\.ts$/];
  for (const entry of ["src/lib/voice/edge.ts", "video/edge-stage.mts", "video/scheduler-step.mts", "src/app/api/render/[id]/route.ts"]) {
    assert.equal(pathTo(entry, AI), null, `${entry} → AI via ${pathTo(entry, AI)?.join(" → ")}`);
    assert.equal(pathTo(entry, TTS), null, `${entry} → TTS via ${pathTo(entry, TTS)?.join(" → ")}`);
  }
  const py = fs.readFileSync(path.join(ROOT, "scripts/edge_tts_worker.py"), "utf8");
  assert.match(py, /edge_tts\.Communicate\(\s*job\["text"\],\s*job\.get\("voice", "id-ID-ArdiNeural"\),\s*rate=job\["rate"\],\s*pitch=job\["pitch"\]/);
  assert.doesNotMatch(py, /anthropic|api_key|API_KEY/i);
  assert.match(fs.readFileSync(path.join(ROOT, "worker/edge/requirements.txt"), "utf8"), /^edge-tts>=7\.3\.1$/m);
  const wf = fs.readFileSync(path.join(ROOT, ".github/workflows/autonomous-scheduler.yml"), "utf8");
  assert.deepEqual([...new Set([...wf.matchAll(/secrets\.(\w+)/g)].map((m) => m[1]))], ["RENDER_TOKEN"], "no new secret");
  // ffmpeg, Python and edge-tts are ready before voicing runs
  const at = (s: string) => wf.indexOf(s);
  assert.ok(at("name: Install ffmpeg") < at("name: Script and voices"));
  assert.ok(at("name: Install Edge TTS") < at("name: Script and voices"));
  assert.ok(at("actions/setup-python") < at("name: Script and voices"));
  assert.match(wf, /EDGE_PYTHON="\$HOME\/\.venv-edge\/bin\/python" npx tsx scheduler-step\.mts prepare/);
});
