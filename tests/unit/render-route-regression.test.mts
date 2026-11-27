// Regression tests for the failed render of episode 9ac3a9ba (run 45943556232, right after #59 went live): the
// manifest GET answered an empty 500 and the worker's failure report a 400 that curl -f swallowed. The manifest and
// the job report are pure functions now (src/lib/render-manifest.ts), checked here on pre-#59 payloads and on the exact
// JSON render-worker.yml sends. No database, no network.
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { test } from "node:test";
import { buildBeats, type EpisodeLine } from "../../video/src/beats.ts";
import { parseDirection } from "../../video/src/direction.ts";
import { parseJobReport, renderManifest } from "../../src/lib/render-manifest.ts";
import { ROOT } from "./importGraph.mts";

const read = (f: string) => fs.readFileSync(path.join(ROOT, f), "utf8");

/** Lines as an episode saved before #59 stored them (the 9ac3a9ba script's shape): long stat sublines, explainer
 *  cards without a named concept, a thought, the spelled-out CTA, old keys only. */
const LEGACY_LINES = [
  { beat: "hook", speaker: "uco", text: "Gue udah sebar seratus lamaran, kenapa belum ada yang manggil?", subtitle: "I've sent a hundred applications, why has nobody called?", emotion: "angry", expression: "angry", prop_tag: "cv-setumpuk-9ac3a9", kinetic_text: "RATUSAN CV DITOLAK", sfx: ["stamp", "whoosh"], camera_shot: "solo-uco", thought_bubble: false },
  { beat: "escalation", speaker: "ocu", text: "Data resmi nyatet hampir sepuluh juta anak muda nganggur.", subtitle: "Official data counts almost ten million idle youths.", emotion: "explaining", layout: "takeover", stat: "9,9 JUTA | GEN Z USIA 15-24 TAHUN BERSTATUS NEET DI INDONESIA", prop_tag: "none", camera_shot: "solo-ocu", thought_bubble: false },
  { beat: "insight", speaker: "ocu", text: "Kampus ngajarin teori lawas, sementara kantor nyari skill beda.", subtitle: "Campuses teach old theory while offices want other skills.", emotion: "explaining", overlay: "brain-badge", prop_tag: "none", camera_shot: "solo-ocu", thought_bubble: false },
  { beat: "insight", speaker: "ocu", text: "Dunia udah berubah, lo nggak bisa ngandelin IPK doang.", subtitle: "The world changed.", emotion: "explaining", overlay: "wave-graph", kinetic_text: "SKILL DI ATAS IPK", camera_shot: "solo-ocu", thought_bubble: false },
  { beat: "twist", speaker: "uco", text: "Kalau gini caranya mending gue buka kursus tips nganggur.", subtitle: "", emotion: "defensive", thought_bubble: true, prop_tag: "ijazah-gulung-9ac3a9" },
  { beat: "button", speaker: "ocu", text: "Biar nggak bebal kayak Uco, langsung follow akun uco titik ocu!", subtitle: "Follow uco dot ocu right now!", emotion: "cta", kinetic_text: "FOLLOW @UCO.OCU", prop_tag: "none", thought_bubble: false },
];
/** The selected takes as they were stored: RVC conversions of Gemini and of Edge takes, and an ElevenLabs take. */
const LEGACY_TAKES = [
  { line_index: 0, source: "ai", ai_prompt: "[rvc] converted from 3be9ac67-fee6-4d87-a673-0e6ec585d47b" },
  { line_index: 1, source: "ai", ai_prompt: "[rvc] converted from 7a46d565-5d32-472a-87e3-0bd547226c9b (edge-tts id-ID-ArdiNeural rate=+3% pitch=-2Hz pose=explaining)" },
  { line_index: 2, source: "ai", ai_prompt: "[gemini_tts_rvc:base] edge-tts id-ID-ArdiNeural rate=+0% pitch=-4Hz pose=explaining" },
  { line_index: 3, source: "ai", ai_prompt: "[gemini_tts] Puck: Energetic Jakartan Indonesian comedy banter" },
  { line_index: 4, source: "ai", ai_prompt: null },
  { line_index: 5, source: "booth", ai_prompt: null },
];
const SRC = {
  project: { id: "9ac3a9ba-d4b1-4bf9-b251-c9e128d4c12b", title: "Jutaan Gen Z Nganggur Gegara Skill Mismatch", video_style: "editorial-paper-cutout" },
  script: { id: "ac4ce82a-6f3d-40d0-81c7-05e07b495143", title: null, version: 1, target_duration_s: null, direction: "CTA: FOLLOW @UCO.OCU\nBGM: urgent\nBGM volume: 20%\nBGM off on thought\nPacing: natural", custom: true, lines: LEGACY_LINES },
  takes: LEGACY_TAKES,
};
const ASSETS = { props: { "cv-setumpuk-9ac3a9": "https://x/props/cv.png" }, sfx: { "bgm-urgent": "https://x/studio/bgm-urgent.mp3" }, cast: {} };

test("GET /api/render/:id builds the manifest for a pre-#59 episode: legacy stat cards, card labels, cached takes", () => {
  const m = renderManifest(SRC, ASSETS);
  // it's what the route answers: plain JSON, every line passed through untouched with its audio flags
  const json = JSON.parse(JSON.stringify(m));
  assert.equal(json.videoStyle, "editorial-paper-cutout");
  assert.equal(json.title, "Jutaan Gen Z Nganggur Gegara Skill Mismatch");
  assert.equal(json.lines.length, LEGACY_LINES.length);
  assert.equal(json.lines[1].stat, LEGACY_LINES[1].stat, "the stored stat card is never rewritten by the app");
  assert.deepEqual(json.lines.map((l: { hasAudio: boolean }) => l.hasAudio), [true, true, true, true, true, true]);
  assert.deepEqual(json.lines.map((l: { audioSource: string }) => l.audioSource), ["ai_gemini", "ai_edge", "ai_edge", "ai_gemini", "ai", "booth"]);
  assert.deepEqual(json.assetUrls, ASSETS);
  // and the renderer animates it with the #59 code: whole-word stat card, FAKTA / DATA labels, the clean handle
  const lines = json.lines.map((l: Record<string, unknown>) => ({ ...l, hasAudio: false, audio: null, frames: 90, envelope: [] })) as EpisodeLine[];
  const beats = buildBeats(lines, { ...parseDirection(json.direction), exact: true });
  assert.deepEqual(beats[1].stat, { headline: "9,9 JUTA", subline: "GEN Z USIA 15-24 TAHUN BERSTATUS NEET DI INDONESIA" });
  assert.equal(beats[2].overlay?.graphic, false);
  assert.equal(beats[3].overlay?.graphic, false);
  assert.equal(beats[5].subtitleEn, "Follow @uco.ocu right now!");
});

test("a broken or empty stored script never crashes the manifest", () => {
  for (const lines of [null, undefined, {}, "[]", 42]) {
    const m = renderManifest({ ...SRC, script: { ...SRC.script, lines } }, ASSETS);
    assert.deepEqual(m.lines, []);
  }
  const m = renderManifest({ ...SRC, project: { ...SRC.project, video_style: null }, takes: [] }, { props: {}, sfx: {} });
  assert.equal(m.lines.every((l) => !l.hasAudio && l.audioSource === null), true);
  assert.ok(m.videoStyle);
});

test("the manifest route answers every failure with a readable JSON error (logged with its stack), never an empty 500", () => {
  const route = read("src/app/api/render/[id]/route.ts");
  assert.match(route, /try \{\s*src = await renderSource\(id\);\s*\} catch \(err\) \{[\s\S]*?serverError\(`render manifest \$\{id\}: loading the episode`, err, 503\)/);
  assert.match(route, /return Response\.json\(renderManifest\(src, assetUrls\)\);\s*\} catch \(err\) \{\s*return serverError\(`render manifest \$\{id\}`, err\);/);
  const helper = read("src/lib/render-manifest.ts");
  assert.match(helper, /console\.error\(`\[\$\{where\}\]`, err instanceof Error \? err\.stack \?\? message : message\);/);
  assert.match(helper, /return Response\.json\(\{ error: `\$\{where\}: \$\{message\}` \}, \{ status \}\);/);
  // the worker prints the body and retries a 5xx for about a minute
  const worker = read("video/render.mts");
  assert.match(worker, /\$\{body \|\| "\(empty body\)"\}/);
  assert.match(worker, /if \(attempt >= 6 \|\| \(err as \{ final\?: boolean \}\)\.final\) throw err;/);
});

/** The -d payload of a render-worker.yml step, with the step's shell variables filled in (as bash would). */
function workflowPayload(step: string, vars: Record<string, string>): unknown {
  const yml = read(".github/workflows/render-worker.yml");
  const block = yml.slice(yml.indexOf(`- name: ${step}`));
  const raw = /-d "((?:[^"\\]|\\.)*)"/.exec(block)![1];
  const expanded = raw.replace(/\\"/g, '"').replace(/\$([A-Z_]+)/g, (_, v: string) => vars[v] ?? "");
  return JSON.parse(expanded);
}
const VARS = { JOB_ID: "35466b9b-46d9-4866-b662-50badf296423", RUN_URL: "https://github.com/workwithyosua-coder/contentmaker/actions/runs/45943556232", STATUS: "rendering", STAGE: "Setting up the renderer" };

test("POST /api/render/:id/job accepts the exact failure report render-worker.yml sends (and its started / done reports)", () => {
  const failure = workflowPayload("Report failure", VARS);
  assert.deepEqual(failure, { jobId: VARS.JOB_ID, status: "failed", error: "The worker failed. Open the run on GitHub for the log.", runUrl: VARS.RUN_URL });
  const r = parseJobReport(failure);
  assert.ok(r.ok);
  assert.deepEqual(r.report, { jobId: VARS.JOB_ID, status: "failed", error: "The worker failed. Open the run on GitHub for the log.", runUrl: VARS.RUN_URL, progress: undefined, stage: undefined });
  for (const status of ["rendering", "converting_voice"]) {
    const started = parseJobReport(workflowPayload("Report started", { ...VARS, STATUS: status }));
    assert.ok(started.ok && started.report.progress === 0 && started.report.stage === "Setting up the renderer");
  }
  assert.ok(parseJobReport(workflowPayload("Report done", VARS)).ok);
  // what is refused, and why (a 400 with the reason)
  assert.deepEqual(parseJobReport(null), { ok: false, error: "jobId (a uuid) is required." });
  assert.deepEqual(parseJobReport({ jobId: VARS.JOB_ID, status: "exploded" }), { ok: false, error: 'Unknown status "exploded".' });
  assert.deepEqual(parseJobReport({ jobId: VARS.JOB_ID, status: "queued" }), { ok: false, error: 'Unknown status "queued".' });
});

test("a failure report is never lost: database errors are a retryable 503 with the reason; curl prints it and retries", () => {
  const route = read("src/app/api/render/[id]/job/route.ts");
  assert.match(route, /if \(err instanceof Error && \/\^\(Unknown render job\|Bad status\)\/\.test\(err\.message\)\) return Response\.json\(\{ error: err\.message \}, \{ status: 400 \}\);\s*return serverError\(`render job \$\{r\.jobId\}`, err, 503\);/);
  assert.match(route, /try \{\s*revalidatePath\(`\/create\/\$\{id\}`\);\s*\} catch/, "a cache-revalidation hiccup after the status is saved isn't a failure");
  const yml = read(".github/workflows/render-worker.yml");
  const curls = yml.match(/curl [^\n]*\/job"/g) ?? [];
  assert.equal(curls.length, 3);
  for (const c of curls) {
    assert.match(c, /--fail-with-body --retry 5 --retry-delay 6 --retry-all-errors/);
    assert.doesNotMatch(c, /curl -fsS/);
  }
});
