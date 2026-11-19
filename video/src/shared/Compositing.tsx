import React from "react";
import { AbsoluteFill, Audio, Sequence, useCurrentFrame } from "remotion";
import { sfxFile } from "../assets";
import { assetSrc } from "../assets/src";
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

/** Sound-effect cues. Each plays only if public/sfx/{name}.mp3 (or .wav) has been added; otherwise nothing. */
export function SfxCues({ cues }: { cues: SfxCue[] }) {
  return (
    <>
      {cues.map((c, i) => {
        const file = assetSrc(sfxFile(c.name));
        if (!file) return null;
        return (
          <Sequence key={`${c.name}-${i}`} from={Math.max(0, c.frame)} durationInFrames={60} layout="none" name={`sfx ${c.name}`}>
            {/* a sound that can't be loaded stays silent instead of failing the render */}
            <Audio src={file} volume={c.volume ?? 0.6} onError={() => undefined} />
          </Sequence>
        );
      })}
    </>
  );
}

/**
 * Background music bed (public/sfx/bgm.mp3, looped) when the direction turns it on: at the bed level, ducked to a
 * third while someone talks, and to `thoughtDuck` of the bed under (thought) lines. Silent without the file.
 */
export function BackgroundMusic({ volume, thoughtDuck, beats, lines }: { volume: number; thoughtDuck: number; beats: Beat[]; lines: EpisodeLine[] }) {
  const file = assetSrc(sfxFile("bgm"));
  if (!file) return null;
  const level = (f: number) => {
    const b = beats.find((x) => f >= x.startFrame && f < x.startFrame + x.durationInFrames);
    if (!b || b.line === null) return volume; // end card: full bed
    const l = lines[b.line];
    const talking = (l.envelope?.[f - b.startFrame] ?? 0) > 0.08;
    const duck = b.thought ? thoughtDuck : 1;
    return volume * duck * (talking ? 0.35 : 1);
  };
  return <Audio src={file} loop volume={level} onError={() => undefined} />;
}
