// Expressive Gemini TTS for scheduled episodes (one engine from line 1 to the last: paced at ≤ 9 a minute, 429s
// retried), the frame-level speech-end cropper that removes Gemini's trailing "tsk", the acronym map, the ping-pong
// comedy rhythm, and the database pool (EMAXCONNSESSION → a retryable 503). No network, no database, no AI.
import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import fs from "node:fs";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";
import { promisify } from "node:util";
import { FADE_OUT_S, GAPS, TAIL_GATE, speechEndSeconds } from "../../video/src/audioChain.ts";
import { buildBeats, type EpisodeLine } from "../../video/src/beats.ts";
import { FPS, naturalGap } from "../../video/src/types.ts";
import { DB_POOL, isDbPoolError } from "../../src/lib/db.ts";
import { sanitizeScript } from "../../src/lib/scheduler.ts";
import { MIN_INTERJECTIONS, rhythmProblems } from "../../src/lib/showBible.ts";
import { CHARACTER_STYLE, GEMINI_VOICES, cleanPcmTailStats, geminiSpeech, ttsRequestBody } from "../../src/lib/voice/acting.ts";
import { schedulerVoiceEngine } from "../../src/lib/voice/edge.ts";
import { ACRONYMS, ttsText } from "../../src/lib/voice/phonetic.ts";
import { TTS_MAX_429_RETRIES, TTS_MIN_INTERVAL_MS, TTS_RPM, TtsPacer, pacedRequest, retryDelayMs } from "../../src/lib/voice/tts-pacing.ts";
import { ROOT } from "./importGraph.mts";

const run = promisify(execFile);
const read = (f: string) => fs.readFileSync(path.join(ROOT, f), "utf8");
const SR = 24000;
const tone = (s: number, amp: number) => Float64Array.from({ length: Math.round(s * SR) }, (_, i) => amp * (0.55 + 0.45 * Math.sin((2 * Math.PI * 4 * i) / SR)) * Math.sin((2 * Math.PI * 170 * i) / SR));
const silence = (s: number) => new Float64Array(Math.round(s * SR));
const burst = (s: number, amp: number) => {
  let seed = 11;
  return Float64Array.from({ length: Math.round(s * SR) }, () => {
    seed = (seed * 1103515245 + 12345) % 2 ** 31;
    return amp * (seed / 2 ** 30 - 1);
  });
};
const pcm16 = (...parts: Float64Array[]) => {
  const out = new Int16Array(parts.reduce((a, p) => a + p.length, 0));
  let o = 0;
  for (const p of parts) for (const v of p) out[o++] = Math.round(Math.max(-1, Math.min(1, v)) * 32767);
  return out;
};

// ------------------------------------------------------------------ 1. Gemini TTS: the tail cropper, pacing, 429s
test("the speech-end cropper removes a loud trailing burst: speech + 100 ms gap + a −12 dB, 90 ms burst", () => {
  assert.deepEqual([TAIL_GATE.windowMs, TAIL_GATE.minSpeechMs, TAIL_GATE.transientMs, TAIL_GATE.bridgeMs, TAIL_GATE.padMs, FADE_OUT_S], [10, 60, 140, 70, 55, 0.045]);
  const amp = 10 ** (-12 / 20); // −12 dBFS peak noise burst
  const take = pcm16(tone(1.8, 0.45), silence(0.1), burst(0.09, amp), silence(0.3));
  const end = speechEndSeconds(take, SR);
  assert.ok(Math.abs(end - (1.8 + 0.055)) < 0.015, `cut at the last word + 55 ms (${end})`);
  const bytes = new Uint8Array(take.buffer);
  const { pcm, originalMs, keptMs } = cleanPcmTailStats(bytes, SR);
  const out = new Int16Array(pcm.buffer, pcm.byteOffset, pcm.length / 2);
  assert.equal(originalMs, 2290);
  assert.ok(Math.abs(keptMs - 1855) <= 10, `${keptMs}`);
  // nothing of the burst survives: the kept audio is never louder than the speech, and it fades to zero over 45 ms
  const peak = (a: Int16Array) => a.reduce((m, v) => Math.max(m, Math.abs(v)), 0);
  assert.ok(peak(out.subarray(Math.round(1.8 * SR))) <= peak(out.subarray(0, Math.round(1.8 * SR))) * 0.6);
  assert.equal(out.at(-1), 0);
  const fade = Math.round(FADE_OUT_S * SR);
  assert.ok(Math.abs(out[out.length - Math.round(fade / 4)]) <= 0.3 * 32767 * 0.45);
  // the worker log line per take
  assert.match(read("src/lib/scheduler-server.ts"), /trims\.push\(`line \$\{l\.index \+ 1\}: \$\{t\.originalMs\} → \$\{t\.keptMs\} ms \(tail cut \$\{t\.originalMs - t\.keptMs\} ms\)`\)/);
  assert.match(read("video/scheduler-step.mts"), /for \(const t of v\.trims \?\? \[\]\) log\(`voice: \$\{t\}`\);/);
});

test("Tier 1 pacing: at most 9 TTS requests a minute, and a 429 retried 3 times (Retry-After, retryDelay, else backoff)", async () => {
  assert.equal(TTS_RPM, 9);
  assert.equal(TTS_MIN_INTERVAL_MS, 6667);
  let now = 0;
  const clock = { now: () => now, sleep: async (ms: number) => void (now += ms) };
  const pacer = new TtsPacer(clock);
  const starts: number[] = [];
  for (let k = 0; k < 15; k++) {
    await pacer.slot();
    starts.push(now);
    now += 1200; // the request itself takes a while
  }
  for (const s of starts) assert.ok(starts.filter((t) => t >= s && t < s + 60_000).length <= 9, "≤ 9 starts in any minute");
  // waits after a 429
  assert.equal(retryDelayMs(1, "2", ""), 2000);
  assert.equal(retryDelayMs(1, null, '{"error":{"details":[{"@type":"type.googleapis.com/google.rpc.RetryInfo","retryDelay":"17s"}]}}'), 17000);
  assert.deepEqual([1, 2, 3].map((a) => retryDelayMs(a, null, "")), [4000, 8000, 16000]);
  assert.equal(retryDelayMs(1, "600", ""), 45000, "capped");
  // 429, 429, then 200: three calls, the line still made by Gemini
  const reply = (status: number, retryAfter: string | null = null) => ({ status, headers: { get: (n: string) => (n === "retry-after" ? retryAfter : null) }, text: async () => "" });
  const seq = [reply(429, "1"), reply(429), reply(200)];
  let calls = 0;
  const waits: number[] = [];
  const ok = await pacedRequest(async () => seq[calls++], new TtsPacer(clock), clock, (_, w) => waits.push(w));
  assert.deepEqual([ok.status, calls, waits], [200, 3, [1000, 8000]]);
  // always 429: 1 + 3 retries, then the 429 goes back (→ the Edge TTS emergency fallback)
  let n = 0;
  const no = await pacedRequest(async () => (n++, reply(429)), new TtsPacer(clock), clock);
  assert.deepEqual([no.status, n], [429, 1 + TTS_MAX_429_RETRIES]);
  assert.match(read("src/lib/voice/gemini.ts"), /const res = await pacedRequest\(/);
});

test("scheduled episodes: both Gemini providers voice with gemini-3.8-flash-tts (Own Voice then RVC), one line at a time", () => {
  assert.equal(schedulerVoiceEngine("gemini_tts"), "gemini");
  assert.equal(schedulerVoiceEngine("gemini_tts_rvc"), "gemini", "#61's Edge-first override reverted: Own Voice keeps the acting");
  const fn = read("src/lib/scheduler-server.ts");
  const voice = fn.slice(fn.indexOf("export async function voiceSlot"), fn.indexOf("// ------------------------------------------------------------------ step 2b"));
  assert.match(voice, /for \(const l of todo\.slice\(0, max\)\) \{\s*const r = await voiceTake\(/, "sequential (paced), never parallel");
  assert.doesNotMatch(voice, /Promise\.all/);
  assert.match(read("video/scheduler-step.mts"), /if \(round > 0\) await new Promise\(\(r\) => setTimeout\(r, Number\(process\.env\.TTS_ROUND_GAP_MS \?\? 7000\)\)\);/);
  assert.match(read("src/lib/scheduler.ts"), /voice_provider: "gemini_tts",/, "new schedules default to plain expressive Gemini TTS");
});

test("the dialogue goes verbatim in parts[0].text; the high-contrast acting only in speechMetadata.style", () => {
  assert.deepEqual(GEMINI_VOICES, { uco: "Puck", ocu: "Charon" });
  const uco = geminiSpeech({ speaker: "uco", text: "Gue bilang ini investasi POD!", emotion: "triumphant" });
  const body = ttsRequestBody(uco.text, uco.style, "uco");
  assert.deepEqual(body.contents[0].parts, [{ text: "Gue bilang ini investasi pod!", speechMetadata: { style: uco.style } }]);
  assert.match(uco.style, /^Cocky, hyped, loud and animated Jakartan guy/);
  assert.doesNotMatch(body.contents[0].parts[0].text, /Cocky|Jakartan|style/i);
  // the contrast per pose
  assert.match(geminiSpeech({ speaker: "uco", text: "Bukan gitu maksud gue!", emotion: "defensive" }).style, /^Flustered and fast/);
  assert.match(geminiSpeech({ speaker: "uco", text: "Hah serius?!", emotion: "shocked" }).style, /^Genuinely panicked, high-pitched/);
  assert.match(geminiSpeech({ speaker: "uco", text: "Duh.", thought_bubble: true }).style, /^Sheepish, quiet mutter/);
  assert.match(geminiSpeech({ speaker: "ocu", text: "Ya ya.", emotion: "deadpan" }).style, /^Razor-sharp deadpan sarcasm, a dry eye-roll/);
  assert.match(geminiSpeech({ speaker: "ocu", text: "Sembilan koma sembilan juta.", emotion: "explaining", layout: "takeover" }).style, /^Intense, urgent breaking-news journalist cadence/);
  assert.match(geminiSpeech({ speaker: "ocu", text: "Coba liat.", emotion: "inspecting" }).style, /^Intense, urgent investigative-journalist cadence/);
  assert.match(geminiSpeech({ speaker: "ocu", text: "Follow @uco.ocu!", emotion: "cta" }).style, /^Smugly calm/);
  assert.ok(Object.keys(CHARACTER_STYLE.uco).length >= 8 && Object.keys(CHARACTER_STYLE.ocu).length >= 8);
});

// ------------------------------------------------------------------ 2. acronyms, rhythm, gaps
test("acronyms are read as words in the TTS text only; subtitles keep them as written", () => {
  assert.deepEqual(ACRONYMS, { POD: "pod", VAPE: "vape", EVALI: "evali", NEET: "nit", FOMO: "fomo", YOLO: "yolo", QRIS: "kris", BPJS: "be-pe-je-es", UMKM: "u-em-ka-em" });
  for (const voice of ["gemini", "edge", "elevenlabs"] as const) {
    assert.match(ttsText("POD sama VAPE bikin EVALI, 9,9 juta NEET, FOMO YOLO, bayar QRIS, BPJS buat UMKM", voice), /pod sama vape bikin evali, 9,9 juta nit, fomo yolo, bayar kris, be-pe-je-es buat u-em-ka-em/);
  }
  assert.equal(ttsText("PODCAST-nya POD-nya", "edge"), "PODCAST-nya pod-nya", "whole words only");
  assert.doesNotMatch(ttsText("follow @uco.ocu", "edge"), /titik|dot|\./);
  // the subtitle and the on-screen text are never touched
  const [b] = buildBeats([{ index: 0, beat: "hook", speaker: "ocu", text: "POD itu bukan permen, bayarnya QRIS juga!", subtitle: "A POD isn't candy, even if you pay by QRIS!", expression: "calm", thought_bubble: false, hasAudio: false, audio: null, frames: 90, envelope: [], start_s: null } as EpisodeLine], { exact: true } as never);
  assert.equal(b.subtitleEn, "A POD isn't candy, even if you pay by QRIS!");
});

test("ping-pong rhythm: never 3 in a row by one speaker, 2 only into a takeover; ≥ 3 interjections; no textbook phrasing", () => {
  const L = (speaker: "uco" | "ocu", text: string, o: Record<string, unknown> = {}) => ({ speaker, text, layout: "standard", thought_bubble: false, emotion: speaker === "uco" ? "triumphant" : "deadpan", ...o });
  const long = "Ini kalimat banter biasa yang panjangnya pas buat lo";
  const good = [L("uco", long), L("ocu", "Hah, serius lo?!"), L("uco", long), L("ocu", long), L("ocu", "9,9 JUTA anak muda nganggur, serius", { layout: "takeover" }), L("uco", "Bentar, bentar dulu!"), L("ocu", long), L("uco", "Uap pala lo peyang!"), L("ocu", "Follow @uco.ocu biar nggak ketipu!", { emotion: "cta" })];
  assert.deepEqual(rhythmProblems(good as never), []);
  const three = [L("uco", long), L("uco", long), L("uco", long), L("ocu", "Hah, serius lo?!"), L("uco", "Bentar, bentar dulu!"), L("ocu", "Uap pala lo peyang!")];
  assert.match(rhythmProblems(three as never).join("; "), /3 lines in a row by uco \(lines 1-3\)/);
  const two = [L("uco", long), L("ocu", long), L("ocu", long), L("uco", "Hah, serius lo?!"), L("ocu", "Bentar, bentar dulu!"), L("uco", "Uap pala lo peyang!")];
  assert.match(rhythmProblems(two as never).join("; "), /2 lines in a row by ocu \(lines 2-3\) without a takeover stat card/);
  // a silent thought is its character's beat; the outro CTA isn't a turn
  assert.deepEqual(rhythmProblems([...good.slice(0, 8), L("ocu", "Duh, gue juga sih", { thought_bubble: true }), L("uco", long), L("ocu", "Follow @uco.ocu!", { emotion: "cta" })] as never), []);
  assert.match(rhythmProblems([...good.slice(0, 8), L("uco", "Duh, gue ketahuan", { thought_bubble: true })] as never).join("; "), /2 lines in a row by uco \(lines 8-9\)/, "Uco talking, then Uco thinking, is still Uco twice");
  const flat = Array.from({ length: 10 }, (_, i) => L(i % 2 ? "ocu" : "uco", long));
  assert.match(rhythmProblems(flat as never).join("; "), new RegExp(`0 rapid-fire interjection\\(s\\) of 3-7 words \\(needs at least ${MIN_INTERJECTIONS}\\)`));
  assert.match(rhythmProblems([...good.slice(0, 7), L("uco", "Dalam satu dekade terakhir zat kimiawi makin banyak, lho")] as never).join("; "), /textbook phrasing: "Dalam satu dekade terakhir"/i);
  // a thought gets a 2-5 word caption from its callout, else its headline, else its own words
  const lines = sanitizeScript({ lines: [{ speaker: "uco", text: "Duh, padahal gue sendiri juga nge-vape tiap malem.", subtitle: "x", pose: "thought", callout: "" }, { speaker: "ocu", text: "Lo kenapa diem?", subtitle: "y", pose: "deadpan" }] }, { fresh: [], bank: [] }, "x", 1).lines;
  assert.equal(lines[0].thought_bubble, true);
  const cap = lines[0].kinetic_text!.split(/\s+/).length;
  assert.ok(cap >= 2 && cap <= 5, lines[0].kinetic_text!);
  const prompt = read("src/lib/showBible.ts");
  assert.match(prompt, /pengakuan dalam hati yang DIAM, tidak terdengar tokoh lain, jadi baris berikutnya TIDAK menjawabnya/);
  assert.match(prompt, /DILARANG 3 baris berturut-turut dari pembicara yang sama/);
});

test("dynamic gaps: rapid-fire 0.08-0.12 s, standard 0.20-0.24 s, beat drop 0.35-0.40 s", () => {
  const ln = (speaker: "uco" | "ocu", text: string, o: Record<string, unknown> = {}) => ({ speaker, text, frames: 60, beat: "escalation", thought_bubble: false, start_s: null, ...o }) as never;
  const long = "Ini kalimat banter biasa yang panjangnya pas buat lo semua";
  const lines = [ln("uco", long), ln("ocu", "Hah, serius lo?!"), ln("uco", long, { emotion: "defensive" }), ln("ocu", long), ln("uco", long, { layout: "takeover" }), ln("ocu", long), ln("uco", "Follow @uco.ocu!", { emotion: "cta" })];
  const g = lines.slice(1).map((_, k) => naturalGap(lines, k + 1) / FPS);
  const within = (v: number, [a, b]: [number, number]) => v >= a - 1e-9 && v <= b + 1e-9;
  assert.ok(within(g[0], [0.08, 0.12]) && within(g[1], [0.08, 0.12]), `rapid ${g[0]} ${g[1]}`);
  assert.ok(within(g[2], [0.2, 0.24]), `standard ${g[2]}`);
  assert.ok(within(g[3], [0.35, 0.4]) && within(g[4], [0.35, 0.4]) && within(g[5], [0.35, 0.4]), `drop ${g[3]} ${g[4]} ${g[5]}`);
  assert.deepEqual(GAPS, { rapid: 0.1, standard: 0.22, drop: 0.38 });
});

// ------------------------------------------------------------------ 3. the database pool
test("a small pool ready for the transaction pooler; EMAXCONNSESSION is a pool error answered 503 (never 422)", () => {
  assert.ok(DB_POOL.max >= 1 && DB_POOL.max <= 2);
  assert.equal(DB_POOL.idle_timeout, 10);
  assert.equal(DB_POOL.prepare, false, "no named prepared statements: required on Supabase's transaction pooler (6543)");
  for (const e of [
    Object.assign(new Error("(EMAXCONNSESSION) max clients reached in session mode - max clients are limited to pool_size: 15"), { code: "XX000" }),
    new Error("sorry, too many clients already"),
    Object.assign(new Error("remaining connection slots are reserved"), { code: "53300" }),
    Object.assign(new Error("write CONNECT_TIMEOUT db.example.supabase.co:6543"), { code: "CONNECT_TIMEOUT" }),
    new Error("connect ECONNREFUSED 127.0.0.1:5432"),
  ])
    assert.equal(isDbPoolError(e), true, e.message);
  for (const e of [new Error('duplicate key value violates unique constraint "x"'), new Error("Gemini wrote only 9 lines"), null]) assert.equal(isDbPoolError(e), false);
  // nothing session-scoped anywhere (transactions run inside sql.begin)
  const offenders = execSyncGrep(/pg_advisory_lock\b|\bLISTEN\b|set_config\(|SET search_path|sql\.reserve/);
  assert.deepEqual(offenders, []);
  // the step route (script, voice, …) and the tick route answer 503 on a pool error, without failing the slot
  const step = read("src/app/api/scheduler/slots/[id]/[step]/route.ts");
  const pool = step.indexOf("if (isDbPoolError(e)) return Response.json(");
  assert.ok(pool > 0 && pool < step.indexOf("if (step !== \"fail\") await failSlot("), "503 before the slot is failed");
  assert.match(step, /\{ status: 503, headers: \{ "Retry-After": "3" \} \}/);
  assert.match(read("src/app/api/scheduler/tick/route.ts"), /if \(isDbPoolError\(e\)\) return Response\.json\(\{ error: `The database is busy, retry: \$\{message\}` \}, \{ status: 503/);
});

/** Files under src/ matching `rx` (session-only Postgres features). */
function execSyncGrep(rx: RegExp): string[] {
  const out: string[] = [];
  const walk = (d: string) => {
    for (const e of fs.readdirSync(path.join(ROOT, d), { withFileTypes: true })) {
      const p = `${d}/${e.name}`;
      if (e.isDirectory()) walk(p);
      // code only: comment lines (which may name these features to say they're not used) are skipped
      else if (/\.(ts|tsx)$/.test(e.name) && rx.test(read(p).split("\n").filter((x) => !/^\s*(\/\/|\*|\/\*)/.test(x)).join("\n"))) out.push(p);
    }
  };
  walk("src");
  return out;
}

test("scheduler-step.mts retries a 503 with a short backoff, then carries on", async () => {
  let n = 0;
  const server = http.createServer((req, res) => {
    n++;
    if (n <= 2) {
      res.writeHead(503, { "content-type": "application/json" });
      res.end(JSON.stringify({ error: "The database is busy, retry: (EMAXCONNSESSION) max clients reached" }));
      return;
    }
    res.writeHead(200, { "content-type": "application/json" });
    res.end(JSON.stringify({ slots: ["11111111-2222-4333-8444-555555555555"], notes: [] }));
  });
  await new Promise<void>((r) => server.listen(0, r));
  const port = (server.address() as { port: number }).port;
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "step-503-"));
  try {
    const r = await run(process.execPath, [path.join(ROOT, "node_modules/tsx/dist/cli.mjs"), path.join(ROOT, "video/scheduler-step.mts"), "plan"], {
      cwd: dir,
      env: { ...Object.fromEntries(Object.entries(process.env).filter(([k]) => !k.startsWith("TSX_") && k !== "NODE_OPTIONS")), RENDER_TOKEN: "t", APP_URL: `http://127.0.0.1:${port}`, GITHUB_OUTPUT: path.join(dir, "out.txt"), POOL_RETRY_BASE_MS: "10" },
    });
    assert.equal(n, 3, "two 503s, then the call that worked");
    assert.equal((r.stdout.match(/tick → 503, retrying in/g) ?? []).length, 2);
    assert.match(r.stdout, /producing 1 slot\(s\)/);
  } finally {
    server.close();
    fs.rmSync(dir, { recursive: true, force: true });
  }
  assert.match(read("video/scheduler-step.mts"), /export const POOL_RETRIES = 5;/);
});
