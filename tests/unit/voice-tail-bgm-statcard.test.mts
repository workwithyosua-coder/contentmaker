// Regression tests from the "100 lamaran kerja / 9,9 juta NEET" render (82.2 s): a loud "tsk" after the last word of
// every Gemini line, no audible music before 0:51, stat card sublines cut mid-word, "Uko", PSIKOLOGI / GRAFIK on cards
// with no concept or graph, and an 82 s runtime. ffmpeg is used for the audio checks (as the worker does); no network.
import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";
import { FADE_OUT_S, PAUSES, TRIM, fades, speechEndSeconds } from "../../video/src/audioChain.ts";
import { PREPARED_BED, bgmFile, registerRemoteAssets, resetRemoteAssets } from "../../video/src/assets/index.ts";
import { STAT_MAX, cardHeader, clampWords, overlayFor, parseStat } from "../../video/src/beats.ts";
import { BED_CHAIN } from "../../video/src/shared/bgm.ts";
import { statCardText } from "../../video/src/shared/motion.ts";
import { STAT_SUBLINE_MAX, sanitizeScript } from "../../src/lib/scheduler.ts";
import { FORMAT_SPEC, showBiblePrompt } from "../../src/lib/showBible.ts";
import { cleanPcmTail, geminiSpeech } from "../../src/lib/voice/acting.ts";
import { edgeJobs } from "../../src/lib/voice/edge.ts";
import { ttsText } from "../../src/lib/voice/phonetic.ts";
import { ROOT } from "./importGraph.mts";

const read = (f: string) => fs.readFileSync(path.join(ROOT, f), "utf8");
const SR = 24000;
const tone = (s: number, amp: number) => Float64Array.from({ length: Math.round(s * SR) }, (_, i) => amp * (0.55 + 0.45 * Math.sin((2 * Math.PI * 4 * i) / SR)) * Math.sin((2 * Math.PI * 170 * i) / SR));
const silence = (s: number) => new Float64Array(Math.round(s * SR));
/** A 15 ms click (a "tsk"): a Hann-windowed noise burst, deterministic. */
const click = (amp: number) => {
  let seed = 7;
  const n = Math.round(0.015 * SR);
  return Float64Array.from({ length: n }, (_, i) => {
    seed = (seed * 1103515245 + 12345) % 2 ** 31;
    return amp * (seed / 2 ** 30 - 1) * 0.5 * (1 - Math.cos((2 * Math.PI * i) / (n - 1)));
  });
};
const join = (...parts: Float64Array[]) => {
  const out = new Int16Array(parts.reduce((a, p) => a + p.length, 0));
  let o = 0;
  for (const p of parts) for (const v of p) out[o++] = Math.round(Math.max(-1, Math.min(1, v)) * 32767);
  return out;
};
/** A Gemini-like take: 1.6 s of speech (peak ≈ −9 dBFS), 0.1 s silence, the click (≈ −29 dBFS), 0.25 s silence. */
const geminiTake = () => join(tone(1.6, 0.35), silence(0.1), click(0.05), silence(0.25));
const hasFfmpeg = spawnSync("ffmpeg", ["-version"]).status === 0;

// ------------------------------------------------------------------ 1. the "tsk" after the last word
test("the tail gate ends a take at its last word: the click after it is dropped, syllable gaps and a short last word kept", () => {
  assert.ok(Math.abs(speechEndSeconds(geminiTake(), SR) - 1.65) < 0.02, "1.6 s of speech + the 50 ms pad, the click gone");
  // no click: just the pad after the speech
  assert.ok(Math.abs(speechEndSeconds(join(tone(1.6, 0.35), silence(0.4)), SR) - 1.65) < 0.02);
  // a pause between words (80 ms) is bridged; a short last word ("lho", 120 ms) after a real pause stays
  const words = join(tone(0.6, 0.35), silence(0.08), tone(0.5, 0.35), silence(0.2), tone(0.12, 0.3), silence(0.3));
  assert.ok(Math.abs(speechEndSeconds(words, SR) - (0.6 + 0.08 + 0.5 + 0.2 + 0.12 + 0.05)) < 0.02);
  // a take that is only one short sound keeps it
  assert.ok(speechEndSeconds(join(silence(0.1), click(0.3), silence(0.1)), SR) > 0.1);
});

test("Stage A: Gemini's PCM is cut at the last word with a 40 ms fade to zero (and whole samples only) before it's stored", () => {
  const take = geminiTake();
  const bytes = new Uint8Array(take.buffer.byteLength + 1); // + a stray odd byte
  bytes.set(new Uint8Array(take.buffer));
  const clean = cleanPcmTail(bytes, SR);
  assert.equal(clean.length % 2, 0);
  const out = new Int16Array(clean.buffer, clean.byteOffset, clean.length / 2);
  assert.ok(Math.abs(out.length / SR - 1.65) < 0.02, `${out.length / SR} s`);
  assert.equal(out.at(-1), 0, "ends at zero");
  const fade = Math.round(FADE_OUT_S * SR);
  assert.ok(Math.abs(out[out.length - fade / 2]) <= Math.abs(take[out.length - fade / 2]) * 0.55 + 1, "half way down the 40 ms fade");
  assert.equal(FADE_OUT_S, 0.04);
  assert.match(read("src/lib/voice/gemini.ts"), /pcmToWav\(cleanPcmTail\(new Uint8Array\(Buffer\.from\(part\.data, "base64"\)\), rate\), rate\)/);
});

test("Stage B and the render gate the tail: before RVC, after RVC (40 ms fade), after Edge, and on every cached take before loudnorm", () => {
  const rvc = read("video/rvc-stage.mts");
  assert.match(rvc, /const end = speechEnd\(raw\);\s*execFileSync\("ffmpeg", \[[^\]]*"-af", cutAt\(end\)\.slice\(0, -1\), "-ac", "1", "-ar", "44100", input\]\);/, "RVC never gets the click or the noise floor after the last word");
  assert.match(rvc, /const seconds = speechEnd\(j\.output\);[\s\S]*?`\$\{cutAt\(seconds\)\}highpass=f=20,\$\{fades\(seconds\)\}`/, "and whatever RVC adds after it is cut, then faded");
  assert.match(read("video/edge-stage.mts"), /cutAt\(speechEnd\(trimmed\)\) \+ LEVEL/);
  assert.match(read("video/render.mts"), /const end = speechEnd\(trimmed\);\s*ffmpeg\("-i", trimmed, "-af", cutAt\(end\) \+ tighten/, "the gate runs before the compressor / loudnorm");
  assert.match(fades(2), /afade=t=out:st=1\.960:d=0\.04$/);
});

test("the old chain kept the click and lifted it ~9 dB; the gated chain ends on the last word (ffmpeg, as in the worker)", { skip: !hasFfmpeg && "no ffmpeg" }, () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "tail-"));
  const wav = (f: string, pcm: Int16Array, rate = SR) => {
    const h = Buffer.alloc(44);
    h.write("RIFF", 0); h.writeUInt32LE(36 + pcm.byteLength, 4); h.write("WAVEfmt ", 8); h.writeUInt32LE(16, 16); h.writeUInt16LE(1, 20); h.writeUInt16LE(1, 22);
    h.writeUInt32LE(rate, 24); h.writeUInt32LE(rate * 2, 28); h.writeUInt16LE(2, 32); h.writeUInt16LE(16, 34); h.write("data", 36); h.writeUInt32LE(pcm.byteLength, 40);
    fs.writeFileSync(path.join(dir, f), Buffer.concat([h, Buffer.from(pcm.buffer)]));
  };
  const ff = (...a: string[]) => execFileSync("ffmpeg", ["-nostdin", "-loglevel", "error", "-y", ...a], { cwd: dir });
  const samples = (f: string) => {
    const b = execFileSync("ffmpeg", ["-nostdin", "-loglevel", "error", "-i", path.join(dir, f), "-f", "s16le", "-ac", "1", "-ar", "48000", "-"], { maxBuffer: 1 << 26 });
    return new Int16Array(b.buffer, b.byteOffset, b.byteLength / 2);
  };
  const peakDb = (s: Int16Array, from: number, to: number) => 20 * Math.log10(Math.max(1, ...Array.from(s.subarray(Math.round(from * 48000), Math.round(to * 48000)), Math.abs)) / 32768);
  const LEVEL = /const LEVEL = "([^"]+)"/.exec(read("video/render.mts"))![1];
  wav("take.wav", geminiTake());
  ff("-i", "take.wav", "-af", TRIM, "-ar", "48000", "-ac", "1", "t.wav");
  // main before this fix: trim → level → fades
  ff("-i", "t.wav", "-af", PAUSES + LEVEL, "-ar", "48000", "-ac", "1", "old.wav");
  const old = samples("old.wav");
  const oldEnd = old.length / 48000;
  const speechPeak = peakDb(old, 0.3, 1.5);
  const clickPeak = peakDb(old, oldEnd - 0.15, oldEnd);
  assert.ok(clickPeak > speechPeak - 16, `old chain: click ${clickPeak.toFixed(1)} dB vs speech ${speechPeak.toFixed(1)} dB (raw: 20 dB under)`);
  // with the gate
  const end = speechEndSeconds(samples("t.wav"), 48000);
  ff("-i", "t.wav", "-af", `atrim=end=${end.toFixed(3)},` + PAUSES + LEVEL, "-ar", "48000", "-ac", "1", "new.wav");
  const nw = samples("new.wav");
  assert.ok(nw.length / 48000 < oldEnd - 0.1, "the click and its pad are gone");
  // nothing after the last word but the 50 ms pad: the tail is speech fading, not a burst
  assert.ok(peakDb(nw, nw.length / 48000 - 0.04, nw.length / 48000) <= peakDb(nw, 0.3, 1.5) + 0.5);
  fs.rmSync(dir, { recursive: true, force: true });
});

// ------------------------------------------------------------------ 2. BGM from 0:00
test("the music bed is evened out before the render: a quiet intro plays at about the level of the loud part (ffmpeg)", { skip: !hasFfmpeg && "no ffmpeg" }, () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "bed-"));
  const ff = (...a: string[]) => execFileSync("ffmpeg", ["-nostdin", "-loglevel", "error", "-y", ...a], { cwd: dir });
  const mean = (f: string, ss: number, t: number) => Number(/mean_volume: (-?[\d.]+)/.exec(spawnSync("ffmpeg", ["-nostdin", "-ss", String(ss), "-t", String(t), "-i", path.join(dir, f), "-af", "volumedetect", "-f", "null", "-"], { encoding: "utf8" }).stderr)![1]);
  // like bgm-urgent.mp3: 1 s of silence, a 14 s intro 15 dB down, then the track at full level
  ff("-f", "lavfi", "-i", "anullsrc=r=48000:cl=stereo:d=1", "-f", "lavfi", "-i", "anoisesrc=d=14:c=pink:a=0.03:r=48000", "-f", "lavfi", "-i", "anoisesrc=d=30:c=pink:a=0.17:r=48000",
    "-filter_complex", "[1]aformat=channel_layouts=stereo[a];[2]aformat=channel_layouts=stereo[b];[0][a][b]concat=n=3:v=0:a=1", "src.wav");
  assert.ok(mean("src.wav", 1, 10) < mean("src.wav", 20, 10) - 12, "the source intro is >12 dB down");
  ff("-i", "src.wav", "-af", BED_CHAIN, "-ar", "48000", "bed.wav");
  const intro = mean("bed.wav", 0, 5);
  const body = mean("bed.wav", 20, 10);
  assert.ok(intro > body - 6, `prepared: intro ${intro} dB vs body ${body} dB`);
  assert.ok(mean("bed.wav", 0, 1) > -40, "no leading silence: music from the first second");
  fs.rmSync(dir, { recursive: true, force: true });
});

test("a scheduled Koran Kinetik render plays the prepared bed from the episode folder, uploaded or repo source", () => {
  const r = read("video/render.mts");
  assert.match(r, /ffmpeg\("-i", src, "-vn", "-af", BED_CHAIN, "-ar", "48000", "-c:a", "libmp3lame", "-b:a", "192k", path\.join\(pub, episodeId, `\$\{name\}\.mp3`\)\);/);
  assert.match(r, /assetUrls\.sfx!\[name\] = `\$\{episodeId\}\/\$\{name\}\.mp3`;/);
  assert.ok(r.indexOf("BED_CHAIN, ") < r.indexOf("const props: EpisodeProps"), "prepared before the props are written");
  // the video resolves it (served with staticFile next to the episode's audio), never as a stray relative URL
  const id = "9ac3a9ba-d4b1-4bf9-b251-c9e128d4c12b";
  assert.ok(PREPARED_BED.test(`${id}/bgm-urgent.mp3`));
  assert.ok(!PREPARED_BED.test("evil/../bgm.mp3"));
  resetRemoteAssets();
  registerRemoteAssets({ sfx: { "bgm-urgent": `${id}/bgm-urgent.mp3`, nope: "relative/thing.mp3" } });
  assert.equal(bgmFile(true), `${id}/bgm-urgent.mp3`);
  resetRemoteAssets();
  // and the music isn't gated off anywhere: frame 0 onward at the direction's level (Compositing / bgm.ts)
  const comp = read("video/src/shared/Compositing.tsx");
  const music = comp.slice(comp.indexOf("export function BackgroundMusic"));
  assert.match(music, /return <Audio src=\{file\} loop volume=\{level\} onError=\{\(\) => undefined\} \/>;/);
  assert.doesNotMatch(music, /startFrom|trimBefore|<Sequence/, "mounted at frame 0, never delayed or offset");
});

// ------------------------------------------------------------------ 3. stat cards
const LIVE_SUBLINES = [
  "GEN Z USIA 15-24 TAHUN BERSTATUS NEET DI INDONESIA",
  "BEKERJA DI LUAR BIDANG KEAHLIAN KARENA SKILL MISMATCH",
  "TINGKAT PENGANGGURAN MUDA INDONESIA NOMOR SATU DI ASEAN",
];

test("stat card sublines are never cut mid-word: clamped between words, then wrapped on up to 3 lines inside the card", () => {
  for (const sub of LIVE_SUBLINES) {
    const s = parseStat(`9,9 JUTA | ${sub}`)!;
    assert.ok(sub.startsWith(s.subline!) && (s.subline!.length === sub.length || sub[s.subline!.length] === " "), `whole words: ${s.subline}`);
    for (const withProp of [false, true]) {
      const t = statCardText(s, withProp ? 820 - 48 : 820 - 48, withProp ? 200 - 32 : 600, withProp);
      assert.ok(t.sub && t.sub.lines.length <= 3, JSON.stringify(t.sub));
      assert.equal(t.sub.lines.join(" "), s.subline!.toUpperCase(), "every word shown, none cut");
      assert.ok(t.height <= (withProp ? 168 : 600), `fits the card: ${t.height}`);
    }
  }
  // the scheduler keeps them short (≤ 42) without a word cut or a dangling "DI"
  assert.equal(STAT_SUBLINE_MAX, 42);
  assert.equal(clampWords(LIVE_SUBLINES[0], 42), "GEN Z USIA 15-24 TAHUN BERSTATUS NEET");
  assert.equal(clampWords(LIVE_SUBLINES[1], 42), "BEKERJA DI LUAR BIDANG KEAHLIAN");
  assert.equal(clampWords("SUPERKALIFRAGILISTIKEKSPIALIDOSIUSNYA", 10), "SUPERKALIFRAGILISTIKEKSPIALIDOSIUSNYA", "one long word stays whole");
  const sane = sanitizeScript({ lines: [{ speaker: "ocu", text: "Data resmi nyatet hampir sepuluh juta anak muda.", subtitle: "x", layout: "takeover", statCard: `9,9 JUTA | ${LIVE_SUBLINES[0]}` }] }, { fresh: [], bank: [] }, "x", 1).lines;
  assert.equal(sane[0].stat, "9,9 JUTA | GEN Z USIA 15-24 TAHUN BERSTATUS NEET");
  assert.ok(STAT_MAX.subline >= 42);
  assert.doesNotMatch(read("video/src/beats.ts"), /\.slice\(0, max\)/, "no character slice left in parseStat");
  assert.match(read("video/src/shared/VisualStage.tsx"), /statCardText\(stat, statBox\.w - 48, statH - 32, Boolean\(children\)\)/);
});

// ------------------------------------------------------------------ 4. pronunciation, card labels, runtime
test("Uco is pronounced: plain Uco for Edge (U-co made it say Uko), Ucho for Gemini, every occurrence incl. 'kayak Uco'", () => {
  const cta = "Biar nggak bebal kayak Uco, langsung follow @uco.ocu sekarang!";
  assert.equal(ttsText(cta, "edge"), "Biar nggak bebal kayak Uco, langsung follow Uco Ocu sekarang!");
  assert.equal(geminiSpeech({ speaker: "ocu", emotion: "cta", text: cta }).text, "Biar nggak bebal kayak Ucho, langsung follow Ucho Ochu sekarang!");
  assert.equal(ttsText(cta), "Biar nggak bebal kayak U-co, langsung follow U-co Ocu sekarang!", "ElevenLabs keeps its split");
  const [job] = edgeJobs([{ index: 16, speaker: "ocu", emotion: "cta", text: cta }], () => false);
  assert.doesNotMatch(job.text, /U-co|@|\./);
});

test("cards say PSIKOLOGI / GRAFIK only for a named concept / a drawn graph; otherwise FAKTA / DATA", () => {
  // b8 at 0:38 and b12 at 0:58 of the live episode
  const b8 = overlayFor({ text: "Kampus ngajarin teori lawas, sementara kantor nyari skill yang beda jauh.", subtitle: "", overlay: "brain-badge" }, "TEORI LAWAS");
  const b12 = overlayFor({ text: "Dunia udah berubah, lo nggak bisa ngandelin nilai IPK doang.", subtitle: "", overlay: "wave-graph" }, "SKILL DI ATAS IPK");
  assert.equal(b8!.graphic, false);
  assert.equal(b12!.graphic, false);
  assert.deepEqual(cardHeader(b8!.kind, "", b8!.graphic), ["FAKTA"]);
  assert.deepEqual(cardHeader(b12!.kind, "", b12!.graphic), ["DATA"]);
  const bias = overlayFor({ text: "Itu namanya bias konfirmasi, lo cuma liat yang lo mau.", subtitle: "", overlay: "brain-badge" })!;
  assert.deepEqual(cardHeader(bias.kind, bias.title, bias.graphic), ["PSIKOLOGI", "BIAS"]);
  assert.match(read("video/src/shared/VisualStage.tsx"), /cardHeader\(kind, graphic \? title : "", graphic\)/);
  assert.match(showBiblePrompt({ format: "koran_kinetik", label: "Koran Kinetik", brief: "b", seed: "s", bankProps: "" }), /"brain-badge" HANYA kalau baris itu menyebut konsep psikologi ber-NAMA/);
});

test("scheduled episodes stay 55-68 s: 13-15 lines, the outro included", () => {
  for (const f of Object.values(FORMAT_SPEC)) {
    assert.deepEqual(f.lines, [13, 15]);
    assert.equal(f.seconds, "55-68");
  }
  const p = showBiblePrompt({ format: "koran_kinetik", label: "Koran Kinetik", brief: "b", seed: "s", bankProps: "" });
  assert.match(p, /Tulis SATU episode format Koran Kinetik \(55-68 detik\)/);
  assert.match(p, /Kurang dari 13 atau lebih dari 15 baris = gagal/);
  assert.match(p, /PENJELASAN maksimal 42 karakter/);
});
