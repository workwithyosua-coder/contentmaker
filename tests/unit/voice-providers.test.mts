// Voice providers (Gemini TTS free default, ElevenLabs), pose-driven acting direction, the Own-Voice model slots and
// cached-audio protection. Pure code: no database, no network, no AI. Run: npm run test:unit
import assert from "node:assert/strict";
import { test } from "node:test";
import {
  DEFAULT_PROVIDER,
  GEMINI_VOICES,
  SELECTABLE_PROVIDERS,
  actingDirection,
  actingPose,
  asPreset,
  asProvider,
  geminiPrompt,
  linesToVoice,
  pcmRate,
  pcmToWav,
  routeVoice,
  wavDurationMs,
} from "../../src/lib/voice/acting.ts";
import { MODEL_MAX_BYTES, STUDIO_MAX_BYTES, isStudioObjectPath, maxBytesFor, modelFileOk, studioSlot, studioVideoUrls, acceptFor } from "../../src/lib/studioAssets.ts";
import { pathTo } from "./importGraph.mts";

const L = (o: Record<string, unknown>) => ({ speaker: "uco" as const, text: "Badak Jawa mau dipindah?!", ...o });

test("each pose maps to its Indonesian acting direction", () => {
  const cases: [Record<string, unknown>, RegExp][] = [
    [{ emotion: "angry" }, /cepat, geram, keras.*omelan.*penekanan tajam/],
    [{ speaker: "ocu", emotion: "deadpan" }, /datar, kering.*sarkas deadpan.*ejekan halus/],
    [{ emotion: "defensive" }, /gelagapan dan defensif.*membela diri dengan cepat/],
    [{ speaker: "ocu", emotion: "inspecting" }, /tajam dan menyelidik.*fakta keras/],
    [{ thought_bubble: true, emotion: "angry" }, /pelan dan lirih.*bergumam.*tidak percaya/],
    [{ emotion: "shocked" }, /energi tinggi ala banter komedi/],
    [{ speaker: "ocu", emotion: "explaining" }, /energi tinggi ala banter komedi/],
    [{ speaker: "ocu", emotion: "cta" }, /banter komedi/],
  ];
  for (const [line, rx] of cases) assert.match(actingDirection(L(line)), rx, JSON.stringify(line));
  // the pose comes from a thought first, then the pose, then the expression
  assert.equal(actingPose(L({ thought_bubble: true, emotion: "angry" })), "thought");
  assert.equal(actingPose(L({ emotion: null, expression: "furious" })), "angry");
  assert.equal(actingPose(L({ speaker: "ocu", emotion: null, expression: "calm" })), "deadpan");
});

test("the Angry / Urgent preset adds urgency to every line except muttered inner thoughts", () => {
  assert.match(actingDirection(L({ emotion: "angry" }), "angry"), /naikkan urgensinya: ini darurat/);
  assert.match(actingDirection(L({ speaker: "ocu", emotion: "deadpan" }), "angry"), /mendesak dan urgen/);
  assert.doesNotMatch(actingDirection(L({ emotion: "deadpan" }), "standard"), /urgen/);
  assert.doesNotMatch(actingDirection(L({ thought_bubble: true }), "angry"), /urgen/);
  assert.equal(asPreset("angry"), "angry");
  assert.equal(asPreset("anything"), "standard");
});

test("Gemini gets the line exactly as written (no script rewriting), after a separate acting instruction", () => {
  const text = 'Uco & Ocu: "Ujung Kulon ke Alas Purwo?!" (serius)';
  const prompt = geminiPrompt(L({ text, emotion: "angry" }), "angry", "lebih keras di akhir");
  assert.ok(prompt.endsWith(`\n${text}`), "the line is the last thing, verbatim");
  assert.match(prompt, /Ucapkan persis kalimat ini saja, tanpa menambah atau mengubah kata/);
  assert.match(prompt, /lebih keras di akhir/);
  assert.notEqual(GEMINI_VOICES.uco, GEMINI_VOICES.ocu, "Uco and Ocu sound different");
  assert.deepEqual(GEMINI_VOICES, { uco: "Puck", ocu: "Charon" });
});

test("provider routing: Gemini TTS is the free default; a missing key is a clear message, never a crash", () => {
  assert.equal(DEFAULT_PROVIDER, "gemini_tts");
  assert.equal(asProvider(undefined), "gemini_tts");
  assert.equal(asProvider("elevenlabs"), "elevenlabs");
  assert.deepEqual([...SELECTABLE_PROVIDERS], ["gemini_tts", "elevenlabs", "gemini_tts_rvc"]);
  const env = { geminiKey: false, elevenLabsKey: false, elevenLabsVoices: false };
  assert.deepEqual(routeVoice("gemini_tts", env), { ok: false, message: "GEMINI_API_KEY is not set in environment variables." });
  assert.deepEqual(routeVoice("gemini_tts", { ...env, geminiKey: true }), { ok: true, engine: "gemini" });
  assert.equal(routeVoice("elevenlabs", env).ok, false);
  assert.match((routeVoice("elevenlabs", { ...env, elevenLabsKey: true }) as { message: string }).message, /Clone Uco's and Ocu's voices/);
  assert.deepEqual(routeVoice("elevenlabs", { geminiKey: false, elevenLabsKey: true, elevenLabsVoices: true }), { ok: true, engine: "elevenlabs" });
  assert.equal(routeVoice("gemini_tts_rvc", { geminiKey: true, elevenLabsKey: true, elevenLabsVoices: true }).ok, false, "no models: blocked");
});

test("Gemini's 16-bit PCM becomes a playable WAV with the right header and length", () => {
  const pcm = new Uint8Array(48000); // 1 s at 24 kHz mono 16-bit
  const wav = pcmToWav(pcm, pcmRate("audio/L16;codec=pcm;rate=24000"));
  const v = new DataView(wav.buffer);
  assert.equal(String.fromCharCode(...wav.slice(0, 4)), "RIFF");
  assert.equal(String.fromCharCode(...wav.slice(8, 12)), "WAVE");
  assert.equal(v.getUint16(22, true), 1, "mono");
  assert.equal(v.getUint32(24, true), 24000);
  assert.equal(v.getUint32(40, true), 48000);
  assert.equal(wav.byteLength, 44 + 48000);
  assert.equal(wavDurationMs(wav), 1000);
  assert.equal(pcmRate(null), 24000);
});

test("Own-Voice model slots: the four keys are allowed, anything else is rejected", () => {
  const keys = ["studio-assets/voices/uco-voice.pth", "studio-assets/voices/uco-voice.index", "studio-assets/voices/ocu-voice.pth", "studio-assets/voices/ocu-voice.index"];
  for (const k of keys) assert.equal(isStudioObjectPath(k), true, k);
  for (const bad of [
    "studio-assets/voices/evil.pth",
    "studio-assets/voices/uco-voice.pth.exe",
    "studio-assets/voices/../uco-voice.pth",
    "voices/uco-voice.pth",
    "studio-assets/voices/uco-voice.PTH",
    "studio-assets/voices/uco-voice.ckpt",
    "studio-assets/voices/",
  ]) {
    assert.equal(isStudioObjectPath(bad), false, bad);
  }
  const pth = studioSlot("uco-voice-pth")!;
  const idx = studioSlot("ocu-voice-index")!;
  assert.equal(pth.bucket, "private", "voice models are never public");
  assert.equal(acceptFor(pth), ".pth");
  assert.equal(modelFileOk(pth, "uco_e300.pth"), true);
  assert.equal(modelFileOk(pth, "uco.index"), false);
  assert.equal(modelFileOk(idx, "added_IVF256_Flat.index"), true);
  assert.equal(maxBytesFor(pth), 100 * 1024 * 1024);
  assert.equal(MODEL_MAX_BYTES, 100 * 1024 * 1024);
  assert.equal(maxBytesFor(studioSlot("uco-angry-closed")!), STUDIO_MAX_BYTES);
  assert.deepEqual(studioVideoUrls([{ key: "uco-voice-pth", url: "https://x/y", updatedAt: 1, originalUrl: null, removeWhite: true }]), { cast: {}, sfx: {} }, "models never reach the video's asset map");
});

test("lines with cached audio are never voiced again, whatever changed (cues, style, BGM, provider)", () => {
  const lines = [0, 1, 2, 3].map((index) => ({ index, speaker: "uco", text: `l${index}` }));
  const cached = new Set([0, 2]);
  assert.deepEqual(linesToVoice(lines, (i) => cached.has(i), "missing").map((l) => l.index), [1, 3]);
  assert.deepEqual(linesToVoice(lines, () => true, "missing"), [], "a fully voiced episode generates nothing");
  assert.deepEqual(linesToVoice(lines, () => true, "line", 2).map((l) => l.index), [2], "only an explicit redo makes a new take");
  // editing cues, poses, props, style, BGM, Studio Assets or the voice choice, and rendering, never reach a TTS provider
  const TTS = [/src\/lib\/voice\/(elevenlabs|gemini|providers|profiles)\.ts$/];
  for (const entry of [
    "src/app/create/studio-actions.ts",
    "src/app/create/voice-actions.ts",
    "src/app/create/publish-actions.ts",
    "src/app/studio-asset-actions.ts",
    "src/app/api/render/[id]/route.ts",
    "src/lib/render.ts",
    "video/render.mts",
  ]) {
    assert.equal(pathTo(entry, TTS), null, `${entry} reaches TTS via ${pathTo(entry, TTS)?.join(" → ")}`);
  }
  assert.ok(pathTo("src/app/create/[id]/record/ai-actions.ts", TTS), "the booth's AI action is the one way in");
});
