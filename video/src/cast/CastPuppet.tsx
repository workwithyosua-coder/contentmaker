import React from "react";
import { Img, spring, staticFile, useVideoConfig } from "remotion";
import { castSprites } from "../assets";
import { headBoxFor, sweatPoint } from "./spriteCalibration";
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
  /** which FX this figure may show: sweat (the speaker), none. Speed lines live on the Director's background layer. */
  fx?: "sweat" | "none";
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
  const sweaty = (p.fx ?? "sweat") === "sweat" && (p.emotion === "shocked" || p.emotion === "defensive");
  // the coded Uco already sweats in his "sweat" mood
  const drop = !sweaty ? null : sprites ? { view: "0 0 900 1700", ...sweatPoint(headBoxFor(p.who, sprites.emotion)), size: 96 } : p.who === "ocu" ? { view: "0 0 180 340", x: 44, y: 62, size: 22 } : null;

  return (
    <div style={{ position: "absolute", inset: 0 }}>
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
        {/* inside the squash/stretch layer, so the drop stays glued to the temple */}
        {drop && <SweatDrop {...drop} frame={p.frame} reduced={r} />}
      </div>
    </div>
  );
}

/** The 900×1700 sprite fills its figure frame exactly (same aspect, uniform scale, never stretched). */
function SpriteImg({ src }: { src: string }) {
  return <Img src={src} style={{ position: "absolute", inset: 0, width: "100%", height: "100%" }} />;
}

/** Comic speed lines radiating from behind a head, rotating slowly (frame-driven). Canvas coordinates; the Director
 *  draws them on the background layer, behind the cast and every prop or card. */
export function SpeedLines({ cx, cy, r, color, frame, reduced }: { cx: number; cy: number; r: number; color: string; frame: number; reduced: boolean }) {
  const spin = reduced ? 0 : (frame * 0.6) % 360;
  return (
    <svg width={1080} height={1920} style={{ position: "absolute", left: 0, top: 0 }} aria-hidden>
      <g transform={`rotate(${spin} ${cx} ${cy})`} stroke={color} strokeLinecap="round" opacity={0.85}>
        {Array.from({ length: 22 }, (_, i) => {
          const a = (i / 22) * Math.PI * 2;
          const r0 = r * (1 + (i % 3) * 0.1);
          const r1 = r0 + r * (0.42 + (i % 2) * 0.22);
          return <line key={i} x1={cx + Math.cos(a) * r0} y1={cy + Math.sin(a) * r0} x2={cx + Math.cos(a) * r1} y2={cy + Math.sin(a) * r1} strokeWidth={i % 2 ? 7 : 12} />;
        })}
      </g>
    </svg>
  );
}

/** One comic sweat drop beside the temple: wells up, slides a little down the cheek line, repeats every 48 frames. */
function SweatDrop({ view, x, y, size, frame, reduced }: { view: string; x: number; y: number; size: number; frame: number; reduced: boolean }) {
  const t = reduced ? 0.35 : (frame % 48) / 48;
  const dy = t * size * 0.35;
  const o = reduced ? 1 : Math.min(1, t * 6) * (1 - Math.max(0, t - 0.75) * 4);
  const w = size * 0.62;
  const top = y - size / 2 + dy;
  const d = `M${x} ${top} C${x + w * 0.2} ${top + size * 0.32} ${x + w / 2} ${top + size * 0.52} ${x + w / 2} ${top + size * 0.7} A${w / 2} ${w / 2} 0 0 1 ${x - w / 2} ${top + size * 0.7} C${x - w / 2} ${top + size * 0.52} ${x - w * 0.2} ${top + size * 0.32} ${x} ${top} Z`;
  return (
    <svg viewBox={view} width="100%" height="100%" style={{ position: "absolute", inset: 0, overflow: "visible" }} aria-hidden>
      <g opacity={o}>
        <path d={d} fill="#7DD3FC" stroke="#141619" strokeWidth={size * 0.07} strokeLinejoin="round" />
        <ellipse cx={x - w * 0.16} cy={top + size * 0.66} rx={w * 0.1} ry={size * 0.12} fill="#FFFFFF" opacity={0.9} />
      </g>
    </svg>
  );
}
