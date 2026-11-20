import React from "react";
import { AbsoluteFill, Sequence, useCurrentFrame } from "remotion";
import { registerLineAssets, registerRemoteAssets } from "../assets";
import { buildBeats, type Beat } from "../beats";
import { VoiceTrack } from "../cast/CueShared";
import { BackgroundMusic, GrainVignette, SfxCues } from "../shared/Compositing";
import { DirectorStage, type DirectorSkin } from "../shared/Director";
import { MovieSubtitle } from "../shared/MovieSubtitle";
import { cameraAt, cutDirection } from "../shared/motion";
import { KINETIC_SLAM, sfxCuesFor } from "../shared/sfxCues";
import { EDITORIAL_PAPER_CUTOUT_STYLE } from "../styles/registry";
import type { EpisodeLine, EpisodeProps } from "../types";

// "Koran Kinetik" (editorial-paper-cutout), ported from the Uco & Ocu Style Lab reference (PR #28). Frame-driven only:
// slow 1.00→1.04 push-in (camera moves in shared/motion.ts), red kinetic stamps that slam in on emphasis beats, cut-out cast and props.
// On-screen text: short kinetic stamps on emphasis beats only, and the line's English subtitle (never the Indonesian
// line).

const P = EDITORIAL_PAPER_CUTOUT_STYLE.palette;
const G = EDITORIAL_PAPER_CUTOUT_STYLE.editingGrammar;

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
      {beats.map((b, i) => (
        <Sequence key={b.id} from={b.startFrame} durationInFrames={b.durationInFrames} name={`${b.id} ${b.beatType} ${b.speaker}`}>
          <KoranBeat beat={b} line={b.line === null ? null : lines[b.line]} reduced={reducedMotion} cutDir={cutDirection(beats, i)} />
        </Sequence>
      ))}
      <VoiceTrack lines={lines} beats={beats} />
      <GrainVignette reduced={reducedMotion} tone="paper" />
      <SfxCues cues={sfxCuesFor(beats, { stampAt: KINETIC_SLAM })} />
      {direction?.bgm && <BackgroundMusic volume={direction.bgmVolume} thoughtDuck={direction.thoughtDuck} beats={beats} lines={lines} />}
    </AbsoluteFill>
  );
}

function KoranBeat({ beat, line, reduced, cutDir }: { beat: Beat; line: EpisodeLine | null; reduced: boolean; cutDir: -1 | 0 | 1 }) {
  const f = useCurrentFrame();
  // camera: the paper push-in (a slower 1.00 → 1.06 Ken Burns on explanation beats), a 1.12× punch with a 2° tilt
  // on shocked beats, and a micro punch-in halfway through long beats
  const cam = reduced ? { scale: 1, rotate: 0 } : cameraAt(beat, f, [G.pushInScale[0], G.pushInScale[1]]);

  return (
    <>
      {/* CAST + VISUAL STAGE: the director's camera shot for this beat (no headline card; kinetic text and props
          float on the open stage), with the paper push-in */}
      <AbsoluteFill style={{ transform: `scale(${cam.scale}) rotate(${cam.rotate}deg)`, transformOrigin: "50% 40%" }}>
        <DirectorStage beat={beat} line={line} frame={f} skin={SKIN} reduced={reduced} cutDir={cutDir} />
      </AbsoluteFill>

      {/* the CTA end card's FOLLOW + button and arrow are drawn by the Director (upper-right safe zone); no banner
          over the chests, where TikTok's caption overlay sits */}

      {/* kinetic English subtitle: 3–5 word chunks, the spoken word highlighted, low in the frame (y 1420..1520, under every face); italic for inner thoughts */}
      <MovieSubtitle chunks={beat.subtitleChunks} frame={f} reduced={reduced} italic={beat.thought} />
    </>
  );
}
