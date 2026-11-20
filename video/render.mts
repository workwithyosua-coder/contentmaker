// Renders one Uco & Ocu episode to MP4 and uploads it to the app.
//
//   RENDER_TOKEN=... npx tsx render.mts <episodeId> [--base https://contentmaker-lime.vercel.app] [--no-upload] [--reuse] [--prep] [--no-tighten] [--style classic|uco-ocu-2d-comic]
//
// Steps: fetch the script from the app → download each line's selected take → trim silence and even out
// loudness (ffmpeg) → measure loudness per frame for the mouth movement → render with Remotion → upload.
// Needs ffmpeg/ffprobe and a Chromium (CHROME_PATH, or Remotion downloads its own).
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { bundle } from "@remotion/bundler";
import { renderMedia, selectComposition } from "@remotion/renderer";
import { COMPOSITION_FOR, styleById } from "./src/styles/registry.ts";
import { cpSync } from "node:fs";
import { writeAssetManifest } from "../scripts/asset-manifest.mts";
import { FPS, totalFrames, type AssetUrls, type EpisodeProps, type ManifestLine } from "./src/types.ts";
import { buildBeats } from "./src/beats.ts";
import { registerLineAssets, registerRemoteAssets } from "./src/assets/index.ts";
import { parseDirection } from "./src/direction.ts";

const args = process.argv.slice(2);
const episodeId = args.find((a) => !a.startsWith("--") && args[args.indexOf(a) - 1] !== "--base");
const base = (args.includes("--base") ? args[args.indexOf("--base") + 1] : process.env.APP_URL) ?? "https://contentmaker-lime.vercel.app";
const upload = !args.includes("--no-upload");
const token = process.env.RENDER_TOKEN?.trim();
if (!episodeId || !token) {
  console.error("Usage: RENDER_TOKEN=... npx tsx render.mts <episodeId> [--base URL] [--no-upload]");
  process.exit(1);
}

const here = path.dirname(new URL(import.meta.url).pathname);
const pub = path.join(here, "public");
const work = path.join(here, "out", episodeId);
const auth = { Authorization: `Bearer ${token}` };
const log = (s: string) => console.log(`[${new Date().toISOString().slice(11, 19)}] ${s}`);

// Progress for the episode page (JOB_ID is set when the app started this render). Overall percentage:
// audio 2–12 %, bundling 13 %, frames 15–92 %, upload 93–99 % (the workflow reports 100 % when it's done).
// Sent at most every 10 s (or on a new stage); a failed report never stops the render.
const jobId = process.env.JOB_ID?.trim();
let lastSent = { at: 0, pct: -1, stage: "" };
function progress(pct: number, stage: string) {
  if (!jobId || !/^[0-9a-f-]{36}$/.test(jobId)) return;
  const p = Math.round(pct);
  const now = Date.now();
  if (stage === lastSent.stage && (p === lastSent.pct || now - lastSent.at < 10_000)) return;
  lastSent = { at: now, pct: p, stage };
  fetch(`${base}/api/render/${episodeId}/job`, {
    method: "POST",
    headers: { ...auth, "Content-Type": "application/json" },
    body: JSON.stringify({ jobId, status: "running", progress: p, stage }),
    signal: AbortSignal.timeout(10_000),
  }).catch(() => {});
}

/** GET from the app, returning the body bytes; retries a stalled or failed request a few times. */
async function get(url: string): Promise<Buffer> {
  for (let attempt = 1; ; attempt++) {
    try {
      const res = await fetch(`${base}${url}`, { headers: auth, signal: AbortSignal.timeout(60_000) });
      if (!res.ok) throw new Error(`GET ${url} → ${res.status} ${(await res.text()).slice(0, 200)}`);
      return Buffer.from(await res.arrayBuffer());
    } catch (err) {
      if (attempt >= 4) throw err;
      log(`retrying ${url} (${err instanceof Error ? err.message : err})`);
      await new Promise((r) => setTimeout(r, attempt * 2000));
    }
  }
}

const manifest = JSON.parse((await get(`/api/render/${episodeId}`)).toString()) as {
  title: string;
  videoStyle?: string;
  version: number;
  lines: ManifestLine[];
  /** custom scripts: direction / pacing notes (parsed by rules, video/src/direction.ts) */
  direction?: string | null;
  custom?: boolean;
  /** uploaded custom props / SFX: name → HTTPS URL (Supabase Storage), loaded directly by Remotion */
  assetUrls?: AssetUrls;
};
log(`"${manifest.title}" v${manifest.version}: ${manifest.lines.length} lines${manifest.custom ? " (custom script, no AI)" : ""}`);
const direction = parseDirection(manifest.direction);
if (manifest.direction) log(`direction: ${JSON.stringify({ ...direction, notes: undefined })}`);
// Props and SFX uploaded in the app (public Supabase bucket): Remotion loads them from their HTTPS URLs, saved on the
// beats and listed by the app (nothing is written to public/).
const assetUrls: AssetUrls = { props: manifest.assetUrls?.props ?? {}, sfx: manifest.assetUrls?.sfx ?? {} };
registerRemoteAssets(assetUrls);
registerLineAssets(manifest.lines);
const uploaded = [...Object.keys(assetUrls.props ?? {}), ...Object.keys(assetUrls.sfx ?? {})];
if (uploaded.length) log(`uploaded assets (loaded by URL): ${uploaded.join(", ")}`);

rmSync(path.join(pub, episodeId), { recursive: true, force: true });
mkdirSync(path.join(pub, episodeId), { recursive: true });
mkdirSync(work, { recursive: true });

const ffmpeg = (...a: string[]) => execFileSync("ffmpeg", ["-nostdin", "-hide_banner", "-loglevel", "error", "-y", ...a], { timeout: 120_000 });
// Trim silence at both ends (keep a short tail), even out loudness, 48 kHz mono.
// Two passes: running loudnorm in the same chain as areverse can stall ffmpeg on some browser recordings.
const TRIM =
  "highpass=f=70," +
  "silenceremove=start_periods=1:start_threshold=-42dB:start_silence=0.08," +
  "areverse,silenceremove=start_periods=1:start_threshold=-42dB:start_silence=0.15,areverse";
// Voice chain: rumble cut at 80 Hz, gentle compression, loudness to -14 LUFS (TikTok/Reels/Shorts level).
// Tighten (default on, --no-tighten to skip): pauses inside a line over 0.3 s shrink to 0.15 s.
// The voices play at their recorded speed, so each line lands where the recording's pacing puts it. (The old
// speed-up, Uco ×1.12 and Ocu ×1.06, pulled every later line earlier: about 2 s by the fourth line. --speed-up brings
// it back.)
const TIGHTEN = !args.includes("--no-tighten");
const PAUSES = "silenceremove=stop_periods=-1:stop_duration=0.3:stop_threshold=-40dB:stop_silence=0.15,";
const SPEED: Record<string, number> = args.includes("--speed-up") ? { uco: 1.12, ocu: 1.06 } : { uco: 1, ocu: 1 };
const LEVEL = "highpass=f=80,acompressor=threshold=-20dB:ratio=3:attack=5:release=80:makeup=2,loudnorm=I=-14:TP=-1.5:LRA=7";
// Inner thoughts: telephone band plus a short room reverb, so they read as "in his head".
const THOUGHT = "highpass=f=300,lowpass=f=3400,aecho=0.8:0.55:45|90:0.25|0.15,";

const lines: EpisodeProps["lines"] = [];
progress(2, "Preparing the voices");
for (const line of manifest.lines) {
  progress(2 + (10 * line.index) / Math.max(1, manifest.lines.length), "Preparing the voices");
  const n = String(line.index + 1).padStart(2, "0");
  if (!line.hasAudio) {
    // No take yet: silent, for the script's own timestamps (start–end) when it has them, else a speaking-speed
    // length for the Indonesian line (~2.6 words a second, at least 1.5 s).
    const timed = line.start_s != null && line.end_s != null && line.end_s > line.start_s ? line.end_s - line.start_s : null;
    const words = (line.text || line.subtitle).split(/\s+/).filter(Boolean).length;
    const frames = Math.round((timed ?? Math.max(1.5, words / 2.6 + 0.4)) * FPS);
    lines.push({ ...line, audio: null, frames, envelope: [] });
    log(`line ${n} (${line.speaker}): no recording, ${frames} silent frames`);
    continue;
  }
  const raw = path.join(work, `line-${n}.raw`);
  writeFileSync(raw, await get(`/api/render/${episodeId}/audio/${line.index}`));
  const rel = `${episodeId}/line-${n}.wav`;
  const wav = path.join(pub, rel);
  const trimmed = path.join(work, `line-${n}.trim.wav`);
  ffmpeg("-i", raw, "-af", TRIM, "-ar", "48000", "-ac", "1", trimmed);
  const speed = SPEED[line.speaker] ?? 1;
  const tighten = TIGHTEN ? `${PAUSES}${speed !== 1 ? `atempo=${speed},` : ""}` : "";
  ffmpeg("-i", trimmed, "-af", tighten + (line.thought_bubble ? THOUGHT : "") + LEVEL, "-ar", "48000", "-ac", "1", wav);

  // Loudness per video frame → mouth openness 0..1
  const pcm = execFileSync("ffmpeg", ["-nostdin", "-hide_banner", "-loglevel", "error", "-i", wav, "-f", "s16le", "-ac", "1", "-ar", "48000", "-"], {
    maxBuffer: 1 << 28,
  });
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
  const envelope = rms.map((v) => Math.round(Math.min(1, Math.max(0, (v - floor * 1.5) / (loud - floor * 1.5 || 1))) * 100) / 100);
  lines.push({ ...line, audio: rel, frames: envelope.length, envelope });
  log(`line ${n} (${line.speaker}): ${(envelope.length / FPS).toFixed(1)} s after trimming`);
}

const props: EpisodeProps = { title: manifest.title, lines, direction, assetUrls };
const total = totalFrames(lines, direction);
log(`timeline: ${(total / FPS).toFixed(1)} s including the end card`);
// Beat sheet: when each line starts and ends in the video (m:ss.ss), its shot, pose and stage, for checking timing
// and props from the run log.
const clock = (f: number) => `${Math.floor(f / FPS / 60)}:${((f / FPS) % 60).toFixed(2).padStart(5, "0")}`;
for (const b of buildBeats(props.lines, direction)) {
  const l = b.line === null ? null : props.lines[b.line];
  const stage = [b.propImage ?? (b.propTag !== "none" ? b.propTag : null), b.overlay?.kind, b.thought ? "thought" : null, b.kinetic ? `"${b.kinetic}"` : null].filter(Boolean).join(" ");
  log(`beat ${b.id.padEnd(4)} ${clock(b.startFrame)}–${clock(b.startFrame + b.durationInFrames)} ${b.speaker.padEnd(4)} ${b.cameraShot} ${b.emotion}${stage ? ` · ${stage}` : ""}${l ? ` · ${l.text.slice(0, 48)}` : ""}`);
}
writeFileSync(path.join(work, "props.json"), JSON.stringify(props));
if (args.includes("--prep")) {
  // --prep: stop after the audio and props.json (for previews: npx remotion still … --props=out/<id>/props.json)
  log(`prepared ${path.join(work, "props.json")}`);
  process.exit(0);
}

// Optional puppet sprites, SFX and props (public/cast, public/sfx, public/props at the repo root): refresh the list of what exists and
// copy them next to the episode audio so the bundle can serve them. Missing ones fall back (SVG cast, no SFX).
const assets = writeAssetManifest();
for (const dir of ["cast", "sfx", "props"]) {
  const src = path.join(here, "..", "public", dir);
  if (existsSync(src)) cpSync(src, path.join(pub, dir), { recursive: true });
}
log(`assets: ${assets.cast.length} cast sprites, ${assets.sfx.length} sound effects, ${assets.props.length} props`);
log("bundling…");
progress(13, "Getting the animation ready");
const serveUrl = await bundle({ entryPoint: path.join(here, "src/index.ts"), publicDir: pub });
const browserExecutable = process.env.CHROME_PATH ?? (existsSync("/opt/pw-browsers") ? findChrome() : null);
// --style <id> overrides the episode's setting (ids in src/styles/registry.ts)
const style = styleById(args.includes("--style") ? args[args.indexOf("--style") + 1] : manifest.videoStyle);
const compositionId = COMPOSITION_FOR[style.id];
log(`style: ${style.label} (${compositionId})`);
const composition = await selectComposition({ serveUrl, id: compositionId, inputProps: props, browserExecutable });
const out = path.join(work, `episode-v${manifest.version}.mp4`);
log(`rendering ${composition.durationInFrames} frames at ${composition.width}x${composition.height}…`);
let last = -1;
// --reuse: upload the MP4 from a previous run instead of rendering again
if (!(args.includes("--reuse") && existsSync(out))) await renderMedia({
  composition,
  serveUrl,
  codec: "h264",
  crf: 23,
  audioBitrate: "192k",
  outputLocation: out,
  inputProps: props,
  browserExecutable,
  concurrency: Number(process.env.CONCURRENCY) || null,
  onProgress: ({ progress: done }) => {
    const pct = Math.floor(done * 10) * 10;
    if (pct !== last) log(`  ${pct}%`), (last = pct);
    progress(15 + done * 77, "Rendering frames");
  },
});
const size = statSync(out).size;
const durationMs = Math.round((composition.durationInFrames / FPS) * 1000);
log(`done: ${out} (${(size / 1e6).toFixed(1)} MB, ${(durationMs / 1000).toFixed(1)} s)`);

if (upload) {
  // Vercel caps request bodies at 4.5 MB: send 4 MB parts, then ask the app to join them.
  log("uploading to the app…");
  const bytes = readFileSync(out);
  const id = crypto.randomUUID();
  const PART = 4 * 1024 * 1024;
  const parts = Math.ceil(bytes.length / PART);
  for (let n = 0; n < parts; n++) {
    progress(93 + (6 * n) / parts, "Uploading the video");
    await post(`/api/render/${episodeId}/video/part?upload=${id}&n=${n}`, bytes.subarray(n * PART, (n + 1) * PART), "application/octet-stream");
    log(`  part ${n + 1}/${parts}`);
  }
  const done = await post(`/api/render/${episodeId}/video/complete`, JSON.stringify({ upload: id, parts, durationMs }), "application/json");
  log(`uploaded: ${done}`);
}

async function post(url: string, body: Buffer | string, type: string) {
  for (let attempt = 1; ; attempt++) {
    try {
      const res = await fetch(`${base}${url}`, { method: "POST", headers: { ...auth, "Content-Type": type }, body: typeof body === "string" ? body : new Uint8Array(body), signal: AbortSignal.timeout(120_000) });
      if (!res.ok) throw new Error(`POST ${url} → ${res.status} ${(await res.text()).slice(0, 300)}`);
      return res.text();
    } catch (err) {
      if (attempt >= 4) throw err;
      log(`retrying ${url} (${err instanceof Error ? err.message : err})`);
      await new Promise((r) => setTimeout(r, attempt * 2000));
    }
  }
}

function findChrome() {
  const dir = "/opt/pw-browsers";
  for (const d of execFileSync("ls", [dir]).toString().split("\n")) {
    const p = path.join(dir, d, "chrome-headless-shell-linux64", "chrome-headless-shell");
    if (d.startsWith("chromium_headless_shell") && existsSync(p)) return p;
  }
  return null;
}
