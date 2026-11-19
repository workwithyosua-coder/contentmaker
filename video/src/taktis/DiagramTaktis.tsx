import React from "react";
import { AbsoluteFill, Sequence, interpolate, spring, useCurrentFrame, useVideoConfig } from "remotion";
import { SAFE_ZONE, buildBeats, type Beat } from "../beats";
import { BrandAware } from "../brand/UcoOcuWordmark";
import { HEAVY, MONO, SafeFrame, VoiceTrack, headlineSize, wrapHeadline } from "../cast/CueShared";
import { GrainVignette, SfxCues } from "../shared/Compositing";
import { DirectorStage, type DirectorSkin, type HeadOnScreen } from "../shared/Director";
import { MovieSubtitle } from "../shared/MovieSubtitle";
import { sfxCuesFor } from "../shared/sfxCues";
import type { CueProps } from "../koran/KoranKinetik";
import { TACTICAL_VECTOR_HUD_STYLE } from "../styles/registry";
import type { EpisodeLine } from "../types";

// "Diagram Taktis" (tactical-vector-hud), ported from the Uco & Ocu Style Lab reference (PR #28). Frame-driven only:
// the cast rises in on a spring (mass 0.7, damping 14, stiffness 200) inside HUD target frames, indicator lines retract
// before each cut, voice meters follow the recorded loudness. On-screen text: the beat's important message on top and the line's English subtitle
// under the cast (never the Indonesian line).

const P = TACTICAL_VECTOR_HUD_STYLE.palette;
const G = TACTICAL_VECTOR_HUD_STYLE.editingGrammar;
const clamp = { extrapolateLeft: "clamp", extrapolateRight: "clamp" } as const;
/** The reference retracts at frame 98 of a 120-frame beat: 22 frames before the cut. */
const RETRACT_BEFORE_END = 120 - G.retractFrame;

const SKIN: DirectorSkin = {
  variant: "hud",
  prop: "hud",
  wash: { uco: "rgba(245,158,11,0.42)", ocu: "rgba(56,189,248,0.36)", kind: "glow" },
  fxColor: P.accent,
  rim: { uco: "rgba(245,158,11,0.75)", ocu: "rgba(56,189,248,0.75)" },
  dimListener: 0.45,
  arrow: { color: P.accent, outline: P.canvas, ring: P.cyan },
  // two-shots keep the HUD target brackets and chest voice meters
  figureExtras: ({ who, head, on, level, frame }) => (
    <>
      <HudTarget head={head} color={who === "uco" ? P.accent : P.cyan} on={on} />
      <VoiceMeter head={head} color={who === "uco" ? P.accent : P.cyan} on={on} level={level} f={frame} reduced={false} />
    </>
  ),
};

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
      <GrainVignette reduced={reducedMotion} tone="dark" />
      <SfxCues cues={sfxCuesFor(beats)} />
    </AbsoluteFill>
  );
}

/** Card chrome around the headline lines: 5px borders, 20/24 padding, 48px kicker row + 12, leader line 16 + 6. */
const CARD_CHROME = 10 + 20 + 24 + 48 + 12 + 16 + 6;
/** Headline text width inside the card (840 card − borders − padding). */
const HEADLINE_W = 840 - 10 - 48;

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

  const size = headlineSize(m.headline) - 4;
  const headLines = wrapHeadline(m.headline, size, HEADLINE_W);
  const cardH = CARD_CHROME + Math.ceil(headLines.length * size * 1.02);
  const rise = (1 - Math.min(1, snap)) * 40;

  return (
    <>
      {/* CAST + PROPS: the director's camera shot for this beat, rising in on the HUD spring. Bodies may run below
          y 1260; faces never do. */}
      <AbsoluteFill style={{ transform: `translateY(${rise}px)` }}>
        <DirectorStage beat={beat} line={line} frame={f} cardBottom={SAFE_ZONE.top + 20 + cardH} skin={SKIN} reduced={reduced} />
      </AbsoluteFill>

      <SafeFrame>
        {/* TOP: important message panel (unchanged look) */}
        <div
          style={{
            position: "absolute",
            left: 20,
            right: 20,
            top: 20,
            height: cardH,
            boxSizing: "border-box",
            border: `5px solid ${P.primary}`,
            background: P.surface,
            padding: "20px 24px 24px",
            transform: `scale(${0.92 + 0.08 * Math.min(1, snap)})`,
            transformOrigin: "50% 0%",
          }}
        >
          <div style={{ height: 48, display: "flex", alignItems: "center", justifyContent: "space-between", gap: 16, marginBottom: 12, fontFamily: MONO, fontWeight: 700 }}>
            <BrandAware text={m.kicker} height={44}>
              <span style={{ fontSize: 30, color: P.cyan }}>[{m.kicker}]</span>
            </BrandAware>
            {m.stamp && <span style={{ fontSize: 26, background: P.accent, color: "#141619", padding: "4px 12px", whiteSpace: "nowrap" }}>{m.stamp}</span>}
          </div>
          <BrandAware text={m.headline} height={size * 1.4}>
            <div style={{ fontFamily: HEAVY, fontWeight: 900, fontSize: size, lineHeight: 1.02, color: P.ink }}>
              {headLines.map((l, i) => (
                <div key={i} style={{ whiteSpace: "nowrap" }}>
                  {l}
                </div>
              ))}
            </div>
          </BrandAware>
          <div style={{ height: 6, marginTop: 16, background: P.accent, transform: `scaleX(${line01})`, transformOrigin: "0% 50%" }} />
        </div>

        {/* BOTTOM: English subtitle floating over the chests (ends at y 1260), or the CTA box */}
        {cta ? (
          <div
            style={{
              position: "absolute",
              right: 0,
              bottom: 0,
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
        ) : null}
      </SafeFrame>

      {/* movie-style English subtitle, timed to the voice, no box (y 1120..1250) */}
      <MovieSubtitle chunks={beat.subtitleChunks} frame={f} reduced={reduced} />
    </>
  );
}

/** HUD target frame around one figure's head and shoulders: corner brackets in the character's colour. */
function HudTarget({ head, color, on }: { head: HeadOnScreen; color: string; on: boolean }) {
  const half = head.height * 0.62;
  const y0 = head.top - 14;
  const y1 = head.chin + head.height * 0.3;
  const arm = 46;
  const corner = (x: number, y: number, dx: number, dy: number) => `M${x + dx * arm} ${y} L${x} ${y} L${x} ${y + dy * arm}`;
  return (
    <svg width={1080} height={1920} style={{ position: "absolute", left: 0, top: 0, opacity: on ? 1 : 0.35 }} aria-hidden>
      <g fill="none" stroke={color} strokeWidth={6} strokeLinecap="square">
        <path d={corner(head.cx - half, y0, 1, 1)} />
        <path d={corner(head.cx + half, y0, -1, 1)} />
        <path d={corner(head.cx - half, y1, 1, -1)} />
        <path d={corner(head.cx + half, y1, -1, -1)} />
      </g>
    </svg>
  );
}

/** Frame-driven voice meter on a dark plate just under the bracket, in front of the figure. */
function VoiceMeter({ head, color, on, level, f, reduced }: { head: HeadOnScreen; color: string; on: boolean; level: number; f: number; reduced: boolean }) {
  const w = head.height * 0.7;
  const h = 56;
  const y = head.chin + head.height * 0.36;
  return (
    <svg width={1080} height={1920} style={{ position: "absolute", left: 0, top: 0, opacity: on ? 1 : 0.45 }} aria-hidden>
      <rect x={head.cx - w / 2} y={y} width={w} height={h} fill="#0F172A" stroke={color} strokeWidth={3} />
      {Array.from({ length: 10 }, (_, i) => {
        const wobble = reduced ? 0.6 : (Math.sin(f * 0.5 + i * 1.4) + 1) / 2;
        const bh = on ? 6 + 38 * Math.min(1, level * (0.5 + 0.5 * wobble)) : 4;
        const bw = (w - 16) / 10;
        return <rect key={i} x={head.cx - w / 2 + 8 + i * bw + 2} y={y + h - 7 - bh} width={bw - 4} height={bh} fill={color} />;
      })}
    </svg>
  );
}
