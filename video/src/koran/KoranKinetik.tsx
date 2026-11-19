import React from "react";
import { AbsoluteFill, Easing, Sequence, interpolate, spring, useCurrentFrame, useVideoConfig } from "remotion";
import { buildBeats, type Beat } from "../beats";
import { OcuBust, UcoBust, mouthOpenAt, ocuMoodFor, ucoMoodFor } from "../cast/CastSvg";
import { CARD_BOTTOM, FollowArrow, FollowTarget, HEAVY, MONO, SafeFrame, VoiceTrack, headlineSize } from "../cast/CueShared";
import { EDITORIAL_PAPER_CUTOUT_STYLE } from "../styles/registry";
import type { EpisodeLine, EpisodeProps } from "../types";

// "Koran Kinetik" (editorial-paper-cutout), ported from _refs/UcoOcuStyleLabWithCast.jsx. Frame-driven only:
// paper-slide entrance (6 frames), slow 1.00→1.04 push-in, highlighter sweep, red stamp slam, cut-out cast.
// On-screen text is only each beat's important message; there are no subtitles.

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
      {beats.map((b, i) => (
        <Sequence key={b.id} from={b.startFrame} durationInFrames={b.durationInFrames} name={`${b.id} ${b.beatType} ${b.speaker}`}>
          <KoranBeat beat={b} index={i} total={beats.length} line={b.line === null ? null : lines[b.line]} reduced={reducedMotion} />
        </Sequence>
      ))}
      <VoiceTrack lines={lines} beats={beats} />
    </AbsoluteFill>
  );
}

function KoranBeat({ beat, index, total, line, reduced }: { beat: Beat; index: number; total: number; line: EpisodeLine | null; reduced: boolean }) {
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
      {/* content sits 20px inside the safe frame, so the 1.04 push-in from its centre never leaves it */}
      <div
        style={{
          position: "absolute",
          inset: 0,
          transform: `translateX(${slideX}px) scale(${zoom})`,
          transformOrigin: "50% 50%",
        }}
      >
        {/* TOP: important message only */}
        <div
          style={{
            position: "absolute",
            left: 20,
            right: 20,
            top: 20,
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

        {/* MIDDLE: cut-out cast */}
        <CastSlot left who="uco" on={ucoOn} reduced={reduced}>
          <UcoBust variant="paper" mood={line ? ucoMoodFor(line.expression, visual) : "loud"} mouthOpen={ucoOn && Boolean(talking)} sweatOffset={reduced ? 0 : Math.min(8, f / 6)} />
        </CastSlot>
        <CastSlot who="ocu" on={ocuOn} reduced={reduced}>
          <OcuBust variant="paper" mood={ocuMoodFor(visual)} mouthOpen={ocuOn && Boolean(talking) && !cta} pointRight={cta} />
        </CastSlot>

        {/* LOWER: paper prop */}
        {cta ? (
          <div
            style={{
              position: "absolute",
              right: 20,
              bottom: 20,
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
        ) : (
          <BeatStrip index={index} total={total} label={beat.beatType} />
        )}
      </div>

      {/* CTA stinger: Ocu points at TikTok's + Follow (x 920, y 780) */}
      {cta && (
        <>
          <FollowArrow from={{ x: 835, y: 655 }} color={P.accent} outline={P.ink} progress={reduced ? 1 : interpolate(f, [8, 26], [0, 1], { ...clamp, easing: Easing.out(Easing.cubic) })} />
          <FollowTarget color={P.primary} scale={reduced ? 1 : 1 + 0.15 * Math.sin((f / 30) * Math.PI * 2)} />
        </>
      )}
    </SafeFrame>
  );
}

const SLOT = { top: CARD_BOTTOM + 20, width: 342, height: 380 };

function CastSlot({ who, on, left = false, reduced, children }: { who: "uco" | "ocu"; on: boolean; left?: boolean; reduced: boolean; children: React.ReactNode }) {
  const scale = on ? 1.07 : 0.94;
  const rot = on ? (who === "uco" ? -2 : 1.5) : 0;
  return (
    <div
      style={{
        position: "absolute",
        top: SLOT.top,
        [left ? "left" : "right"]: 40,
        width: SLOT.width,
        height: SLOT.height + 60,
        opacity: on ? 1 : 0.6,
        transform: reduced ? undefined : `scale(${scale}) rotate(${rot}deg)`,
        transformOrigin: "50% 100%",
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
      }}
    >
      <div style={{ width: SLOT.width, height: SLOT.height }}>{children}</div>
      <span
        style={{
          marginTop: 8,
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

/** Newspaper strip: one box per beat, filled red up to this one (the reference's "slip gajian" grid, made generic). */
function BeatStrip({ index, total, label }: { index: number; total: number; label: string }) {
  const n = Math.max(1, total - 1); // the CTA stinger isn't counted
  const cols = Math.min(n, 12);
  return (
    <div
      style={{
        position: "absolute",
        left: 20,
        right: 20,
        bottom: 20,
        background: P.surface,
        border: `5px solid ${P.ink}`,
        boxShadow: `8px 8px 0 ${P.ink}`,
        padding: "14px 18px",
      }}
    >
      <div style={{ display: "flex", justifyContent: "space-between", fontFamily: MONO, fontWeight: 700, fontSize: 24, color: P.ink, marginBottom: 10 }}>
        <span>{label.toUpperCase()}</span>
        <span style={{ color: P.primary }}>
          {index + 1}/{n}
        </span>
      </div>
      <div style={{ display: "grid", gridTemplateColumns: `repeat(${cols}, 1fr)`, gap: 6 }}>
        {Array.from({ length: n }, (_, i) => (
          <div
            key={i}
            style={{
              height: 26,
              border: `2px solid ${P.ink}`,
              background: i <= index ? P.primary : P.canvas,
            }}
          />
        ))}
      </div>
    </div>
  );
}

