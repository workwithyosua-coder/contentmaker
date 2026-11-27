// Stage B of the Own Voice provider, run by the render worker before the render: converts every Gemini take of the
// episode that isn't converted yet into the user's own voice with RVC v2 (worker/rvc/convert.py), and stores each
// result as that line's selected take. render.mts then renders with the converted takes (and computes their loudness
// envelopes, so speechStartFrame / speechEndFrame follow the converted audio).
//
// Talks to the app only through /api/render/:id/* with RENDER_TOKEN (signed URLs for the private models and takes):
// the worker never holds database or storage keys.
//
// Usage: RENDER_TOKEN=... npx tsx rvc-stage.mts <episodeId> [--base URL]
// Env:   RVC_PYTHON (python with worker/rvc/requirements.txt installed), RVC_FAKE=1 (tests: a pitch shift, no RVC)
import { execFileSync, spawn } from "node:child_process";
import { mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import path from "node:path";
import { progressAt } from "../src/lib/slotProgress.ts";
import { slotReporter } from "./slot-progress.mts";
import { fades } from "./src/audioChain.ts";

const args = process.argv.slice(2);
const episodeId = args.find((a) => !a.startsWith("--")) ?? process.env.EPISODE_ID;
const base = (args.includes("--base") ? args[args.indexOf("--base") + 1] : process.env.APP_URL) ?? "https://contentmaker-lime.vercel.app";
const token = process.env.RENDER_TOKEN?.trim();
const jobId = process.env.JOB_ID?.trim();
if (!episodeId || !token) {
  console.error("Usage: RENDER_TOKEN=... npx tsx rvc-stage.mts <episodeId> [--base URL]");
  process.exit(1);
}
const here = path.dirname(new URL(import.meta.url).pathname);
const work = path.join(here, "out", episodeId, "rvc");
const auth = { Authorization: `Bearer ${token}` };
const log = (s: string) => console.log(`[${new Date().toISOString().slice(11, 19)}] ${s}`);

async function report(progress: number, stage: string) {
  if (!jobId) return;
  await fetch(`${base}/api/render/${episodeId}/job`, {
    method: "POST",
    headers: { ...auth, "Content-Type": "application/json" },
    body: JSON.stringify({ jobId, status: "converting_voice", progress, stage }),
  }).catch(() => {});
}

async function json<T>(url: string, init?: RequestInit): Promise<T> {
  const res = await fetch(url, { ...init, headers: { ...auth, "Content-Type": "application/json", ...(init?.headers ?? {}) } });
  if (!res.ok) throw new Error(`${init?.method ?? "GET"} ${url.replace(base, "")} → ${res.status}: ${(await res.text()).slice(0, 300)}`);
  return res.json() as Promise<T>;
}

/** Signed URLs are absolute on Supabase; the local test driver's are relative to the app. */
const abs = (url: string) => new URL(url, base).toString();

async function download(url: string, to: string) {
  const res = await fetch(abs(url));
  if (!res.ok) throw new Error(`Download failed (${res.status}) for ${path.basename(to)}`);
  writeFileSync(to, Buffer.from(await res.arrayBuffer()));
}

type Plan = { lines: { lineIndex: number; speaker: "uco" | "ocu"; recordingId: string; url: string }[]; models: Record<string, { pth: string; index: string | null }> };

const plan = await json<Plan>(`${base}/api/render/${episodeId}/voices`);
if (!plan.lines.length) {
  log("own voice: nothing to convert (every line is already converted, or the provider isn't Own Voice)");
  process.exit(0);
}
log(`own voice: ${plan.lines.length} line(s) to convert (${[...new Set(plan.lines.map((l) => l.speaker))].join(", ")})`);
await report(2, `Converting ${plan.lines.length} line${plan.lines.length > 1 ? "s" : ""} to your voice`);

rmSync(work, { recursive: true, force: true });
for (const d of ["models", "in", "out"]) mkdirSync(path.join(work, d), { recursive: true });

// the private models, through short-lived signed URLs
const models: Record<string, { pth: string; index: string }> = {};
for (const [who, m] of Object.entries(plan.models)) {
  const pth = path.join(work, "models", `${who}-voice.pth`);
  await download(m.pth, pth);
  let index = "";
  if (m.index) {
    index = path.join(work, "models", `${who}-voice.index`);
    await download(m.index, index);
  }
  models[who] = { pth, index };
}

// the Gemini takes, normalised to 44.1 kHz mono WAV
const jobs = [];
for (const l of plan.lines) {
  const raw = path.join(work, "in", `line-${l.lineIndex + 1}.src`);
  const input = path.join(work, "in", `line-${l.lineIndex + 1}.wav`);
  const output = path.join(work, "out", `line-${l.lineIndex + 1}.wav`);
  await download(l.url, raw);
  execFileSync("ffmpeg", ["-nostdin", "-loglevel", "error", "-y", "-i", raw, "-ac", "1", "-ar", "44100", input]);
  const pitch = Number(process.env[`RVC_PITCH_${l.speaker.toUpperCase()}`] ?? 0) || 0;
  jobs.push({ ...l, model: models[l.speaker].pth, index: models[l.speaker].index, input, output, pitch });
}

// Stage B: RVC on CPU (or, in tests, a pitch shift standing in for it)
const started = Date.now();
// the scheduled slot's progress bar (SLOT_ID set by the autonomous scheduler; nothing for a manual render)
const slotReport = slotReporter(base);
const converted = (i: number) => slotReport("converting_voice", progressAt("converting_voice", i, jobs.length), `Converting voice ${i} of ${jobs.length}`, { force: i === 0 || i === jobs.length });
await converted(0);
if (process.env.RVC_FAKE === "1") {
  for (const [i, j] of jobs.entries()) {
    execFileSync("ffmpeg", ["-nostdin", "-loglevel", "error", "-y", "-i", j.input, "-af", "asetrate=44100*0.94,aresample=44100,atempo=1.0638", j.output]);
    await converted(i + 1);
  }
} else {
  const python = process.env.RVC_PYTHON?.trim() || "python";
  const list = path.join(work, "jobs.json");
  writeFileSync(list, JSON.stringify(jobs.map(({ model, index, input, output, pitch }) => ({ model, index, input, output, pitch }))));
  // convert.py prints "[rvc] i/n …" after each line: passed through to the log and to the progress bar
  const code = await new Promise<number | null>((resolve) => {
    const child = spawn(python, [path.resolve(here, "../worker/rvc/convert.py"), list], { stdio: ["ignore", "pipe", "inherit"] });
    let buf = "";
    child.stdout.on("data", (d: Buffer) => {
      process.stdout.write(d);
      buf += d.toString();
      let nl;
      while ((nl = buf.indexOf("\n")) >= 0) {
        const m = /^\[rvc\] (\d+)\/(\d+)/.exec(buf.slice(0, nl));
        buf = buf.slice(nl + 1);
        if (m) void converted(Number(m[1]));
      }
    });
    child.on("close", resolve);
  });
  if (code !== 0) throw new Error(`RVC conversion failed (exit ${code}). See the log above.`);
}
log(`own voice: converted in ${((Date.now() - started) / 1000).toFixed(0)} s`);

// upload each converted take and make it the line's selected take
let done = 0;
for (const j of jobs) {
  const seconds = Number(execFileSync("ffprobe", ["-v", "error", "-show_entries", "format=duration", "-of", "csv=p=0", j.output]).toString().trim());
  // RVC tail noise / DC offset must not click at the cut: DC removed (20 Hz high-pass), 15 ms in, 35 ms out
  const clean = j.output.replace(/\.wav$/, ".clean.wav");
  execFileSync("ffmpeg", ["-nostdin", "-loglevel", "error", "-y", "-i", j.output, "-af", `highpass=f=20,${fades(seconds)}`, clean]);
  const up = await json<{ url: string; path: string }>(`${base}/api/render/${episodeId}/voices/upload`, { method: "POST", body: JSON.stringify({ lineIndex: j.lineIndex }) });
  const put = await fetch(abs(up.url), { method: "PUT", headers: { "Content-Type": "audio/wav", "x-upsert": "true" }, body: readFileSync(clean) });
  if (!put.ok) throw new Error(`Upload of line ${j.lineIndex + 1} failed (${put.status}).`);
  await json(`${base}/api/render/${episodeId}/voices/finish`, {
    method: "POST",
    body: JSON.stringify({ lineIndex: j.lineIndex, path: up.path, durationMs: Math.round(seconds * 1000), fromRecordingId: j.recordingId }),
  });
  done++;
  await report(Math.round(2 + (done / jobs.length) * 10), `Converted ${done} of ${jobs.length} lines to your voice`);
}
log(`own voice: ${done} converted take(s) stored`);
