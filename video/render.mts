// Renders one Uco & Ocu episode to MP4 and uploads it to the app.
//
//   RENDER_TOKEN=... npx tsx render.mts <episodeId> [--base https://contentmaker-lime.vercel.app] [--no-upload]
//
// Steps: fetch the script from the app → download each line's selected take → trim silence and even out
// loudness (ffmpeg) → measure loudness per frame for the mouth movement → render with Remotion → upload.
// Needs ffmpeg/ffprobe and a Chromium (CHROME_PATH, or Remotion downloads its own).
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import path from "node:path";
import { bundle } from "@remotion/bundler";
import { renderMedia, selectComposition } from "@remotion/renderer";
import { FPS, GAP_FRAMES, type EpisodeProps, type ManifestLine } from "./src/types.ts";

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

async function get(url: string) {
  const res = await fetch(`${base}${url}`, { headers: auth });
  if (!res.ok) throw new Error(`GET ${url} → ${res.status} ${(await res.text()).slice(0, 200)}`);
  return res;
}

const manifest = (await (await get(`/api/render/${episodeId}`)).json()) as {
  title: string;
  version: number;
  lines: ManifestLine[];
};
log(`"${manifest.title}" v${manifest.version}: ${manifest.lines.length} lines`);

rmSync(path.join(pub, episodeId), { recursive: true, force: true });
mkdirSync(path.join(pub, episodeId), { recursive: true });
mkdirSync(work, { recursive: true });

const ffmpeg = (...a: string[]) => execFileSync("ffmpeg", ["-hide_banner", "-loglevel", "error", "-y", ...a]);
// Trim silence at both ends (keep a short tail), even out loudness, 48 kHz mono.
const CLEAN =
  "highpass=f=70," +
  "silenceremove=start_periods=1:start_threshold=-42dB:start_silence=0.08," +
  "areverse,silenceremove=start_periods=1:start_threshold=-42dB:start_silence=0.15,areverse," +
  "loudnorm=I=-16:TP=-1.5:LRA=11";

const lines: EpisodeProps["lines"] = [];
for (const line of manifest.lines) {
  const n = String(line.index + 1).padStart(2, "0");
  if (!line.hasAudio) {
    // No take yet: show the subtitle for a reading-speed duration, silent.
    const frames = Math.max(2 * FPS, Math.round((line.subtitle.split(/\s+/).length / 2.6) * FPS));
    lines.push({ ...line, audio: null, frames, envelope: [] });
    log(`line ${n} (${line.speaker}): no recording, ${frames} silent frames`);
    continue;
  }
  const raw = path.join(work, `line-${n}.raw`);
  writeFileSync(raw, Buffer.from(await (await get(`/api/render/${episodeId}/audio/${line.index}`)).arrayBuffer()));
  const rel = `${episodeId}/line-${n}.wav`;
  const wav = path.join(pub, rel);
  ffmpeg("-i", raw, "-af", CLEAN, "-ar", "48000", "-ac", "1", wav);

  // Loudness per video frame → mouth openness 0..1
  const pcm = execFileSync("ffmpeg", ["-hide_banner", "-loglevel", "error", "-i", wav, "-f", "s16le", "-ac", "1", "-ar", "48000", "-"], {
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

const props: EpisodeProps = { title: manifest.title, lines };
const total = lines.reduce((s, l) => s + l.frames + GAP_FRAMES, 0);
log(`timeline: ${(total / FPS).toFixed(1)} s of dialogue + end card`);
writeFileSync(path.join(work, "props.json"), JSON.stringify(props));

log("bundling…");
const serveUrl = await bundle({ entryPoint: path.join(here, "src/index.ts"), publicDir: pub });
const browserExecutable = process.env.CHROME_PATH ?? (existsSync("/opt/pw-browsers") ? findChrome() : null);
const composition = await selectComposition({ serveUrl, id: "Episode", inputProps: props, browserExecutable });
const out = path.join(work, `episode-v${manifest.version}.mp4`);
log(`rendering ${composition.durationInFrames} frames at ${composition.width}x${composition.height}…`);
let last = -1;
await renderMedia({
  composition,
  serveUrl,
  codec: "h264",
  crf: 20,
  audioBitrate: "192k",
  outputLocation: out,
  inputProps: props,
  browserExecutable,
  concurrency: Number(process.env.CONCURRENCY) || null,
  onProgress: ({ progress }) => {
    const pct = Math.floor(progress * 10) * 10;
    if (pct !== last) log(`  ${pct}%`), (last = pct);
  },
});
const size = statSync(out).size;
const durationMs = Math.round((composition.durationInFrames / FPS) * 1000);
log(`done: ${out} (${(size / 1e6).toFixed(1)} MB, ${(durationMs / 1000).toFixed(1)} s)`);

if (upload) {
  log("uploading to the app…");
  const res = await fetch(`${base}/api/render/${episodeId}/video`, {
    method: "POST",
    headers: { ...auth, "Content-Type": "video/mp4", "x-duration-ms": String(durationMs) },
    body: readFileSync(out),
  });
  if (!res.ok) throw new Error(`upload → ${res.status} ${(await res.text()).slice(0, 300)}`);
  log(`uploaded: ${JSON.stringify(await res.json())}`);
}

function findChrome() {
  const dir = "/opt/pw-browsers";
  for (const d of execFileSync("ls", [dir]).toString().split("\n")) {
    const p = path.join(dir, d, "chrome-headless-shell-linux64", "chrome-headless-shell");
    if (d.startsWith("chromium_headless_shell") && existsSync(p)) return p;
  }
  return null;
}
