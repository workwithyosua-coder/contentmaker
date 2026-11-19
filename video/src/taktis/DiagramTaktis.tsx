import React from "react";
import { AbsoluteFill, Easing, Sequence, interpolate, spring, useCurrentFrame, useVideoConfig } from "remotion";
import { buildBeats, type Beat } from "../beats";
import { OcuBust, UcoBust, mouthOpenAt, ocuMoodFor, ucoMoodFor } from "../cast/CastSvg";
import { FollowArrow, FollowTarget, HEAVY, MONO, SafeFrame, VoiceTrack, headlineSize } from "../cast/CueShared";
import type { CueProps } from "../koran/KoranKinetik";
import { TACTICAL_VECTOR_HUD_STYLE } from "../styles/registry";
import type { EpisodeLine } from "../types";

// "Diagram Taktis" (tactical-vector-hud), ported from the Uco & Ocu Style Lab reference (PR #28). Frame-driven only:
// panels spring-snap in (mass 0.7, damping 14, stiffness 200), indicator lines retract before each cut, voice meters
// follow the recorded loudness. On-screen text: the beat's important message on top and the line's English subtitle
// under the cast (never the Indonesian line).

const P = TACTICAL_VECTOR_HUD_STYLE.palette;
const G = TACTICAL_VECTOR_HUD_STYLE.editingGrammar;
const clamp = { extrapolateLeft: "clamp", extrapolateRight: "clamp" } as const;
/** The reference retracts at frame 98 of a 120-frame beat: 22 frames before the cut. */
const RETRACT_BEFORE_END = 120 - G.retractFrame;

export function DiagramTaktis({ lines, reducedMotion = false }: CueProps) {
  const beats = buildBeats(lines);
  return (
    <AbsoluteFill
      style={{
        backgroundColor: P.canvas,
        backgroundImage:
          "linear-gradient(rgba(56,189,248,0.07) 2px, transparent 2px), linear-gradient(90deg, rgba(56,189,248,0.07) 2px, transparent 2px)",
        backgroundSize: "54px 54px",
      }}
    >
      {beats.map((b) => (
        <Sequence key={b.id} from={b.startFrame} durationInFrames={b.durationInFrames} name={`${b.id} ${b.beatType} ${b.speaker}`}>
          <TaktisBeat beat={b} line={b.line === null ? null : lines[b.line]} reduced={reducedMotion} />
        </Sequence>
      ))}
      <VoiceTrack lines={lines} beats={beats} />
    </AbsoluteFill>
  );
}

function TaktisBeat({ beat, line, reduced }: { beat: Beat; line: EpisodeLine | null; reduced: boolean }) {
  const f = useCurrentFrame();
  const { fps } = useVideoConfig();
  const cta = beat.beatType === "cta-stinger";
  const m = beat.importantMessage;
  const snap = reduced ? 1 : spring({ frame: f, fps, config: G.springConfig });
  // Retract relative to this beat's end (voice lines vary in length): 22 frames before the cut, but never before
  // the first half of a short beat, and the retract always finishes on or before the last frame.
  const dur = beat.durationInFrames;
  const late = Math.max(Math.round(dur * 0.5), dur - RETRACT_BEFORE_END);
  const retractLen = Math.max(1, Math.min(12, dur - late - 1));
  const line01 = reduced
    ? 1
    : f >= late
      ? interpolate(f, [late, late + retractLen], [1, 0], clamp)
      : Math.min(1, spring({ frame: f - 6, fps, config: G.springConfig }));

  const ucoOn = beat.speaker === "uco" || beat.speaker === "both";
  const ocuOn = beat.speaker === "ocu" || beat.speaker === "both";
  const level = line && line.envelope.length ? (line.envelope[f] ?? 0) : !reduced && !cta ? (Math.sin(f * 0.5) + 1) / 2 : 0;
  const talking = line && line.envelope.length ? mouthOpenAt(line.envelope, f) : false;
  const visual = line?.visual ?? "";
  const size = headlineSize(m.headline) - 4;

  const subColor = beat.speaker === "uco" ? P.accent : beat.speaker === "ocu" ? P.cyan : P.primary;

  return (
    <SafeFrame>
      {/* One column inside the safe frame (x 60..940, y 250..1260): card, cast, then subtitle or CTA. The cast row
          takes whatever height is left, so a longer headline or a 3-line subtitle shrinks the cast, never overlaps. */}
      <div style={{ position: "absolute", inset: 0, paddingTop: 20, display: "flex", flexDirection: "column" }}>
        {/* TOP: important message panel (unchanged) */}
        <div
          style={{
            margin: "0 20px",
            flexShrink: 0,
            border: `5px solid ${P.primary}`,
            background: P.surface,
            padding: "20px 24px 24px",
            transform: `scale(${0.92 + 0.08 * Math.min(1, snap)})`,
            transformOrigin: "50% 0%",
          }}
        >
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 16, marginBottom: 12, fontFamily: MONO, fontWeight: 700 }}>
            <span style={{ fontSize: 30, color: P.cyan }}>[{m.kicker}]</span>
            {m.stamp && <span style={{ fontSize: 26, background: P.accent, color: "#141619", padding: "4px 12px", whiteSpace: "nowrap" }}>{m.stamp}</span>}
          </div>
          <div style={{ fontFamily: HEAVY, fontWeight: 900, fontSize: size, lineHeight: 1.02, color: P.ink, textTransform: "uppercase", overflowWrap: "anywhere" }}>
            {m.headline}
          </div>
          <div style={{ height: 6, marginTop: 16, background: P.accent, transform: `scaleX(${line01})`, transformOrigin: "0% 50%" }} />
        </div>

        {/* MIDDLE: big HUD cast panels, full safe-zone width */}
        <div style={{ flex: 1, minHeight: 0, marginTop: 22, display: "flex", gap: 12 }}>
          <HudPanel who="uco" on={ucoOn} level={ucoOn ? level : 0} f={f} reduced={reduced} snap={snap}>
            <UcoBust variant="hud" mood={line ? ucoMoodFor(line.expression, visual) : "loud"} mouthOpen={ucoOn && talking} sweatOffset={reduced ? 0 : Math.min(8, f / 6)} />
          </HudPanel>
          <HudPanel who="ocu" on={ocuOn} level={ocuOn && !cta ? level : 0} f={f} reduced={reduced} snap={snap}>
            <OcuBust variant="hud" mood={ocuMoodFor(visual)} mouthOpen={ocuOn && talking} pointRight={cta} />
          </HudPanel>
        </div>

        {/* LOWER: English subtitle (nothing when the line has none) or the CTA box */}
        {cta ? (
          <div style={{ marginTop: 14, flexShrink: 0, display: "flex", justifyContent: "flex-end" }}>
            <div
              style={{
                border: `5px solid ${P.accent}`,
                background: P.surface,
                padding: "16px 22px",
                display: "flex",
                alignItems: "center",
                gap: 16,
                fontFamily: MONO,
                fontWeight: 700,
                fontSize: 34,
                color: P.accent,
                transform: `scale(${0.92 + 0.08 * Math.min(1, snap)})`,
                transformOrigin: "100% 100%",
              }}
            >
              <span>LOCK TARGET + FOLLOW</span>
              <svg width={50} height={36} viewBox="0 0 20 14" aria-hidden>
                <path d="M1 7 H17 M12 2 L18 7 L12 12" fill="none" stroke={P.accent} strokeWidth={2.5} />
              </svg>
            </div>
          </div>
        ) : beat.subtitleEn ? (
          <div style={{ marginTop: 14, flexShrink: 0, border: `2px solid ${subColor}`, background: "#0F172A" }}>
            {/* leader line: springs in, retracts 22 frames before the beat ends (never before halfway) */}
            <div style={{ height: 4, background: subColor, transform: `scaleX(${line01})`, transformOrigin: "0% 50%" }} />
            <div
              style={{
                padding: "12px 18px 14px",
                fontFamily: HEAVY,
                fontWeight: 700,
                fontSize: 36,
                lineHeight: 1.25,
                color: "#F8FAFC",
                display: "-webkit-box",
                WebkitBoxOrient: "vertical",
                WebkitLineClamp: 3,
                overflow: "hidden",
                overflowWrap: "anywhere",
              }}
            >
              {beat.subtitleEn}
            </div>
          </div>
        ) : null}
      </div>

      {cta && (
        <>
          <FollowArrow from={OCU_HAND} color={P.accent} outline={P.canvas} progress={reduced ? 1 : interpolate(f, [6, 22], [0, 1], { ...clamp, easing: Easing.out(Easing.cubic) })} />
          <FollowTarget color={P.cyan} scale={reduced ? 1 : 1 + 0.15 * Math.sin((f / 30) * Math.PI * 2)} />
        </>
      )}
    </SafeFrame>
  );
}

/** Ocu's pointing hand in the CTA stinger (safe-frame px), where the Follow arrow starts. Checked against renders. */
const OCU_HAND = { x: 830, y: 672 };

function HudPanel({ who, on, level, f, reduced, snap, children }: { who: "uco" | "ocu"; on: boolean; level: number; f: number; reduced: boolean; snap: number; children: React.ReactNode }) {
  const color = who === "uco" ? P.accent : P.cyan;
  return (
    <div
      style={{
        flex: 1,
        minWidth: 0,
        display: "flex",
        flexDirection: "column",
        border: `5px solid ${color}`,
        background: "#161B22",
        padding: "10px 10px 12px",
        opacity: on ? 1 : 0.6,
        transform: `translateY(${(1 - Math.min(1, snap)) * 40}px)`,
      }}
    >
      <div style={{ display: "flex", justifyContent: "space-between", fontFamily: MONO, fontWeight: 700, fontSize: 26, color, marginBottom: 4, flexShrink: 0 }}>
        <span>{who.toUpperCase()}</span>
        <span>{on ? "SPEAKING" : "IDLE"}</span>
      </div>
      {/* the bust scales to the space left (SVG keeps its 180×200 aspect) */}
      <div style={{ flex: 1, minHeight: 0 }}>{children}</div>
      {/* voice meter: recorded loudness, offset per bar so it reads as a waveform */}
      <div style={{ display: "flex", alignItems: "flex-end", gap: 8, height: 40, marginTop: 6, flexShrink: 0 }}>
        {[0, 1, 2, 3, 4, 5, 6, 7].map((i) => {
          const wobble = reduced ? 0.6 : (Math.sin(f * 0.5 + i * 1.4) + 1) / 2;
          const h = on ? 6 + 34 * Math.min(1, level * (0.5 + 0.5 * wobble)) : 4;
          return <div key={i} style={{ flex: 1, height: h, background: color }} />;
        })}
      </div>
    </div>
  );
}
