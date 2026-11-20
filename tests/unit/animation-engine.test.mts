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
  PROP_ENTRY,
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
  assert.deepEqual(cameraAt(beat({ cameraShot: "cta-stinger" }), 40), { scale: 1, rotate: 0 });
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

test("props pop in just before their keyword is spoken (else ~0.35 s), and the pop sound lands with them", () => {
  const voiced = Array.from({ length: 150 }, () => 0.6);
  // "blender" is ~70 % into the line → ~frame 105 of 150, a few frames early, capped at 60 % of the beat
  const at = propEntryFrame("Terus nasi kemarin dimasukin ke blender aja ya", /\bblender\b/i, voiced, 150);
  assert.ok(at > 60 && at <= 90, `entry ${at}`);
  assert.equal(propEntryFrame("Tidak ada kata kunci", /\bblender\b/i, voiced, 150), PROP_ENTRY);
  assert.equal(propEntryFrame("Apa saja", null, [], 150), PROP_ENTRY);
  assert.equal(PROP_ENTRY, 11);
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
