// The Koran Kinetik motion & staging upgrade: reactive two-shot listeners, the prop at Ocu's magnifying glass, animated
// takeover stat cards (staggered slam, number count-up), and the editorial SFX budget. Pure code, no rendering.
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { test } from "node:test";
import { headFracFor, INSPECT_FACE_X, INSPECT_PAIR_X, lensOnCanvas, fitFrameH, SOLO_H, PAIR_H, STAGE_TOP } from "../../video/src/shared/castLayout.ts";
import { buildBeats, listenerPoseFor, type EpisodeLine } from "../../video/src/beats.ts";
import { koranPoses } from "../../video/src/koran/poses.ts";
import { bgmDropOut, bgmLevel, DROP_OUT_FRAMES } from "../../video/src/shared/bgm.ts";
import { COUNT_FRAMES, LOCK_POP_FRAMES, TAKEOVER_STEPS, countUp, ctaTapFrame, lensHover, lensPropBox, statNumber, takeoverTimeline } from "../../video/src/shared/motion.ts";
import { ACCENT_BUDGET, sfxCuesFor } from "../../video/src/shared/sfxCues.ts";
import { ROOT } from "./importGraph.mts";

const read = (f: string) => fs.readFileSync(path.join(ROOT, f), "utf8");
const line = (o: Record<string, unknown>, i: number) =>
  ({ index: i, beat: "escalation", speaker: i % 2 ? "ocu" : "uco", text: "Baris biasa", subtitle: "A plain line", expression: "calm", thought_bubble: false, hasAudio: true, audio: null, frames: 120, envelope: [], start_s: null, prop_tag: "none", sfx: [], ...o }) as EpisodeLine;
const EXACT = { exact: true } as never;

// ------------------------------------------------------------------ 1. reactive two-shot listener
test("two-shot listener: Uco is never a smiling triumphant while Ocu explains, inspects, deadpans or warns", () => {
  for (const emotion of ["explaining", "inspecting", "deadpan", "angry"] as const) {
    for (const text of ["Itu namanya bias konfirmasi.", "Tagihan lo 9 juta!", "Batu kali dicat ungu lima puluh ribu?"]) {
      const pose = listenerPoseFor({ speaker: "ocu", text, subtitle: "", thought_bubble: false }, { emotion, cameraShot: "two-shot" });
      assert.ok(pose === "shocked" || pose === "defensive", `${emotion} "${text}": ${pose}`);
    }
  }
  // a loud line / a number / an angry delivery → shocked; a calm explanation → defensive
  assert.equal(listenerPoseFor({ speaker: "ocu", text: "Kampus ngajarin teori lawas.", subtitle: "", thought_bubble: false }, { emotion: "explaining", cameraShot: "two-shot" }), "defensive");
  assert.equal(listenerPoseFor({ speaker: "ocu", text: "Itu 53 persen lulusan.", subtitle: "", thought_bubble: false }, { emotion: "explaining", cameraShot: "two-shot" }), "shocked");
  // a script asking for a smug listener during a roast is overruled; any other listener pose it names is kept
  assert.equal(listenerPoseFor({ speaker: "ocu", text: "Lo ketipu.", subtitle: "", thought_bubble: false, listener_pose: "triumphant" }, { emotion: "deadpan", cameraShot: "two-shot" }), "defensive");
  assert.equal(listenerPoseFor({ speaker: "ocu", text: "Lo ketipu.", subtitle: "", thought_bubble: false, listener_pose: "phone" }, { emotion: "deadpan", cameraShot: "two-shot" }), "phone");
  // Ocu listening to Uco stays deadpan; solo shots and thoughts have no listener
  assert.equal(listenerPoseFor({ speaker: "uco", text: "Gue bilang investasi!", subtitle: "", thought_bubble: false }, { emotion: "triumphant", cameraShot: "two-shot" }), "deadpan");
  assert.equal(listenerPoseFor({ speaker: "ocu", text: "x", subtitle: "", thought_bubble: false }, { emotion: "deadpan", cameraShot: "solo-ocu" }), null);
  // end to end: the live b11 / b15 two-shots ("Batu kali dicat ungu…", "Nama lo salah ketik…", Ocu inspecting)
  const beats = koranPoses(
    buildBeats([line({ speaker: "uco", text: "Batu kristal ungu gue udah dijemur." }, 0), line({ speaker: "ocu", emotion: "inspecting", camera_shot: "two-shot", text: "Nama lo salah ketik dan webinar-nya seminar cara jualan." }, 1)], EXACT),
    [],
  );
  assert.equal(beats[1].cameraShot, "two-shot");
  assert.equal(beats[1].listenerPose, "defensive");
  // the Director draws the listener with that pose, dimmed (brightness 0.82) and stepped back; the speaker forward
  const dir = read("video/src/shared/Director.tsx");
  assert.match(dir, /who !== beat\.speaker && beat\.listenerPose \? beat\.listenerPose : beat\.emotion/);
  assert.match(dir, /export const LISTENER_DIM = 0\.18;/);
  assert.match(dir, /if \(pair\) parts\.push\(`scale\(\$\{p\.on \? 1\.04 : 0\.96\}\)`\);/);
});

// ------------------------------------------------------------------ 2. the prop at the magnifying glass
test("inspecting: the prop sits right at Ocu's magnifying-glass lens (solo and two-shot), inside the safe columns", () => {
  const O = headFracFor("ocu", "inspecting");
  assert.ok(O.lens, "the inspecting pose has a measured lens");
  const place = (H: number, faceX: number) => {
    const s = H / 340;
    const w = 180 * s;
    return { cx: faceX - O.frac.faceX * w + w / 2, top: 1920 - H, s };
  };
  for (const [name, fig, size] of [["solo-ocu", place(fitFrameH(O.frac, SOLO_H), INSPECT_FACE_X), 330], ["two-shot", place(fitFrameH(O.frac, PAIR_H), INSPECT_PAIR_X.ocu), 260]] as const) {
    const lens = lensOnCanvas(fig, O.lens)!;
    const box = lensPropBox(lens, size, STAGE_TOP);
    const cx = box.x + box.w / 2;
    // on the lens's side of the frame (Ocu's right / the viewer's right of his face), touching the lens from above
    assert.ok(lens.x > 540, `${name}: lens right of centre (${lens.x})`);
    assert.ok(cx > 540, `${name}: prop in the right half (${cx}), not across the frame`);
    assert.ok(Math.abs(cx - lens.x) <= size * 0.6, `${name}: prop centred near the lens (${cx} vs ${lens.x})`);
    assert.ok(box.y + box.h >= lens.y - lens.r && box.y + box.h <= lens.y, `${name}: its lower edge on the lens's upper rim`);
    assert.ok(box.x >= 60 && box.x + box.w <= 940 && box.y >= STAGE_TOP, `${name}: inside the safe area ${JSON.stringify(box)}`);
  }
  // it floats and pulses gently
  const hs = [0, 10, 20, 30].map(lensHover);
  assert.ok(hs.every((h) => Math.abs(h.dy) <= 6 && h.scale >= 1 && h.scale <= 1.04));
  assert.ok(new Set(hs.map((h) => h.dy.toFixed(2))).size > 1);
  assert.match(read("video/src/shared/Director.tsx"), /beat\.emotion === "inspecting" && ocuOn && \(beat\.propImage \|\| beat\.sceneImageUrl\) && ocuFig \? lensOnCanvas\(ocuFig, O\.lens\) : null/);
});

// ------------------------------------------------------------------ 3. takeover stat cards
test("takeover stat card numbers: extracted Indonesian-style and counted up over 0.6 s with a pop on the lock", () => {
  assert.deepEqual(statNumber("9,6 JUTA"), { value: 9.6, decimals: 1, thousands: false, start: 0, end: 3 });
  assert.deepEqual(statNumber("2.800+ KASUS"), { value: 2800, decimals: 0, thousands: true, start: 0, end: 5 });
  assert.equal(statNumber("76%")!.value, 76);
  assert.equal(statNumber("10 KALI LIPAT")!.value, 10);
  assert.equal(statNumber("RP 35 RIBU")!.start, 3);
  assert.equal(statNumber("JUTAAN NGANGGUR"), null);
  const at = 12;
  const start = at + TAKEOVER_STEPS.card[0];
  assert.equal(COUNT_FRAMES, 18);
  // before the card lands: zero, in the headline's own format
  assert.equal(countUp("9,6 JUTA", start, at).text, "0,0 JUTA");
  assert.equal(countUp("2.800+ KASUS", start, at).text, "0+ KASUS");
  // counting: rising frame by frame, thousands dots kept, never past the value
  const seq = Array.from({ length: COUNT_FRAMES }, (_, k) => countUp("2.800+ KASUS", start + k, at));
  const nums = seq.map((c) => Number(c.number!.replace(/\./g, "")));
  for (let k = 1; k < nums.length; k++) assert.ok(nums[k] >= nums[k - 1] && nums[k] <= 2800);
  assert.ok(seq.some((c) => /^\d\.\d{3}\+ KASUS$/.test(c.text)), "1.400-style formatting while counting");
  assert.ok(seq.every((c) => c.counting && c.scale === 1));
  // locks on the exact headline, then a 1.15× overshoot pop over 6 frames, then settles
  const lock = countUp("9,6 JUTA", start + COUNT_FRAMES, at);
  assert.deepEqual([lock.text, lock.counting], ["9,6 JUTA", false]);
  const pops = Array.from({ length: LOCK_POP_FRAMES + 2 }, (_, k) => countUp("9,6 JUTA", start + COUNT_FRAMES + k, at).scale);
  assert.ok(Math.max(...pops) > 1.14 && Math.max(...pops) <= 1.15 + 1e-9);
  assert.equal(pops.at(-1), 1);
  assert.equal(countUp("76%", start + 9, at).text.endsWith("%"), true);
  assert.deepEqual(countUp("JUTAAN NGANGGUR", start + 5, at), { text: "JUTAAN NGANGGUR", scale: 1, counting: false, number: null, final: null });
});

test("takeover entrance is staggered: strip slam 0-6 (4 px shake), red card 4-12, subline wipe 12-18; never a frozen slide", () => {
  const at = 10;
  const t = (k: number) => takeoverTimeline(at + k, at);
  assert.deepEqual([t(0).strip, t(0).card, t(0).sub], [0, 0, 0]);
  assert.ok(t(3).strip > 0 && t(3).card === 0, "strip first");
  assert.ok(t(8).strip === 1 && t(8).card > 0 && t(8).card < 1 && t(8).sub === 0, "then the card");
  assert.ok(t(15).card === 1 && t(15).sub > 0 && t(15).sub < 1, "then the subline");
  assert.deepEqual([t(18).strip, t(18).card, t(18).sub], [1, 1, 1]);
  assert.equal(Math.abs(t(0).shake.x), 4);
  assert.ok(t(6).shake.x === 0 && t(6).shake.y === 0, "settled after 6 frames");
  // the card renders the count-up, the subline wipe, the drifting halftone and the progress underline
  const stage = read("video/src/shared/VisualStage.tsx");
  for (const rx of [/countUp\(stat\.headline\.toUpperCase\(\), frame, at\)/, /clipPath: `inset\(0 \$\{\(1 - tl\.sub\) \* 100\}% 0 0\)`/, /backgroundPosition: reduced \? undefined : `\$\{\(frame \* 0\.6\) % 22\}px/, /width: `\$\{progress \* 100\}%`/]) assert.match(stage, rx);
  assert.match(read("video/src/shared/Director.tsx"), /const cameoBounce = reduced \? 0 : -10 \* Math\.min\(1, level\);/);
});

// ------------------------------------------------------------------ 4. editorial SFX budget
test("SFX budget: takeover cards, new props, at most 3 spaced impact accents and the CTA flip; never plain dialogue cuts", () => {
  // 20 plain back-and-forth lines: silence
  assert.deepEqual(sfxCuesFor(buildBeats(Array.from({ length: 20 }, (_, i) => line({ sfx: ["whoosh", "stamp"] }, i)), EXACT), { ding: true }), []);
  // 12 shocked lines in a row: 3 accents, each at least 3 beats after the last
  const shocked = buildBeats(Array.from({ length: 12 }, (_, i) => line({ speaker: "uco", text: "Hah serius?!", expression: "shocked", kinetic_text: "HAH" }, i)), EXACT);
  const cues = sfxCuesFor(shocked, { ding: true });
  const beatOf = (f: number) => shocked.findIndex((b) => f >= b.startFrame && f < b.startFrame + b.durationInFrames);
  const idx = cues.map((c) => beatOf(c.frame));
  assert.equal(cues.length, ACCENT_BUDGET.max);
  for (let k = 1; k < idx.length; k++) assert.ok(idx[k] - idx[k - 1] >= ACCENT_BUDGET.minGap);
  assert.ok(cues.every((c) => c.name === "stamp" && c.volume === 0.22), "a red callout accent: a light stamp");
  // the outro flip: a ding exactly when FOLLOW + flips to FOLLOWED ✔ (a pop when there's no ding file)
  const withOutro = buildBeats([line({}, 0), line({ speaker: "ocu", emotion: "cta", text: "Follow @uco.ocu!" }, 1)], { exact: true, cta: true, ctaText: "FOLLOW @UCO.OCU" } as never);
  const outro = withOutro.find((b) => b.cameraShot === "cta-stinger")!;
  assert.deepEqual(sfxCuesFor(withOutro, { ding: true }).filter((c) => c.name === "ding").map((c) => c.frame), [outro.startFrame + ctaTapFrame(outro.durationInFrames)]);
  assert.equal(sfxCuesFor(withOutro, { ding: false }).at(-1)!.name, "pop");
  assert.match(read("video/src/shared/Director.tsx"), /<FollowPill skin=\{skin\.prop\} frame=\{frame\} reduced=\{reduced\} tap=\{tap\} \/>/, "the pill flips at the same tap frame");
});

test("the music drops out for 0.25 s right before the final punchline lands, then comes back", () => {
  const env = Array.from({ length: 120 }, (_, f) => (f >= 10 && f < 110 ? 0.5 : 0));
  const lines = [line({ envelope: env }, 0), line({ speaker: "uco", beat: "button", envelope: env, text: "Tetap beli!" }, 1), line({ speaker: "ocu", emotion: "cta", text: "Follow @uco.ocu!", envelope: env }, 2)];
  const beats = buildBeats(lines, { exact: true, cta: true, ctaText: "FOLLOW @UCO.OCU" } as never);
  const drop = bgmDropOut(beats)!;
  const outro = beats.findIndex((b) => b.cameraShot === "cta-stinger");
  const punch = beats[outro - 1];
  assert.equal(drop.to, punch.startFrame + punch.speechStart, "silence until the punchline's voice lands");
  assert.equal(drop.to - drop.from, DROP_OUT_FRAMES);
  assert.equal(DROP_OUT_FRAMES, 8);
  for (let f = drop.from; f < drop.to; f++) assert.equal(bgmLevel(beats, lines, 0.2, 0, f), 0);
  assert.ok(bgmLevel(beats, lines, 0.2, 0, drop.to + 1) > 0, "back with the punchline");
  assert.ok(bgmLevel(beats, lines, 0.2, 0, drop.from - 1) > 0);
});
