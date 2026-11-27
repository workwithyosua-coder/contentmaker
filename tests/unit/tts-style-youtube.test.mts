// Regression tests for the first live Tier-1 render: (1) Gemini TTS must speak ONLY the line (acting cues in
// speechMetadata.style, never in the text), (2) scheduled episodes render in Koran Kinetik, never the 2D Vertical
// Comic, (3) YouTube uploads survive transient network errors without ever posting twice.
// Pure code: no database, no network, no AI. Run: npm run test:unit
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { test } from "node:test";
import { INSTRUCTION_IN_TEXT, assertSpokenOnly, geminiSpeech, ttsRequestBody } from "../../src/lib/voice/acting.ts";
import { edgeJobs } from "../../src/lib/voice/edge.ts";
import { DEFAULT_RULE, DEFAULT_VISUAL_STYLE, FORMATS, FORMAT_IDS, SCHEDULE_STYLES, normalizeRule } from "../../src/lib/scheduler.ts";
import { describeFetchError, fetchRetry, isTransient, youtubeUpload } from "../../src/lib/publish/youtubeUpload.ts";
import { ROOT } from "./importGraph.mts";

const read = (f: string) => fs.readFileSync(path.join(ROOT, f), "utf8");
const BANNED = /Bacakan|Ucapkan persis|tanpa menambah|style:/i;

// ------------------------------------------------------------------ 1. TTS: verbatim text, style in speechMetadata
test("Gemini TTS gets the verbatim line in parts[0].text and the acting cue only in parts[0].speechMetadata.style", () => {
  const line = { speaker: "uco" as const, text: "Uco & Ocu bilang: follow @uco.ocu!", emotion: "triumphant", thought_bubble: false };
  const { text, style } = geminiSpeech(line, "standard");
  assert.equal(text, "Ucho dan Ochu bilang: follow Ucho Ochu!", "the line only, phonetic fixes applied (Gemini says Ucho, not Uko)");
  assert.doesNotMatch(text, BANNED);
  assert.equal(style, 'Cocky, hyped, loud and animated Jakartan guy, grinning through every word, showing off; natural, conversational Indonesian speaking speed, expressive and witty in tone, not rushed or rapid-fire; say the names "Uco Ocu" the Indonesian way, "OO-cho OH-chu" (c as in "ch", never "k"), both names distinct', "natural speed, the handle gets clear diction");
  const body = ttsRequestBody(text, style, "uco");
  assert.deepEqual(body.contents, [{ role: "user", parts: [{ text, speechMetadata: { style } }] }]);
  assert.equal(body.generationConfig.speechConfig.voiceConfig.prebuiltVoiceConfig.voiceName, "Puck");
  assert.deepEqual(body.generationConfig.responseModalities, ["AUDIO"]);
  // poses, presets and booth notes only ever change the style
  const ocu = geminiSpeech({ speaker: "ocu", text: "Satu tsunami, habis semua.", emotion: "deadpan" }, "angry", "lebih keras di akhir");
  assert.equal(ocu.text, "Satu tsunami, habis semua.");
  assert.equal(ocu.style, "Razor-sharp deadpan sarcasm, a dry eye-roll in the voice, flat and unimpressed best friend; natural, conversational Indonesian speaking speed, expressive and witty in tone, not rushed or rapid-fire; crisp and steady, clear enunciation, no drawn-out pauses or stretched syllables; urgent, pressing; lebih keras di akhir");
  assert.match(geminiSpeech({ speaker: "uco", text: "Hmm.", thought_bubble: true }, "angry").style, /^Sheepish, quiet mutter[^;]*$/, "Uco's thought stays a sheepish mutter, not urgent");
  assert.match(geminiSpeech({ speaker: "uco", text: "Gila!", emotion: "angry" }).style, /Genuinely panicked and furious, high-pitched/);
  assert.equal(ttsRequestBody("Halo", "x", "ocu").generationConfig.speechConfig.voiceConfig.prebuiltVoiceConfig.voiceName, "Charon");
  assert.throws(() => ttsRequestBody("Halo", "  ", "uco"), /needs a delivery style/);
});

test("runtime guard: instruction text is never sent to Gemini TTS or Edge TTS", () => {
  for (const bad of [
    "Bacakan dalam bahasa Indonesia gaul Jakarta dengan gaya cepat. Ucapkan persis kalimat ini saja, tanpa menambah atau mengubah kata:\nHalo",
    "Ucapkan persis kalimat ini: Halo",
    "tanpa menambah atau mengubah kata: Halo",
    "style: deadpan | Halo",
  ]) {
    assert.match(bad, INSTRUCTION_IN_TEXT);
    assert.throws(() => assertSpokenOnly(bad), /Refusing to send acting instructions/);
    assert.throws(() => ttsRequestBody(bad, "Deadpan", "ocu"), /Refusing/);
  }
  // ordinary dialogue passes, including words like "baca" or "ucap"
  for (const ok of ["Gue baca beritanya tadi pagi.", "Ucapin makasih dulu dong!", "Lo bacain dong, Co."]) assert.equal(assertSpokenOnly(ok), ok);
  // Edge TTS gets the same clean line
  const jobs = edgeJobs([{ index: 0, speaker: "uco", text: "Uco & Ocu, follow @uco.ocu", emotion: "shocked" }], () => false);
  assert.equal(jobs[0].text, "Uco dan Ocu, follow Uco Ocu");
  assert.throws(() => edgeJobs([{ index: 0, speaker: "uco", text: "Ucapkan persis kalimat ini: halo" }], () => false), /Refusing/);
  // the code paths: the old prompt builder is gone; Gemini goes through the body builder on /v1beta; Edge is guarded
  const acting = read("src/lib/voice/acting.ts");
  assert.doesNotMatch(acting, /Bacakan dalam|Ucapkan persis kalimat/, "no instruction template left to prepend");
  assert.doesNotMatch(read("src/lib/voice/providers.ts"), /geminiPrompt/);
  assert.match(read("src/lib/voice/providers.ts"), /const \{ text, style \} = geminiSpeech\(p\.line, p\.preset, p\.extra\);\s*const \{ wav, originalMs, keptMs, payload, tail \} = await speakGeminiTake\(text, style, p\.line\.speaker\);/);
  const tts = read("src/lib/voice/gemini.ts");
  assert.match(tts, /"https:\/\/generativelanguage\.googleapis\.com\/v1beta"/);
  assert.match(tts, /const body = JSON\.stringify\(ttsRequestBody\(text, style, speaker\)\);/);
  assert.match(tts, /fetch\(`\$\{API\(\)\}\/models\/\$\{model\}:generateContent`, \{[\s\S]*?body,/);
  assert.match(read("video/edge-stage.mts"), /text: assertSpokenOnly\(j\.text\)/);
});

// ------------------------------------------------------------------ 2. Koran Kinetik by default
test("scheduled episodes render in Koran Kinetik by default, never the 2D Vertical Comic", () => {
  assert.equal(DEFAULT_VISUAL_STYLE, "editorial-paper-cutout");
  assert.deepEqual(SCHEDULE_STYLES.map((s) => [s.id, s.label]), [["editorial-paper-cutout", "Koran Kinetik"], ["tactical-vector-hud", "Diagram Taktis"]]);
  assert.equal(DEFAULT_RULE.visual_style, "editorial-paper-cutout");
  assert.equal(normalizeRule({}).visual_style, "editorial-paper-cutout");
  for (const bad of ["uco-ocu-2d-comic", "classic", "", null, 7]) assert.equal(normalizeRule({ visual_style: bad }).visual_style, "editorial-paper-cutout", String(bad));
  assert.equal(normalizeRule({ visual_style: "tactical-vector-hud" }).visual_style, "tactical-vector-hud");
  // no format carries its own style any more (Comedy Debate used to mean the 2D comic)
  for (const f of FORMAT_IDS) assert.equal("style" in FORMATS[f], false, f);
  const srv = read("src/lib/scheduler-server.ts");
  assert.doesNotMatch(srv, /uco-ocu-2d-comic|FORMATS\[format\]\.style/);
  assert.match(srv, /\$\{r\.visual_style\}, \$\{r\.voice_provider\},/, "episode creation uses the schedule's style");
  assert.match(srv, /const style = normalizeRule\(rule \?\? DEFAULT_RULE\)\.visual_style;\s*await db\(\)`UPDATE content_projects SET video_style = \$\{style\}/, "and so does the render (older comic drafts too)");
  assert.match(read("db/migrations/020_schedule_visual_style.sql"), /visual_style text NOT NULL DEFAULT 'editorial-paper-cutout'[\s\S]*CHECK \(visual_style IN \('editorial-paper-cutout', 'tactical-vector-hud'\)\)/);
  assert.match(read("src/components/scheduler.tsx"), /<legend className="text-sm font-semibold">Visual style<\/legend>/);
});

// ------------------------------------------------------------------ 3. YouTube
const fetchFailed = (code: string) => Object.assign(new TypeError("fetch failed"), { cause: Object.assign(new Error(code === "ENOTFOUND" ? "getaddrinfo ENOTFOUND www.googleapis.com" : "socket hang up"), { code }) });
const json = (status: number, body: unknown, headers: Record<string, string> = {}) => new Response(JSON.stringify(body), { status, headers });
const META = { title: "Skincare #Shorts", description: "d", tags: [], privacy: "public" };
const BYTES = new Uint8Array(1000);
const noSleep = async () => {};

test("YouTube errors show their real cause instead of a bare 'fetch failed'", () => {
  assert.equal(describeFetchError(fetchFailed("ECONNRESET")), "fetch failed (ECONNRESET: socket hang up)");
  assert.equal(describeFetchError(fetchFailed("ENOTFOUND")), "fetch failed (ENOTFOUND: getaddrinfo ENOTFOUND www.googleapis.com)");
  assert.equal(describeFetchError(new Error("plain")), "plain");
  assert.equal(isTransient(fetchFailed("ECONNRESET")), true);
  assert.equal(isTransient(new Error("YouTube said no")), false);
  assert.match(read("src/lib/publish/engine.ts"), /const message = describeFetchError\(err\);/, "every adapter's thrown error (OAuth refresh too)");
});

test("transient network errors are retried up to 3 times with backoff; HTTP answers are not", async () => {
  const waits: number[] = [];
  let n = 0;
  const flaky = async () => {
    if (++n < 3) throw fetchFailed("ECONNRESET");
    return json(200, { ok: true });
  };
  const r = await fetchRetry("https://x", {}, { fetchImpl: flaky, sleep: async (ms) => void waits.push(ms) });
  assert.equal(r.status, 200);
  assert.deepEqual(waits, [1000, 2000]);
  n = 0;
  await assert.rejects(fetchRetry("https://x", {}, { fetchImpl: async () => (n++, Promise.reject(fetchFailed("ECONNRESET"))), sleep: noSleep }), /fetch failed/);
  assert.equal(n, 3, "3 tries, then the error");
  n = 0;
  assert.equal((await fetchRetry("https://x", {}, { fetchImpl: async () => (n++, json(401, {})), sleep: noSleep })).status, 401);
  assert.equal(n, 1, "an API answer isn't retried");
});

test("YouTube upload: session saved first, a retry asks it before uploading, a finished upload is never repeated", async () => {
  const calls: string[] = [];
  const net = (handlers: ((url: string, init?: RequestInit) => Response | Promise<Response>)[]) => {
    let i = 0;
    return async (url: string, init?: RequestInit) => {
      calls.push(`${init?.method} ${url.includes("uploadType") ? "start" : "session"}${new Headers(init?.headers).get("content-range") ? " status?" : ""}`);
      return handlers[i++](url, init);
    };
  };
  // 1. open the session (with one dropped connection): nothing uploaded yet, the session URL saved
  const s1 = await youtubeUpload({ token: "t", bytes: BYTES, meta: META, step: {}, sleep: noSleep, fetchImpl: net([() => Promise.reject(fetchFailed("ECONNRESET")), () => json(200, {}, { location: "https://up/session1" })]) });
  assert.deepEqual(s1, { status: "uploading", step: { uploadUrl: "https://up/session1" }, retryInSec: 1 });
  // 2. upload: the session isn't complete yet, the PUT drops once and then lands
  calls.length = 0;
  const s2 = await youtubeUpload({ token: "t", bytes: BYTES, meta: META, step: s1.step, sleep: noSleep, fetchImpl: net([() => new Response(null, { status: 308 }), () => Promise.reject(fetchFailed("ECONNRESET")), () => json(200, { id: "vid123", status: { privacyStatus: "public" } })]) });
  assert.equal(s2.status, "published");
  assert.equal((s2 as { externalUrl: string }).externalUrl, "https://www.youtube.com/shorts/vid123");
  assert.deepEqual(calls, ["PUT session status?", "PUT session", "PUT session"]);
  // 3. the answer was lost 3 times but the video arrived: the status check finds it, no second upload
  calls.length = 0;
  const lost = async () => Promise.reject(fetchFailed("ECONNRESET"));
  const s3 = await youtubeUpload({ token: "t", bytes: BYTES, meta: META, step: { uploadUrl: "https://up/session1" }, sleep: noSleep, fetchImpl: net([() => new Response(null, { status: 308 }), lost, lost, lost, () => json(201, { id: "vid123" })]) });
  assert.equal(s3.status, "published");
  assert.equal((s3 as { externalId: string }).externalId, "vid123");
  // 4. a retry of a publication whose session already completed: published straight away, no bytes sent again
  calls.length = 0;
  const s4 = await youtubeUpload({ token: "t", bytes: BYTES, meta: META, step: { uploadUrl: "https://up/session1" }, sleep: noSleep, fetchImpl: net([() => json(200, { id: "vid123" })]) });
  assert.equal(s4.status, "published");
  assert.deepEqual(calls, ["PUT session status?"], "only the status question");
  // 5. a real failure keeps the session (the retry resumes it) and says why
  const s5 = await youtubeUpload({ token: "t", bytes: BYTES, meta: META, step: { uploadUrl: "https://up/session1" }, sleep: noSleep, fetchImpl: net([() => new Response(null, { status: 308 }), lost, lost, lost, lost, lost, lost]) });
  assert.deepEqual(s5, { status: "failed", step: { uploadUrl: "https://up/session1" }, error: "YouTube upload: fetch failed (ECONNRESET: socket hang up)" });
  // 6. an expired session: a new one is opened (nothing was posted with the old one)
  const s6 = await youtubeUpload({ token: "t", bytes: BYTES, meta: META, step: { uploadUrl: "https://up/old" }, sleep: noSleep, fetchImpl: net([() => json(404, {})]) });
  assert.equal(s6.status, "uploading");
  assert.deepEqual(s6.step, {});
});

test("a retry re-queues only failed platforms and keeps the YouTube session; published ones are never posted again", () => {
  const engine = read("src/lib/publish/engine.ts");
  assert.match(engine, /WHERE episode_publications\.status \$\{p\.onlyFailed \? sql`= 'failed'` : sql`IN \('failed', 'idle', 'queued'\)`\}/, "published / uploading rows are never re-queued");
  assert.match(engine, /step = CASE WHEN episode_publications\.step \? 'uploadUrl' THEN jsonb_build_object\('uploadUrl', episode_publications\.step -> 'uploadUrl'\) ELSE '\{\}'::jsonb END/);
  assert.match(read("src/lib/publish/adapters.ts"), /return youtubeUpload\(\{/);
});
