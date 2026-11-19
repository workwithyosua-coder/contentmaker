import React from "react";
import { AbsoluteFill, Easing, Sequence, interpolate, spring, useCurrentFrame, useVideoConfig } from "remotion";
import { SAFE_ZONE, buildBeats, type Beat } from "../beats";
import { BrandAware } from "../brand/UcoOcuWordmark";
import { FollowArrow, FollowTarget, HEAVY, MONO, SafeFrame, VoiceTrack, castLayout, headlineSize, toFrame, wrapHeadline } from "../cast/CueShared";
import { GrainVignette, SfxCues } from "../shared/Compositing";
import { DirectorStage, type DirectorSkin } from "../shared/Director";
import { MovieSubtitle } from "../shared/MovieSubtitle";
import { sfxCuesFor } from "../shared/sfxCues";
import { EDITORIAL_PAPER_CUTOUT_STYLE } from "../styles/registry";
import type { EpisodeLine, EpisodeProps } from "../types";

// "Koran Kinetik" (editorial-paper-cutout), ported from the Uco & Ocu Style Lab reference (PR #28). Frame-driven only:
// paper-slide entrance (6 frames), slow 1.00→1.04 push-in, highlighter sweep, red stamp slam, cut-out cast.
// On-screen text: the beat's important message on top and the line's English subtitle under the cast (never the
// Indonesian line).

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
      <SfxCues cues={sfxCuesFor(beats, { stampAt: 34 })} />
    </AbsoluteFill>
  );
}

/** Card chrome around the headline lines: 5px borders, 22/26 padding, 48px kicker row, 12px gap. */
const CARD_CHROME = 10 + 22 + 26 + 48 + 12;
/** Headline text width inside the card (840 card − borders − padding − highlighter padding). */
const HEADLINE_W = 840 - 10 - 52 - 16;

function KoranBeat({ beat, line, reduced }: { beat: Beat; line: EpisodeLine | null; reduced: boolean }) {
  const f = useCurrentFrame();
  const { fps } = useVideoConfig();
  const cta = beat.beatType === "cta-stinger";
  const m = beat.importantMessage;

  const slideX = reduced ? 0 : interpolate(f, [0, G.transitionFrames], [126, 0], { ...clamp, easing: Easing.out(Easing.cubic) });
  const zoom = reduced ? 1 : interpolate(f, [0, beat.durationInFrames], [G.pushInScale[0], G.pushInScale[1]], clamp);
  const sweep = reduced ? 100 : interpolate(f, [14, 28], [0, 100], clamp);
  const stamp = reduced ? 1 : f < 34 ? 0 : interpolate(f, [34, 42], [1.65, 1], clamp);
  const ctaPop = reduced ? 1 : spring({ frame: f - 6, fps, config: { mass: 0.7, damping: 14, stiffness: 200 } });


  const size = headlineSize(m.headline);
  const headLines = wrapHeadline(m.headline, size, HEADLINE_W);
  const cardH = CARD_CHROME + Math.ceil(headLines.length * size * 1.02);
  const stage = castLayout({ cardBottom: SAFE_ZONE.top + 20 + cardH, cta, frame: f, reduced });
  // who looks where: the listener watches the speaker; in the CTA both look at the viewer

  return (
    <>
      {/* CAST + PROPS: the director's camera shot for this beat, under all text (bodies may run below y 1260,
          faces never do), with the paper push-in */}
      <AbsoluteFill style={{ transform: `scale(${zoom})`, transformOrigin: "50% 45%" }}>
        <DirectorStage beat={beat} line={line} frame={f} cardBottom={SAFE_ZONE.top + 20 + cardH} skin={SKIN} reduced={reduced} />
      </AbsoluteFill>

      <SafeFrame>
        {/* TOP: important message. The paper slide happens inside its own clip, so it never leaves the safe zone. */}
        <div style={{ position: "absolute", left: 0, right: 0, top: 0, height: 20 + cardH + 14, overflow: "hidden" }}>
          <div
            style={{
              position: "absolute",
              left: 20,
              right: 20,
              top: 20,
              height: cardH,
              boxSizing: "border-box",
              background: P.surface,
              border: `5px solid ${P.ink}`,
              boxShadow: `10px 10px 0 ${P.ink}`,
              padding: "22px 26px 26px",
              transform: `translateX(${slideX}px)`,
            }}
          >
            <div style={{ height: 48, display: "flex", alignItems: "center", justifyContent: "space-between", gap: 16, marginBottom: 12 }}>
              <BrandAware text={m.kicker} height={44}>
                <span style={{ fontFamily: MONO, fontWeight: 700, fontSize: 30, letterSpacing: 2, color: P.primary }}>{m.kicker}</span>
              </BrandAware>
              {m.stamp && stamp > 0 && (
                <span
                  style={{
                    fontFamily: HEAVY,
                    fontWeight: 900,
                    fontSize: 26,
                    background: P.primary,
                    color: "#FFFFFF",
                    border: `3px solid ${P.ink}`,
                    padding: "4px 12px",
                    transform: `rotate(-3deg) scale(${stamp})`,
                    whiteSpace: "nowrap",
                  }}
                >
                  {m.stamp}
                </span>
              )}
            </div>
            <BrandAware text={m.headline} height={size * 1.4}>
              <div style={{ position: "relative", display: "inline-block", maxWidth: "100%" }}>
                <div aria-hidden style={{ position: "absolute", top: 0, bottom: 0, left: 0, width: `${sweep}%`, background: P.accent }} />
                <div style={{ position: "relative", fontFamily: HEAVY, fontWeight: 900, fontSize: size, lineHeight: 1.02, color: P.ink, padding: "0 8px" }}>
                  {headLines.map((l, i) => (
                    <div key={i} style={{ whiteSpace: "nowrap" }}>
                      {l}
                    </div>
                  ))}
                </div>
              </div>
            </BrandAware>
          </div>
        </div>

        {/* BOTTOM: English subtitle floating over the chests (ends at y 1260), or the CTA card */}
        {cta ? (
          <div
            style={{
              position: "absolute",
              right: 0,
              bottom: 0,
              background: P.accent,
              border: `5px solid ${P.ink}`,
              boxShadow: `8px 8px 0 ${P.ink}`,
              padding: "18px 26px",
              display: "flex",
              alignItems: "center",
              gap: 18,
              transform: `scale(${0.92 + 0.08 * Math.min(1, ctaPop)})`,
              transformOrigin: "100% 100%",
            }}
          >
            <span style={{ fontFamily: HEAVY, fontWeight: 900, fontSize: 40, color: P.ink }}>TAP + DI KANAN</span>
            <svg width={60} height={40} viewBox="0 0 24 16" aria-hidden>
              <path d="M2 8 H20 M14 2 L21 8 L14 14" fill="none" stroke={P.ink} strokeWidth={3} strokeLinecap="round" strokeLinejoin="round" />
            </svg>
          </div>
        ) : null}

        {/* CTA stinger: arrow from Ocu's fingertip, sideways to TikTok's + Follow (x 920, y 780) */}
        {cta && (
          <>
            <FollowArrow from={toFrame({ x: stage.tip.x + 12, y: stage.tip.y })} color={P.accent} outline={P.ink} progress={reduced ? 1 : interpolate(f, [10, 24], [0, 1], { ...clamp, easing: Easing.out(Easing.cubic) })} />
            <FollowTarget color={P.primary} scale={reduced ? 1 : 1 + 0.15 * Math.sin((f / 30) * Math.PI * 2)} />
          </>
        )}
      </SafeFrame>

      {/* movie-style English subtitle, timed to the voice, no box (y 1120..1250) */}
      <MovieSubtitle chunks={beat.subtitleChunks} frame={f} reduced={reduced} />
    </>
  );
}
