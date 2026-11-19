import React from "react";
import { Img, spring, staticFile, useVideoConfig } from "remotion";
import { castSprites } from "../assets";
import type { Emotion } from "../beats";
import { OcuBust, UcoBust, type CastVariant, type OcuMood, type UcoMood } from "./CastSvg";

// Layered puppet: illustrated PNG sprites (public/cast/{uco|ocu}/{emotion}-{closed|open}.png, see cast/README.md),
// swapped closed/open from the voice loudness, with spring squash-and-stretch on entry, a talking bounce, idle
// breathing and comic FX. When the sprites for an emotion aren't uploaded yet, the coded CastSvg figure stands in,
// with the same motion and FX, so previews and renders always work.
// Fills its parent box (the 180×340 figure frame from CastFigure).

export type PuppetProps = {
  who: "uco" | "ocu";
  variant: CastVariant;
  emotion: Emotion;
  /** mouth open this frame (from the voice loudness) */
  mouthOpen: boolean;
  /** voice loudness 0..1 this frame */
  level: number;
  /** frame inside the current shot (drives the entry spring) */
  frame: number;
  /** frame in the whole episode (drives blinking and breathing, continuous across cuts) */
  globalFrame: number;
  look?: number;
  reduced: boolean;
  /** rim light colour (a soft outer glow), or null */
  rim?: string | null;
  /** colour of the speed lines behind high-energy Uco beats */
  fxColor: string;
  /** which FX layers this figure may show: all (single-character shots), sweat only (the speaker in a two-shot), none */
  fx?: "all" | "sweat" | "none";
};

const UCO_MOOD: Partial<Record<Emotion, UcoMood>> = { phone: "phone", shocked: "sweat", defensive: "squint" };
const OCU_MOOD: Partial<Record<Emotion, OcuMood>> = { inspecting: "magnifier" };

export function CastPuppet(p: PuppetProps) {
  const { fps } = useVideoConfig();
  const sprites = castSprites(p.who, p.emotion);
  const r = p.reduced;
  // entry: squash then stretch (a spring that overshoots), volume roughly kept (scaleX ≈ 1/√scaleY)
  const pop = r ? 1 : spring({ frame: p.frame, fps, config: { mass: 0.6, damping: 9, stiffness: 190 } });
  const breathe = r ? 0 : Math.sin(p.globalFrame / 22) * 0.008;
  const sy = 0.9 + 0.1 * pop + breathe;
  const sx = 1 / Math.sqrt(sy);
  const bounce = r ? 0 : -p.level * 1.4; // % of the figure height, while talking
  const fx = p.fx ?? "all";
  const energetic = fx === "all" && p.who === "uco" && (p.emotion === "triumphant" || p.emotion === "shocked");
  const sweaty = fx !== "none" && (p.emotion === "shocked" || p.emotion === "defensive");

  return (
    <div style={{ position: "absolute", inset: 0 }}>
      {energetic && <SpeedLines color={p.fxColor} frame={p.globalFrame} reduced={r} />}
      <div
        style={{
          position: "absolute",
          inset: 0,
          transform: `translateY(${bounce}%) scale(${sx}, ${sy})`,
          transformOrigin: "50% 100%",
          filter: p.rim ? `drop-shadow(0 0 10px ${p.rim}) drop-shadow(0 0 2px ${p.rim})` : undefined,
        }}
      >
        {sprites ? (
          <SpriteImg src={staticFile(p.mouthOpen ? sprites.open : sprites.closed)} />
        ) : p.who === "uco" ? (
          <UcoBust
            variant={p.variant}
            mood={UCO_MOOD[p.emotion] ?? "loud"}
            mouthOpen={p.mouthOpen}
            sweatOffset={r ? 0 : Math.min(8, p.frame / 6)}
            motion={{ frame: p.globalFrame, look: p.look, talk: p.level, reduced: r }}
          />
        ) : (
          <OcuBust
            variant={p.variant}
            mood={OCU_MOOD[p.emotion] ?? "deadpan"}
            mouthOpen={p.mouthOpen}
            pointRight={p.emotion === "cta"}
            motion={{ frame: p.globalFrame, look: p.look, talk: p.level, reduced: r }}
          />
        )}
      </div>
      {/* the SVG Uco already sweats in his "sweat" mood; everyone else gets falling drops as an FX layer */}
      {sweaty && (sprites || p.who === "ocu") && <SweatDrops frame={p.frame} reduced={r} />}
    </div>
  );
}

/** The 900×1700 sprite fills its figure frame exactly (same aspect, uniform scale, never stretched). */
function SpriteImg({ src }: { src: string }) {
  return <Img src={src} style={{ position: "absolute", inset: 0, width: "100%", height: "100%" }} />;
}

/** Comic speed lines radiating from behind the head, rotating slowly (frame-driven). viewBox matches the figure. */
function SpeedLines({ color, frame, reduced }: { color: string; frame: number; reduced: boolean }) {
  const spin = reduced ? 0 : (frame * 0.6) % 360;
  return (
    <svg viewBox="0 0 180 340" width="100%" height="100%" style={{ position: "absolute", inset: 0, overflow: "visible" }} aria-hidden>
      <g transform={`rotate(${spin} 90 60)`} stroke={color} strokeLinecap="round" opacity={0.85}>
        {Array.from({ length: 18 }, (_, i) => {
          const a = (i / 18) * Math.PI * 2;
          const r0 = 70 + (i % 3) * 8;
          const r1 = r0 + 34 + (i % 2) * 18;
          return <line key={i} x1={90 + Math.cos(a) * r0} y1={60 + Math.sin(a) * r0} x2={90 + Math.cos(a) * r1} y2={60 + Math.sin(a) * r1} strokeWidth={i % 2 ? 3 : 5} />;
        })}
      </g>
    </svg>
  );
}

/** Two sweat drops sliding down beside the head, looping every 36 frames. */
function SweatDrops({ frame, reduced }: { frame: number; reduced: boolean }) {
  const drops = [
    { x: 136, y0: 40, phase: 0 },
    { x: 46, y0: 50, phase: 18 },
  ];
  return (
    <svg viewBox="0 0 180 340" width="100%" height="100%" style={{ position: "absolute", inset: 0, overflow: "visible" }} aria-hidden>
      {drops.map((d, i) => {
        const t = reduced ? 0.3 : ((frame + d.phase) % 36) / 36;
        const y = d.y0 + t * 30;
        return (
          <path
            key={i}
            d={`M${d.x} ${y} C${d.x + 5} ${y + 10} ${d.x + 5} ${y + 17} ${d.x} ${y + 17} C${d.x - 5} ${y + 17} ${d.x - 5} ${y + 10} ${d.x} ${y} Z`}
            fill="#38BDF8"
            stroke="#141619"
            strokeWidth={2.5}
            opacity={1 - t * 0.6}
          />
        );
      })}
    </svg>
  );
}
