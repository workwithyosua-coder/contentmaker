import React from "react";
import { AbsoluteFill, Sequence, interpolate, useCurrentFrame } from "remotion";
import { registerLineAssets, registerRemoteAssets } from "../assets";
import { buildBeats, type Beat } from "../beats";
import { VoiceTrack } from "../cast/CueShared";
import { BackgroundMusic, GrainVignette, SfxCues } from "../shared/Compositing";
import { DirectorStage, type DirectorSkin } from "../shared/Director";
import { MovieSubtitle } from "../shared/MovieSubtitle";
import { KINETIC_SLAM, sfxCuesFor } from "../shared/sfxCues";
import { EDITORIAL_PAPER_CUTOUT_STYLE } from "../styles/registry";
import type { EpisodeLine, EpisodeProps } from "../types";

// "Koran Kinetik" (editorial-paper-cutout), ported from the Uco & Ocu Style Lab reference (PR #28). Frame-driven only:
// slow 1.00→1.04 push-in, red kinetic stamps that slam in on emphasis beats, cut-out cast and props.
// On-screen text: short kinetic stamps on emphasis beats only, and the line's English subtitle (never the Indonesian
// line).

const P = EDITORIAL_PAPER_CUTOUT_STYLE.palette;
const G = EDITORIAL_PAPER_CUTOUT_STYLE.editingGrammar;
const clamp = { extrapolateLeft: "clamp", extrapolateRight: "clamp" } as const;

export type CueProps = EpisodeProps & { reducedMotion?: boolean };

const SKIN: DirectorSkin = {
  variant: "paper",
  prop: "paper",
  wash: { uco: P.ucoBg, ocu: "#7FA3A4", kind: "flat" },
  fxColor: P.ink,
  rim: { uco: null, ocu: null },
  dimListener: 0.12,
  arrow: { color: P.accent, outline: P.ink, ring: P.primary },
};

export function KoranKinetik({ lines, direction, assetUrls, reducedMotion = false }: CueProps) {
  // uploaded props / SFX load from their public HTTPS URLs (saved on the beats, and passed by the renderer)
  registerRemoteAssets(assetUrls);
  registerLineAssets(lines);
  const beats = buildBeats(lines, direction);
  return (
    <AbsoluteFill
      style={{
        backgroundColor: P.canvas,
        backgroundImage: "radial-gradient(rgba(20,22,25,0.14) 2.4px, transparent 2.4px)",
        backgroundSize: "24px 24px",
      }}
    >
      {beats.map((b) => (
        <Sequence key={b.id} from={b.startFrame} durationInFrames={b.durationInFrames} name={`${b.id} ${b.beatType} ${b.speaker}`}>
          <KoranBeat beat={b} line={b.line === null ? null : lines[b.line]} reduced={reducedMotion} />
        </Sequence>
      ))}
      <VoiceTrack lines={lines} beats={beats} />
      <GrainVignette reduced={reducedMotion} tone="paper" />
      <SfxCues cues={sfxCuesFor(beats, { stampAt: KINETIC_SLAM })} />
      {direction?.bgm && <BackgroundMusic volume={direction.bgmVolume} thoughtDuck={direction.thoughtDuck} beats={beats} lines={lines} />}
    </AbsoluteFill>
  );
}

function KoranBeat({ beat, line, reduced }: { beat: Beat; line: EpisodeLine | null; reduced: boolean }) {
  const f = useCurrentFrame();
  const zoom = reduced ? 1 : interpolate(f, [0, beat.durationInFrames], [G.pushInScale[0], G.pushInScale[1]], clamp);

  return (
    <>
      {/* CAST + VISUAL STAGE: the director's camera shot for this beat (no headline card; kinetic text and props
          float on the open stage), with the paper push-in */}
      <AbsoluteFill style={{ transform: `scale(${zoom})`, transformOrigin: "50% 45%" }}>
        <DirectorStage beat={beat} line={line} frame={f} skin={SKIN} reduced={reduced} />
      </AbsoluteFill>

      {/* the CTA end card's FOLLOW + button and arrow are drawn by the Director (upper-right safe zone); no banner
          over the chests, where TikTok's caption overlay sits */}

      {/* movie-style English subtitle, timed to the voice, no box, low in the frame (y 1480..1620, under every face); italic for inner thoughts */}
      <MovieSubtitle chunks={beat.subtitleChunks} frame={f} reduced={reduced} italic={beat.thought} />
    </>
  );
}
