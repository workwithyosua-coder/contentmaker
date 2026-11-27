// Regression tests from the "Manifestasi Cuan Lawan Lembur Keras" render (slot fcd3aeb1, 73.6 s): a stamp on every beat,
// no audible music, "Follow akun uco titik ocu", a callout stamp over the explainer card, Ocu's coffee in Uco's thought,
// and the off-style angry sprite. Pure code: no database, no network, no AI.
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { test } from "node:test";
import { TRIM } from "../../video/src/audioChain.ts";
import { bgmFile, registerRemoteAssets, resetRemoteAssets } from "../../video/src/assets/index.ts";
import { buildBeats, type EpisodeLine } from "../../video/src/beats.ts";
import { parseDirection } from "../../video/src/direction.ts";
import { koranPoses } from "../../video/src/koran/poses.ts";
import { BGM_UNDER_DIALOGUE, bgmLevel } from "../../video/src/shared/bgm.ts";
import { STAGE_BOTTOM, STAGE_TOP } from "../../video/src/shared/castLayout.ts";
import { STAMP_CARD_GAP, cardCeiling, stackColumn, stampFloor } from "../../video/src/shared/motion.ts";
import { SFX_VOLUME, sfxCuesFor } from "../../video/src/shared/sfxCues.ts";
import { writeAssetManifest } from "../../scripts/asset-manifest.mts";
import { fillDeadAir } from "../../src/lib/scheduler.ts";
import { CTA_LINE, showBiblePrompt, showDirection, withCta } from "../../src/lib/showBible.ts";
import { HANDLE_DICTION, geminiSpeech } from "../../src/lib/voice/acting.ts";
import { cleanHandle, ttsText } from "../../src/lib/voice/phonetic.ts";
import { ROOT } from "./importGraph.mts";

const read = (f: string) => fs.readFileSync(path.join(ROOT, f), "utf8");
const line = (o: Partial<EpisodeLine> & Record<string, unknown>, i: number) =>
  ({ index: i, beat: "escalation", speaker: i % 2 ? "ocu" : "uco", text: "Baris biasa", subtitle: "A plain line", expression: "calm", thought_bubble: false, hasAudio: true, audio: null, frames: 120, envelope: [], start_s: null, prop_tag: "none", sfx: [], ...o }) as EpisodeLine;
const KK = { ...parseDirection(showDirection("editorial-paper-cutout")), exact: true };

/** The 15 lines of the fcd3aeb1 render as the produce log listed them (props, callouts, cards, thoughts, script SFX). */
const EPISODE = [
  { speaker: "uco", prop_tag: "buku-manifestasi-1511be", kinetic_text: "TRANSFER ENERGI", sfx: ["whoosh"] },
  { speaker: "ocu", kinetic_text: "NUNGGAK KOSAN", sfx: ["stamp"] },
  { speaker: "uco", prop_tag: "buku-manifestasi-1511be", sfx: ["pop"] },
  { speaker: "ocu", emotion: "inspecting", prop_tag: "buku-manifestasi-1511be" },
  { speaker: "uco", expression: "angry", emotion: "angry", text: "Ini frekuensi gelombang kuantum!", kinetic_text: "AURA MISKIN", sfx: ["stamp", "record-scratch"] },
  { speaker: "ocu", overlay: "brain-badge", kinetic_text: "BIAS KONFIRMASI SEMATA", sfx: ["ding"] },
  { speaker: "ocu", overlay: "wave-graph", kinetic_text: "DUA JUTA PASTI" },
  { speaker: "uco" },
  { speaker: "ocu", kinetic_text: "LANGSUNG BAYAR TAGIHAN LISTRIK", sfx: ["stamp"] },
  { speaker: "uco", prop_tag: "kristal-cuan-1511be" },
  { speaker: "ocu", camera_shot: "two-shot", prop_tag: "kristal-cuan-1511be", kinetic_text: "BATU PALSU", sfx: ["whoosh"] },
  { speaker: "ocu", thought_bubble: true, prop_tag: "kopi-sachet-lembur-1511be", sfx: ["pop"] },
  { speaker: "uco", thought_bubble: true, prop_tag: "kopi-sachet-lembur-1511be", sfx: ["ding"] },
  { speaker: "uco", camera_shot: "closeup-punch", kinetic_text: "TRAKTIR GUE", sfx: ["stamp"] },
  { speaker: "ocu", emotion: "cta", text: "Follow akun uco titik ocu biar lo nggak males kerja!", subtitle: "Follow uco dot ocu so you don't skip work!" },
];
const PROPS = { "buku-manifestasi-1511be": "https://x/props/buku.png", "kristal-cuan-1511be": "https://x/props/kristal.png", "kopi-sachet-lembur-1511be": "https://x/props/kopi.png" };
const episode = () => EPISODE.map((o, i) => line(o as never, i));
const speaking = (frames: number) => Array.from({ length: frames }, (_, f) => (f >= 6 && f < frames - 6 ? 0.5 : 0));

// ------------------------------------------------------------------ 1. the per-beat "chk-tsk"
test("the per-beat stamp stays gone: that episode makes new-prop pops, one impact accent and the outro ding, nothing on cuts or thoughts", () => {
  resetRemoteAssets();
  registerRemoteAssets({ props: PROPS });
  const beats = buildBeats(episode(), KK);
  const cues = sfxCuesFor(beats, { ding: true });
  resetRemoteAssets();
  const beatOf = (f: number) => beats.findIndex((b) => f >= b.startFrame && f < b.startFrame + b.durationInFrames);
  // was (before #58): a stamp on every beat with a callout (8 here) + pops + dings + whooshes + every script effect.
  // Now: the book appears (b1), comes back after a line without it (b3), the crystal appears (b10); the angry b5 callout
  // is the one impact accent; the outro button flips with a ding
  assert.deepEqual(cues.map((c) => [c.name, beatOf(c.frame) + 1]), [["pop", 1], ["pop", 3], ["stamp", 5], ["pop", 10], ["ding", 15]]);
  for (const b of beats.filter((x) => x.thought)) assert.ok(!cues.some((c) => beatOf(c.frame) === beats.indexOf(b)), `nothing on ${b.id}`);
  assert.ok(cues.length <= 6, "a handful per episode, not one per cut");
  assert.ok(cues.every((c) => c.volume! <= 0.28));
});

test("a takeover stat card: whoosh (0.16) then stamp (0.26) as it slams, once per run; a new prop pops (0.22); thoughts stay silent", () => {
  assert.deepEqual(SFX_VOLUME, { whoosh: 0.16, stamp: 0.26, pop: 0.22, accentStamp: 0.22, accentPop: 0.18, ding: 0.28 });
  const lines = [
    line({ speaker: "uco", sfx: ["whoosh", "stamp", "ding"] }, 0),
    line({ speaker: "ocu", layout: "takeover", stat: "35 RIBU | SEGELAS" }, 1),
    line({ speaker: "uco", layout: "takeover", stat: "1 JUTA | SEBULAN" }, 2),
    line({ speaker: "ocu", prop_tag: "kristal-cuan-1511be" }, 3),
    line({ speaker: "uco", thought_bubble: true, prop_tag: "kopi-sachet-lembur-1511be" }, 4),
  ];
  resetRemoteAssets();
  registerRemoteAssets({ props: PROPS });
  const beats = buildBeats(lines, { exact: true } as never);
  resetRemoteAssets();
  const cues = sfxCuesFor(beats, { ding: false });
  assert.deepEqual(cues.map((c) => c.name), ["whoosh", "stamp", "pop"]);
  const lands = beats[1].startFrame + beats[1].speechStart;
  assert.deepEqual([cues[0].frame, cues[0].volume], [Math.max(beats[1].startFrame, lands - 4), 0.16]);
  assert.deepEqual([cues[1].frame, cues[1].volume], [lands, 0.26], "the stamp lands with the card, as the voice starts");
  assert.deepEqual([cues[2].frame, cues[2].volume], [beats[3].startFrame + beats[3].propEntry, 0.22]);
});

test("no other sound source fires per beat: the only <Audio> tags in the video are the voices, these cues and the music bed", () => {
  const files: string[] = [];
  const walk = (d: string) => fs.readdirSync(path.join(ROOT, d), { withFileTypes: true }).forEach((e) => (e.isDirectory() ? walk(`${d}/${e.name}`) : /\.tsx$/.test(e.name) && files.push(`${d}/${e.name}`)));
  walk("video/src");
  const withAudio = files.filter((f) => /<Audio\b/.test(read(f))).sort();
  // Episode / Comic / Lipstick are the older styles; Koran Kinetik is CueShared (voices) + Compositing (cues, music)
  assert.deepEqual(withAudio, ["video/src/Episode.tsx", "video/src/cast/CueShared.tsx", "video/src/comic/ComicEpisode.tsx", "video/src/lipstick/LipstickEffect.tsx", "video/src/shared/Compositing.tsx"]);
  assert.match(read("video/src/koran/KoranKinetik.tsx"), /<SfxCues cues=\{sfxCuesFor\(beats\)\} \/>/);
  assert.doesNotMatch(read("video/render.mts"), /amix|amerge|"-map"/, "no ffmpeg mix adds anything after Remotion");
});

// ------------------------------------------------------------------ 2. BGM
test("public/sfx/bgm.mp3 and bgm-urgent.mp3 are in the asset manifest and a scheduled Koran Kinetik render gets a real file", () => {
  const m = writeAssetManifest();
  for (const f of ["bgm.mp3", "bgm-urgent.mp3"]) {
    assert.ok(fs.existsSync(path.join(ROOT, "public/sfx", f)), `public/sfx/${f} committed`);
    assert.ok(m.sfx.includes(f), `${f} in the manifest`);
  }
  assert.deepEqual(JSON.parse(read("video/src/assets/assetManifest.json")).sfx, m.sfx, "the committed manifest is current");
  resetRemoteAssets();
  const urgent = bgmFile(Boolean(KK.urgentBgm));
  assert.equal(urgent, "sfx/bgm-urgent.mp3");
  assert.ok(fs.existsSync(path.join(ROOT, "public", urgent!)), "the path exists on disk");
  assert.ok(KK.bgm && fs.existsSync(path.join(ROOT, "public", bgmFile(false)!)));
  // the worker copies public/sfx next to the bundle and checks out the whole repo (no sparse checkout in produce)
  assert.match(read("video/render.mts"), /for \(const dir of \["cast", "sfx", "props"\]\)/);
  const wf = read(".github/workflows/autonomous-scheduler.yml");
  assert.equal((wf.match(/sparse-checkout:/g) ?? []).length, 1, "only the plan job is sparse");
  assert.ok(wf.indexOf("sparse-checkout:") < wf.indexOf("\n  produce:"));
});

test("the music bed is audible: 20 % between lines, 12 % (≈ −18 dB) under dialogue (was 7 %), silent in thoughts", () => {
  assert.equal(BGM_UNDER_DIALOGUE, 0.12);
  const lines = [line({ speaker: "uco", envelope: speaking(120) }, 0), line({ speaker: "ocu", thought_bubble: true, envelope: speaking(120) }, 1)];
  const beats = buildBeats(lines, KK);
  const at = (b: number, f: number) => bgmLevel(beats, lines, KK.bgmVolume, KK.thoughtDuck, beats[b].startFrame + f);
  assert.equal(at(0, 2), 0.2, "before the first word");
  assert.equal(at(0, 40), 0.12, "under the voice");
  assert.equal(at(1, 40), 0, "BGM off on thought");
  assert.ok(20 * Math.log10(at(0, 40)) > -19, "not the old -23 dB that read as silence");
});

test("an uploaded music bed that can't be fetched falls back to the repo's file, and the log names the bed used", () => {
  const r = read("video/render.mts");
  assert.match(r, /for \(const name of \["bgm", "bgm-urgent"\]\) \{[\s\S]*?audioUnreachable\(url\)[\s\S]*?delete assetUrls\.sfx!\[name\];/);
  assert.match(r, /\/\^audio\\\/\|octet-stream\/\.test\(type\)/);
  assert.match(r, /log\(`bgm: \$\{bgm \?\? "NONE \(add public\/sfx\/bgm\.mp3\): this episode has no music"\}/);
});

// ------------------------------------------------------------------ 3. the outro handle
test("the handle is never spoken or shown with a dot: Gemini says Ucho Ochu, the subtitle shows @uco.ocu", () => {
  for (const s of ["Follow akun uco titik ocu biar lo nggak males kerja!", "Follow @uco.ocu biar lo nggak males kerja!", "Follow uco dot ocu biar lo nggak males kerja!", "Follow Uco . Ocu biar lo nggak males kerja!"]) {
    assert.equal(cleanHandle(s), "Follow @uco.ocu biar lo nggak males kerja!", s);
    const g = geminiSpeech({ speaker: "ocu", emotion: "cta", text: s });
    assert.equal(g.text, "Follow Ucho Ochu biar lo nggak males kerja!", s);
    assert.doesNotMatch(g.text, /titik|dot|\.\s*o|Uko/i);
    assert.ok(g.style.includes(HANDLE_DICTION));
  }
  assert.equal(ttsText("Follow uco titik ocu!"), "Follow U-co Ocu!", "Edge's Indonesian voice keeps U-co / Ocu");
  assert.equal(cleanHandle("Follow uco dot ocu so you don't skip work!"), "Follow @uco.ocu so you don't skip work!");
  // a new draft is cleaned before it's saved; the prompt asks for the written handle
  const [cta] = withCta([{ ...CTA_LINE, text: "Follow akun uco titik ocu ya!", subtitle: "Follow uco dot ocu!" }]);
  assert.deepEqual([cta.text, cta.subtitle], ["Follow @uco.ocu ya!", "Follow @uco.ocu!"]);
  assert.match(showBiblePrompt({ format: "koran_kinetik", label: "Koran Kinetik", brief: "b", seed: "s", bankProps: "" }), /DILARANG mengeja titiknya \("uco titik ocu", "uco dot ocu", "akun uco titik ocu"\)/);
  // and already-made scripts render the subtitle clean
  const beats = buildBeats(episode(), KK);
  assert.equal(beats.at(-1)!.subtitleEn, "Follow @uco.ocu so you don't skip work!");
});

test("a leading breath is trimmed (−42 dB start) with the 50 ms pre-speech pad kept for the first consonant", () => {
  assert.match(TRIM, /^highpass=f=70,silenceremove=start_periods=1:start_threshold=-42dB:start_silence=0\.05,/);
  assert.doesNotMatch(TRIM, /start_duration/, "a start_duration would eat the consonant's onset");
});

// ------------------------------------------------------------------ 4. layout
test("callout stamp and explainer card never overlap: ≥ 24 px clear at the stamp's biggest frame and the camera's tightest", () => {
  // b6 at 0:29: solo Ocu, "BIAS KONFIRMASI SEMATA" over the PSIKOLOGI PERSEPSI card
  const b6 = stackColumn({ kinetic: "BIAS KONFIRMASI SEMATA", align: "left", tilted: true, thought: false, overlay: true, hasProp: false }, { x: 60, w: 340 }, STAGE_TOP, STAGE_BOTTOM);
  assert.ok(b6.kineticBox && b6.cardBox, "both still show");
  assert.ok(cardCeiling(b6.cardBox.y, b6.cardBox.x, b6.cardBox.w) - stampFloor("BIAS KONFIRMASI SEMATA", b6.kineticBox, "left") >= STAMP_CARD_GAP);
  assert.ok(b6.cardBox.y + b6.cardBox.h <= STAGE_BOTTOM);
  // every column, alignment and callout length: either clear by the gap, or the card alone (the stamp gives way)
  const texts = ["OK", "AURA MISKIN", "BIAS KONFIRMASI SEMATA", "LANGSUNG BAYAR TAGIHAN LISTRIK", "WWWW WWWW WWWW WWWW"];
  const cols = [[{ x: 60, w: 340 }, "left", STAGE_TOP, STAGE_BOTTOM], [{ x: 600, w: 340 }, "right", STAGE_TOP, STAGE_BOTTOM], [{ x: 230, w: 620 }, "center", STAGE_TOP, 760]] as const;
  for (const t of texts) for (const [col, align, top, bottom] of cols) for (const hasProp of [false, true]) for (const tilted of [true, false]) {
    const c = stackColumn({ kinetic: t, align, tilted, thought: false, overlay: true, hasProp }, col, top, bottom, hasProp ? 300 : 200);
    if (c.kineticBox && c.cardBox) assert.ok(cardCeiling(c.cardBox.y, c.cardBox.x, c.cardBox.w) - stampFloor(t, c.kineticBox, align, tilted) >= STAMP_CARD_GAP, `${t} ${align} prop=${hasProp}`);
    if (c.propBox && c.cardBox) assert.ok(c.propBox.y >= c.cardBox.y + c.cardBox.h, "the prop sits under the card");
  }
  assert.match(read("video/src/shared/Director.tsx"), /const c = stackColumn\(\{ kinetic, align: kineticAlign, tilted: skin\.prop === "paper"/);
});

test("a thought bubble shows only its own prop: never the previous line's (Ocu's coffee in Uco's thought), else its caption", () => {
  resetRemoteAssets();
  registerRemoteAssets({ props: PROPS });
  const beats = buildBeats(episode(), KK);
  resetRemoteAssets();
  assert.equal(beats[11].propImage, "kopi-sachet-lembur-1511be", "Ocu's own thought keeps the coffee it names");
  assert.equal(beats[12].propImage, null, "Uco's thought doesn't inherit it");
  assert.equal(beats[12].propTag, "none");
  assert.ok(beats[12].thoughtCaption && beats[12].thoughtCaption.split(/\s+/).length <= 4, `${beats[12].thoughtCaption}`);
  // new scripts: the dead-air rule never hands a thought line someone else's prop
  const base = (i: number, o: Record<string, unknown> = {}) => ({ beat: "twist", speaker: i % 2 ? "ocu" : "uco", text: `Baris ${i}`, subtitle: "", expression: "calm", thought_bubble: false, visual: "", on_screen_text: null, kinetic_text: null, delivery: null, important_message: { kicker: "FAKTA", headline: `POIN ${i}`, stamp: null }, camera_shot: "solo-uco", emotion: "triumphant", prop_tag: "none", start_s: null, end_s: null, sfx: [], overlay: null, callouts: null, layout: "standard", stat: null, ...o });
  const filled = fillDeadAir([base(1, { prop_tag: "kopi-x" }), base(2, { thought_bubble: true }), base(3, { emotion: "inspecting" })] as never, ["kopi-x"]);
  assert.equal(filled[1].prop_tag, "none");
  assert.equal(filled[2].prop_tag, "kopi-x", "the magnifier still examines the episode's prop");
  // the bubble draws a prop only when the beat has one (a text label never stands in)
  assert.match(read("video/src/shared/Director.tsx"), /\{beat\.propImage \|\| beat\.sceneImageUrl \|\| beat\.propTag !== "none" \? <div/);
});

test("Koran Kinetik draws angry with the master art's poses: shocked when shouted, else defensive", () => {
  const lines = [line({ speaker: "uco", expression: "angry", text: "Ini frekuensi gelombang kuantum!" }, 0), line({ speaker: "ocu", expression: "angry", text: "Itu bukan investasi", subtitle: "That's not an investment" }, 1)];
  const beats = buildBeats(lines, { exact: true } as never);
  assert.deepEqual(beats.map((b) => b.emotion), ["angry", "angry"]);
  koranPoses(beats, lines);
  assert.deepEqual(beats.map((b) => b.emotion), ["shocked", "defensive"]);
  assert.ok(beats.every((b) => b.angry), "the angry shake and vignette stay");
  assert.match(read("video/src/koran/KoranKinetik.tsx"), /const beats = koranPoses\(buildBeats\(lines, direction\), lines\);/);
});
