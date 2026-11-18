// Splitting a full voice-over into one clip per line (synthetic audio: tones for speech, near-silence for pauses).
import assert from "node:assert/strict";
import { encodeWav, frameLoudness, segments, splitLines } from "../../src/lib/voiceover-split.ts";

const SR = 16000;
function build(parts: [kind: "speech" | "pause", seconds: number][]) {
  const total = parts.reduce((a, [, s]) => a + s, 0);
  const out = new Float32Array(Math.round(total * SR));
  let i = 0;
  for (const [kind, s] of parts) {
    const n = Math.round(s * SR);
    for (let j = 0; j < n; j++, i++) {
      const t = i / SR;
      out[i] = kind === "speech" ? 0.4 * Math.sin(2 * Math.PI * 180 * t) * (0.6 + 0.4 * Math.sin(2 * Math.PI * 3 * t)) : (Math.random() - 0.5) * 0.002;
    }
  }
  return out;
}

// 4 lines; line 2 has a short breath (0.3 s) in the middle, the real line breaks are 0.6–0.9 s.
const audio = build([
  ["pause", 0.5], ["speech", 2.0], ["pause", 0.8],
  ["speech", 1.2], ["pause", 0.3], ["speech", 1.3], ["pause", 0.7],
  ["speech", 1.5], ["pause", 0.9],
  ["speech", 2.2], ["pause", 0.6],
]);
const rms = frameLoudness(audio, SR);
const split = splitLines(rms, [8, 10, 6, 9]); // word counts
assert.equal(split.cuts.length, 3);
assert.ok(split.gaps.length >= 4, `gaps: ${JSON.stringify(split.gaps)}`);
const near = (a: number, b: number) => Math.abs(a - b) < 0.2;
assert.ok(near(split.cuts[0], 2.9), `cut 1 at ${split.cuts[0]}`); // middle of the 0.8 s pause (2.5–3.3)
assert.ok(near(split.cuts[1], 6.45), `cut 2 at ${split.cuts[1]}`); // the 0.7 s pause (6.1–6.8), not the 0.3 s breath
assert.ok(near(split.cuts[2], 8.75), `cut 3 at ${split.cuts[2]}`);
assert.ok(split.chosen.every((c) => c !== null));
const segs = segments(split, audio.length / SR);
assert.equal(segs.length, 4);
assert.ok(segs[0].start < 0.5 && segs[3].end > 10.9);

// fewer pauses than lines: still N clips, cuts in order, unmatched ones flagged
const run = build([["pause", 0.4], ["speech", 3], ["pause", 0.8], ["speech", 3], ["pause", 0.4]]);
const s2 = splitLines(frameLoudness(run, SR), [5, 5, 5]);
assert.equal(s2.cuts.length, 2);
assert.ok(s2.cuts[0] < s2.cuts[1]);
assert.equal(s2.chosen.filter((c) => c === null).length, 1);

const wav = new Uint8Array(encodeWav(new Float32Array([0, 0.5, -0.5]), SR));
assert.equal(String.fromCharCode(...wav.slice(0, 4)), "RIFF");
assert.equal(wav.length, 44 + 6);
console.log("voiceover split: ok", split.cuts.map((c) => c.toFixed(2)).join(", "));
