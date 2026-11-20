import React from "react";
import { AbsoluteFill, Sequence, spring, useCurrentFrame, useVideoConfig } from "remotion";
import { registerLineAssets, registerRemoteAssets } from "../assets";
import { buildBeats, type Beat } from "../beats";
import { VoiceTrack } from "../cast/CueShared";
import { BackgroundMusic, GrainVignette, SfxCues } from "../shared/Compositing";
import { DirectorStage, type DirectorSkin, type HeadOnScreen } from "../shared/Director";
import { MovieSubtitle } from "../shared/MovieSubtitle";
import { cameraAt, cutDirection } from "../shared/motion";
import { sfxCuesFor } from "../shared/sfxCues";
import type { CueProps } from "../koran/KoranKinetik";
import { TACTICAL_VECTOR_HUD_STYLE } from "../styles/registry";
import type { EpisodeLine } from "../types";

// "Diagram Taktis" (tactical-vector-hud), ported from the Uco & Ocu Style Lab reference (PR #28). Frame-driven only:
// the cast rises in on a spring (mass 0.7, damping 14, stiffness 200) inside HUD target frames, voice meters follow
// the recorded loudness. On-screen text: typed amber readouts on emphasis beats only, and the line's English subtitle
// (never the Indonesian line).

const P = TACTICAL_VECTOR_HUD_STYLE.palette;
const G = TACTICAL_VECTOR_HUD_STYLE.editingGrammar;

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

export function DiagramTaktis({ lines, direction, assetUrls, reducedMotion = false }: CueProps) {
  // uploaded props / SFX load from their public HTTPS URLs (saved on the beats, and passed by the renderer)
  registerRemoteAssets(assetUrls);
  registerLineAssets(lines);
  const beats = buildBeats(lines, direction);
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
          <TaktisBeat beat={b} line={b.line === null ? null : lines[b.line]} reduced={reducedMotion} cutDir={cutDirection(beats, i)} />
        </Sequence>
      ))}
      <VoiceTrack lines={lines} beats={beats} />
      <GrainVignette reduced={reducedMotion} tone="dark" />
      <SfxCues cues={sfxCuesFor(beats)} />
      {direction?.bgm && <BackgroundMusic volume={direction.bgmVolume} thoughtDuck={direction.thoughtDuck} beats={beats} lines={lines} />}
    </AbsoluteFill>
  );
}

function TaktisBeat({ beat, line, reduced, cutDir }: { beat: Beat; line: EpisodeLine | null; reduced: boolean; cutDir: -1 | 0 | 1 }) {
  const f = useCurrentFrame();
  const { fps } = useVideoConfig();
  const snap = reduced ? 1 : spring({ frame: f, fps, config: G.springConfig });
  const rise = (1 - Math.min(1, snap)) * 40;
  // camera: a gentle push only where the shared rules ask for one (explanations, shocks, long holds)
  const cam = reduced ? { scale: 1, rotate: 0 } : cameraAt(beat, f, [1, 1]);

  return (
    <>
      {/* CAST + VISUAL STAGE: the director's camera shot for this beat, rising in on the HUD spring (no headline
          panel; kinetic readouts and props float on the open stage). Bodies may run below y 1260; faces never do. */}
      <AbsoluteFill style={{ transform: `translateY(${rise}px) scale(${cam.scale}) rotate(${cam.rotate}deg)`, transformOrigin: "50% 40%" }}>
        <DirectorStage beat={beat} line={line} frame={f} skin={SKIN} reduced={reduced} cutDir={cutDir} />
      </AbsoluteFill>

      {/* the CTA end card's FOLLOW + button and arrow are drawn by the Director (upper-right safe zone); no banner
          over the chests, where TikTok's caption overlay sits */}

      {/* kinetic English subtitle: 3–5 word chunks, the spoken word highlighted, low in the frame (y 1420..1520, under every face); italic for inner thoughts */}
      <MovieSubtitle chunks={beat.subtitleChunks} frame={f} reduced={reduced} italic={beat.thought} />
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
