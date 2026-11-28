import React from "react";
import { AbsoluteFill, Sequence, useCurrentFrame } from "remotion";
import { registerLineAssets, registerRemoteAssets } from "../assets";
import { buildBeats, type Beat } from "../beats";
import { VoiceTrack } from "../cast/CueShared";
import { useSpriteFrames } from "../cast/useSpriteFrames";
import { BackgroundMusic, GrainVignette, SfxCues } from "../shared/Compositing";
import { DirectorStage, WhipStreaks, type DirectorSkin } from "../shared/Director";
import { BeatSubtitle, SubtitleScrim } from "../shared/MovieSubtitle";
import { cameraAt, cutDirection, holdFrames, setMotionEnergy, whipOffset } from "../shared/motion";
import { sfxCuesFor } from "../shared/sfxCues";
import { EDITORIAL_PAPER_CUTOUT_STYLE } from "../styles/registry";
import type { EpisodeLine, EpisodeProps } from "../types";

// "Koran Kinetik" (editorial-paper-cutout), ported from the Uco & Ocu Style Lab reference (PR #28). Frame-driven only:
// camera framing per beat (medium push-in, punch close-up, slow creep, a mid-beat punch-in; shared/motion.ts), a slowly
// drifting halftone paper, red kinetic stamps that slam in on emphasis beats, cut-out cast and props.
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

const BACKGROUND: React.CSSProperties = {
  backgroundColor: P.canvas,
  backgroundImage: "radial-gradient(rgba(20,22,25,0.14) 2.4px, transparent 2.4px)",
  backgroundSize: "24px 24px",
};

export function KoranKinetik({ lines, direction, assetUrls, reducedMotion = false }: CueProps) {
  // uploaded props / SFX load from their public HTTPS URLs (saved on the beats, and passed by the renderer)
  registerRemoteAssets(assetUrls);
  registerLineAssets(lines);
  // Live Studio Tunables: the puppets' motion energy, set before any puppet renders
  setMotionEnergy(direction?.motionEnergy);
  // uploaded sprites are measured once so they're framed like the calibrated ones (spriteFrame.ts)
  useSpriteFrames(Object.values(assetUrls?.cast ?? {}));
  // angry beats draw the repo's style-matched angry sprites directly (the shocked / defensive alias is gone)
  const beats = buildBeats(lines, direction);
  return (
    <AbsoluteFill style={BACKGROUND}>
      {/* each beat is a full-canvas opaque layer; it stays mounted (held on its last frame) while the next beat
          whips in over it, so no frame ever shows an empty background */}
      {beats.map((b, i) => (
        <Sequence key={b.id} from={b.startFrame} durationInFrames={b.durationInFrames + holdFrames(beats, i)} name={`${b.id} ${b.beatType} ${b.speaker}`}>
          <KoranBeat beat={b} line={b.line === null ? null : lines[b.line]} reduced={reducedMotion} cutDir={cutDirection(beats, i)} />
        </Sequence>
      ))}
      <SubtitleScrim />
      {beats.map((b, i) => (
        <Sequence key={`s-${b.id}`} from={b.startFrame} durationInFrames={b.durationInFrames} name={`subtitle ${b.id}`} layout="none">
          <BeatSubtitle beat={b} reduced={reducedMotion} cutDir={cutDirection(beats, i)} />
        </Sequence>
      ))}
      <VoiceTrack lines={lines} beats={beats} />
      <GrainVignette reduced={reducedMotion} tone="paper" />
      <SfxCues cues={sfxCuesFor(beats)} />
      {direction?.bgm && <BackgroundMusic volume={direction.bgmVolume} thoughtDuck={direction.thoughtDuck} urgent={Boolean(direction.urgentBgm)} beats={beats} lines={lines} underDialogue={direction.speechBgm} />}
    </AbsoluteFill>
  );
}

function KoranBeat({ beat, line, reduced, cutDir }: { beat: Beat; line: EpisodeLine | null; reduced: boolean; cutDir: -1 | 0 | 1 }) {
  const raw = useCurrentFrame();
  // past its end the beat holds its last frame underneath the next beat's whip
  const held = raw >= beat.durationInFrames;
  const f = held ? beat.durationInFrames - 1 : raw;
  const x = held || reduced ? 0 : whipOffset(cutDir, raw);
  // camera: the paper push-in (a slower 1.00 → 1.06 Ken Burns on explanation beats), a 1.12× punch with a 2° tilt
  // on shocked beats, a micro punch-in halfway through long beats, and a short shake on urgent impacts
  const cam = reduced ? { scale: 1, rotate: 0, x: 0, y: 0 } : cameraAt(beat, f, [G.pushInScale[0], G.pushInScale[1]]);
  return (
    <AbsoluteFill style={{ ...BACKGROUND, backgroundPosition: reduced ? undefined : `${((beat.startFrame + f) * 0.5) % 24}px ${((beat.startFrame + f) * 0.3) % 24}px`, transform: x ? `translateX(${x}px)` : undefined }}>
      <AbsoluteFill style={{ transform: `translate(${cam.x}px, ${cam.y}px) scale(${cam.scale}) rotate(${cam.rotate}deg)`, transformOrigin: "50% 40%" }}>
        <DirectorStage beat={beat} line={line} frame={f} skin={SKIN} reduced={reduced} camera={{ ...cam, y: cam.y, slideX: x }} />
      </AbsoluteFill>
      {x !== 0 && <WhipStreaks dir={cutDir} frame={raw} color={SKIN.fxColor} />}
    </AbsoluteFill>
  );
}
