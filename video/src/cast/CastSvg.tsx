import React from "react";

// Uco & Ocu busts from the Uco & Ocu Style Lab reference (PR #28) (viewBox 180×200), ported for Remotion: pure props, no
// state or timers. Two variants: "paper" (Koran Kinetik: white cut-out border + ink drop shadow) and "hud" (Diagram
// Taktis: darker wardrobe tones). The chalk variant from the reference is intentionally not ported.

export type CastVariant = "paper" | "hud";
export type UcoMood = "loud" | "phone" | "squint" | "sweat";
export type OcuMood = "deadpan" | "magnifier";

const INK = "#141619";
const UCO_SILHOUETTE =
  "M36 196 L32 132 C32 110 55 104 68 102 L68 88 C52 80 48 64 50 48 C42 36 52 14 78 16 C92 4 128 8 134 30 C148 38 144 58 134 68 C134 82 124 94 114 98 L114 102 C132 104 150 112 152 134 L148 196 Z";
const OCU_SILHOUETTE =
  "M34 196 L38 128 C40 110 62 104 74 100 L74 88 C58 80 54 64 56 46 C58 20 82 10 112 16 C128 20 132 38 128 56 C126 78 118 92 108 98 L108 102 C126 106 144 114 146 134 L148 196 Z";

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

export function UcoBust({
  variant,
  mood = "loud",
  mouthOpen = false,
  sweatOffset = 0,
}: {
  variant: CastVariant;
  mood?: UcoMood;
  mouthOpen?: boolean;
  /** px the sweat drop has slid down (frame-driven by the caller) */
  sweatOffset?: number;
}) {
  const hud = variant === "hud";
  const y = sweatOffset;
  return (
    <svg viewBox="0 0 180 200" width="100%" height="100%" style={{ overflow: "visible" }} role="img" aria-label="Uco">
      {variant === "paper" && <PaperBacking d={UCO_SILHOUETTE} />}
      <g stroke={INK} strokeWidth={3.5} strokeLinecap="round" strokeLinejoin="round">
        <path d="M38 194 L36 134 C38 114 60 108 90 108 C120 108 144 114 146 134 L144 194 Z" fill={hud ? "#D97706" : "#F5A623"} />
        <path d="M68 108 L80 128 L90 116 L100 128 L112 108 Z" fill="#FEF08A" />
        <rect x={78} y={90} width={24} height={22} fill="#F6C296" />
        <path d="M56 54 C56 32 124 32 124 54 L122 80 C120 96 106 104 90 104 C74 104 60 96 58 80 Z" fill="#F6C296" />
        <path
          d="M52 54 C46 34 60 16 78 20 C84 8 108 8 116 20 C134 16 144 34 132 54 C126 42 118 36 104 38 L94 30 L84 40 C72 38 62 42 52 54 Z"
          fill="#C85A17"
        />
        {mood === "squint" || mood === "sweat" ? (
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
        <rect x={61} y={58} width={24} height={16} rx={2} fill="#FFFFFF" strokeWidth={4} />
        <rect x={95} y={58} width={24} height={16} rx={2} fill="#FFFFFF" strokeWidth={4} />
        <line x1={85} y1={65} x2={95} y2={65} strokeWidth={4} />
        <circle cx={74} cy={66} r={2.8} fill={INK} />
        <circle cx={106} cy={66} r={2.8} fill={INK} />
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
          <g transform="translate(132, 92) rotate(12)">
            <rect x={0} y={0} width={30} height={48} rx={3} fill="#FFE600" />
            <line x1={6} y1={12} x2={24} y2={12} />
            <line x1={6} y1={22} x2={20} y2={22} />
            <line x1={6} y1={32} x2={24} y2={32} />
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
}: {
  variant: CastVariant;
  mood?: OcuMood;
  mouthOpen?: boolean;
  pointRight?: boolean;
}) {
  const hud = variant === "hud";
  return (
    <svg viewBox="0 0 180 200" width="100%" height="100%" style={{ overflow: "visible" }} role="img" aria-label="Ocu">
      {variant === "paper" && <PaperBacking d={OCU_SILHOUETTE} />}
      <g stroke={INK} strokeWidth={3.5} strokeLinecap="round" strokeLinejoin="round">
        <path d="M38 194 L40 132 C44 114 64 108 90 108 C116 108 138 114 142 132 L144 194 Z" fill={hud ? "#1E3A5F" : "#587A7C"} />
        <path d="M72 100 L108 100 L114 194 L66 194 Z" fill={hud ? "#0F2942" : "#3A5859"} />
        <path d="M64 110 L76 148 L60 156" fill="none" />
        <path d="M116 110 L104 148 L120 156" fill="none" />
        <path d="M58 50 C58 30 122 30 122 50 L120 78 C118 96 104 104 90 104 C76 104 62 96 60 78 Z" fill="#9EB7BA" />
        <path d="M54 52 C50 26 72 10 106 14 C124 16 132 32 124 50 C116 36 104 32 82 34 C68 36 60 42 54 52 Z" fill="#25393B" />
        <line x1={65} y1={53} x2={82} y2={53} />
        <line x1={98} y1={53} x2={115} y2={53} />
        <rect x={62} y={59} width={23} height={14} rx={1.5} fill="#E2ECEC" strokeWidth={3} />
        <rect x={95} y={59} width={23} height={14} rx={1.5} fill="#E2ECEC" strokeWidth={3} />
        <line x1={85} y1={65} x2={95} y2={65} />
        <line x1={64} y1={64} x2={83} y2={64} />
        <line x1={97} y1={64} x2={116} y2={64} />
        <circle cx={74} cy={68} r={2.2} fill={INK} />
        <circle cx={106} cy={68} r={2.2} fill={INK} />
        {mouthOpen ? <ellipse cx={90} cy={86} rx={9} ry={4} fill="#25393B" /> : <path d="M80 86 Q92 88 103 83" fill="none" />}
        {mood === "magnifier" && (
          <g transform="translate(8, 108)">
            <circle cx={22} cy={22} r={18} fill="#FFE600" fillOpacity={0.35} />
            <line x1={35} y1={35} x2={50} y2={50} strokeWidth={5} />
          </g>
        )}
        {pointRight && (
          <g transform="translate(132, 118)">
            <path d="M0 10 L36 10 C42 10 42 20 36 20 L18 20 L18 30 L0 30 Z" fill="#9EB7BA" />
          </g>
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
