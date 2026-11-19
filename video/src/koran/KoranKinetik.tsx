import React from "react";
import { AbsoluteFill, Easing, Sequence, interpolate, spring, useCurrentFrame, useVideoConfig } from "remotion";
import { buildBeats, type Beat } from "../beats";
import { OcuBust, UcoBust, mouthOpenAt, ocuMoodFor, ucoMoodFor } from "../cast/CastSvg";
import { FollowArrow, FollowTarget, HEAVY, MONO, SafeFrame, VoiceTrack, headlineSize } from "../cast/CueShared";
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
    </AbsoluteFill>
  );
}

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

  const ucoOn = beat.speaker === "uco" || beat.speaker === "both";
  const ocuOn = beat.speaker === "ocu" || beat.speaker === "both";
  const talking = line && line.envelope.length ? mouthOpenAt(line.envelope, f) : !reduced && !cta && Math.floor(f / 4) % 2 === 0;
  const visual = line?.visual ?? "";
  const size = headlineSize(m.headline);

  return (
    <SafeFrame>
      {/* One column, 20px inside the safe frame (so the 1.04 push-in from its centre never leaves it): headline card,
          cast, then the English subtitle or the CTA. The cast takes whatever height is left, so a longer headline or
          a 3-line subtitle shrinks the cast instead of overlapping it. */}
      <div
        style={{
          position: "absolute",
          inset: 0,
          padding: 20,
          display: "flex",
          flexDirection: "column",
          transform: `translateX(${slideX}px) scale(${zoom})`,
          transformOrigin: "50% 50%",
        }}
      >
        {/* TOP: important message only */}
        <div
          style={{
            flexShrink: 0,
            background: P.surface,
            border: `5px solid ${P.ink}`,
            boxShadow: `10px 10px 0 ${P.ink}`,
            padding: "22px 26px 26px",
          }}
        >
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 16, marginBottom: 12 }}>
            <span style={{ fontFamily: MONO, fontWeight: 700, fontSize: 30, letterSpacing: 2, color: P.primary }}>{m.kicker}</span>
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
          <div style={{ position: "relative", display: "inline-block", maxWidth: "100%" }}>
            <div aria-hidden style={{ position: "absolute", top: 0, bottom: 0, left: 0, width: `${sweep}%`, background: P.accent }} />
            <div
              style={{
                position: "relative",
                fontFamily: HEAVY,
                fontWeight: 900,
                fontSize: size,
                lineHeight: 1.02,
                color: P.ink,
                textTransform: "uppercase",
                padding: "0 8px",
                overflowWrap: "anywhere",
              }}
            >
              {m.headline}
            </div>
          </div>
        </div>

        {/* MIDDLE: big cut-out cast, side by side across the safe-zone width */}
        <div style={{ flex: 1, minHeight: 0, marginTop: 30, marginBottom: 2, display: "flex", gap: 16 }}>
          <CastSlot who="uco" on={ucoOn} reduced={reduced}>
            <UcoBust variant="paper" mood={line ? ucoMoodFor(line.expression, visual) : "loud"} mouthOpen={ucoOn && Boolean(talking)} sweatOffset={reduced ? 0 : Math.min(8, f / 6)} />
          </CastSlot>
          <CastSlot who="ocu" on={ocuOn} reduced={reduced}>
            <OcuBust variant="paper" mood={ocuMoodFor(visual)} mouthOpen={ocuOn && Boolean(talking) && !cta} pointRight={cta} />
          </CastSlot>
        </div>

        {/* LOWER: English subtitle (nothing when the line has none) or the CTA card */}
        {cta ? (
          <div style={{ marginTop: 14, flexShrink: 0, display: "flex", justifyContent: "flex-end" }}>
            <div
              style={{
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
          </div>
        ) : beat.subtitleEn ? (
          <div
            style={{
              marginTop: 14,
              flexShrink: 0,
              background: P.ink,
              border: `2px solid ${P.ink}`,
              padding: "14px 20px 16px",
              fontFamily: HEAVY,
              fontWeight: 800,
              fontSize: 36,
              lineHeight: 1.25,
              color: P.canvas,
              display: "-webkit-box",
              WebkitBoxOrient: "vertical",
              WebkitLineClamp: 3,
              overflow: "hidden",
              overflowWrap: "anywhere",
            }}
          >
            {beat.subtitleEn}
          </div>
        ) : null}
      </div>

      {/* CTA stinger: Ocu points at TikTok's + Follow (x 920, y 780) */}
      {cta && (
        <>
          <FollowArrow from={OCU_HAND} color={P.accent} outline={P.ink} progress={reduced ? 1 : interpolate(f, [8, 26], [0, 1], { ...clamp, easing: Easing.out(Easing.cubic) })} />
          <FollowTarget color={P.primary} scale={reduced ? 1 : 1 + 0.15 * Math.sin((f / 30) * Math.PI * 2)} />
        </>
      )}
    </SafeFrame>
  );
}

/** Ocu's pointing hand in the CTA stinger (safe-frame px), where the Follow arrow starts. Checked against renders. */
const OCU_HAND = { x: 845, y: 716 };

/**
 * One cut-out character, sized by the height it gets: the figure only uses the middle two-thirds of its 180×200
 * drawing, so the drawing may run wider than the slot without the two characters touching. The name tag sits on the
 * bottom of the bust like a sticker, so it costs no height.
 */
function CastSlot({ who, on, reduced, children }: { who: "uco" | "ocu"; on: boolean; reduced: boolean; children: React.ReactNode }) {
  const scale = on ? 1.04 : 0.94;
  const rot = on ? (who === "uco" ? -2 : 1.5) : 0;
  return (
    <div
      style={{
        flex: 1,
        minWidth: 0,
        position: "relative",
        display: "flex",
        justifyContent: "center",
        opacity: on ? 1 : 0.6,
        // grows from its centre, so the 4% active emphasis stays clear of the card above and the subtitle below
        transform: reduced ? undefined : `scale(${scale}) rotate(${rot}deg)`,
        transformOrigin: "50% 50%",
      }}
    >
      <div style={{ height: "100%", aspectRatio: "180 / 200", flexShrink: 0 }}>{children}</div>
      <span
        style={{
          position: "absolute",
          bottom: 6,
          left: "50%",
          transform: "translateX(-50%)",
          whiteSpace: "nowrap",
          fontFamily: MONO,
          fontWeight: 700,
          fontSize: 26,
          padding: "4px 12px",
          background: who === "uco" ? P.ink : P.ocuBg,
          color: who === "uco" ? P.accent : "#FFFFFF",
          border: `3px solid ${P.ink}`,
        }}
      >
        {who.toUpperCase()}
        {on ? " ON MIC" : ""}
      </span>
    </div>
  );
}
