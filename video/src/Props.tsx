import React from "react";
import { Easing, interpolate, spring, useVideoConfig } from "remotion";
import { COLORS, type EpisodeLine } from "./types";

// Floating minimalist 2D prop icons, picked from the script line's `visual` notes by keyword,
// so every episode gets gags without hand-placing them. Uco's props pop in with overshoot,
// Ocu's drift in slowly and bob.

export type PropKind = "cup" | "house" | "receipt" | "newspaper" | "chart" | "sun" | "paylater" | "lipstick" | "money" | "phone";

const KEYWORDS: [PropKind, RegExp][] = [
  ["receipt", /receipt|bank statement|struk|mutasi/],
  ["newspaper", /newspaper|clipping|koran|headline/],
  ["chart", /chart|graph|grafik/],
  ["house", /\bhouse\b|rumah|home/],
  ["paylater", /paylater|cicil|installment/],
  ["sun", /\bsun\b|matahari/],
  ["lipstick", /lipstick|lipstik/],
  ["money", /money|cash|uang|salary|gaji|rupiah/],
  ["phone", /phone|hp\b|smartphone|scroll/],
  ["cup", /matcha|coffee|kopi|\bcup\b/],
];

export function propsFor(line: EpisodeLine): PropKind[] {
  const text = `${line.visual ?? ""}`.toLowerCase();
  const found = KEYWORDS.filter(([, re]) => re.test(text))
    .map(([k]) => ({ k, at: text.search(KEYWORDS.find(([kk]) => kk === k)![1]) }))
    .sort((a, b) => a.at - b.at)
    .map((x) => x.k)
    // Ocu already holds his drink; a second cup would be clutter.
    .filter((k) => !(k === "cup" && line.speaker === "ocu"));
  return found.slice(0, 3);
}

// Slot centers inside the 80% safe zone, kept clear of the face, caption card and subtitles.
const SLOTS = {
  uco: [
    { x: 215, y: 720 },
    { x: 215, y: 1080 },
    { x: 860, y: 1110 },
  ],
  ocu: [
    { x: 215, y: 700 },
    { x: 865, y: 720 },
    { x: 865, y: 1060 },
  ],
  two: [
    { x: 540, y: 640 },
    { x: 540, y: 880 },
    { x: 540, y: 1100 },
  ],
};

export function Prop({
  kind,
  slot,
  line,
  frame,
  flyAt,
  morph,
}: {
  kind: PropKind;
  slot: number;
  line: EpisodeLine;
  frame: number;
  /** frame at which the prop gets slapped off-screen */
  flyAt?: number;
  /** turn into another prop halfway through the line (e.g. house → matcha cup) */
  morph?: PropKind;
}) {
  const { fps } = useVideoConfig();
  const two = Boolean(line.thought_bubble) || line.beat === "concession" || line.beat === "button";
  // a prop that gets slapped sits where Uco's hand lands
  const pos = flyAt != null ? { x: 850, y: 780 } : (two ? SLOTS.two : SLOTS[line.speaker])[slot];
  const fly = flyAt != null ? Math.max(0, Math.min(1, (frame - flyAt) / 10)) : 0;
  const morphP = morph ? Math.max(0, Math.min(1, (frame - line.frames * 0.5) / 12)) : 0;
  const delay = 6 + slot * 8;
  const uco = line.speaker === "uco";
  const t = uco
    ? spring({ frame: frame - delay, fps, config: { damping: 7, stiffness: 220 } })
    : interpolate(frame, [delay, delay + 30], [0, 1], { extrapolateLeft: "clamp", extrapolateRight: "clamp", easing: Easing.inOut(Easing.sin) });
  const bob = Math.sin((frame + slot * 20) / (uco ? 9 : 22)) * (uco ? 8 : 12);
  const rot = uco ? Math.sin((frame + slot * 10) / 6) * 6 : Math.sin(frame / 30 + slot) * 4;
  // "house drifts away into the distance" style gag: the house slowly shrinks on Ocu's lines
  const shrink = kind === "house" && !uco ? interpolate(frame, [0, line.frames * 0.5], [1, 0.45], { extrapolateRight: "clamp" }) * (1 - morphP) + morphP * 1.1 : 1;
  return (
    <div
      style={{
        position: "absolute",
        left: pos.x - 100,
        top: pos.y - 100,
        width: 200,
        height: 200,
        opacity: uco ? 1 : t,
        transform: `translate(${fly * 900}px, ${bob + (1 - t) * (uco ? 0 : 40) - fly * 300}px) scale(${(uco ? t : 1) * shrink}) rotate(${rot + fly * 140}deg)`,
        filter: `drop-shadow(8px 8px 0 ${COLORS.ink})`,
      }}
    >
      <svg viewBox="0 0 200 200" width={200} height={200} style={{ position: "absolute", opacity: 1 - morphP }}>
        <Icon kind={kind} frame={frame} />
      </svg>
      {morph && morphP > 0 && (
        <svg viewBox="0 0 200 200" width={200} height={200} style={{ position: "absolute", opacity: morphP }}>
          <circle cx={100} cy={100} r={96} fill={COLORS.yellow} opacity={0.35 * (1 - morphP) + 0.15} />
          <Icon kind={morph} frame={frame} />
        </svg>
      )}
      {fly > 0 && fly < 1 && (
        <svg viewBox="0 0 200 200" width={260} height={260} style={{ position: "absolute", left: -150, top: -30 }}>
          {Array.from({ length: 8 }, (_, i) => (
            <line key={i} x1={100} y1={100} x2={100 + Math.cos(i * 0.8) * 95} y2={100 + Math.sin(i * 0.8) * 95} stroke={COLORS.yellow} strokeWidth={10} strokeLinecap="round" />
          ))}
        </svg>
      )}
    </div>
  );
}

const I = COLORS.ink;
const W = COLORS.white;
const sw = 7;

export function Icon({ kind, frame }: { kind: PropKind; frame: number }) {
  switch (kind) {
    case "cup":
      return (
        <g strokeLinejoin="round">
          <path d="M 50 40 L 150 40 L 138 185 L 62 185 Z" fill="rgba(230,240,240,0.5)" stroke={I} strokeWidth={sw} />
          <path d="M 54 80 L 146 80 L 138 182 L 62 182 Z" fill="#8DB255" />
          <rect x={64} y={88} width={28} height={24} rx={5} fill="rgba(255,255,255,0.6)" stroke={I} strokeWidth={3} />
          <rect x={104} y={100} width={28} height={24} rx={5} fill="rgba(255,255,255,0.6)" stroke={I} strokeWidth={3} />
          <rect x={42} y={28} width={116} height={16} rx={5} fill={W} stroke={I} strokeWidth={6} />
          <path d="M 110 28 L 126 -6" stroke="#2D6A4F" strokeWidth={10} strokeLinecap="round" />
        </g>
      );
    case "house":
      return (
        <g strokeLinejoin="round">
          <path d="M 30 100 L 100 36 L 170 100 Z" fill="#E5383B" stroke={I} strokeWidth={sw} />
          <rect x={46} y={98} width={108} height={84} fill={W} stroke={I} strokeWidth={sw} />
          <rect x={86} y={130} width={30} height={52} fill={COLORS.ocu} stroke={I} strokeWidth={5} />
          <rect x={58} y={114} width={22} height={22} fill="#8ECAE6" stroke={I} strokeWidth={4} />
          <rect x={124} y={114} width={22} height={22} fill="#8ECAE6" stroke={I} strokeWidth={4} />
        </g>
      );
    case "receipt": {
      const flutter = Math.sin(frame / 3) * 6;
      return (
        <g strokeLinejoin="round">
          <path d={`M 60 10 L 140 10 L 140 170 Q 120 ${180 + flutter} 100 170 Q 80 ${160 - flutter} 60 172 Z`} fill={W} stroke={I} strokeWidth={sw} />
          {[34, 54, 74, 94, 114, 134].map((y, i) => (
            <g key={y}>
              <line x1={72} x2={110} y1={y} y2={y} stroke={I} strokeWidth={4} />
              <line x1={118} x2={130} y1={y} y2={y} stroke={i % 2 ? "#E5383B" : I} strokeWidth={4} />
            </g>
          ))}
        </g>
      );
    }
    case "newspaper":
      return (
        <g strokeLinejoin="round" transform="rotate(-6 100 100)">
          <rect x={22} y={30} width={156} height={140} fill="#EDE6D6" stroke={I} strokeWidth={sw} />
          <rect x={34} y={42} width={132} height={24} fill={I} />
          <text x={100} y={61} textAnchor="middle" fontFamily="Bangers, Impact" fontSize={20} fill={W} letterSpacing={2}>
            NEWS
          </text>
          <rect x={34} y={76} width={60} height={50} fill="#B9B2A3" stroke={I} strokeWidth={3} />
          {[80, 92, 104, 116, 136, 148].map((y) => (
            <line key={y} x1={y > 126 ? 34 : 102} x2={166} y1={y} y2={y} stroke={I} strokeWidth={4} />
          ))}
        </g>
      );
    case "chart": {
      const grow = Math.min(1, frame / 20);
      return (
        <g strokeLinejoin="round">
          <rect x={18} y={18} width={164} height={164} rx={10} fill={W} stroke={I} strokeWidth={sw} />
          {[40, 70, 110].map((h, i) => (
            <rect key={i} x={40 + i * 44} y={160 - h * grow} width={32} height={h * grow} fill={i === 2 ? "#E5383B" : COLORS.ocu} stroke={I} strokeWidth={5} />
          ))}
          <path d="M 40 120 L 90 96 L 150 44" stroke={COLORS.yellow} strokeWidth={8} fill="none" />
          <path d="M 150 44 l -22 2 m 22 -2 l -4 22" stroke={I} strokeWidth={6} />
        </g>
      );
    }
    case "sun": {
      const pop = frame > 50 ? Math.min(1, (frame - 50) / 10) : 0; // the sun quietly pops
      return pop < 1 ? (
        <g opacity={1 - pop} transform={`scale(${1 + pop * 0.4}) translate(${-pop * 30} ${-pop * 30})`}>
          {Array.from({ length: 10 }, (_, i) => (
            <line key={i} x1={100} y1={100} x2={100 + Math.cos((i / 10) * Math.PI * 2) * 90} y2={100 + Math.sin((i / 10) * Math.PI * 2) * 90} stroke={COLORS.ucoAmber} strokeWidth={10} strokeLinecap="round" />
          ))}
          <circle cx={100} cy={100} r={52} fill={COLORS.yellow} stroke={I} strokeWidth={sw} />
          <circle cx={84} cy={94} r={5} fill={I} />
          <circle cx={116} cy={94} r={5} fill={I} />
          <path d="M 82 114 Q 100 128 118 114" stroke={I} strokeWidth={5} fill="none" />
        </g>
      ) : (
        <g>
          {[0, 1, 2, 3, 4].map((i) => (
            <circle key={i} cx={100 + Math.cos(i * 1.3) * 40} cy={100 + Math.sin(i * 1.3) * 34} r={28} fill={W} stroke={I} strokeWidth={5} />
          ))}
        </g>
      );
    }
    case "paylater":
      return (
        <g strokeLinejoin="round">
          <path d="M 40 60 L 130 40 L 170 80 L 160 160 L 70 180 L 30 140 Z" fill="#CDEFFB" stroke={I} strokeWidth={sw} />
          <path d="M 40 60 L 80 100 L 170 80 M 80 100 L 70 180" stroke={I} strokeWidth={4} fill="none" />
          <rect x={22} y={88} width={156} height={40} fill={W} stroke={I} strokeWidth={5} transform="rotate(-10 100 108)" />
          <text x={100} y={118} textAnchor="middle" fontFamily="Bangers, Impact" fontSize={30} fill={I} transform="rotate(-10 100 108)" letterSpacing={1}>
            PAYLATER
          </text>
          <path d="M 40 186 Q 100 200 160 186" stroke="#8ECAE6" strokeWidth={8} fill="none" />
        </g>
      );
    case "lipstick":
      return (
        <g strokeLinejoin="round">
          <rect x={70} y={110} width={60} height={76} rx={6} fill={COLORS.yellow} stroke={I} strokeWidth={sw} />
          <rect x={76} y={74} width={48} height={40} fill="#D4D4D4" stroke={I} strokeWidth={6} />
          <path d="M 80 74 L 80 30 L 120 50 L 120 74 Z" fill="#D00000" stroke={I} strokeWidth={6} />
        </g>
      );
    case "money":
      return (
        <g strokeLinejoin="round">
          <rect x={22} y={56} width={156} height={88} rx={8} fill="#95D5B2" stroke={I} strokeWidth={sw} transform="rotate(-8 100 100)" />
          <circle cx={100} cy={100} r={24} fill={W} stroke={I} strokeWidth={5} />
          <text x={100} y={110} textAnchor="middle" fontFamily="Bangers, Impact" fontSize={30} fill={I}>
            Rp
          </text>
        </g>
      );
    case "phone":
      return (
        <g strokeLinejoin="round">
          <rect x={56} y={16} width={88} height={168} rx={16} fill={I} />
          <rect x={64} y={30} width={72} height={136} rx={6} fill="#8ECAE6" />
          {[50, 76, 102, 128].map((y) => (
            <rect key={y} x={72} y={y} width={56} height={18} rx={4} fill={W} />
          ))}
        </g>
      );
  }
}
