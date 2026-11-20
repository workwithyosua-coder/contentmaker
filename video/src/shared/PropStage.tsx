import React from "react";
import { Img, spring, useVideoConfig } from "remotion";
import type { PropTag } from "../beats";

// The open half of a solo shot shows what the character is talking about: the beat's scene image (taped
// Polaroid for Koran Kinetik, glowing HUD viewport for Diagram Taktis), or a coded topic prop for its propTag.
// Pops in on a spring, then drifts gently (2.5D parallax). Everything stays inside the box it's given, which the
// director keeps inside x 60..940, y 520..1080.

export type PropSkin = "paper" | "hud";
export type Box = { x: number; y: number; w: number; h: number };

const INK = "#141619";

/** snappy pop: overshoots ~12 % and settles in ~0.4 s */
export const PROP_SPRING = { mass: 0.5, damping: 9, stiffness: 230 } as const;
/** props sit in the scene: the style's own shadow plus a soft contact shadow below */
export const PROP_SHADOW: Record<PropSkin, string> = {
  paper: "drop-shadow(8px 8px 0 rgba(20,22,25,0.9)) drop-shadow(0 22px 18px rgba(20,22,25,0.28))",
  hud: "drop-shadow(0 0 16px rgba(56,189,248,0.45)) drop-shadow(0 22px 20px rgba(0,0,0,0.45))",
};

export function PropStage({
  box,
  skin,
  tag,
  label,
  sceneImageUrl,
  frame,
  reduced,
  tilt,
  delay = 6,
}: {
  box: Box;
  skin: PropSkin;
  tag: PropTag;
  /** short text on the prop (a price, a number), or null */
  label: string | null;
  sceneImageUrl: string | null;
  frame: number;
  reduced: boolean;
  /** resting tilt in degrees (paper props sit a little crooked) */
  tilt: number;
  /** frame the prop pops in on (its keyword, else ~0.35 s) */
  delay?: number;
}) {
  const { fps } = useVideoConfig();
  const pop = reduced ? 1 : spring({ frame: frame - delay, fps, config: PROP_SPRING });
  if (pop <= 0.001) return null;
  // idle float: ±4 px
  const driftY = reduced ? 0 : Math.sin((frame - delay) / 20) * 4;
  const driftR = reduced ? 0 : Math.sin(frame / 52) * 1.2;
  return (
    <div
      style={{
        position: "absolute",
        left: box.x,
        top: box.y,
        width: box.w,
        height: box.h,
        transform: `translateY(${driftY}px) rotate(${tilt + driftR}deg) scale(${0.3 + 0.7 * pop})`,
        opacity: Math.min(1, pop * 2),
        transformOrigin: "50% 60%",
        filter: PROP_SHADOW[skin],
      }}
    >
      {sceneImageUrl ? (
        skin === "paper" ? (
          <Polaroid url={sceneImageUrl} frame={frame} reduced={reduced} />
        ) : (
          <HudViewport url={sceneImageUrl} frame={frame} reduced={reduced} />
        )
      ) : (
        <svg viewBox="0 0 400 480" width="100%" height="100%" style={{ overflow: "visible" }} aria-hidden>
          <Prop tag={tag} skin={skin} label={label} frame={reduced ? 40 : frame} />
        </svg>
      )}
    </div>
  );
}

/** Taped, torn-edged Polaroid with the image inside; the image pans slower than the frame (parallax). */
function Polaroid({ url, frame, reduced }: { url: string; frame: number; reduced: boolean }) {
  const pan = reduced ? 0 : Math.sin(frame / 45) * 10;
  return (
    <div style={{ position: "absolute", inset: "4% 6% 8% 6%", background: "#FFFFFF", border: `4px solid ${INK}`, boxShadow: `10px 10px 0 ${INK}`, padding: "5% 5% 18% 5%" }}>
      <div style={{ position: "relative", width: "100%", height: "100%", overflow: "hidden", border: `3px solid ${INK}` }}>
        <Img src={url} style={{ position: "absolute", left: "-8%", top: "-8%", width: "116%", height: "116%", objectFit: "cover", transform: `translate(${pan}px, ${-pan / 2}px)` }} />
      </div>
      {/* torn bottom edge */}
      <svg viewBox="0 0 100 6" preserveAspectRatio="none" style={{ position: "absolute", left: -4, right: -4, bottom: -10, width: "calc(100% + 8px)", height: 14 }} aria-hidden>
        <path d="M0 0 L5 4 L10 1 L15 5 L21 2 L27 5 L33 1 L39 4 L45 2 L51 6 L57 1 L63 4 L69 2 L75 5 L81 1 L87 4 L93 2 L100 5 L100 0 Z" fill="#F4EFE6" />
      </svg>
      {/* tape */}
      <div style={{ position: "absolute", top: -22, left: "8%", width: "30%", height: 40, background: "rgba(255,230,0,0.78)", border: `2px solid ${INK}`, transform: "rotate(-8deg)" }} />
      <div style={{ position: "absolute", top: -18, right: "6%", width: "26%", height: 38, background: "rgba(255,230,0,0.78)", border: `2px solid ${INK}`, transform: "rotate(7deg)" }} />
    </div>
  );
}

/** Glowing tactical viewport: cyan frame, corner ticks, scanlines, the image drifting behind (parallax). */
function HudViewport({ url, frame, reduced }: { url: string; frame: number; reduced: boolean }) {
  const pan = reduced ? 0 : Math.sin(frame / 45) * 10;
  const scan = reduced ? 0 : (frame * 3) % 100;
  return (
    <div style={{ position: "absolute", inset: "4%", border: "4px solid #38BDF8", boxShadow: "0 0 24px rgba(56,189,248,0.55), inset 0 0 18px rgba(56,189,248,0.35)", background: "#0F172A", overflow: "hidden" }}>
      <Img src={url} style={{ position: "absolute", left: "-8%", top: "-8%", width: "116%", height: "116%", objectFit: "cover", opacity: 0.92, transform: `translate(${pan}px, ${-pan / 2}px)` }} />
      <div style={{ position: "absolute", inset: 0, backgroundImage: "repeating-linear-gradient(0deg, rgba(15,23,42,0.35) 0 2px, transparent 2px 6px)" }} />
      <div style={{ position: "absolute", left: 0, right: 0, top: `${scan}%`, height: 6, background: "rgba(56,189,248,0.45)" }} />
      {[
        { left: 10, top: 10, b: "borderLeft", c: "borderTop" },
        { right: 10, top: 10, b: "borderRight", c: "borderTop" },
        { left: 10, bottom: 10, b: "borderLeft", c: "borderBottom" },
        { right: 10, bottom: 10, b: "borderRight", c: "borderBottom" },
      ].map(({ b, c, ...pos }, i) => (
        <div key={i} style={{ position: "absolute", width: 34, height: 34, ...pos, [b]: "5px solid #F59E0B", [c]: "5px solid #F59E0B" }} />
      ))}
    </div>
  );
}

// ------------------------------------------------------------------ coded topic props (viewBox 400×480)
type Ink = { line: string; fill: string; soft: string; accent: string; hot: string; text: string; glow?: string };
const SKINS: Record<PropSkin, Ink> = {
  paper: { line: INK, fill: "#FFFFFF", soft: "#F4EFE6", accent: "#FFE600", hot: "#D9381E", text: INK },
  hud: { line: "#38BDF8", fill: "#0F172A", soft: "#1E293B", accent: "#F59E0B", hot: "#EF4444", text: "#F8FAFC", glow: "drop-shadow(0 0 8px rgba(56,189,248,0.6))" },
};

function Tag({ x, y, text, k, rot = -6 }: { x: number; y: number; text: string; k: Ink; rot?: number }) {
  const w = Math.max(120, text.length * 26 + 40);
  return (
    <g transform={`translate(${x} ${y}) rotate(${rot})`}>
      <rect x={-w / 2} y={-34} width={w} height={68} rx={6} fill={k.accent} stroke={INK} strokeWidth={5} />
      <circle cx={-w / 2 + 18} cy={0} r={7} fill={k.fill} stroke={INK} strokeWidth={4} />
      <text x={10} y={14} textAnchor="middle" fontFamily="Montserrat, 'Arial Black', sans-serif" fontWeight={900} fontSize={40} fill={INK}>
        {text}
      </text>
    </g>
  );
}

function Prop({ tag, skin, label, frame }: { tag: PropTag; skin: PropSkin; label: string | null; frame: number }) {
  const k = SKINS[skin];
  const sw = 6;
  const common = { stroke: k.line, strokeWidth: sw, strokeLinejoin: "round" as const, strokeLinecap: "round" as const };
  const g = { style: { filter: k.glow } };
  switch (tag) {
    case "iced-coffee": {
      const bob = Math.sin(frame / 10) * 3;
      return (
        <g {...g}>
          <path d="M110 120 L290 120 L262 440 L138 440 Z" fill={skin === "paper" ? "#E9D8C0" : k.soft} {...common} />
          <path d="M120 220 L280 220 L262 440 L138 440 Z" fill={skin === "paper" ? "#8B5A2B" : "#7C4A1E"} stroke="none" />
          <path d="M110 120 L290 120 L262 440 L138 440 Z" fill="none" {...common} />
          {[0, 1, 2, 3].map((i) => (
            <rect key={i} x={140 + i * 32} y={150 + ((i * 37) % 50) + bob * (i % 2 ? 1 : -1)} width={40} height={40} rx={6} fill="rgba(255,255,255,0.75)" {...common} strokeWidth={4} transform={`rotate(${i * 13 - 15} ${160 + i * 32} ${170 + ((i * 37) % 50)})`} />
          ))}
          <rect x={96} y={100} width={208} height={30} rx={10} fill={k.fill} {...common} />
          <path d="M220 104 L262 20" {...common} strokeWidth={14} stroke={k.hot} />
          <path d="M220 104 L262 20" fill="none" stroke={k.line} strokeWidth={3} />
          {label && <Tag x={300} y={330} text={label} k={k} />}
        </g>
      );
    }
    case "checkout-phone": {
      const pulse = 0.6 + 0.4 * Math.abs(Math.sin(frame / 8));
      return (
        <g {...g}>
          <rect x={90} y={30} width={220} height={420} rx={34} fill={k.fill} {...common} />
          <rect x={110} y={70} width={180} height={320} rx={10} fill={skin === "paper" ? "#FFF6B0" : "#0B3B5C"} stroke={k.line} strokeWidth={4} />
          <path d="M150 140 L170 140 L188 200 L250 200 L262 160 L178 160" fill="none" {...common} />
          <circle cx={196} cy={222} r={10} fill={k.line} />
          <circle cx={240} cy={222} r={10} fill={k.line} />
          <rect x={126} y={300} width={148} height={56} rx={10} fill={k.hot} opacity={pulse} {...common} strokeWidth={4} />
          <text x={200} y={338} textAnchor="middle" fontFamily="Montserrat, 'Arial Black', sans-serif" fontWeight={900} fontSize={28} fill="#FFFFFF">
            CHECKOUT
          </text>
          <circle cx={200} cy={418} r={12} fill="none" stroke={k.line} strokeWidth={4} />
          {label && <Tag x={300} y={110} text={label} k={k} rot={8} />}
        </g>
      );
    }
    case "payday-slips":
      return (
        <g {...g}>
          {[0, 1, 2, 3, 4].map((i) => {
            const t = ((frame + i * 14) % 70) / 70;
            const x = 70 + i * 50 + Math.sin(t * 6 + i) * 30;
            const y = 420 - t * 380;
            return (
              <g key={i} transform={`translate(${x} ${y}) rotate(${-20 + i * 11 + t * 40})`} opacity={1 - t * 0.5}>
                <rect x={-70} y={-40} width={140} height={80} rx={6} fill={k.fill} {...common} strokeWidth={4} />
                <text x={0} y={-6} textAnchor="middle" fontFamily="Montserrat, 'Arial Black', sans-serif" fontWeight={900} fontSize={22} fill={k.text}>
                  GAJI
                </text>
                <line x1={-46} y1={16} x2={46} y2={16} stroke={k.hot} strokeWidth={6} />
              </g>
            );
          })}
          {label && <Tag x={200} y={440} text={label} k={k} />}
        </g>
      );
    case "receipt-magnifier": {
      const mx = 200 + Math.sin(frame / 20) * 40;
      return (
        <g {...g}>
          <path d="M100 20 L300 20 L300 440 L280 455 L260 440 L240 455 L220 440 L200 455 L180 440 L160 455 L140 440 L120 455 L100 440 Z" fill={k.fill} {...common} strokeWidth={5} />
          {Array.from({ length: 10 }, (_, i) => (
            <line key={i} x1={124} y1={70 + i * 34} x2={i % 3 === 2 ? 230 : 276} y2={70 + i * 34} stroke={i === 6 ? k.hot : k.line} strokeWidth={i === 6 ? 8 : 4} opacity={i === 6 ? 1 : 0.6} />
          ))}
          <g transform={`translate(${mx} 274)`}>
            <circle r={78} fill={skin === "paper" ? "rgba(255,230,0,0.25)" : "rgba(56,189,248,0.18)"} {...common} strokeWidth={10} />
            <line x1={56} y1={56} x2={120} y2={120} {...common} strokeWidth={22} />
          </g>
          {label && <Tag x={200} y={60} text={label} k={k} rot={4} />}
        </g>
      );
    }
    case "cash-vs-paylater": {
      const fill = Math.min(1, frame / 30);
      return (
        <g {...g}>
          {[
            { x: 70, name: "CASH", v: 0.92, c: k.hot, note: "SAKIT" },
            { x: 230, name: "PAYLATER", v: 0.12, c: k.accent, note: "KEBAL" },
          ].map((b) => (
            <g key={b.name}>
              <rect x={b.x} y={70} width={100} height={320} rx={8} fill={k.soft} {...common} strokeWidth={5} />
              <rect x={b.x + 8} y={382 - 304 * b.v * fill} width={84} height={304 * b.v * fill} fill={b.c} stroke="none" />
              <text x={b.x + 50} y={430} textAnchor="middle" fontFamily="Montserrat, 'Arial Black', sans-serif" fontWeight={900} fontSize={b.name.length > 5 ? 26 : 34} fill={k.text}>
                {b.name}
              </text>
              <text x={b.x + 50} y={50} textAnchor="middle" fontFamily="Montserrat, 'Arial Black', sans-serif" fontWeight={900} fontSize={28} fill={b.c}>
                {b.note}
              </text>
            </g>
          ))}
        </g>
      );
    }
    default: {
      // generic topic burst: a starburst with the beat's number or a "!"
      const spin = (frame * 0.5) % 360;
      const pts = Array.from({ length: 24 }, (_, i) => {
        const a = (i / 24) * Math.PI * 2;
        const r = i % 2 ? 120 : 175;
        return `${200 + Math.cos(a) * r},${240 + Math.sin(a) * r}`;
      }).join(" ");
      return (
        <g {...g}>
          <polygon points={pts} fill={k.accent} {...common} transform={`rotate(${spin / 8} 200 240)`} />
          <text x={200} y={label ? 262 : 300} textAnchor="middle" fontFamily="Montserrat, 'Arial Black', sans-serif" fontWeight={900} fontSize={label ? (label.length > 6 ? 46 : 64) : 160} fill={INK}>
            {label ?? "!"}
          </text>
        </g>
      );
    }
  }
}

/** A short number-like label for the prop from the cue / on-screen text (e.g. "65RB", "1,02 JUTA", "12X"). */
export function propLabel(...texts: (string | null | undefined)[]): string | null {
  for (const t of texts) {
    const m = (t ?? "").toUpperCase().match(/(RP\s?)?\d[\d.,]*\s?(RB|JT|JUTA|RIBU|K|X|%)?/);
    if (m && m[0].trim().length >= 2) return m[0].replace(/\s+/g, " ").trim().slice(0, 10);
  }
  return null;
}
