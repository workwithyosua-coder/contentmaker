import React from "react";
import { AbsoluteFill, Sequence, interpolate, spring, useCurrentFrame, useVideoConfig } from "remotion";
import { buildBeats, type Beat } from "../beats";
import { HEAVY, SafeFrame, VoiceTrack } from "../cast/CueShared";
import { GrainVignette, SfxCues } from "../shared/Compositing";
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

export function KoranKinetik({ lines, reducedMotion = false }: CueProps) {
  const beats = buildBeats(lines);
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
    </AbsoluteFill>
  );
}

function KoranBeat({ beat, line, reduced }: { beat: Beat; line: EpisodeLine | null; reduced: boolean }) {
  const f = useCurrentFrame();
  const { fps } = useVideoConfig();
  const cta = beat.beatType === "cta-stinger";
  const zoom = reduced ? 1 : interpolate(f, [0, beat.durationInFrames], [G.pushInScale[0], G.pushInScale[1]], clamp);
  const ctaPop = reduced ? 1 : spring({ frame: f - 6, fps, config: { mass: 0.7, damping: 14, stiffness: 200 } });

  return (
    <>
      {/* CAST + VISUAL STAGE: the director's camera shot for this beat (no headline card; kinetic text and props
          float on the open stage), with the paper push-in */}
      <AbsoluteFill style={{ transform: `scale(${zoom})`, transformOrigin: "50% 45%" }}>
        <DirectorStage beat={beat} line={line} frame={f} skin={SKIN} reduced={reduced} />
      </AbsoluteFill>

      <SafeFrame>
        {/* BOTTOM: English subtitle floating over the chests (ends at y 1260), or the CTA card */}
        {cta ? (
          <div
            style={{
              position: "absolute",
              // bottom-left, so Ocu's pointing hand and the arrow (right side) stay clear
              left: 0,
              bottom: 0,
              background: P.accent,
              border: `5px solid ${P.ink}`,
              boxShadow: `8px 8px 0 ${P.ink}`,
              padding: "18px 26px",
              display: "flex",
              alignItems: "center",
              gap: 18,
              transform: `scale(${0.92 + 0.08 * Math.min(1, ctaPop)})`,
              transformOrigin: "0% 100%",
            }}
          >
            <span style={{ fontFamily: HEAVY, fontWeight: 900, fontSize: 40, color: P.ink }}>TAP + DI KANAN</span>
            <svg width={60} height={40} viewBox="0 0 24 16" aria-hidden>
              <path d="M2 8 H20 M14 2 L21 8 L14 14" fill="none" stroke={P.ink} strokeWidth={3} strokeLinecap="round" strokeLinejoin="round" />
            </svg>
          </div>
        ) : null}
      </SafeFrame>

      {/* movie-style English subtitle, timed to the voice, no box (y 1120..1250); italic for inner thoughts */}
      <MovieSubtitle chunks={beat.subtitleChunks} frame={f} reduced={reduced} italic={beat.thought} />
    </>
  );
}
