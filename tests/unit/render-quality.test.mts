// Regression tests for the first live Koran Kinetik render (video_1.mp4): explainer cards (no "GRAFIK GRAFIK", no
// invented ENDORFIN / DOPAMIN), thought bubbles (never a bare "…"), no dead air, prop style references, clean audio
// edges, default BGM for scheduled episodes, and the Show Bible rules ("Co", preachy endings).
// Pure code: no database, no network, no AI. Run: npm run test:unit
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { BGM_UNDER_DIALOGUE } from "../../video/src/shared/bgm.ts";
import { test } from "node:test";
import { GAPS, LEAD_IN, LEAD_IN_MS, PAUSES, THOUGHT_FILTER, TRIM, fades } from "../../video/src/audioChain.ts";
import { bgmFile, registerRemoteAssets, resetRemoteAssets } from "../../video/src/assets/index.ts";
import { brainChips, buildBeats, cardHeader, overlayFor, thoughtCaption, type EpisodeLine } from "../../video/src/beats.ts";
import { parseDirection } from "../../video/src/direction.ts";
import { fillDeadAir, hasVisual, noUcoShortening, sanitizeScript } from "../../src/lib/scheduler.ts";
import { LEGACY_SHOW_DIRECTION, showBiblePrompt, showDirection } from "../../src/lib/showBible.ts";
import { HANDLE_DICTION, OCU_PACE, geminiSpeech } from "../../src/lib/voice/acting.ts";
import { ROOT } from "./importGraph.mts";

const read = (f: string) => fs.readFileSync(path.join(ROOT, f), "utf8");
const line = (o: Partial<EpisodeLine> & Record<string, unknown>) =>
  ({ index: 0, beat: "insight", speaker: "ocu", text: "Kebiasaan lo itu cuma bias.", subtitle: "Just a bias.", expression: "calm", thought_bubble: false, visual: "", on_screen_text: null, hasAudio: false, audio: null, frames: 90, envelope: [], ...o }) as EpisodeLine;

// ------------------------------------------------------------------ 1. explainer cards
test("explainer cards: one header, never 'GRAFIK GRAFIK' / 'PSIKOLOGI PSIKOLOGI'", () => {
  assert.deepEqual(cardHeader("wave-graph", "GRAFIK"), ["GRAFIK"]);
  assert.deepEqual(cardHeader("brain-badge", "psikologi"), ["PSIKOLOGI"]);
  assert.deepEqual(cardHeader("brain-badge", ""), ["PSIKOLOGI"]);
  assert.deepEqual(cardHeader("brain-badge", "DOPAMIN"), ["PSIKOLOGI", "DOPAMIN"]);
  // a line with no concept the card can draw: a text badge of its own headline (never the label again)
  const plain = overlayFor({ text: "Mikroplastik nyampe ke perut lo.", subtitle: "", overlay: "wave-graph" }, "MIKROPLASTIK DI PERUT");
  assert.deepEqual(plain, { kind: "wave-graph", title: "MIKROPLASTIK DI PERUT", graphic: false });
  assert.deepEqual(overlayFor({ text: "Ini soal dopamin.", subtitle: "", overlay: "brain-badge" }, "X"), { kind: "brain-badge", title: "DOPAMIN", graphic: true });
  assert.equal(overlayFor({ text: "Nggak ada apa-apa.", subtitle: "", overlay: "wave-graph" }, ""), null, "no concept, no headline: no card");
  assert.equal(overlayFor({ text: "x", subtitle: "", overlay: "none" }, "Y"), null);
});

test("explainer cards never invent ENDORFIN / DOPAMIN chips or draw a graph without a concept", () => {
  assert.deepEqual(brainChips("DOPAMIN"), ["DOPAMIN"]);
  assert.deepEqual(brainChips("Serotonin"), ["SEROTONIN"]);
  assert.deepEqual(brainChips("KEBIASAAN"), [], "a habit card shows no chemical");
  assert.deepEqual(brainChips("BIAS"), []);
  const stage = read("video/src/shared/VisualStage.tsx");
  assert.doesNotMatch(stage, /"ENDORFIN", "DOPAMIN"\]/, "no default chemical list");
  assert.match(stage, /\{graphic \? \(\s*<svg/, "the graph / brain only when the card has a concept");
  assert.match(stage, /data-card-badge/, "otherwise a clean text badge");
  // in a beat: a card without a concept gives way to the line's prop; with a concept it stays
  const beats = buildBeats(
    [
      line({ index: 0, overlay: "wave-graph", prop_tag: "nasi-padang-blender", text: "Rendang dijadiin minuman.", important_message: { kicker: "FAKTA", headline: "JUS RENDANG", stamp: null } }),
      line({ index: 1, overlay: "brain-badge", text: "Itu efek dopamin." }),
    ] as EpisodeLine[],
    { exact: true } as never,
  );
  assert.equal(beats[0].overlay, null, "no concept + a prop: the prop shows");
  assert.equal(beats[0].propImage, "nasi-padang-blender");
  assert.deepEqual(beats[1].overlay, { kind: "brain-badge", title: "DOPAMIN", graphic: true });
});

// ------------------------------------------------------------------ 1. thought bubbles
test("thought beats never show a bare '…': the prop, else a 2-4 word italic caption", () => {
  const beats = buildBeats(
    [
      line({ index: 0, speaker: "uco", thought_bubble: true, text: "Padahal gue juga beli kemarin.", important_message: { kicker: "DALAM HATI", headline: "GUE JUGA BELI", stamp: null } }),
      line({ index: 1, speaker: "uco", thought_bubble: true, text: "Hmm...", kinetic_text: "SKAKMAT GUE" }),
    ] as EpisodeLine[],
    { exact: true } as never,
  );
  assert.equal(beats[0].thoughtCaption, "GUE JUGA BELI");
  assert.equal(beats[1].thoughtCaption, "SKAKMAT GUE");
  assert.equal(thoughtCaption({ text: "...", kinetic_text: null }, null), "HMM", "even an empty line gets words, not dots");
  for (const b of beats) assert.doesNotMatch(b.thoughtCaption ?? "", /^[.…\s]*$/);
  const stage = read("video/src/shared/VisualStage.tsx");
  assert.doesNotMatch(stage, /letterSpacing: 6 \}\}>…<\/span>/, "the old '…' placeholder is gone");
  assert.match(stage, /fontStyle: "italic"[\s\S]*?\{caption \?\? "HMM"\}/);
  assert.match(read("video/src/shared/Director.tsx"), /caption=\{beat\.thoughtCaption\}/);
});

// ------------------------------------------------------------------ 1. no dead air, props
test("no dead air: never two lines in a row with an empty stage; an inspecting line holds the episode's prop", () => {
  const base = (i: number, o: Record<string, unknown> = {}) => ({
    beat: "escalation", speaker: i % 2 ? "ocu" : "uco", text: `Baris ${i}`, subtitle: "", expression: "calm", thought_bubble: false, visual: "", on_screen_text: null, kinetic_text: null, delivery: null,
    important_message: { kicker: "FAKTA", headline: `POIN NOMOR ${i}`, stamp: null }, camera_shot: "solo-uco", emotion: "triumphant", prop_tag: "none", start_s: null, end_s: null, sfx: [], overlay: null, callouts: null, layout: "standard", stat: null, ...o,
  });
  const lines = fillDeadAir([base(1), base(2), base(3), base(4, { prop_tag: "serum-emas-c54315" }), base(5), base(6), base(7, { emotion: "inspecting", speaker: "ocu" })] as never, ["serum-emas-c54315"]);
  for (let i = 1; i < lines.length; i++) assert.ok(hasVisual(lines[i - 1]) || hasVisual(lines[i]), `lines ${i}-${i + 1} both empty`);
  assert.equal(lines[1].kinetic_text, "POIN NOMOR 2");
  assert.ok(lines.filter(hasVisual).length / lines.length >= 0.75, "at least 75 % of the lines show something");
  assert.equal(lines[6].prop_tag, "serum-emas-c54315", "the magnifier examines the episode's prop, not empty air");
  // a prop whose image failed is dropped to none, and the rule runs again so that line doesn't go blank
  assert.match(read("src/lib/scheduler-server.ts"), /SET lines = \$\{sql\.json\(fillDeadAir\(dropProp\(sc\.lines, name\), keep\) as never\)\}/);
  // a Prop Bank leftover is never borrowed
  assert.equal(fillDeadAir([base(1, { emotion: "inspecting" })] as never, [])[0].prop_tag, "none");
});

test("generated props: style references must be real PNGs (the live run sent the login page), retried without them", () => {
  const srv = read("src/lib/scheduler-server.ts");
  assert.match(srv, /export const isPng = /);
  assert.match(srv, /if \(data && isPng\(data\)\) refs\.push/);
  assert.match(srv, /redirect: "manual"/, "a redirect to the login page is never followed into an 'image'");
  assert.match(srv, /\/input image\|INVALID_ARGUMENT\/i\.test\(String\(e\)\)\) throw e;[\s\S]*?retrying without style references[\s\S]*?geminiImage\(`\$\{prop\.prompt\}\. \$\{PROP_STYLE\}`, \[\]\)/);
  assert.match(read("src/proxy.ts"), /\|props\/\|cast\/\|/, "the public prop / cast images load without the login cookie");
});

// ------------------------------------------------------------------ 2. audio
test("every clip: gentle onset with a 40-60 ms pad and a 70 ms tail, only dead pauses (> 0.5 s) shortened, 15 / 45 ms fades", () => {
  assert.match(TRIM, /silenceremove=start_periods=1:start_threshold=-42dB:start_silence=0\.05,/);
  assert.ok(LEAD_IN_MS >= 40 && LEAD_IN_MS <= 60);
  assert.equal(LEAD_IN, "adelay=50:all=1,");
  assert.match(TRIM, /areverse,silenceremove=start_periods=1:start_threshold=-50dB:start_silence=0\.07,areverse/, "a 70 ms tail pad");
  assert.equal(PAUSES, "silenceremove=stop_periods=-1:stop_duration=0.5:stop_threshold=-42dB:stop_silence=0.3,", "only a dead pause over 0.5 s, down to 0.3 s");
  assert.doesNotMatch(TRIM + PAUSES, /stop_duration=0\.18/, "no 0.18 s mid-line chopping");
  assert.doesNotMatch(THOUGHT_FILTER, /aecho|lowpass=f=4500|highpass=f=250/, "no hollow / walkie-talkie thought filter");
  assert.equal(fades(2), "afade=t=in:st=0:d=0.015,afade=t=out:st=1.955:d=0.045");
  assert.equal(fades(0.01), "afade=t=in:st=0:d=0.015,afade=t=out:st=0.000:d=0.045");
  assert.ok(GAPS.rapid >= 0.08 && GAPS.rapid <= 0.12 && GAPS.standard >= 0.2 && GAPS.standard <= 0.24 && GAPS.drop >= 0.35 && GAPS.drop <= 0.4);
  // the renderer, Edge TTS and RVC all use them, the fades last (on the final length)
  const render = read("video/render.mts");
  assert.match(render, /import \{ LEAD_IN, PAUSES, THOUGHT_FILTER, TRIM, fades \} from "\.\/src\/audioChain\.ts";/);
  assert.match(render, /ffmpeg\("-i", leveled, "-af", fades\(secs\),/);
  assert.match(read("video/edge-stage.mts"), /ffmpeg\("-i", leveled, "-af", fades\(secs\),/);
  assert.match(read("video/rvc-stage.mts"), /`\$\{cutAt\(seconds\)\}highpass=f=20,\$\{fades\(seconds\)\}`/, "after RVC: tail gate, DC removed, faded");
});

test("the repo's SFX no longer clip: peaks at or below -3 dBFS (normalize-sfx.sh)", () => {
  assert.ok(fs.existsSync(path.join(ROOT, "scripts/normalize-sfx.sh")));
  assert.match(read("scripts/normalize-sfx.sh"), /highpass=f=20,volume=\$\{gain\}dB,alimiter=limit=0\.66[\s\S]*afade=t=in:st=0:d=0\.003,afade=t=out/);
});

// ------------------------------------------------------------------ 3. BGM
test("scheduled episodes get a background bed: urgent for Koran Kinetik, 12 % (about -18 dB) under dialogue, silent in thoughts", () => {
  const kk = parseDirection(showDirection("editorial-paper-cutout"));
  assert.equal(kk.bgm, true);
  assert.equal(kk.urgentBgm, true);
  assert.equal(kk.thoughtDuck, 0, "muted under inner thoughts");
  assert.equal(kk.naturalPacing, true);
  assert.equal(kk.pauseS, null, "no flat gap");
  assert.equal(kk.ctaText, "FOLLOW @UCO.OCU");
  const underDialogue = 20 * Math.log10(Math.min(kk.bgmVolume, BGM_UNDER_DIALOGUE));
  assert.ok(underDialogue <= -17 && underDialogue >= -20, `${underDialogue.toFixed(1)} dB`);
  const dt = parseDirection(showDirection("tactical-vector-hud"));
  assert.equal(dt.bgm, true);
  assert.equal(dt.urgentBgm, undefined);
  // no upload: the repo's tracks (public/sfx/bgm-urgent.mp3, public/sfx/bgm.mp3); an upload wins over the repo's
  resetRemoteAssets();
  assert.equal(bgmFile(true), "sfx/bgm-urgent.mp3");
  assert.equal(bgmFile(false), "sfx/bgm.mp3");
  registerRemoteAssets({ sfx: { bgm: "https://x/sfx/bgm.mp3" } });
  assert.equal(bgmFile(false), "https://x/sfx/bgm.mp3");
  registerRemoteAssets({ sfx: { "bgm-urgent": "https://x/studio/bgm-urgent.mp3" } });
  assert.equal(bgmFile(true), "https://x/studio/bgm-urgent.mp3");
  resetRemoteAssets();
  assert.match(read("video/src/shared/Compositing.tsx"), /bgmFile\(urgent \|\| beats\.some\(\(b\) => b\.angry\)\)/);
  const srv = read("src/lib/scheduler-server.ts");
  assert.match(srv, /\$\{showDirection\(r\.visual_style\)\}, true, now\(\)\)/, "new scheduled scripts");
  assert.match(srv, /UPDATE scripts SET direction = \$\{showDirection\(style\)\} WHERE project_id = \$\{s\.episode_id\} AND custom AND \(direction IS NULL OR direction LIKE \$\{LEGACY_SHOW_DIRECTION \+ "%"\}\)/, "and older drafts at render time");
  assert.equal(LEGACY_SHOW_DIRECTION, "CTA: FOLLOW @UCO.OCU");
});

// ------------------------------------------------------------------ 4. Ocu pacing, Show Bible rules
test("Ocu's style is crisp and steady at natural speed; the handle is enunciated; scripts never say 'Co' or end with a sermon", () => {
  const ocu = geminiSpeech({ speaker: "ocu", text: "Itu namanya bias, bukan investasi.", emotion: "deadpan" });
  assert.ok(ocu.style.includes(OCU_PACE), ocu.style);
  assert.match(OCU_PACE, /crisp and steady.*no drawn-out pauses or stretched syllables/);
  assert.doesNotMatch(OCU_PACE, /brisk|fast|rapid/, "energy, not speed");
  assert.ok(!geminiSpeech({ speaker: "uco", text: "Gas!", emotion: "triumphant" }).style.includes(OCU_PACE), "Uco keeps his own energy");
  assert.ok(geminiSpeech({ speaker: "ocu", text: "Follow @uco.ocu biar nggak ketipu!", emotion: "cta" }).style.includes(HANDLE_DICTION));
  const prompt = showBiblePrompt({ format: "comedy_debate", label: "Comedy Debate", brief: "b", seed: "Skincare", bankProps: "" });
  assert.match(prompt, /JANGAN PERNAH disingkat "Co"/);
  assert.match(prompt, /DILARANG penutup moral ala karangan sekolah \/ PSA, DILARANG Uco tiba-tiba sadar dan setuju jadi baik/);
  assert.match(prompt, /twist kemunafikan yang lucu atau punchline keras kepala/);
  // and in code, whatever the model writes
  assert.equal(noUcoShortening("Itu bubur, Co."), "Itu bubur, Uco.");
  assert.equal(noUcoShortening("Co, lo serius?"), "Uco, lo serius?");
  for (const keep of ["Coba deh", "co-founder", "Coca Cola", "Uco"]) assert.equal(noUcoShortening(keep), keep);
  const s = sanitizeScript({ lines: [{ speaker: "ocu", text: "Sabar, Co.", subtitle: "Easy, Co." }] }, { fresh: [], bank: [] }, "x", 1);
  assert.deepEqual([s.lines[0].text, s.lines[0].subtitle], ["Sabar, Uco.", "Easy, Uco."]);
});
