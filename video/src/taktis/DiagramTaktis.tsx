import React from "react";
import { AbsoluteFill, Easing, Sequence, interpolate, spring, useCurrentFrame, useVideoConfig } from "remotion";
import { buildBeats, type Beat } from "../beats";
import { OcuBust, UcoBust, mouthOpenAt, ocuMoodFor, ucoMoodFor } from "../cast/CastSvg";
import { CARD_BOTTOM, FollowArrow, FollowTarget, HEAVY, MONO, SafeFrame, VoiceTrack, headlineSize } from "../cast/CueShared";
import type { CueProps } from "../koran/KoranKinetik";
import { TACTICAL_VECTOR_HUD_STYLE } from "../styles/registry";
import type { EpisodeLine } from "../types";

// "Diagram Taktis" (tactical-vector-hud), ported from _refs/UcoOcuStyleLabWithCast.jsx. Frame-driven only:
// panels spring-snap in (mass 0.7, damping 14, stiffness 200), indicator lines retract before each cut, voice meters
// follow the recorded loudness. On-screen text is only each beat's important message; there are no subtitles.

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
      {beats.map((b, i) => (
        <Sequence key={b.id} from={b.startFrame} durationInFrames={b.durationInFrames} name={`${b.id} ${b.beatType} ${b.speaker}`}>
          <TaktisBeat beat={b} index={i} total={beats.length} line={b.line === null ? null : lines[b.line]} reduced={reducedMotion} />
        </Sequence>
      ))}
      <VoiceTrack lines={lines} beats={beats} />
    </AbsoluteFill>
  );
}

function TaktisBeat({ beat, index, total, line, reduced }: { beat: Beat; index: number; total: number; line: EpisodeLine | null; reduced: boolean }) {
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

  return (
    <SafeFrame>
      {/* TOP: important message panel */}
      <div
        style={{
          position: "absolute",
          left: 20,
          right: 20,
          top: 20,
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

      {/* MIDDLE: HUD cast panels */}
      <HudPanel who="uco" on={ucoOn} level={ucoOn ? level : 0} f={f} reduced={reduced} snap={snap}>
        <UcoBust variant="hud" mood={line ? ucoMoodFor(line.expression, visual) : "loud"} mouthOpen={ucoOn && talking} sweatOffset={reduced ? 0 : Math.min(8, f / 6)} />
      </HudPanel>
      <HudPanel who="ocu" on={ocuOn} level={ocuOn && !cta ? level : 0} f={f} reduced={reduced} snap={snap}>
        <OcuBust variant="hud" mood={ocuMoodFor(visual)} mouthOpen={ocuOn && talking} pointRight={cta} />
      </HudPanel>

      {/* LOWER: progress diagram / CTA */}
      {cta ? (
        <div
          style={{
            position: "absolute",
            right: 20,
            bottom: 20,
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
      ) : (
        <ProgressDiagram index={index} total={total} label={beat.beatType} retract={line01} />
      )}

      {cta && (
        <>
          <FollowArrow from={{ x: 785, y: 650 }} color={P.accent} outline={P.canvas} progress={reduced ? 1 : interpolate(f, [6, 22], [0, 1], { ...clamp, easing: Easing.out(Easing.cubic) })} />
          <FollowTarget color={P.cyan} scale={reduced ? 1 : 1 + 0.15 * Math.sin((f / 30) * Math.PI * 2)} />
        </>
      )}
    </SafeFrame>
  );
}

function HudPanel({ who, on, level, f, reduced, snap, children }: { who: "uco" | "ocu"; on: boolean; level: number; f: number; reduced: boolean; snap: number; children: React.ReactNode }) {
  const color = who === "uco" ? P.accent : P.cyan;
  return (
    <div
      style={{
        position: "absolute",
        top: CARD_BOTTOM + 20,
        [who === "uco" ? "left" : "right"]: 20,
        width: 410,
        border: `5px solid ${color}`,
        background: "#161B22",
        padding: 14,
        opacity: on ? 1 : 0.6,
        transform: `translateY(${(1 - Math.min(1, snap)) * 40}px)`,
      }}
    >
      <div style={{ display: "flex", justifyContent: "space-between", fontFamily: MONO, fontWeight: 700, fontSize: 24, color, marginBottom: 8 }}>
        <span>{who.toUpperCase()}</span>
        <span>{on ? "SPEAKING" : "IDLE"}</span>
      </div>
      <div style={{ height: 280, display: "flex", justifyContent: "center" }}>
        <div style={{ width: 252, height: 280 }}>{children}</div>
      </div>
      {/* voice meter: recorded loudness, offset per bar so it reads as a waveform */}
      <div style={{ display: "flex", alignItems: "flex-end", gap: 6, height: 36, marginTop: 10 }}>
        {[0, 1, 2, 3, 4, 5].map((i) => {
          const wobble = reduced ? 0.6 : (Math.sin(f * 0.5 + i * 1.4) + 1) / 2;
          const h = on ? 6 + 30 * Math.min(1, level * (0.5 + 0.5 * wobble)) : 4;
          return <div key={i} style={{ flex: 1, height: h, background: color }} />;
        })}
      </div>
    </div>
  );
}

/** Segmented episode progress (the reference's "paycheck drain" blocks, made generic for any script). */
function ProgressDiagram({ index, total, label, retract }: { index: number; total: number; label: string; retract: number }) {
  const n = Math.max(1, total - 1);
  return (
    <div style={{ position: "absolute", left: 20, right: 20, bottom: 20 }}>
      <div style={{ border: `4px solid ${P.cyan}`, background: P.surface, padding: "12px 16px" }}>
        <div style={{ display: "flex", justifyContent: "space-between", fontFamily: MONO, fontWeight: 700, fontSize: 24, color: P.cyan, marginBottom: 10 }}>
          <span>{`${label.toUpperCase()} // BEAT`}</span>
          <span style={{ color: P.accent }}>
            {String(index + 1).padStart(2, "0")}/{String(n).padStart(2, "0")}
          </span>
        </div>
        <div style={{ display: "flex", gap: 4, height: 28 }}>
          {Array.from({ length: n }, (_, i) => (
            <div key={i} style={{ flex: 1, background: i < index ? P.danger : i === index ? P.accent : P.cyan, opacity: i <= index ? 0.95 : 0.25 }} />
          ))}
        </div>
      </div>
      <div style={{ height: 5, marginTop: 8, background: P.accent, transform: `scaleX(${retract})`, transformOrigin: "0% 50%" }} />
    </div>
  );
}
