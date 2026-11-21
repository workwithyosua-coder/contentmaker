// Unit tests for the animation engine (video/src/shared/motion.ts and its use in beats.ts). Pure code: no browser,
// no network, no AI. Run: npm run test:unit
import assert from "node:assert/strict";
import { test } from "node:test";
import { buildBeats, chunkSubtitle, timeSubtitle, type Beat } from "../../video/src/beats.ts";
import { parseDirection } from "../../video/src/direction.ts";
import {
  BLINK_FRAMES,
  CUT_FRAMES,
  LONG_BEAT,
  CAMEO,
  PROP_LEAD,
  SHAKE_PX,
  SUBTITLE_BAND,
  TAKEOVER_HERO,
  cameoBox,
  coversCanvas,
  holdFrames,
  impactShake,
  layersAt,
  speechBounds,
  subtitleLayout,
  subtitleVisible,
  activeWord,
  blinkAt,
  blinkStarts,
  bodyMotion,
  cameraAt,
  ctaTapFrame,
  cutDirection,
  levelAt,
  mouthStage,
  propEntryFrame,
  whipOffset,
} from "../../video/src/shared/motion.ts";
import { sfxCuesFor } from "../../video/src/shared/sfxCues.ts";
import type { EpisodeLine } from "../../video/src/types.ts";

const line = (o: Partial<EpisodeLine> & Pick<EpisodeLine, "speaker" | "text">, i = 0): EpisodeLine =>
  ({ index: i, beat: "escalation", subtitle: "", expression: "neutral", hasAudio: true, audio: null, frames: 90, envelope: [], ...o }) as EpisodeLine;
const exact = { ...parseDirection(""), exact: true };
const beat = (o: Partial<Beat>): Beat => ({ ...buildBeats([line({ speaker: "uco", text: "x" })], exact)[0], ...o });

test("lip sync has three stages: soft syllables half-open, loud stressed ones wide", () => {
  assert.equal(mouthStage(0.05), 0);
  assert.equal(mouthStage(0.3), 1);
  assert.equal(mouthStage(0.8), 2);
  // smoothing: a single-frame spike doesn't throw the mouth wide open
  const env = [0, 0, 0, 1, 0, 0];
  assert.equal(mouthStage(levelAt(env, 3)), 1);
  assert.equal(levelAt(env, 99), 0, "past the recording: closed");
});

test("blinks: deterministic, 4 frames long, every 2.5–4.5 s, seeded per beat and character", () => {
  const starts = blinkStarts("b1-uco", 30 * 30);
  assert.ok(starts.length >= 6);
  assert.ok(starts[0] >= 24 && starts[0] <= 60, "first blink 0.8–2 s in");
  for (let i = 1; i < starts.length; i++) {
    const gap = starts[i] - starts[i - 1];
    assert.ok(gap >= 75 && gap <= 135, `gap ${gap}`);
  }
  assert.deepEqual(blinkStarts("b1-uco", 900), starts, "same seed, same blinks");
  assert.notDeepEqual(blinkStarts("b1-ocu", 900), starts, "the two characters don't blink in sync");
  const s = starts[0];
  assert.equal(blinkAt("b1-uco", s - 1, 900), 0);
  assert.deepEqual([0, 1, 2, 3].map((k) => blinkAt("b1-uco", s + k, 900)), [0.6, 1, 1, 0.6]);
  assert.equal(blinkAt("b1-uco", s + BLINK_FRAMES, 900), 0);
});

test("audio-reactive body: Uco bounces more than Ocu; inner thoughts stay still", () => {
  const u = bodyMotion("uco", 1, 20, false);
  const o = bodyMotion("ocu", 1, 20, false);
  assert.equal(u.dy, -4);
  assert.ok(Math.abs(o.dy) >= 2 && Math.abs(o.dy) < Math.abs(u.dy));
  assert.ok(u.scale <= 1.025 && u.scale > o.scale && o.scale > 1);
  for (let f = 0; f < 200; f++) assert.ok(Math.abs(bodyMotion("uco", 1, f, false).tilt) <= 1.5);
  assert.deepEqual(bodyMotion("uco", 1, 20, true), { dy: 0, scale: 1, tilt: 0 });
  assert.deepEqual(bodyMotion("ocu", 0, 20, false).dy, -0);
});

test("camera: Ken Burns on explanations, a 1.12× tilted punch on shocks, a micro punch-in on long beats, still outro", () => {
  const explain = beat({ beatType: "insight", emotion: "explaining", durationInFrames: 120 });
  assert.equal(cameraAt(explain, 0).scale, 1);
  assert.ok(Math.abs(cameraAt(explain, 120).scale - 1.06) < 1e-9);
  const shock = beat({ emotion: "shocked", durationInFrames: 60 });
  assert.ok(cameraAt(shock, 0).scale < 1.05, "starts wide");
  const held = cameraAt(shock, 30);
  assert.ok(Math.abs(held.scale / (1 + 0.04 * 0.5) - 1.12) < 0.01, `punch ${held.scale}`);
  assert.equal(held.rotate, -2);
  const long = beat({ durationInFrames: LONG_BEAT + 30 });
  const mid = Math.round(long.durationInFrames / 2);
  const before = cameraAt(long, mid - 1).scale;
  const after = cameraAt(long, mid + 10).scale;
  assert.ok(after / before > 1.06, "punches in 1.07× halfway");
  assert.ok(cameraAt(beat({ durationInFrames: LONG_BEAT - 1 }), 100).scale < 1.05, "short beats don't");
  assert.deepEqual(cameraAt(beat({ cameraShot: "cta-stinger" }), 40), { scale: 1, rotate: 0, x: 0, y: 0 });
});

test("cuts: a 4-frame directional whip toward the new speaker's side, none when the shot continues", () => {
  const beats = buildBeats(
    [line({ speaker: "uco", text: "a" }, 0), line({ speaker: "ocu", text: "b" }, 1), line({ speaker: "uco", text: "c" }, 2)],
    exact,
  );
  assert.equal(cutDirection(beats, 0), 0);
  assert.equal(cutDirection(beats, 1), 1, "to Ocu: in from the right");
  assert.equal(cutDirection(beats, 2), -1, "to Uco: in from the left");
  const same = [beats[0], { ...beats[0], id: "b9" }];
  assert.equal(cutDirection(same, 1), 0);
  assert.ok(whipOffset(1, 0) > 100);
  assert.ok(whipOffset(-1, 0) < -100);
  assert.equal(whipOffset(1, CUT_FRAMES), 0);
  for (let f = 1; f < CUT_FRAMES; f++) assert.ok(Math.abs(whipOffset(1, f)) < Math.abs(whipOffset(1, f - 1)));
});

test("props pop in just before their keyword is spoken (else 0.25 s after the voice starts), and the pop sound lands with them", () => {
  const voiced = Array.from({ length: 150 }, () => 0.6);
  // "blender" is ~70 % into the line → ~frame 105 of 150, a few frames early, capped at 60 % of the beat
  const at = propEntryFrame("Terus nasi kemarin dimasukin ke blender aja ya", /\bblender\b/i, voiced, 150);
  assert.ok(at > 60 && at <= 90, `entry ${at}`);
  assert.equal(propEntryFrame("Tidak ada kata kunci", /\bblender\b/i, voiced, 150), PROP_LEAD);
  assert.equal(propEntryFrame("Apa saja", null, [], 150), PROP_LEAD);
  assert.equal(PROP_LEAD, 8);
  // relative to the voice: never before it starts; the hook beat's prop lands right as it starts
  assert.equal(propEntryFrame("Apa saja", null, [], 150, { speechStart: 20 }), 28);
  assert.equal(propEntryFrame("Ini blender", /\bblender\b/i, voiced, 150, { speechStart: 20, hook: true }), 20);
  assert.ok(propEntryFrame("blender dulu", /\bblender\b/i, voiced, 150, { speechStart: 20 }) >= 20);
  const beats = buildBeats([line({ speaker: "uco", text: "Nasi padang diblender!", prop_tag: "nasi-padang-blender", frames: 120, envelope: voiced.slice(0, 120) })], exact);
  const pop = sfxCuesFor(beats).find((c) => c.name === "pop");
  assert.equal(pop?.frame, beats[0].startFrame + beats[0].propEntry);
});

test("subtitles: 3–5 word chunks, each word timed in order, the spoken word is the active one", () => {
  const chunks = chunkSubtitle("Your brain is flooded with endorphins and dopamine, that's why you're hooked on it.");
  for (const c of chunks) {
    const n = c.split(" ").length;
    assert.ok(n >= 3 && n <= 6, `"${c}" has ${n} words`);
  }
  assert.ok(chunks.length >= 3);
  const env = Array.from({ length: 180 }, (_, i) => (i % 20 < 16 ? 0.6 : 0));
  const timed = timeSubtitle("Your brain is flooded with endorphins and dopamine, that's why you're hooked.", env, 180);
  for (const c of timed) {
    assert.equal(c.words.map((w) => w.text).join(" "), c.text);
    assert.equal(c.words[0].startFrame, c.startFrame);
    for (let i = 1; i < c.words.length; i++) assert.ok(c.words[i].startFrame >= c.words[i - 1].startFrame);
    assert.ok(c.words.at(-1)!.startFrame < c.endFrame);
  }
  const c = timed[0];
  assert.equal(activeWord(c, c.startFrame), 0);
  assert.equal(activeWord(c, c.endFrame - 1), c.words.length - 1);
  assert.equal(activeWord(c, c.startFrame - 1), -1);
});

test("outro: the FOLLOW tap comes after the arrow draws on and leaves time to read FOLLOWED", () => {
  assert.equal(ctaTapFrame(90), 40);
  assert.ok(ctaTapFrame(60) >= 26 && ctaTapFrame(60) <= 30);
  assert.ok(ctaTapFrame(20) >= 26, "never before the arrow (frames 10–24) has drawn on");
});

// ------------------------------------------------------------------ transitions, speech onset, lower zone, takeover
const env = (silentHead: number, voiced: number, tail = 0) => [...Array(silentHead).fill(0.02), ...Array(voiced).fill(0.6), ...Array(tail).fill(0.03)];

test("whip cuts never show an empty frame: the outgoing beat stays mounted underneath until the incoming one covers the canvas", () => {
  const lines = [
    line({ speaker: "uco", text: "a", frames: 60, envelope: env(6, 50, 4) }, 0),
    line({ speaker: "ocu", text: "b", frames: 60, envelope: env(6, 50, 4) }, 1),
    line({ speaker: "uco", text: "c", frames: 60, envelope: env(6, 50, 4) }, 2),
    line({ speaker: "uco", text: "d", frames: 60, envelope: env(6, 50, 4) }, 3),
  ];
  const beats = buildBeats(lines, exact);
  assert.equal(holdFrames(beats, 0), CUT_FRAMES, "Uco → Ocu whips: beat 1 is held under beat 2");
  assert.equal(holdFrames(beats, 2), 0, "Uco → Uco same shot: no whip, no hold");
  const total = beats.at(-1)!.startFrame + beats.at(-1)!.durationInFrames;
  for (let g = 0; g < total; g++) {
    const layers = layersAt(beats, g);
    assert.ok(layers.length >= 1, `frame ${g}: something is on screen`);
    assert.ok(coversCanvas(layers.map((l) => l.x)), `frame ${g}: layers ${JSON.stringify(layers)} leave a gap`);
  }
  // mid-whip into beat 2: beat 1 held on its last frame underneath, beat 2 offset on top
  const mid = layersAt(beats, beats[1].startFrame + 1);
  assert.deepEqual(mid.map((l) => l.index), [0, 1]);
  assert.equal(mid[0].held, true);
  assert.equal(mid[0].frame, beats[0].durationInFrames - 1);
  assert.ok(mid[1].x > 0);
  // the check itself catches a gap: a lone incoming layer mid-whip doesn't cover the canvas
  assert.equal(coversCanvas([mid[1].x]), false);
  // reduced motion: plain cuts, always covered
  assert.ok(layersAt(beats, beats[1].startFrame, true).every((l) => l.x === 0));
});

test("speech onset: found from the loudness envelope; the whole beat without one", () => {
  assert.deepEqual(speechBounds(env(15, 40, 10), 70), { start: 15, end: 55 });
  assert.deepEqual(speechBounds([], 90), { start: 0, end: 90 });
  assert.deepEqual(speechBounds(Array(30).fill(0.01), 30), { start: 0, end: 30 }, "silence: whole beat");
  // a one-frame click before the voice doesn't count
  const click = [0, 0, 0.9, 0, 0, 0, ...Array(20).fill(0.5)];
  assert.equal(speechBounds(click, 26).start, 6);
});

test("subtitles stay hidden until the voice starts (and during the whip in), and words are timed across the spoken frames", () => {
  const e = env(20, 100, 30);
  const [b] = buildBeats([line({ speaker: "uco", text: "Mie pedas itu kemenangan", subtitle: "Spicy noodles are a total victory for everyone", frames: 150, envelope: e })], exact);
  assert.equal(b.speechStart, 20);
  assert.equal(b.speechEnd, 120);
  assert.equal(subtitleVisible(b, 19, 0), false);
  assert.equal(subtitleVisible(b, 20, 0), true);
  assert.equal(subtitleVisible({ speechStart: 0 }, 2, 1), false, "never during the whip overlap");
  assert.equal(subtitleVisible({ speechStart: 0 }, CUT_FRAMES, 1), true);
  assert.equal(b.subtitleChunks[0].startFrame, 20, "chunk 1 starts with the voice, not at frame 0");
  const words = b.subtitleChunks.flatMap((c) => c.words);
  assert.ok(words.every((w) => w.startFrame >= 20 && w.startFrame < 120), JSON.stringify(words));
  assert.ok(words.at(-1)!.startFrame > 80, "the last word comes late in the spoken span");
  // no recording: [0, beat length]
  const [nb] = buildBeats([line({ speaker: "uco", text: "x", subtitle: "one two three four", frames: 90 })], exact);
  assert.equal(nb.subtitleChunks[0].startFrame, 0);
});

test("on-screen callouts, script SFX and the urgent shake land when the voice starts", () => {
  const e = env(12, 60, 8);
  const beats = buildBeats(
    [
      line({ speaker: "uco", text: "a", frames: 80, envelope: e, kinetic_text: "KRIMINAL!", sfx: ["ding", "stamp"] }, 0),
      line({ speaker: "ocu", text: "b", frames: 80, envelope: e, expression: "angry" }, 1),
    ],
    exact,
  );
  const cues = sfxCuesFor(beats, { stampAt: 10 });
  const at = (n: string) => cues.filter((c) => c.name === n).map((c) => c.frame);
  assert.ok(at("ding").includes(beats[0].startFrame + 12));
  assert.ok(at("stamp").every((f) => f >= beats[0].startFrame + 12), "nothing stamps before the voice");
  assert.equal(beats[0].impactFrame, 12 + 6, "the script's stamp (2nd SFX) is the impact");
  assert.equal(beats[1].angry, true);
  assert.equal(beats[1].impactFrame, 12);
  assert.deepEqual(impactShake(11, 12), { x: 0, y: 0 });
  assert.equal(Math.abs(impactShake(12, 12).x), SHAKE_PX);
  for (let k = 1; k < 6; k++) assert.ok(Math.abs(impactShake(12 + k, 12).x) < SHAKE_PX);
  assert.deepEqual(impactShake(18, 12), { x: 0, y: 0 });
});

test("subtitle pill stays inside y 1540..1630 for every chunk and never touches the takeover cameo", () => {
  assert.deepEqual([SUBTITLE_BAND.top, SUBTITLE_BAND.bottom], [1540, 1630]);
  const samples = ["Ok.", "Level 10 spicy noodles", "Your brain is flooded with endorphins", "WWWWWWWW WWWWWWWW WWWWWWWW WWWWWWWW", "So blended nasi padang tastes good too?"];
  for (const t of samples) {
    const { pill, size } = subtitleLayout(t);
    assert.ok(pill.y >= 1540 && pill.y + pill.h <= 1630, `${t}: ${JSON.stringify(pill)}`);
    assert.ok(pill.x >= 60 && pill.x + pill.w <= 940, `${t}: x`);
    assert.ok(size >= 28, `${t}: readable size ${size}`);
    for (const who of ["uco", "ocu"] as const) assert.ok(cameoBox(who).y + cameoBox(who).h < pill.y, `${who} cameo above the subtitles`);
  }
  // the takeover hero: centred, ~70 % of the width, y 340..1160
  assert.equal(TAKEOVER_HERO.x * 2 + TAKEOVER_HERO.w, 1080);
  assert.ok(TAKEOVER_HERO.w / 1080 >= 0.65 && TAKEOVER_HERO.w / 1080 <= 0.75);
  assert.deepEqual([TAKEOVER_HERO.y, TAKEOVER_HERO.y + TAKEOVER_HERO.h], [340, 1160]);
  assert.ok(Math.abs(CAMEO.w / 1080 - 0.3) < 0.01);
  assert.ok(cameoBox("uco").x < 540 && cameoBox("ocu").x > 540);
  assert.ok(cameoBox("ocu").x + CAMEO.w <= 940, "clear of the right-hand icon rail");
});

test("layout: takeover and stat reach the beat; omitted means standard", () => {
  const beats = buildBeats(
    [
      line({ speaker: "ocu", text: "a", layout: "takeover", stat: '"20 KM | MATI DALAM 2 HARI"' }, 0),
      line({ speaker: "uco", text: "b" }, 1),
      line({ speaker: "uco", text: "c", layout: "takeover", thought_bubble: true }, 2),
    ],
    exact,
  );
  assert.equal(beats[0].layout, "takeover");
  assert.deepEqual(beats[0].stat, { headline: "20 KM", subline: "MATI DALAM 2 HARI" });
  assert.equal(beats[1].layout, "standard");
  assert.equal(beats[1].stat, null);
  assert.equal(beats[2].layout, "standard", "thought lines keep their bubble");
});
