import React from "react";

// Uco & Ocu as tall waist-up figures (viewBox 180×340): the heads from the Uco & Ocu Style Lab reference (PR #28),
// with a longer torso, shoulders and sweater / blazer so they can fill a portrait frame without stretching.
// Pure props, no state or timers: blinking, glances and eyebrow lifts are computed from the frame number.
// Variants: "paper" (Koran Kinetik: white cut-out border + ink drop shadow) and "hud" (Diagram Taktis tones).

export type CastVariant = "paper" | "hud";
export type UcoMood = "loud" | "phone" | "squint" | "sweat";
export type OcuMood = "deadpan" | "magnifier";

export const CAST_VIEW = { width: 180, height: 340 } as const;
/** Ocu's pointing fingertip in the CTA pose, in viewBox units (callers align it with TikTok's + Follow). */
export const OCU_FINGERTIP = { x: 174, y: 47 } as const;

const INK = "#141619";
const UCO_SILHOUETTE =
  "M18 340 L20 150 C22 120 50 110 68 106 L68 88 C52 80 48 64 50 48 C42 36 52 14 78 16 C92 4 128 8 134 30 C148 38 144 58 134 68 C134 82 124 94 114 98 L114 106 C132 110 158 120 160 150 L162 340 Z";
const OCU_SILHOUETTE =
  "M16 340 L20 148 C24 120 56 110 74 104 L74 88 C58 80 54 64 56 46 C58 20 82 10 112 16 C128 20 132 38 128 56 C126 78 118 92 108 98 L108 104 C126 110 156 120 160 148 L164 340 Z";

/** Frame-driven face life. `look` −1..1 = left..right; `talk` 0..1 = how loud the line is right now. */
export type FaceMotion = { frame: number; look?: number; talk?: number; reduced?: boolean };

function faceState({ frame, look = 0, talk = 0, reduced = false }: FaceMotion, period: number, phase: number) {
  if (reduced) return { blink: 0, dx: look * 2, browLift: 0 };
  // blink: 2 frames half, 2 frames closed, once per `period` frames (deterministic, no randomness)
  const t = (frame + phase) % period;
  const blink = t < 1 ? 0.5 : t < 3 ? 1 : t < 4 ? 0.5 : 0;
  const drift = Math.sin((frame + phase) / 47) * 0.6;
  const browLift = Math.min(1, talk) * 3.2 + (talk > 0.6 ? Math.sin(frame / 3) * 0.6 : 0);
  return { blink, dx: look * 2.2 + drift, browLift };
}

function PaperBacking({ d }: { d: string }) {
  return (
    <>
      <g transform="translate(5, 6)" opacity={0.95}>
        <path d={d} fill={INK} />
      </g>
      <path d={d} fill="#FFFFFF" stroke="#FFFFFF" strokeWidth={12} strokeLinejoin="round" />
    </>
  );
}

/** One lens: white glass, pupil that glances and an eyelid that closes for blinks. */
function Eye({ x, y, w, h, rx, glass, pupilR, dx, blink, lidLine }: { x: number; y: number; w: number; h: number; rx: number; glass: string; pupilR: number; dx: number; blink: number; lidLine?: boolean }) {
  const cx = x + w / 2;
  const cy = y + h / 2 + (lidLine ? 1.5 : 0);
  return (
    <>
      <rect x={x} y={y} width={w} height={h} rx={rx} fill={glass} />
      {blink < 1 && <circle cx={cx + dx} cy={cy} r={pupilR} fill={INK} stroke="none" />}
      {lidLine && blink === 0 && <line x1={x + 2} y1={y + h / 2 - 0.5} x2={x + w - 2} y2={y + h / 2 - 0.5} />}
      {blink === 1 && <path d={`M${x + 4} ${cy} Q${cx} ${cy + 3} ${x + w - 4} ${cy}`} fill="none" />}
      {blink === 0.5 && <line x1={x + 3} y1={cy - 1} x2={x + w - 3} y2={cy - 1} />}
    </>
  );
}

export function UcoBust({
  variant,
  mood = "loud",
  mouthOpen = false,
  sweatOffset = 0,
  motion = { frame: 0 },
}: {
  variant: CastVariant;
  mood?: UcoMood;
  mouthOpen?: boolean;
  /** px the sweat drop has slid down (frame-driven by the caller) */
  sweatOffset?: number;
  motion?: FaceMotion;
}) {
  const hud = variant === "hud";
  const y = sweatOffset;
  const { blink, dx, browLift } = faceState(motion, 101, 0);
  const sweater = hud ? "#D97706" : "#F5A623";
  const sweaterShade = hud ? "#B45309" : "#D98E14";
  const squint = mood === "squint" || mood === "sweat";
  return (
    <svg viewBox="0 0 180 340" width="100%" height="100%" style={{ overflow: "visible" }} role="img" aria-label="Uco">
      {variant === "paper" && <PaperBacking d={UCO_SILHOUETTE} />}
      <g stroke={INK} strokeWidth={3.5} strokeLinecap="round" strokeLinejoin="round">
        {/* sweater: shoulders, long torso, arms down the sides */}
        <path d="M22 340 L24 152 C26 122 58 112 90 112 C122 112 154 122 156 152 L158 340 Z" fill={sweater} />
        <path d="M44 172 L46 340" fill="none" />
        <path d="M136 172 L134 340" fill="none" />
        <path d="M46 236 C58 244 70 246 80 246 M134 236 C122 244 110 246 100 246" fill="none" stroke={sweaterShade} />
        <path d="M24 318 L156 318" fill="none" stroke={sweaterShade} strokeWidth={3} />
        {/* pale yellow shirt collar */}
        <path d="M68 108 L80 128 L90 116 L100 128 L112 108 Z" fill="#FEF08A" />
        <rect x={78} y={90} width={24} height={22} fill="#F6C296" />
        <path d="M56 54 C56 32 124 32 124 54 L122 80 C120 96 106 104 90 104 C74 104 60 96 58 80 Z" fill="#F6C296" />
        <path
          d="M52 54 C46 34 60 16 78 20 C84 8 108 8 116 20 C134 16 144 34 132 54 C126 42 118 36 104 38 L94 30 L84 40 C72 38 62 42 52 54 Z"
          fill="#C85A17"
        />
        <g transform={`translate(0, ${-browLift})`}>
          {squint ? (
            <>
              <path d="M64 52 L82 56" fill="none" />
              <path d="M116 52 L98 56" fill="none" />
            </>
          ) : (
            <>
              <path d="M64 50 L82 55" fill="none" />
              <path d="M116 50 L98 55" fill="none" />
            </>
          )}
        </g>
        <g strokeWidth={4}>
          <Eye x={61} y={58} w={24} h={16} rx={2} glass="#FFFFFF" pupilR={2.8} dx={dx} blink={blink} />
          <Eye x={95} y={58} w={24} h={16} rx={2} glass="#FFFFFF" pupilR={2.8} dx={dx} blink={blink} />
          <line x1={85} y1={65} x2={95} y2={65} />
        </g>
        {mouthOpen ? (
          <path d="M74 83 C84 81 96 81 106 83 C106 94 74 94 74 83 Z" fill="#7F1D1D" />
        ) : (
          <path d={mood === "sweat" ? "M76 87 Q90 82 104 87" : "M78 85 L102 85"} fill="none" />
        )}
        {mood === "sweat" && (
          <path
            d={`M132 ${46 + y} C137 ${56 + y} 137 ${63 + y} 132 ${63 + y} C127 ${63 + y} 127 ${56 + y} 132 ${46 + y} Z`}
            fill="#38BDF8"
          />
        )}
        {mood === "phone" && (
          <g transform="translate(118, 150) rotate(10)">
            <rect x={0} y={0} width={34} height={56} rx={4} fill="#FFE600" />
            <line x1={7} y1={14} x2={27} y2={14} />
            <line x1={7} y1={26} x2={22} y2={26} />
            <line x1={7} y1={38} x2={27} y2={38} />
          </g>
        )}
      </g>
    </svg>
  );
}

export function OcuBust({
  variant,
  mood = "deadpan",
  mouthOpen = false,
  pointRight = false,
  motion = { frame: 0 },
}: {
  variant: CastVariant;
  mood?: OcuMood;
  mouthOpen?: boolean;
  /** CTA pose: right arm raised beside his head, index finger pointing right (fingertip at OCU_FINGERTIP) */
  pointRight?: boolean;
  motion?: FaceMotion;
}) {
  const hud = variant === "hud";
  const { blink, dx, browLift } = faceState(motion, 113, 41);
  const blazer = hud ? "#1E3A5F" : "#587A7C";
  const turtle = hud ? "#0F2942" : "#3A5859";
  return (
    <svg viewBox="0 0 180 340" width="100%" height="100%" style={{ overflow: "visible" }} role="img" aria-label="Ocu">
      {variant === "paper" && <PaperBacking d={OCU_SILHOUETTE} />}
      <g stroke={INK} strokeWidth={3.5} strokeLinecap="round" strokeLinejoin="round">
        {/* blazer over a turtleneck, long torso */}
        <path d="M20 340 L24 150 C28 122 58 112 90 112 C122 112 152 122 156 150 L160 340 Z" fill={blazer} />
        <path d="M72 100 L108 100 L114 340 L66 340 Z" fill={turtle} />
        <path d="M64 114 L82 196 L60 214" fill="none" />
        <path d="M116 114 L98 196 L120 214" fill="none" />
        <path d="M42 172 L44 340" fill="none" />
        {!pointRight && <path d="M138 172 L136 340" fill="none" />}
        <path d="M58 252 L74 252 M106 252 L122 252" fill="none" />
        <path d="M58 50 C58 30 122 30 122 50 L120 78 C118 96 104 104 90 104 C76 104 62 96 60 78 Z" fill="#9EB7BA" />
        <path d="M54 52 C50 26 72 10 106 14 C124 16 132 32 124 50 C116 36 104 32 82 34 C68 36 60 42 54 52 Z" fill="#25393B" />
        <g transform={`translate(0, ${-browLift})`}>
          <line x1={65} y1={53} x2={82} y2={53} />
          <line x1={98} y1={53} x2={115} y2={53} />
        </g>
        <g strokeWidth={3}>
          <Eye x={62} y={59} w={23} h={14} rx={1.5} glass="#E2ECEC" pupilR={2.2} dx={dx} blink={blink} lidLine />
          <Eye x={95} y={59} w={23} h={14} rx={1.5} glass="#E2ECEC" pupilR={2.2} dx={dx} blink={blink} lidLine />
          <line x1={85} y1={65} x2={95} y2={65} />
        </g>
        {mouthOpen ? <ellipse cx={90} cy={86} rx={9} ry={4} fill="#25393B" /> : <path d="M80 86 Q92 88 103 83" fill="none" />}
        {mood === "magnifier" && (
          <g transform="translate(6, 150)">
            <circle cx={24} cy={24} r={20} fill="#FFE600" fillOpacity={0.35} />
            <line x1={38} y1={38} x2={54} y2={54} strokeWidth={5} />
          </g>
        )}
        {pointRight && (
          <>
            {/* raised right arm: a full sleeve from the shoulder straight up beside his head, cuff, then a fist at
                forehead height with the index finger pointing right (toward TikTok's + Follow) */}
            <path d="M128 132 C134 118 150 114 160 122 L164 66 L140 66 Z" fill={blazer} />
            <path d="M139 66 L165 66 L165 76 L139 76 Z" fill={turtle} />
            <path d="M136 36 L158 36 C162 36 162 40 162 40 L162 64 L136 64 C134 64 134 62 134 60 L134 40 C134 38 135 36 136 36 Z" fill="#9EB7BA" />
            <path d="M160 41 L171 41 C176 41 176 53 171 53 L160 53 Z" fill="#9EB7BA" />
            <path d="M138 46 L156 46 M138 54 L156 54" fill="none" strokeWidth={2.5} />
          </>
        )}
      </g>
    </svg>
  );
}

/** Mood per line, from the script's expression and props (the reference hard-coded these per demo beat). */
export function ucoMoodFor(expression: string, visual = ""): UcoMood {
  if (/phone|hp\b|checkout|scroll/i.test(visual)) return "phone";
  if (["worried", "shocked"].includes(expression)) return "sweat";
  if (["thinking", "smug"].includes(expression)) return "squint";
  return "loud";
}
export function ocuMoodFor(visual = ""): OcuMood {
  return /magnif|receipt|struk|zoom|inspect|detail/i.test(visual) ? "magnifier" : "deadpan";
}

/** Mouth open/closed from the voice loudness envelope (no audio → closed). */
export function mouthOpenAt(envelope: number[], frame: number) {
  const v = envelope[frame] ?? 0;
  return v > 0.35;
}
