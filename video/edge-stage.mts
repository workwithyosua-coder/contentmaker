// Edge TTS stage of the autonomous scheduler worker (free Microsoft Edge TTS, voice id-ID-ArdiNeural). Voices every line
// of a slot's episode that has no take yet: the app hands out the TTS text (phonetic fixes applied) and each line's
// rate / pitch (character + pose, src/lib/voice/edge.ts); scripts/edge_tts_worker.py synthesizes; ffmpeg trims the
// silence, evens out the loudness (Beat 1 keeps its small lead-in pad) and writes 48 kHz mono 16-bit WAV, the format
// rvc-stage.mts and render.mts read; the loudness envelope is measured to check each clip really has speech
// (speechStartFrame / speechEndFrame); each take is uploaded through a signed URL and registered with RENDER_TOKEN.
//
// Used by scheduler-step.mts (prepare). Standalone: RENDER_TOKEN=... npx tsx edge-stage.mts <slotId> [--base URL]
// Env: EDGE_PYTHON (python with worker/edge/requirements.txt), EDGE_FAKE=1 (tests: a tone instead of Edge TTS)
import { execFileSync, spawnSync } from "node:child_process";
import { mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import path from "node:path";
import { speechBounds } from "./src/shared/motion.ts";
import { FPS } from "./src/types.ts";
import { LEAD_IN, TRIM, fades } from "./src/audioChain.ts";
import { assertSpokenOnly } from "../src/lib/voice/acting.ts";

type Job = { lineIndex: number; speaker: "uco" | "ocu"; text: string; rate: string; pitch: string; pose: string; leadIn: boolean };
type Post = <T>(path: string, body?: Record<string, unknown>) => Promise<T>;

const here = path.dirname(new URL(import.meta.url).pathname);
const ffmpeg = (...a: string[]) => execFileSync("ffmpeg", ["-nostdin", "-hide_banner", "-loglevel", "error", "-y", ...a], { timeout: 120_000 });

// Trim dead air at both ends with the shared chain (src/audioChain.ts: a gentle onset keeping a 0.05 s pad, a 0.1 s
// tail), level, then the 15 / 35 ms edge fades. Beat 1 gets the 0.05 s lead-in so frame 1 never clips a syllable.
const LEVEL = "loudnorm=I=-16:TP=-1.5:LRA=11";

/** Loudness per video frame (0..1), the same measure render.mts uses for the mouth. */
export function envelopeOf(wav: string): number[] {
  const pcm = execFileSync("ffmpeg", ["-nostdin", "-hide_banner", "-loglevel", "error", "-i", wav, "-f", "s16le", "-ac", "1", "-ar", "48000", "-"], { maxBuffer: 1 << 28 });
  const samples = new Int16Array(pcm.buffer, pcm.byteOffset, Math.floor(pcm.byteLength / 2));
  const per = 48000 / FPS;
  const rms: number[] = [];
  for (let i = 0; i < samples.length; i += per) {
    let s = 0;
    const end = Math.min(samples.length, i + per);
    for (let j = i; j < end; j++) s += (samples[j] / 32768) ** 2;
    rms.push(Math.sqrt(s / Math.max(1, end - i)));
  }
  const sorted = [...rms].sort((a, b) => a - b);
  const loud = sorted[Math.floor(sorted.length * 0.95)] || 1;
  const floor = sorted[Math.floor(sorted.length * 0.2)] ?? 0;
  return rms.map((v) => Math.round(Math.min(1, Math.max(0, (v - floor * 1.5) / (loud - floor * 1.5 || 1))) * 100) / 100);
}

export async function edgeStage(p: { slotId: string; post: Post; log: (s: string) => void; onLine?: (done: number, total: number) => void | Promise<void> }): Promise<{ voiced: number }> {
  const plan = await p.post<{ voice: string; lines: Job[] }>(`slots/${p.slotId}/edge-plan`);
  if (!plan.lines.length) {
    p.log("edge-tts: every line already has a take (cached audio kept)");
    return { voiced: 0 };
  }
  p.log(`edge-tts: ${plan.lines.length} line(s) with ${plan.voice}`);
  const work = path.join(here, "out", "edge", p.slotId);
  rmSync(work, { recursive: true, force: true });
  mkdirSync(work, { recursive: true });
  const raw = (j: Job) => path.join(work, `line-${j.lineIndex + 1}.mp3`);

  // synthesize (one Python run for the whole episode)
  if (process.env.EDGE_FAKE === "1") {
    for (const j of plan.lines) {
      const f = j.speaker === "uco" ? 220 : 150;
      ffmpeg("-f", "lavfi", "-i", `anullsrc=r=24000:cl=mono:d=0.4`, "-f", "lavfi", "-i", `sine=f=${f}:d=1.2:r=24000`, "-filter_complex", "[0][1][0]concat=n=3:v=0:a=1,volume=0.5", raw(j));
    }
  } else {
    const list = path.join(work, "jobs.json");
    writeFileSync(list, JSON.stringify(plan.lines.map((j) => ({ text: assertSpokenOnly(j.text), voice: plan.voice, rate: j.rate, pitch: j.pitch, out: raw(j) }))));
    const python = process.env.EDGE_PYTHON?.trim() || "python3";
    const r = spawnSync(python, [path.resolve(here, "../scripts/edge_tts_worker.py"), list], { stdio: "inherit" });
    if (r.status !== 0) throw new Error(`Edge TTS failed (exit ${r.status}). See the log above.`);
  }

  let voiced = 0;
  for (const j of plan.lines) {
    const n = j.lineIndex + 1;
    const trimmed = path.join(work, `line-${n}.trim.wav`);
    const wav = path.join(work, `line-${n}.wav`);
    ffmpeg("-i", raw(j), "-af", TRIM, "-ar", "48000", "-ac", "1", trimmed);
    const leveled = path.join(work, `line-${n}.level.wav`);
    ffmpeg("-i", trimmed, "-af", LEVEL + (j.leadIn ? `,${LEAD_IN.slice(0, -1)}` : ""), "-ar", "48000", "-ac", "1", leveled);
    const secs = Number(execFileSync("ffprobe", ["-v", "error", "-show_entries", "format=duration", "-of", "csv=p=0", leveled]).toString().trim()) || 0;
    ffmpeg("-i", leveled, "-af", fades(secs), "-ar", "48000", "-ac", "1", "-c:a", "pcm_s16le", wav);
    const env = envelopeOf(wav);
    const speech = speechBounds(env, env.length);
    if (!env.some((v) => v > 0.2)) throw new Error(`Edge TTS line ${n} came back silent.`);
    const seconds = env.length / FPS;
    const up = await p.post<{ skip: true } | { skip: false; url: string; path: string }>(`slots/${p.slotId}/edge-upload`, { lineIndex: j.lineIndex });
    if (up.skip) {
      p.log(`line ${n}: got a take meanwhile, kept it`);
      continue;
    }
    const base = process.env.APP_URL ?? "https://contentmaker-lime.vercel.app";
    const put = await fetch(new URL(up.url, base), { method: "PUT", headers: { "Content-Type": "audio/wav", "x-upsert": "true" }, body: readFileSync(wav) });
    if (!put.ok) throw new Error(`Upload of line ${n} failed (${put.status}).`);
    const done = await p.post<{ stored: boolean }>(`slots/${p.slotId}/edge-finish`, { lineIndex: j.lineIndex, path: up.path, durationMs: Math.round(seconds * 1000) });
    if (done.stored) voiced++;
    await p.onLine?.(voiced, plan.lines.length);
    p.log(`line ${n} (${j.speaker}, ${j.pose}, ${j.rate} ${j.pitch}): ${seconds.toFixed(1)} s, speech frames ${speech.start}–${speech.end}`);
  }
  return { voiced };
}

// standalone
if (process.argv[1] && path.resolve(process.argv[1]) === path.resolve(new URL(import.meta.url).pathname)) {
  const slotId = process.argv[2];
  const base = (process.argv.includes("--base") ? process.argv[process.argv.indexOf("--base") + 1] : process.env.APP_URL) ?? "https://contentmaker-lime.vercel.app";
  const token = process.env.RENDER_TOKEN?.trim();
  if (!slotId || !token) {
    console.error("Usage: RENDER_TOKEN=... npx tsx edge-stage.mts <slotId> [--base URL]");
    process.exit(1);
  }
  process.env.APP_URL = base;
  const post: Post = async (p, body = {}) => {
    const res = await fetch(`${base}/api/scheduler/${p}`, { method: "POST", headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" }, body: JSON.stringify(body) });
    if (!res.ok) throw new Error(`${p} → ${res.status}: ${(await res.text()).slice(0, 300)}`);
    return res.json();
  };
  edgeStage({ slotId, post, log: console.log }).then(
    (r) => console.log(`edge-tts: ${r.voiced} take(s) stored`),
    (e) => {
      console.error(e instanceof Error ? e.message : String(e));
      process.exit(1);
    },
  );
}
