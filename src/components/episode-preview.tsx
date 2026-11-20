"use client";

import { Player } from "@remotion/player";
import { useState, useSyncExternalStore } from "react";
import { ComicEpisode } from "../../video/src/comic/ComicEpisode";
import { KoranKinetik } from "../../video/src/koran/KoranKinetik";
import { DiagramTaktis } from "../../video/src/taktis/DiagramTaktis";
import { Episode } from "../../video/src/Episode";
import { COMPOSITION_FOR, DEFAULT_STYLE_ID, styleById } from "../../video/src/styles/registry";
import { parseDirection } from "../../video/src/direction";
import { FPS, HEIGHT, WIDTH, cueTotalFrames, totalFrames, type AssetUrls, type EpisodeLine, type EpisodeProps } from "../../video/src/types";
import { castSprites, propFile, registerLineAssets, registerRemoteAssets } from "../../video/src/assets";
import { buildBeats } from "../../video/src/beats";

// Live preview of the episode animation (the same Remotion composition the renderer uses), built in the browser
// from the selected takes: each take is decoded, its loudness measured per frame for the mouths, and the silence
// at both ends skipped. Nothing is rendered or uploaded.

/** Same composition the renderer uses for each style (ids registered in video/src/Root.tsx). */
const COMPONENTS: Record<string, React.ComponentType<EpisodeProps & { reducedMotion?: boolean }>> = {
  Episode,
  EpisodeComic: ComicEpisode,
  EpisodeKoran: KoranKinetik,
  EpisodeTaktis: DiagramTaktis,
};

export type PreviewLine = Omit<EpisodeLine, "audio" | "frames" | "envelope" | "trimFrom" | "hasAudio"> & { take: string | null };

type State = { status: "idle" } | { status: "loading"; done: number } | { status: "ready"; props: EpisodeProps } | { status: "error"; message: string };

export function EpisodePreview({
  title,
  lines,
  style = DEFAULT_STYLE_ID,
  direction = null,
  assetUrls = null,
  exact = false,
}: {
  title: string;
  lines: PreviewLine[];
  style?: string;
  direction?: string | null;
  /** uploaded custom props / SFX (public URLs), so the preview shows them like the render does */
  assetUrls?: AssetUrls | null;
  /** Manual / Exact Import script: no keyword-guessed props or cards (same as the render) */
  exact?: boolean;
}) {
  const [state, setState] = useState<State>({ status: "idle" });
  const preset = styleById(style);
  const composition = COMPOSITION_FOR[preset.id] ?? "Episode";
  const Component = COMPONENTS[composition] ?? Episode;
  const takesReducedMotion = composition !== "Episode";
  // 2D Vertical Comic: honour the viewer's reduced-motion setting (no shake, tilt wobble or speed-line pulses).
  const reduced = useSyncExternalStore(subscribeReduced, () => window.matchMedia(REDUCED).matches, () => false);

  async function load() {
    setState({ status: "loading", done: 0 });
    try {
      const ctx = new AudioContext();
      const out: EpisodeLine[] = [];
      let done = 0;
      for (const l of lines) {
        out.push(await analyse(ctx, l));
        setState({ status: "loading", done: ++done });
      }
      await ctx.close();
      const props: EpisodeProps = { title, lines: out, direction: { ...parseDirection(direction), exact }, assetUrls };
      // download every sprite and prop the episode shows before playing: a pose or prop that's still loading would
      // flash an empty frame at a cut
      await preloadImages(imagesFor(props, composition)).catch(() => {});
      setState({ status: "ready", props });
    } catch (err) {
      setState({ status: "error", message: err instanceof Error ? err.message : String(err) });
    }
  }

  if (state.status === "ready") {
    // cue styles end 0.5 s after a closing call-to-action line (no silent end card); the others keep theirs
    const frames = composition === "EpisodeKoran" || composition === "EpisodeTaktis" ? cueTotalFrames(state.props.lines, state.props.direction) : totalFrames(state.props.lines, state.props.direction);
    return (
      <div className="space-y-2">
        <div className="mx-auto w-full max-w-[360px] overflow-hidden rounded-control border border-border bg-black">
          <Player
            key={preset.id}
            component={Component as typeof Episode}
            inputProps={takesReducedMotion ? { ...state.props, reducedMotion: reduced } : state.props}
            durationInFrames={frames}
            compositionWidth={preset.resolution.width ?? WIDTH}
            compositionHeight={preset.resolution.height ?? HEIGHT}
            fps={preset.fps ?? FPS}
            controls
            // voice + several sound effects + music can overlap; the default 5 shared audio tags made busy moments
            // (e.g. a beat's own whoosh on a cut plus pop, stamp and the voice) crash the preview with ⚠
            numberOfSharedAudioTags={16}
            style={{ width: "100%", aspectRatio: "9 / 16" }}
            acknowledgeRemotionLicense
          />
        </div>
        <p className="text-xs text-muted">
          {Math.round(frames / FPS)} s. This is a live preview; tap Render video for the finished MP4 (cleaned-up audio, exact timing).
        </p>
        <button type="button" onClick={load} className="btn btn-quiet">
          Reload preview
        </button>
      </div>
    );
  }
  return (
    <div className="space-y-2">
      <button type="button" onClick={load} disabled={state.status === "loading"} className="btn btn-secondary">
        {state.status === "loading" ? `Loading takes… ${state.done}/${lines.length}` : "Preview the animation"}
      </button>
      {state.status === "error" && (
        <p className="text-xs" style={{ color: "var(--bad)" }}>
          Preview failed: {state.message}
        </p>
      )}
    </div>
  );
}

const REDUCED = "(prefers-reduced-motion: reduce)";
function subscribeReduced(cb: () => void) {
  const q = window.matchMedia(REDUCED);
  q.addEventListener("change", cb);
  return () => q.removeEventListener("change", cb);
}

/** One line → timing, trim and lip-sync data. Falls back to the take's length (no lip-sync) if the audio can't be read. */
async function analyse(ctx: AudioContext, l: PreviewLine): Promise<EpisodeLine> {
  const base = { ...l, hasAudio: Boolean(l.take) };
  if (!l.take) {
    // silent, like the renderer: the script's own start–end when it has one, else ~2.6 words a second (≥ 1.5 s)
    const timed = l.start_s != null && l.end_s != null && l.end_s > l.start_s ? l.end_s - l.start_s : null;
    const words = (l.text || l.subtitle).split(/\s+/).filter(Boolean).length;
    const frames = Math.round((timed ?? Math.max(1.5, words / 2.6 + 0.4)) * FPS);
    return { ...base, audio: null, frames, envelope: [] };
  }
  try {
    const res = await fetch(l.take);
    if (!res.ok) throw new Error(String(res.status));
    const buf = await ctx.decodeAudioData(await res.arrayBuffer());
    const data = buf.getChannelData(0);
    const per = Math.round(buf.sampleRate / FPS);
    const rms: number[] = [];
    for (let i = 0; i < data.length; i += per) {
      let s = 0;
      const end = Math.min(data.length, i + per);
      for (let j = i; j < end; j++) s += data[j] * data[j];
      rms.push(Math.sqrt(s / Math.max(1, end - i)));
    }
    const sorted = [...rms].sort((a, b) => a - b);
    const loud = sorted[Math.floor(sorted.length * 0.95)] || 1;
    const floor = sorted[Math.floor(sorted.length * 0.2)] ?? 0;
    const env = rms.map((v) => Math.min(1, Math.max(0, (v - floor * 1.5) / (loud - floor * 1.5 || 1))));
    const first = Math.max(0, env.findIndex((v) => v > 0.08) - 2);
    let last = env.length - 1;
    while (last > first && env[last] <= 0.08) last--;
    last = Math.min(env.length - 1, last + 4);
    return { ...base, audio: l.take, trimFrom: first, frames: last - first + 1, envelope: env.slice(first, last + 1) };
  } catch {
    const seconds = await durationOf(l.take);
    return { ...base, audio: l.take, frames: Math.max(FPS, Math.round(seconds * FPS)), envelope: [] };
  }
}

function durationOf(url: string) {
  return new Promise<number>((resolve) => {
    const a = new Audio();
    a.preload = "metadata";
    a.onloadedmetadata = () => resolve(Number.isFinite(a.duration) ? a.duration : 3);
    a.onerror = () => resolve(3);
    a.src = url;
  });
}

/** Every image the cue styles will draw for this episode: both mouth frames of each pose used, the CTA poses, props. */
function imagesFor(props: EpisodeProps, composition: string): string[] {
  if (composition !== "EpisodeKoran" && composition !== "EpisodeTaktis") return [];
  registerRemoteAssets(props.assetUrls);
  registerLineAssets(props.lines);
  const urls = new Set<string>();
  const add = (p: string | null) => {
    if (!p || p.startsWith("remote:")) return;
    urls.add(/^(https?:)?\/\//.test(p) || p.startsWith("/") ? p : `/${p}`);
  };
  for (const b of buildBeats(props.lines, props.direction)) {
    const poses: ["uco" | "ocu", string][] = b.cameraShot === "cta-stinger" ? [["uco", "triumphant"], ["ocu", "cta"]] : [["uco", b.emotion], ["ocu", b.emotion]];
    for (const [who, emotion] of poses) {
      const s = castSprites(who, emotion);
      if (s) [s.closed, s.open].forEach((f) => add(f));
    }
    if (b.propImage) add(propFile(b.propImage));
  }
  return [...urls];
}

/** Loads and decodes images (8 at a time) so they're in the browser cache before playback; never throws. */
async function preloadImages(urls: string[]) {
  let i = 0;
  const worker = async () => {
    while (i < urls.length) {
      const url = urls[i++];
      const img = new Image();
      img.src = url;
      await img.decode().catch(() => {});
    }
  };
  await Promise.all(Array.from({ length: 8 }, worker));
}
