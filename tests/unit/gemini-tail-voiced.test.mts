// The "chh-tsk!" at the end of every Gemini line (13 of 13 on the "kopi susu" episode, all logged as "tail cut 0 ms"
// by #63's loudness rule): the tail is now classified by its spectrum (voiced speech vs. an unvoiced high-frequency
// burst) and Gemini's payload is checked before it's read as PCM. Plus the inspecting prop nudged off Ocu's face.
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { test } from "node:test";
import { FADE_OUT_S, speechEndSeconds, speechTail } from "../../video/src/audioChain.ts";
import { VOICED, tailSummary, voicedTail } from "../../video/src/voicedTail.ts";
import { headFracFor, INSPECT_FACE_X, lensOnCanvas, fitFrameH, SOLO_H, STAGE_TOP } from "../../video/src/shared/castLayout.ts";
import { lensPropBox, SOLO_LENS_PROP } from "../../video/src/shared/motion.ts";
import { cleanPcmTailStats, geminiPcm, pcmToWav } from "../../src/lib/voice/acting.ts";
import { ROOT } from "./importGraph.mts";

const read = (f: string) => fs.readFileSync(path.join(ROOT, f), "utf8");
const SR = 24000;
let seed = 7;
const rnd = () => ((seed = (seed * 1103515245 + 12345) % 2 ** 31) / 2 ** 31) * 2 - 1;
/** voiced speech: a 300 Hz fundamental with harmonics (600-1800 Hz) and a syllable-rate envelope */
const voiced = (s: number, amp: number) =>
  Float64Array.from({ length: Math.round(s * SR) }, (_, i) => {
    const t = i / SR;
    const env = 0.6 + 0.4 * Math.sin(2 * Math.PI * 4 * t);
    return (amp * env * (Math.sin(2 * Math.PI * 300 * t) + 0.6 * Math.sin(2 * Math.PI * 600 * t) + 0.4 * Math.sin(2 * Math.PI * 900 * t) + 0.25 * Math.sin(2 * Math.PI * 1200 * t) + 0.15 * Math.sin(2 * Math.PI * 1800 * t))) / 2.4;
  });
const silence = (s: number) => new Float64Array(Math.round(s * SR));
/** the "chh-tsk!": broadband noise between 4 and 9 kHz (random-phase sines), peak at `amp` */
const chhTsk = (s: number, amp: number) => {
  const comps = Array.from({ length: 48 }, () => ({ f: 4000 + ((rnd() + 1) / 2) * 5000, p: rnd() * Math.PI }));
  const raw = Float64Array.from({ length: Math.round(s * SR) }, (_, i) => comps.reduce((a, c) => a + Math.sin((2 * Math.PI * c.f * i) / SR + c.p), 0));
  const pk = Math.max(...raw.map(Math.abs));
  return raw.map((v) => (v / pk) * amp);
};
const pcm16 = (...parts: Float64Array[]) => {
  const out = new Int16Array(parts.reduce((a, p) => a + p.length, 0));
  let o = 0;
  for (const p of parts) for (const v of p) out[o++] = Math.round(Math.max(-1, Math.min(1, v)) * 32767);
  return out;
};
const minus6 = 10 ** (-6 / 20);
const peak = (a: ArrayLike<number>, from = 0, to = a.length) => {
  let m = 0;
  for (let i = from; i < to; i++) m = Math.max(m, Math.abs(a[i]));
  return m;
};

// ------------------------------------------------------------------ 1. voiced-speech tail trimming
test("a loud 220 ms 4-9 kHz 'chh-tsk!' (−6 dB) after a 40 ms dip is stripped whole; the voiced last syllable stays", () => {
  const take = pcm16(voiced(1.8, 0.5), silence(0.04), chhTsk(0.22, minus6));
  const r = speechTail(take, SR);
  assert.equal(r.mode, "voiced");
  assert.ok(Math.abs(r.lastVoicedMs! - 1800) <= 10, `last voiced ${r.lastVoicedMs}`);
  assert.ok(r.endMs >= 1800 && r.endMs <= 1800 + VOICED.padMs + 10, `cut at ${r.endMs}`);
  assert.equal(r.burstMs, 220);
  assert.ok(r.gapMs >= 30 && r.gapMs <= 50);
  assert.ok(r.burstHfDb! > 10 && r.burstZcr! > 0.3, "a noise signature: high-frequency energy over the speech band, many zero crossings");
  // the stored take: every voiced sample kept, nothing of the burst left, fading to zero over 45 ms
  const { pcm, keptMs } = cleanPcmTailStats(new Uint8Array(take.buffer), SR);
  const out = new Int16Array(pcm.buffer, pcm.byteOffset, pcm.length / 2);
  assert.ok(keptMs >= 1800 && keptMs <= 1850, `${keptMs}`);
  assert.deepEqual(Array.from(out.subarray(0, Math.round(1.75 * SR))), Array.from(take.subarray(0, Math.round(1.75 * SR))), "the speech is untouched");
  assert.equal(out.at(-1), 0);
  assert.ok(peak(out, Math.round(1.8 * SR)) < peak(take, Math.round(1.84 * SR)) * 0.2, "no burst in what's kept");
  assert.equal(FADE_OUT_S, 0.045);
  assert.match(tailSummary(r), /^2060 → \d+ ms \(voiced; last word ends \d+ ms, gap \d+ ms, burst 220 ms, hf \+\d+(\.\d)? dB, zcr 0\.\d+ \(cut\)\)$/);
});

test("the burst is cut however close or loud it is: touching the syllable, louder than the speech", () => {
  for (const [name, take] of [
    ["no gap at all", pcm16(voiced(1.8, 0.5), chhTsk(0.22, minus6))],
    ["10 ms gap", pcm16(voiced(1.8, 0.5), silence(0.01), chhTsk(0.25, minus6))],
    ["louder than the speech", pcm16(voiced(1.8, 0.2), silence(0.04), chhTsk(0.16, 0.9))],
    ["at the very end of the file (no silence after)", pcm16(voiced(1.8, 0.5), silence(0.02), chhTsk(0.2, minus6))],
  ] as const) {
    const end = speechEndSeconds(take, SR);
    assert.ok(end >= 1.8 && end <= 1.8 + 0.055, `${name}: ${end}`);
  }
});

test("quiet thought whispers and real word endings stay intact", () => {
  // a muttered thought (−30 dB) followed by the loud burst: the whisper is kept, the burst cut
  const thought = pcm16(voiced(1.5, 0.03), silence(0.04), chhTsk(0.22, minus6));
  const t = speechTail(thought, SR);
  assert.equal(t.mode, "voiced");
  assert.ok(t.endMs >= 1500 && t.endMs <= 1555, `${t.endMs}`);
  // a clean ending: just the 45 ms pad
  assert.ok(Math.abs(speechEndSeconds(pcm16(voiced(1.8, 0.5), silence(0.3)), SR) - 1.845) < 0.012);
  // a short voiced last word after a pause ("lho") is speech
  assert.ok(speechEndSeconds(pcm16(voiced(1.0, 0.5), silence(0.1), voiced(0.12, 0.4), silence(0.2)), SR) >= 1.22);
  // a word's own quiet final fricative ("-s", 100 ms, 20 dB down, touching the vowel) is kept
  const s = speechTail(pcm16(voiced(1.8, 0.5), chhTsk(0.1, 0.05), silence(0.1)), SR);
  assert.equal(s.keptFricativeMs, 100);
  assert.ok(s.endMs >= 1900);
  // a take with almost no voiced speech (a full whisper, all noise) falls back to the loudness gate, never cut to nothing
  const whisper = pcm16(chhTsk(0.8, 0.1), silence(0.2));
  const w = speechTail(whisper, SR);
  assert.equal(w.mode, "energy");
  assert.ok(w.endMs >= 800);
});

test("the gate runs before storage (Stage A), around RVC and before loudnorm in the render; diagnostics in the run log", () => {
  const gem = read("src/lib/voice/gemini.ts");
  assert.match(gem, /const \{ pcm, \.\.\.payload \} = geminiPcm\(new Uint8Array\(Buffer\.from\(part\.data, "base64"\)\), part\.mimeType\);\s*const clean = cleanPcmTailStats\(pcm, payload\.rate\);/);
  assert.match(read("video/audio-tail.mts"), /return speechTail\(new Int16Array\(pcm\.buffer, pcm\.byteOffset, Math\.floor\(pcm\.byteLength \/ 2\)\), 48000\);/);
  const render = read("video/render.mts");
  assert.match(render, /if \(line\.index < 3\) log\(`line \$\{n\} tail: \$\{tailSummary\(tail\)\}`\);/);
  assert.ok(render.indexOf("const tail = speechTailOf(trimmed);") < render.indexOf("cutAt(end) + tighten"), "cut before the compressor / loudnorm");
  assert.match(read("src/lib/scheduler-server.ts"), /if \(l\.index < 3\) trims\.push\(`line \$\{l\.index \+ 1\} detail: payload \$\{t\.payload\}; tail \$\{t\.summary\}`\);/);
  assert.equal(voicedTail(new Int16Array(0), SR, 0).mode, "energy");
});

// ------------------------------------------------------------------ 2. Gemini's inlineData
test("inlineData: raw L16 PCM kept as is; a WAV container's data chunk only; trailer chunks stripped; MP3 / OGG refused", () => {
  const speech = pcm16(voiced(0.2, 0.5));
  const raw = new Uint8Array(speech.buffer);
  const r = geminiPcm(raw, "audio/L16;codec=pcm;rate=24000");
  assert.deepEqual([r.container, r.rate, r.bytes, r.strippedBytes, r.pcm.length], ["raw", 24000, raw.length, 0, raw.length]);
  // a stray odd byte
  const odd = new Uint8Array(raw.length + 1);
  odd.set(raw);
  assert.equal(geminiPcm(odd, "audio/L16;rate=24000").pcm.length, raw.length);
  // raw PCM with a RIFF LIST / INFO trailer appended (it would play as a noise burst at the end)
  const tag = new TextEncoder().encode("LIST\x1a\x00\x00\x00INFOISFT\x0e\x00\x00\x00Lavf60.16.100\x00");
  const withTrailer = new Uint8Array(raw.length + tag.length);
  withTrailer.set(raw);
  withTrailer.set(tag, raw.length);
  const t = geminiPcm(withTrailer, "audio/L16;rate=24000");
  assert.deepEqual([t.pcm.length, t.strippedBytes], [raw.length, tag.length]);
  // a WAV container (at 22.05 kHz) with a LIST chunk after its data: only the data chunk, at the fmt chunk's rate
  const wav = pcmToWav(raw, 22050);
  const container = new Uint8Array(wav.length + tag.length);
  container.set(wav);
  container.set(tag, wav.length);
  const w = geminiPcm(container, "audio/wav");
  assert.deepEqual([w.container, w.rate, w.pcm.length], ["wav", 22050, raw.length]);
  assert.deepEqual(Array.from(w.pcm.subarray(0, 8)), Array.from(raw.subarray(0, 8)));
  // a compressed format is refused, never read as PCM noise
  assert.throws(() => geminiPcm(new Uint8Array([0x49, 0x44, 0x33, 4, 0, 0, 0, 0]), "audio/mpeg"), /returned MP3 audio, not raw PCM/);
  assert.throws(() => geminiPcm(new TextEncoder().encode("OggS\0\x02rest"), "audio/ogg"), /returned OGG audio/);
  // the payload is what the first lines' log describes
  assert.match(read("src/lib/voice/providers.ts"), /payload: `\$\{payload\.mime \|\| "no mime type"\}, \$\{payload\.bytes\} bytes, \$\{payload\.rate\} Hz, \$\{payload\.container\}/);
});

// ------------------------------------------------------------------ 3. the inspecting prop
test("solo inspecting: the prop sits off Ocu's glasses and nose (right of his right pupil), clear of the right icon rail", () => {
  const O = headFracFor("ocu", "inspecting");
  const H = fitFrameH(O.frac, SOLO_H);
  const s = H / 340;
  const w = 180 * s;
  const fig = { cx: INSPECT_FACE_X - O.frac.faceX * w + w / 2, top: 1920 - H, s };
  const k = w / 900;
  const left = fig.cx - w / 2;
  const lens = lensOnCanvas(fig, O.lens)!;
  const box = lensPropBox(lens, SOLO_LENS_PROP.size, STAGE_TOP, SOLO_LENS_PROP);
  const before = lensPropBox(lens, 330, STAGE_TOP);
  // the measured eyes (spriteCalibration OCU_EYES: x 394 / 543, y ~508) and the nose (face centre, x 493)
  const rightPupil = { x: left + 543 * k, y: fig.top + 507 * k };
  const nose = left + 493 * k;
  assert.ok(before.x < rightPupil.x, "the first placement covered the glasses");
  assert.ok(box.x > rightPupil.x && box.x > nose, `left edge ${box.x} right of the right pupil (${rightPupil.x}) and the nose (${nose})`);
  assert.ok(box.x - before.x >= 70, "moved right by at least 70 px");
  assert.ok(box.y + box.h <= before.y + before.h - 40 + 1e-9, "bottom 40 px higher");
  assert.ok(box.x + box.w <= 940, "clear of the right-hand icon rail");
  assert.ok(box.y + box.h <= lens.y && box.y + box.h >= lens.y - lens.r - 60, "still right above the lens");
  assert.match(read("video/src/shared/Director.tsx"), /lensPropBox\(lens, SOLO_LENS_PROP\.size, STAGE_TOP, SOLO_LENS_PROP\)/);
});
