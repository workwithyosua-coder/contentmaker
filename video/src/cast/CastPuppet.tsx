import React, { useId } from "react";
import { Img, spring, staticFile, useVideoConfig } from "remotion";
import { castSprites } from "../assets";
import { headBoxFor, sweatPoint, type HeadBox } from "./spriteCalibration";
import { bodyMotion, type MouthStage } from "../shared/motion";
import { framedRect, spriteBox } from "./spriteFrame";
import type { Emotion } from "../beats";
import { OcuBust, UcoBust, type CastVariant, type OcuMood, type UcoMood } from "./CastSvg";

// Layered puppet: illustrated PNG sprites (public/cast/{uco|ocu}/{emotion}-{closed|open}.png, see cast/README.md),
// with a 3-stage mouth from the voice loudness (closed / half-open / wide-open: the open frame's mouth squashed or
// stretched vertically over the closed or open frame), programmatic blinks, spring squash-and-stretch on entry, an
// audio-reactive bob, pulse and tilt (bouncy Uco, steady Ocu), idle breathing and comic FX. When the sprites for an emotion aren't uploaded yet, the coded CastSvg figure stands in,
// with the same motion and FX, so previews and renders always work.
// Fills its parent box (the 180×340 figure frame from CastFigure).

export type PuppetProps = {
  who: "uco" | "ocu";
  variant: CastVariant;
  emotion: Emotion;
  /** mouth this frame (from the voice loudness): 0 closed, 1 half-open, 2 wide-open */
  mouth: MouthStage;
  /** eyelids this frame: 0 open, 1 shut */
  blink?: number;
  /** inner thought: the body holds still */
  thought?: boolean;
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
  // audio-reactive: a bounce on vocal peaks (Uco up to 12 px, Ocu 6), squash-stretch and a swaying tilt (±2.8° / ±1.2°),
  // over idle breathing (motion.ts bodyMotion)
  const body = r ? { dy: 0, sx: 1, sy: 1, tilt: 0 } : bodyMotion(p.who, p.level, p.globalFrame, Boolean(p.thought));
  const box = sprites ? headBoxFor(p.who, sprites.emotion) : null;
  const sweaty = (p.fx ?? "sweat") === "sweat" && (p.emotion === "shocked" || p.emotion === "defensive");
  // the coded Uco already sweats in his "sweat" mood
  const drop = !sweaty ? null : sprites ? { view: "0 0 900 1700", ...sweatPoint(headBoxFor(p.who, sprites.emotion)), size: 96 } : p.who === "ocu" ? { view: "0 0 180 340", x: 44, y: 62, size: 22 } : null;

  return (
    <div style={{ position: "absolute", inset: 0 }}>
      <div
        style={{
          position: "absolute",
          inset: 0,
          transform: `translateY(${body.dy}px) rotate(${body.tilt}deg) scale(${sx * body.sx}, ${sy * body.sy})`,
          transformOrigin: "50% 100%",
          filter: p.rim ? `drop-shadow(0 0 10px ${p.rim}) drop-shadow(0 0 2px ${p.rim})` : undefined,
        }}
      >
        {sprites ? (
          <SpriteMouth closed={spriteSrc(sprites.closed)} open={spriteSrc(sprites.open)} stage={p.mouth} mouth={box?.mouth ?? null} rect={sprites.remote && box ? uploadRect(sprites.closed, sprites.open, box) : null} />
        ) : p.who === "uco" ? (
          <UcoBust
            variant={p.variant}
            mood={UCO_MOOD[p.emotion] ?? "loud"}
            mouthOpen={p.mouth > 0}
            sweatOffset={r ? 0 : Math.min(8, p.frame / 6)}
            motion={{ frame: p.globalFrame, look: p.look, talk: p.level, reduced: r }}
          />
        ) : (
          <OcuBust
            variant={p.variant}
            mood={OCU_MOOD[p.emotion] ?? "deadpan"}
            mouthOpen={p.mouth > 0}
            pointRight={p.emotion === "cta"}
            motion={{ frame: p.globalFrame, look: p.look, talk: p.level, reduced: r }}
          />
        )}
        {sprites && box && !r && (p.blink ?? 0) > 0 && <Blink box={box} closed={p.blink ?? 0} />}
        {/* inside the squash/stretch layer, so the drop stays glued to the temple */}
        {drop && <SweatDrop {...drop} frame={p.frame} reduced={r} />}
      </div>
    </div>
  );
}

type Rect = { left: number; top: number; width: number; height: number };

/**
 * An uploaded sprite's placement: its measured content framed like the calibrated sprites (spriteFrame.ts), measured
 * on the closed frame so both mouth frames line up. Null until measured (then it's drawn contained, as before).
 */
function uploadRect(closed: string, open: string, box: HeadBox): Rect | null {
  const m = spriteBox(closed) ?? spriteBox(open);
  return m ? framedRect(m, box.hairTop, box.faceX) : null;
}

/**
 * The 900×1700 sprite fills its figure frame exactly (same aspect, uniform scale, never stretched). An uploaded one is
 * placed by its measured content (`rect`), else contained with its feet on the frame's bottom. The Player waits for a
 * sprite that is still loading instead of showing a frame without the character.
 */
function SpriteImg({ src, hidden = false, rect = null }: { src: string; hidden?: boolean; rect?: Rect | null }) {
  const place: React.CSSProperties = rect
    ? { left: `${rect.left}%`, top: `${rect.top}%`, width: `${rect.width}%`, height: `${rect.height}%` }
    : { inset: 0, width: "100%", height: "100%", objectFit: "contain", objectPosition: "50% 100%" };
  return <Img src={src} maxRetries={2} pauseWhenLoading style={{ position: "absolute", ...place, visibility: hidden ? "hidden" : "visible" }} />;
}

const SPRITE = { w: 900, h: 1700 };
/** Uploaded sprites (Studio Assets) load from their URL; repo sprites through staticFile(). */
const spriteSrc = (p: string) => (/^(https?:|blob:|\/)/.test(p) ? p : staticFile(p));
const pct = (v: number, of: number) => `${((v / of) * 100).toFixed(3)}%`;

/**
 * Three mouth stages from two drawings: closed = the closed frame; half-open = the closed frame with the open
 * frame's mouth squashed to 62 % height (hinged at the upper lip); wide-open = the open frame with its mouth
 * stretched to 112 %. Only a feathered ellipse around the mouth is copied, over the same skin, so no seam shows.
 */
function SpriteMouth({ closed, open, stage, mouth, rect = null }: { closed: string; open: string; stage: MouthStage; mouth: HeadBox["mouth"] | null; rect?: Rect | null }) {
  // uploaded sprites have no measured mouth: both frames stay mounted (no decode gap on a swap), one shows
  if (!mouth || rect)
    return (
      <>
        <SpriteImg src={closed} hidden={stage > 0} rect={rect} />
        <SpriteImg src={open} hidden={stage === 0} rect={rect} />
      </>
    );
  const k = stage === 1 ? 0.62 : 1.12;
  // the stretched copy stops short of the chin so it never redraws the jaw line
  const bottom = stage === 2 ? mouth.y1 - 12 : mouth.y1;
  // a feathered ellipse around the mouth (not a hard box), so cheek shading never shows a seam
  const cx = (mouth.x0 + mouth.x1) / 2;
  const cy = (mouth.y0 + bottom) / 2;
  const mask = `radial-gradient(ellipse ${pct((mouth.x1 - mouth.x0) * 0.74, SPRITE.w)} ${pct((bottom - mouth.y0) * 0.66, SPRITE.h)} at ${pct(cx, SPRITE.w)} ${pct(cy, SPRITE.h)}, #000 70%, transparent 100%)`;
  return (
    <>
      {/* both frames stay mounted so the swap never waits on a decode */}
      <SpriteImg src={closed} hidden={stage === 2} />
      <SpriteImg src={open} hidden={stage !== 2} />
      {stage > 0 && (
        <div style={{ position: "absolute", inset: 0, transform: `scaleY(${k})`, transformOrigin: `50% ${pct(mouth.y0, SPRITE.h)}` }}>
          <Img src={open} style={{ position: "absolute", inset: 0, width: "100%", height: "100%", objectFit: "contain", objectPosition: "50% 100%", WebkitMaskImage: mask, maskImage: mask, WebkitMaskRepeat: "no-repeat", maskRepeat: "no-repeat", WebkitMaskSize: "100% 100%", maskSize: "100% 100%" }} />
        </div>
      )}
    </>
  );
}

/** Eyelids over the eye whites (sprite skin colour) with an ink lash line at the lid's edge. */
function Blink({ box, closed }: { box: HeadBox; closed: number }) {
  const id = useId().replace(/:/g, "");
  if (!box.eyes || !box.skin) return null;
  return (
    <svg viewBox={`0 0 ${SPRITE.w} ${SPRITE.h}`} width="100%" height="100%" style={{ position: "absolute", inset: 0 }} aria-hidden>
      {box.eyes.map((e, i) => {
        const top = e.cy - e.ry - 3;
        const h = (2 * e.ry + 6) * closed;
        const edge = top + h;
        const sag = e.ry * 0.28;
        return (
          <g key={i}>
            <clipPath id={`${id}-lid-${i}`}>
              <rect x={e.cx - e.rx - 4} y={top} width={2 * e.rx + 8} height={h} />
            </clipPath>
            <ellipse cx={e.cx} cy={e.cy} rx={e.rx + 3} ry={e.ry + 3} fill={box.skin} clipPath={`url(#${id}-lid-${i})`} />
            <path d={`M${e.cx - e.rx} ${edge - sag} Q${e.cx} ${edge + sag} ${e.cx + e.rx} ${edge - sag}`} fill="none" stroke="#141619" strokeWidth={8} strokeLinecap="round" />
          </g>
        );
      })}
    </svg>
  );
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
