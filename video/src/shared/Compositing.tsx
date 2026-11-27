import React from "react";
import { AbsoluteFill, Audio, Sequence, useCurrentFrame } from "remotion";
import { bgmFile, sfxFile } from "../assets";
import { assetSrc } from "../assets/src";
import { bgmLevel } from "./bgm";
import type { Beat } from "../beats";
import type { EpisodeLine } from "../types";

// Finishing layers shared by the cue styles.

/** Film / paper grain (~3.5%) that changes every 2 frames, plus a soft edge vignette. Grain is still with reduced motion. */
export function GrainVignette({ reduced, tone }: { reduced: boolean; tone: "paper" | "dark" }) {
  const frame = useCurrentFrame();
  const seed = reduced ? 3 : Math.floor(frame / 2) % 24;
  return (
    <AbsoluteFill style={{ pointerEvents: "none" }}>
      <svg width={1080} height={1920} style={{ position: "absolute", inset: 0, opacity: tone === "paper" ? 0.04 : 0.035, mixBlendMode: tone === "paper" ? "multiply" : "screen" }} aria-hidden>
        <filter id={`grain-${seed}`}>
          <feTurbulence type="fractalNoise" baseFrequency={0.85} numOctaves={2} seed={seed} stitchTiles="stitch" />
          <feColorMatrix type="saturate" values="0" />
        </filter>
        <rect width={1080} height={1920} filter={`url(#grain-${seed})`} />
      </svg>
      <AbsoluteFill style={{ background: `radial-gradient(ellipse 75% 65% at 50% 45%, transparent 58%, ${tone === "paper" ? "rgba(20,22,25,0.22)" : "rgba(0,0,0,0.45)"} 100%)` }} />
    </AbsoluteFill>
  );
}

/** Built-in cues are whoosh / stamp / pop / ding / record-scratch; scripts may name any other public/sfx file. */
export type SfxCue = { name: string; frame: number; volume?: number };

/** How long each built-in effect stays mounted (its real length plus a little); uploaded effects get 2 s. Short slots
 *  keep few audio tags alive at once (the in-app Player shares a limited pool of them). */
const SFX_FRAMES: Record<string, number> = { whoosh: 24, pop: 18, stamp: 24, ding: 30, "record-scratch": 36 };

/** Sound-effect cues. Each plays only if public/sfx/{name}.mp3 (or .wav) has been added; otherwise nothing. */
export function SfxCues({ cues }: { cues: SfxCue[] }) {
  return (
    <>
      {cues.map((c, i) => {
        const file = assetSrc(sfxFile(c.name));
        if (!file) return null;
        return (
          <Sequence key={`${c.name}-${i}`} from={Math.max(0, c.frame)} durationInFrames={SFX_FRAMES[c.name] ?? 60} layout="none" name={`sfx ${c.name}`}>
            {/* a sound that can't be loaded stays silent instead of failing the render */}
            <Audio src={file} volume={c.volume ?? 0.6} onError={() => undefined} />
          </Sequence>
        );
      })}
    </>
  );
}

/**
 * Background music bed (sfx/bgm.mp3, or bgm-urgent.mp3 for urgent episodes; looped) when the direction turns it on,
 * at bgmLevel with ≈ 150 ms fades. Silent without the file.
 */
export function BackgroundMusic({ volume, thoughtDuck, urgent = false, beats, lines }: { volume: number; thoughtDuck: number; urgent?: boolean; beats: Beat[]; lines: EpisodeLine[] }) {
  // urgent episodes ("BGM: urgent", or an angry line) use the urgent track when there is one: uploaded, then repo,
  // then the regular bed
  const file = assetSrc(bgmFile(urgent || beats.some((b) => b.angry)));
  if (!file) return null;
  const target = (f: number) => bgmLevel(beats, lines, volume, thoughtDuck, f);
  // a 5-frame (≈ 150 ms) moving average: dips into and out of thoughts (and under speech) fade instead of clicking
  const level = (f: number) => [0, 1, 2, 3, 4].reduce((s, k) => s + target(Math.max(0, f - k)), 0) / 5;
  return <Audio src={file} loop volume={level} onError={() => undefined} />;
}
