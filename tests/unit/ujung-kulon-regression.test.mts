// Regression tests for the Ujung Kulon episode: cues that went missing after a re-pasted script, re-renders that must
// reuse cached voices, and the serious ending without a FOLLOW + card. Pure code: no database, no network, no AI.
// Run: npm run test:unit
import assert from "node:assert/strict";
import { test } from "node:test";
import { applyCuesToLines, parseManualScript, storedDirection } from "../../src/lib/manualScriptParser.ts";
import { reusableTakes } from "../../src/lib/takeReuse.ts";
import { buildBeats } from "../../video/src/beats.ts";
import { parseDirection } from "../../video/src/direction.ts";
import { coversCanvas, layersAt, propEntryFrame, speechBounds } from "../../video/src/shared/motion.ts";
import { kineticAt, sfxCuesFor } from "../../video/src/shared/sfxCues.ts";
import { END_HOLD, cueTotalFrames, outroMode, type EpisodeLine } from "../../video/src/types.ts";
import { pathTo } from "./importGraph.mts";

const LINE1_CUE = `- Line 1 (Uco): prop: peta-relokasi-jawa · layout: takeover · stat: "UJUNG KULON KE ALAS PURWO | RELOKASI LINTAS JAWA?!" · SFX: stamp · on screen: "PINDAH KE ALAS PURWO?!"`;
const SCRIPT = `Title: Badak Jawa Ujung Kulon
1. UCO (0:00-0:06 | angry): "Badak Jawa mau dipindah ke Alas Purwo?!"
[EN] "They want to move the Javan rhino to Alas Purwo?!"
2. OCU (0:06-0:12): "Tenang. Itu namanya populasi kedua."
[EN] "Relax. It's called a second population."
3. OCU (0:12-0:18 | Closing - deadpan): "Kalau tsunami datang, semuanya habis."
[EN] "If a tsunami comes, they're all gone."`;
const CUES = `LINE-BY-LINE VISUAL, ON-SCREEN TEXT & SFX CUES\n${LINE1_CUE}\n- Line 3 (Ocu): on screen: "SATU TSUNAMI = PUNAH"`;
const exact = (notes = "") => ({ ...parseDirection(notes), exact: true });
const asEpisode = (lines: ReturnType<typeof parseManualScript>["lines"], frames = 150, envelope: (n: number, i: number) => number[] = () => []) =>
  lines.map((l, i) => ({ ...l, index: i, hasAudio: true, audio: null, frames, envelope: envelope(frames, i) }) as unknown as EpisodeLine);
const speech = (n: number) => Array.from({ length: n }, (_, k) => (k < 9 || k > n - 8 ? 0.02 : 0.55 + 0.4 * Math.abs(Math.sin(k * 0.5))));

test("the Ujung Kulon line 1 cue survives parsing: prop, takeover, quoted stat with its own '|', stamp SFX, on-screen text", () => {
  for (const r of [parseManualScript({ script: `${SCRIPT}\n${CUES}` }), parseManualScript({ script: SCRIPT, direction: CUES })]) {
    const l = r.lines[0];
    assert.equal(l.prop_tag, "peta-relokasi-jawa");
    assert.equal(l.layout, "takeover");
    assert.equal(l.stat, "UJUNG KULON KE ALAS PURWO | RELOKASI LINTAS JAWA?!");
    assert.deepEqual(l.sfx, ["stamp"]);
    assert.equal(l.on_screen_text, "PINDAH KE ALAS PURWO?!");
    assert.equal(l.kinetic_text, "PINDAH KE ALAS PURWO?!");
    assert.ok(r.cueText.includes(LINE1_CUE), "the cue block is kept to be stored with the episode");
  }
});

test("…and renders its takeover, stat and callout with no loudness data (live preview) and with it (render)", () => {
  const parsed = parseManualScript({ script: SCRIPT, direction: CUES });
  for (const [mode, env] of [["preview", () => []], ["render", speech]] as const) {
    const lines = asEpisode(parsed.lines, 150, env);
    const [b] = buildBeats(lines, exact());
    assert.equal(b.layout, "takeover", mode);
    assert.deepEqual(b.stat, { headline: "UJUNG KULON KE ALAS PURWO", subline: "RELOKASI LINTAS JAWA?!" }, mode);
    assert.equal(b.kinetic, "PINDAH KE ALAS PURWO?!", mode);
    assert.equal(b.angry, true, mode);
    // everything lands early in the beat: the voice onset, the stamp callout, the stamp SFX
    assert.ok(b.speechStart <= 10, `${mode}: speech starts at ${b.speechStart}`);
    assert.ok(kineticAt(b) < b.durationInFrames / 4, mode);
    const stamp = sfxCuesFor([b], { stampAt: 10 }).filter((c) => c.name === "stamp");
    assert.ok(stamp.length >= 1 && stamp.every((c) => c.frame - b.startFrame < 20), `${mode}: ${JSON.stringify(stamp)}`);
  }
});

test("missing, flat, invalid or implausibly late loudness never hides props, callouts or cards", () => {
  assert.deepEqual(speechBounds(undefined, 120), { start: 0, end: 120 });
  assert.deepEqual(speechBounds([], 120), { start: 0, end: 120 });
  assert.deepEqual(speechBounds(Array(120).fill(0.05), 120), { start: 0, end: 120 }, "flat and quiet");
  assert.deepEqual(speechBounds([NaN, NaN, NaN], 90), { start: 0, end: 90 }, "invalid numbers");
  const late = [...Array(100).fill(0.01), ...Array(20).fill(0.7)];
  assert.deepEqual(speechBounds(late, 120), { start: 0, end: 120 }, "an onset at 3.3 s of a 4 s beat is bad data");
  assert.equal(speechBounds([...Array(12).fill(0.01), ...Array(100).fill(0.7)], 112).start, 12, "a real 0.4 s lead-in is kept");
  assert.ok(propEntryFrame("ada peta", null, [], 120, speechBounds([], 120)) < 20);
});

test("a re-pasted script keeps the episode's cues (they're stored with the direction), and new cues win", () => {
  const first = parseManualScript({ script: SCRIPT, direction: CUES });
  const stored = storedDirection(first);
  assert.ok(stored.includes(LINE1_CUE), "the cue block is part of what's stored");
  // the user pastes only the dialogue again: the stored cues apply again
  const again = parseManualScript({ script: SCRIPT, direction: stored });
  assert.equal(again.lines[0].layout, "takeover");
  assert.equal(again.lines[0].prop_tag, "peta-relokasi-jawa");
  assert.equal(again.lines[2].kinetic_text, "SATU TSUNAMI = PUNAH");
  // the stored cue block isn't read as direction notes (e.g. a "pose: cta" cue is not a CTA note)
  const d = parseDirection(`Pause 0.2s\n\n${CUES}\n- Line 2 (Ocu): pose: cta · on screen: "IKUTI KAMI"`);
  assert.equal(d.pauseS, 0.2);
  assert.equal(d.ctaText, null);
  assert.equal(d.ctaExplicit, undefined);
});

test("saving the direction box applies its line cues to the stored lines (only what the cues set)", () => {
  const bare = parseManualScript({ script: SCRIPT }).lines.map((l) => ({ ...l, asset_urls: { props: { x: "https://x" } } }));
  bare[1].kinetic_text = "EDITED IN THE BEAT TABLE";
  const { lines, changed } = applyCuesToLines(bare, CUES);
  assert.deepEqual(changed, [0, 2]);
  assert.equal(lines[0].layout, "takeover");
  assert.equal(lines[0].stat, "UJUNG KULON KE ALAS PURWO | RELOKASI LINTAS JAWA?!");
  assert.equal(lines[0].prop_tag, "peta-relokasi-jawa");
  assert.deepEqual(lines[0].sfx, ["stamp"]);
  assert.equal(lines[0].text, bare[0].text, "the dialogue is never touched");
  assert.deepEqual(lines[0].asset_urls, bare[0].asset_urls, "fields the cues don't mention are kept");
  assert.equal(lines[1].kinetic_text, "EDITED IN THE BEAT TABLE", "lines without cues keep their edits");
  assert.equal(lines[2].kinetic_text, "SATU TSUNAMI = PUNAH");
  assert.deepEqual(applyCuesToLines(lines, CUES).changed, [], "saving again changes nothing");
});

test("re-pasting unchanged dialogue reuses every cached take: zero new voice lines to generate", () => {
  const prev = parseManualScript({ script: SCRIPT }).lines;
  const next = parseManualScript({ script: SCRIPT, direction: CUES }).lines; // only cues changed
  assert.deepEqual(reusableTakes(prev, next, new Set([0, 1, 2])), [0, 1, 2]);
  // an edited line needs a new take; moved lines keep theirs; a line with no take has none to reuse
  const edited = [next[1], { ...next[0], text: "Badak Jawa mau dipindah?!" }, next[2]];
  assert.deepEqual(reusableTakes(prev, edited, new Set([0, 1, 2])), [1, -1, 2]);
  assert.deepEqual(reusableTakes(prev, next, new Set([0, 2])), [0, -1, 2]);
});

test("editing cues, style, BGM or Studio Assets and rendering never reach ElevenLabs", () => {
  const ELEVEN = [/src\/lib\/voice\/(elevenlabs|profiles)\.ts$/];
  for (const entry of [
    "src/app/create/studio-actions.ts", // paste a new version, save direction & cues, save beats, asset uploads
    "src/app/create/publish-actions.ts",
    "src/app/studio-asset-actions.ts", // the urgent BGM and sprites
    "src/app/api/render/[id]/route.ts", // the render handoff (cached takes only)
    "src/lib/render.ts", // Render video
    "video/render.mts", // the renderer itself
  ]) {
    assert.equal(pathTo(entry, ELEVEN), null, `${entry} reaches ElevenLabs via ${pathTo(entry, ELEVEN)?.join(" → ")}`);
  }
  // the check works: the booth's AI-take action does reach it
  assert.ok(pathTo("src/app/create/[id]/record/ai-actions.ts", ELEVEN));
});

test("a serious ending (no cta pose) gets no FOLLOW + card, and its last beat covers the very last frame", () => {
  const parsed = parseManualScript({ script: SCRIPT, direction: CUES });
  const lines = asEpisode(parsed.lines, 150, speech);
  const d = exact("BGM on");
  assert.equal(outroMode(lines, d), "none");
  const beats = buildBeats(lines, d);
  assert.ok(beats.every((b) => b.cameraShot !== "cta-stinger" && b.line !== null), "no outro beat, no FOLLOW +");
  assert.equal(beats.at(-1)!.kinetic, "SATU TSUNAMI = PUNAH", "the closing beat keeps its on-screen callout");
  const total = cueTotalFrames(lines, d);
  assert.equal(beats.at(-1)!.startFrame + beats.at(-1)!.durationInFrames, total, "the last beat ends on the video's last frame");
  assert.equal(total - (beats.at(-1)!.startFrame + lines.at(-1)!.frames), END_HOLD, "and holds 0.5 s after the last word");
  for (let g = 0; g < total; g++) {
    const layers = layersAt(beats, g);
    assert.ok(layers.length && coversCanvas(layers.map((l) => l.x)), `frame ${g} of ${total} is covered`);
  }
  // a last line posed cta (e.g. "Outro - cta") keeps the merged FOLLOW + outro; a direction "CTA:" note adds the card
  const ctaLines = asEpisode(parseManualScript({ script: SCRIPT.replace("Closing - deadpan", "Outro - cta") }).lines);
  assert.equal(ctaLines.at(-1)!.emotion, "cta");
  assert.equal(outroMode(ctaLines, d), "merge");
  assert.equal(buildBeats(ctaLines, d).at(-1)!.cameraShot, "cta-stinger");
  assert.equal(outroMode(lines, exact("CTA: Follow buat part 2")), "card");
  assert.equal(outroMode(lines, exact("CTA: off")), "none");
});
