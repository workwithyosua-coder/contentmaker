// Regression tests from the natural-pacing review of a live Koran Kinetik render: comedic gaps between lines (no rush),
// natural speaking speed, the whoosh only on major visual shifts with SFX under the dialogue, and the generated-prop
// chain end to end (payload, image extraction, the inline hand-off that replaced the JPEG-refusing bucket, the
// propWarning, and the props reaching Koran Kinetik). Pure code: no database, no network, no AI.
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { test } from "node:test";
import { GAPS } from "../../video/src/audioChain.ts";
import { propFile, registerRemoteAssets, resetRemoteAssets } from "../../video/src/assets/index.ts";
import { buildBeats, type EpisodeLine } from "../../video/src/beats.ts";
import { parseDirection } from "../../video/src/direction.ts";
import { FPS, naturalGap, timeline } from "../../video/src/types.ts";
import { extractImage, imageRequestBody } from "../../src/lib/gemini-core.ts";
import { showDirection, showBiblePrompt } from "../../src/lib/showBible.ts";
import { NATURAL_PACE, geminiSpeech } from "../../src/lib/voice/acting.ts";
import { ROOT } from "./importGraph.mts";

const read = (f: string) => fs.readFileSync(path.join(ROOT, f), "utf8");
type L = Partial<EpisodeLine> & { speaker: "uco" | "ocu"; layout?: string; emotion?: string | null };
const line = (o: L, i: number) => ({ index: i, beat: "escalation", text: "x", subtitle: "", expression: "calm", thought_bubble: false, hasAudio: true, audio: null, frames: 60, envelope: [], start_s: null, ...o }) as EpisodeLine;

// ------------------------------------------------------------------ 1. pacing
test("ping-pong comedy gaps: 0.10 s rapid-fire / snap reactions, 0.22 s standard, 0.38 s drop before a takeover / punchline / outro", () => {
  assert.deepEqual(GAPS, { rapid: 0.1, standard: 0.22, drop: 0.38 });
  const long = "Ini kalimat biasa yang cukup panjang untuk banter standar kita";
  const lines = [
    line({ speaker: "uco", text: long }, 0),
    line({ speaker: "ocu", text: long }, 1), // standard cut
    line({ speaker: "uco", text: "Hah, serius lo?!" }, 2), // rapid-fire interjection (3 words)
    line({ speaker: "ocu", text: long, emotion: "shocked" }, 3), // a snap reaction
    line({ speaker: "uco", text: long, layout: "takeover" }, 4), // beat drop into a takeover
    line({ speaker: "ocu", text: long, layout: "takeover" }, 5), // takeover to takeover: a standard cut
    line({ speaker: "uco", text: long, thought_bubble: true }, 6), // a thought: standard
    line({ speaker: "ocu", text: long }, 7), // the final punchline (before the CTA): drop
    line({ speaker: "ocu", text: "Follow @uco.ocu biar nggak ketipu!", emotion: "cta" }, 8), // the outro: drop
  ];
  const gaps = lines.slice(1).map((_, k) => naturalGap(lines, k + 1) / FPS);
  assert.deepEqual(gaps.map((g) => Math.round(g * 100) / 100), [0.23, 0.1, 0.1, 0.37, 0.23, 0.23, 0.37, 0.37]);
  // the timeline uses them only with "Pacing: natural" (scheduled episodes); other scripts keep their timing
  const d = parseDirection(showDirection());
  assert.equal(d.naturalPacing, true);
  const { starts } = timeline(lines, d);
  assert.equal(starts[1] - (starts[0] + 60), 7);
  assert.equal(starts[2] - (starts[1] + 60), 3);
  assert.equal(starts[4] - (starts[3] + 60), 11);
  assert.notDeepEqual(timeline(lines, parseDirection("")).starts, starts);
});

test("natural speaking speed: energy in the tone, never in speed; shorter lines instead of faster audio", () => {
  for (const sp of ["uco", "ocu"] as const) {
    const s = geminiSpeech({ speaker: sp, text: "Gue bilang ini investasi!", emotion: sp === "uco" ? "angry" : "deadpan" }).style;
    assert.ok(s.includes(NATURAL_PACE), s);
    assert.doesNotMatch(s, /fast|brisk|rapid-fire pace|fast-paced/i, s.replace(NATURAL_PACE, ""));
  }
  assert.match(NATURAL_PACE, /natural, conversational Indonesian speaking speed.*not rushed or rapid-fire/);
  assert.ok(!geminiSpeech({ speaker: "uco", text: "Hmm.", thought_bubble: true }).style.includes(NATURAL_PACE), "a muttered thought keeps its own pace");
  // the renderer no longer speeds Gemini / Edge takes up (only ElevenLabs, source "ai")
  assert.match(read("video/render.mts"), /source === "ai" \? \(AI_SPEED\[speaker\] \?\? 1\)/);
  assert.match(read("src/lib/voice/edge.ts"), /return "ai_gemini";/);
  const prompt = showBiblePrompt({ format: "koran_kinetik", label: "Koran Kinetik", brief: "b", seed: "Begadang", bankProps: "" });
  assert.match(prompt, /Baris biasa 8-13 kata, padat dan nendang; interjeksi kilat 3-7 kata/);
  assert.match(prompt, /"nge-hang", "eror"/);
  assert.match(prompt, /Minimal 75% baris punya sesuatu di layar/);
  assert.match(prompt, /termasuk baris inspecting/);
  assert.match(prompt, /Baris thought hanya memakai prop kalau objek itu memang yang sedang dipikirkan/);
});

// ------------------------------------------------------------------ 2. SFX: see audio-layout-fixes.test.mts (stamp / pop only)

// ------------------------------------------------------------------ 3. generated props
test("the image request: refs as valid base64 inlineData, then the prompt, IMAGE output on /v1beta", () => {
  const png = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1, 2, 3]);
  const body = imageRequestBody("A serum bottle", [{ mime: "image/png", data: png }]);
  assert.deepEqual(body.contents[0].parts[0], { inlineData: { mimeType: "image/png", data: png.toString("base64") } });
  assert.equal(Buffer.from((body.contents[0].parts[0] as { inlineData: { data: string } }).inlineData.data, "base64").subarray(0, 4).toString("hex"), "89504e47");
  assert.deepEqual(body.contents[0].parts.at(-1), { text: "A serum bottle" });
  assert.deepEqual(body.generationConfig.responseModalities, ["IMAGE"]);
  assert.match(read("src/lib/gemini-text.ts"), /fetch\(`\$\{API\(\)\}\/models\/\$\{model\}:generateContent`, \{[\s\S]*?body: JSON\.stringify\(imageRequestBody\(prompt, refs\)\)/);
  assert.match(read("src/lib/gemini-text.ts"), /"https:\/\/generativelanguage\.googleapis\.com\/v1beta"/);
});

test("the image is extracted from the answer whatever comes before it; no image says why", () => {
  const jpeg = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 9]).toString("base64");
  const got = extractImage({ candidates: [{ content: { parts: [{ text: "Here is your prop." }, { inlineData: { mimeType: "image/jpeg", data: jpeg } }] } }] });
  assert.ok("data" in got && got.mime === "image/jpeg" && got.data.toString("base64") === jpeg);
  assert.deepEqual(extractImage({ candidates: [{ content: { parts: [{ text: "I can't draw that." }] }, finishReason: "STOP" }] }), { error: 'no image came back (STOP): "I can\'t draw that."' });
  assert.deepEqual(extractImage({ promptFeedback: { blockReason: "SAFETY" } }), { error: "no image came back (SAFETY)" });
});

test("the generated image goes straight to the worker (no JPEG-refusing bucket); failures are loud and leave a propWarning", () => {
  const srv = read("src/lib/scheduler-server.ts");
  const gen = srv.slice(srv.indexOf("export async function propGenerate"), srv.indexOf("export async function propUpload"));
  assert.doesNotMatch(gen, /putObject|props-raw/, "no raw upload to the private bucket (it refused image/jpeg on the live run)");
  assert.match(gen, /return \{ ok: true, data: img\.data\.toString\("base64"\), mime: img\.mime, model: img\.model \};/);
  const stage = read("video/prop-stage.mts");
  assert.match(stage, /writeFileSync\(raw, Buffer\.from\(g\.data, "base64"\)\);/);
  assert.match(stage, /p\.log\(`prop \$\{prop\.name\}: FAILED, dropped to none: \$\{g\.error\}`\);/, "the exact reason in the produce log");
  assert.match(srv, /const propWarning = propWarningFor\(props\);/);
  assert.match(read("src/components/scheduler.tsx"), /\{s\.handoff\?\.propWarning && \(/, "and on the slot card");
});

test("propWarning: a short summary of the failed props (null when none failed)", async () => {
  // propWarningFor lives in the server module; its logic, mirrored here, is checked against the source
  const src = read("src/lib/scheduler-server.ts");
  assert.match(src, /return `\$\{failed\.length\} of \$\{props\.length\} prop\$\{props\.length > 1 \? "s" : ""\} failed: \$\{\(failed\[0\]\.error \?\? "unknown error"\)\.slice\(0, 200\)\}`;/);
  assert.match(src, /if \(!failed\.length\) return null;/);
});

test("generated props reach Koran Kinetik: the render manifest's assetUrls.props, registered by render.mts, resolved by name", () => {
  // the app lists every uploaded prop (custom-assets bucket, where the worker uploads generated ones) for the render
  assert.match(read("src/app/api/render/[id]/route.ts"), /const assetUrls = await videoAssetUrls\(/);
  assert.match(read("src/lib/render-manifest.ts"), /    assetUrls,\n/);
  assert.match(read("src/lib/studio-assets.ts"), /return \{ props: attached\.props, sfx/);
  assert.match(read("video/render.mts"), /registerRemoteAssets\(/);
  // a generated prop's name on a beat resolves to its Supabase URL
  resetRemoteAssets();
  registerRemoteAssets({ props: { "cangkir-kopi-begadang-790859": "https://x.supabase.co/storage/v1/object/public/custom-assets/props/cangkir-kopi-begadang-790859.png" } });
  assert.equal(propFile("cangkir-kopi-begadang-790859"), "https://x.supabase.co/storage/v1/object/public/custom-assets/props/cangkir-kopi-begadang-790859.png");
  const beats = buildBeats([line({ speaker: "ocu", emotion: "inspecting", prop_tag: "cangkir-kopi-begadang-790859" } as never, 0)], { exact: true } as never);
  assert.equal(beats[0].propImage, "cangkir-kopi-begadang-790859");
  resetRemoteAssets();
});
