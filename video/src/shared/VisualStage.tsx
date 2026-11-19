import React from "react";
import { Img, interpolate, spring, staticFile, useVideoConfig } from "remotion";
import type { Overlay } from "../beats";
import { HEAVY, MONO, textWidth, wrapHeadline } from "../cast/CueShared";
import { pngPropByName } from "../props/library";
import type { Box, PropSkin } from "./PropStage";

// The open "visual stage" beside or above the speaker: floating kinetic text, callout labels on a PNG prop, explainer
// cards (wave / emulsion graph, brain / psychology badge) and the comic thought bubble. Canvas coordinates; the
// Director decides the boxes and keeps them inside the safe zone (x 60..940, y 250..1080).

const INK = "#141619";
const clamp = { extrapolateLeft: "clamp", extrapolateRight: "clamp" } as const;

export type StageInk = { line: string; fill: string; text: string; accent: string; hot: string; muted: string; glow?: string };
export const STAGE_INK: Record<PropSkin, StageInk> = {
  paper: { line: INK, fill: "#FFFFFF", text: INK, accent: "#FFE600", hot: "#D9381E", muted: "#7A7568" },
  hud: { line: "#38BDF8", fill: "#0F172A", text: "#F8FAFC", accent: "#F59E0B", hot: "#EF4444", muted: "#64748B", glow: "0 0 18px rgba(56,189,248,0.55)" },
};

// ------------------------------------------------------------------ kinetic text
/** Largest size (76 → 44 px) at which the text fits `w` in at most two lines. */
function kineticFit(text: string, w: number) {
  for (let size = 76; size >= 44; size -= 4) {
    const lines = wrapHeadline(text, size, w - 40);
    if (lines.length <= 2 && lines.every((l) => textWidth(l, size) <= w - 40)) return { size, lines };
  }
  return { size: 44, lines: wrapHeadline(text, 44, w - 40) };
}

/** Height a kinetic block needs for `text` in a box `w` wide. */
export const kineticHeight = (text: string, w: number) => {
  const { size, lines } = kineticFit(text, w);
  return Math.ceil(lines.length * size * 1.05) + 44;
};

/**
 * 2–4 punchy words floating on the stage. Paper: a red stamp that slams in (frame 10). HUD: an amber bracketed
 * readout that types on.
 */
export function KineticText({ text, box, skin, frame, reduced, align = "center" }: { text: string; box: Box; skin: PropSkin; frame: number; reduced: boolean; align?: "left" | "center" | "right" }) {
  const { size, lines } = kineticFit(text, box.w);
  const bob = reduced ? 0 : Math.sin(frame / 16) * 4;
  const justify = align === "left" ? "flex-start" : align === "right" ? "flex-end" : "center";
  if (skin === "paper") {
    const slam = reduced ? 1 : frame < 10 ? 0 : interpolate(frame, [10, 18], [1.7, 1], clamp);
    if (!slam) return null;
    return (
      <div style={{ position: "absolute", left: box.x, top: box.y, width: box.w, height: box.h, display: "flex", alignItems: "flex-start", justifyContent: justify }}>
        <div
          style={{
            background: "#D9381E",
            border: `6px solid ${INK}`,
            boxShadow: `9px 9px 0 ${INK}`,
            padding: "12px 20px 14px",
            transform: `translateY(${bob}px) rotate(-4deg) scale(${slam})`,
            transformOrigin: "50% 50%",
            fontFamily: HEAVY,
            fontWeight: 900,
            fontSize: size,
            lineHeight: 1.05,
            color: "#FFFFFF",
            textAlign: align,
          }}
        >
          {lines.map((l, i) => (
            <div key={i} style={{ whiteSpace: "nowrap" }}>
              {l}
            </div>
          ))}
        </div>
      </div>
    );
  }
  const shown = reduced ? text.length : Math.floor(interpolate(frame, [6, 6 + text.length * 1.5], [0, text.length], clamp));
  // characters typed so far, line by line (each line break counts as one character)
  const starts = lines.map((_, i) => lines.slice(0, i).reduce((a, l) => a + l.length + 1, 0));
  const typed = lines.map((l, i) => l.slice(0, Math.max(0, shown - starts[i])));
  return (
    <div style={{ position: "absolute", left: box.x, top: box.y, width: box.w, height: box.h, display: "flex", alignItems: "flex-start", justifyContent: justify }}>
      <div
        style={{
          background: "rgba(15,23,42,0.88)",
          borderLeft: "8px solid #F59E0B",
          boxShadow: "0 0 22px rgba(245,158,11,0.35)",
          padding: "12px 20px 14px",
          transform: `translateY(${bob}px)`,
          fontFamily: HEAVY,
          fontWeight: 900,
          fontSize: size,
          lineHeight: 1.05,
          color: "#F59E0B",
          textAlign: align,
          minWidth: 120,
        }}
      >
        {lines.map((l, i) => (
          <div key={i} style={{ whiteSpace: "nowrap", minHeight: size * 1.05 }}>
            {typed[i]}
            {i === lines.length - 1 && !reduced && Math.floor(frame / 8) % 2 === 0 ? "▌" : ""}
          </div>
        ))}
      </div>
    </div>
  );
}

// ------------------------------------------------------------------ PNG prop with callout labels
/** Where a PNG of aspect `a` (w/h) lands inside `box` with object-fit: contain. */
export function containRect(box: Box, a: number): Box {
  const w = Math.min(box.w, box.h * a);
  const h = w / a;
  return { x: box.x + (box.w - w) / 2, y: box.y + (box.h - h) / 2, w, h };
}

/**
 * An illustrated prop (public/props) that springs in and drifts, plus callout labels on its parts: a dot pops on the
 * part, a leader line draws out, then the label lands (staggered 10 frames apart).
 */
export function PngPropStage({ name, box, skin, callouts, frame, reduced, tilt = 0, delay = 6, labels = "sides" }: { name: string; box: Box; skin: PropSkin; callouts: string[]; frame: number; reduced: boolean; tilt?: number; delay?: number; labels?: LabelMode }) {
  const { fps } = useVideoConfig();
  const prop = pngPropByName(name);
  // "below-left" / "below-right": labels stack under the prop inside its column (solo shots, so they never cover a
  // face); "sides": labels sit left or right of the prop, on the side their part is on (two-shots)
  const n = prop ? callouts.filter((id) => prop.parts.some((p) => p.id === id)).length : 0;
  const reserve = labels === "sides" || !n ? 0 : n * LABEL_STEP + 14;
  const rect = containRect({ ...box, h: Math.max(140, box.h - reserve) }, prop?.aspect ?? 1);
  const pop = reduced ? 1 : spring({ frame: frame - delay, fps, config: { mass: 0.7, damping: 11, stiffness: 170 } });
  const driftY = reduced ? 0 : Math.sin(frame / 38) * 6;
  const driftR = reduced ? 0 : Math.sin(frame / 52) * 1.2;
  const k = STAGE_INK[skin];
  return (
    <>
      <div
        style={{
          position: "absolute",
          left: rect.x,
          top: rect.y,
          width: rect.w,
          height: rect.h,
          transform: `translateY(${driftY}px) rotate(${tilt + driftR}deg) scale(${0.55 + 0.45 * pop})`,
          opacity: Math.min(1, pop * 1.5),
          transformOrigin: "50% 60%",
          filter: skin === "paper" ? `drop-shadow(8px 8px 0 rgba(20,22,25,0.9))` : "drop-shadow(0 0 16px rgba(56,189,248,0.45))",
        }}
      >
        <Img src={staticFile(`props/${name}.png`)} style={{ width: "100%", height: "100%" }} />
      </div>
      {prop && n > 0 && <Callouts rect={rect} col={box} mode={labels} ids={callouts} prop={prop} k={k} skin={skin} frame={frame} reduced={reduced} driftY={driftY} />}
    </>
  );
}

export type LabelMode = "sides" | "below-left" | "below-right";
const LABEL_STEP = 62;

function Callouts({ rect, col, mode, ids, prop, k, skin, frame, reduced, driftY }: { rect: Box; col: Box; mode: LabelMode; ids: string[]; prop: NonNullable<ReturnType<typeof pngPropByName>>; k: StageInk; skin: PropSkin; frame: number; reduced: boolean; driftY: number }) {
  const size = 32;
  const parts = ids.map((id) => prop.parts.find((p) => p.id === id)).filter((p): p is NonNullable<typeof p> => Boolean(p));
  const placed = parts.map((p, i) => {
    const ax = rect.x + p.x * rect.w;
    const ay = rect.y + p.y * rect.h + driftY;
    const w = textWidth(p.label, size) + 34;
    if (mode !== "sides") {
      // stacked under the prop, flush with the column's outer edge
      const lx = mode === "below-left" ? col.x : col.x + col.w - w;
      return { p, i, ax, ay, w, lx, ly: rect.y + rect.h + 14 + i * LABEL_STEP };
    }
    // on the side of the prop the part is on, inside the safe zone
    const left = p.x < 0.5;
    const lx = Math.min(940 - w, Math.max(60, left ? rect.x - 26 - w : rect.x + rect.w + 26));
    return { p, i, ax, ay, w, lx, ly: ay - 28 };
  });
  if (mode === "sides") {
    placed.sort((a, b) => a.ly - b.ly);
    for (let j = 1; j < placed.length; j++) placed[j].ly = Math.max(placed[j].ly, placed[j - 1].ly + LABEL_STEP);
  }
  return (
    <svg width={1080} height={1920} style={{ position: "absolute", left: 0, top: 0, overflow: "visible" }} aria-hidden>
      {/* all leaders first, then dots and labels on top, so a leader never crosses over another label */}
      {(["lines", "labels"] as const).map((layer) => (
        <g key={layer}>
          {placed.map(({ p, i, ax, ay, w, lx, ly }) => {
            const t0 = 16 + i * 10;
            const dot = reduced ? 1 : interpolate(frame, [t0, t0 + 5], [0, 1], clamp);
            const draw = reduced ? 1 : interpolate(frame, [t0 + 3, t0 + 11], [0, 1], clamp);
            const lab = reduced ? 1 : interpolate(frame, [t0 + 9, t0 + 15], [0, 1], clamp);
            if (!dot) return null;
            // leader from the dot to the label (stacked labels: into the label's top, near its outer end)
            const below = mode !== "sides";
            const ex = below ? (mode === "below-left" ? lx + 18 : lx + w - 18) : lx + (lx + w / 2 < ax ? w : 0);
            const ey = below ? ly + 4 : ly + 28;
            if (layer === "lines") {
              return <line key={p.id} x1={ax} y1={ay} x2={ax + (ex - ax) * draw} y2={ay + (ey - ay) * draw} stroke={skin === "paper" ? INK : k.accent} strokeWidth={skin === "paper" ? 5 : 4} strokeLinecap="round" />;
            }
            return (
              <g key={p.id}>
                <circle cx={ax} cy={ay} r={11 * dot} fill={skin === "paper" ? k.hot : k.accent} stroke={skin === "paper" ? INK : "#0F172A"} strokeWidth={4} />
                {lab > 0 && (
                  <g transform={`translate(${lx} ${ly + (1 - lab) * 14})`} opacity={lab}>
                    <rect width={w} height={56} rx={skin === "paper" ? 4 : 2} fill={skin === "paper" ? "#FFE600" : "#0F172A"} stroke={skin === "paper" ? INK : k.accent} strokeWidth={skin === "paper" ? 5 : 3} />
                    <text x={w / 2} y={39} textAnchor="middle" fontFamily={skin === "paper" ? HEAVY : MONO} fontWeight={900} fontSize={size} fill={skin === "paper" ? INK : k.accent}>
                      {p.label}
                    </text>
                  </g>
                )}
              </g>
            );
          })}
        </g>
      ))}
    </svg>
  );
}

// ------------------------------------------------------------------ explainer cards
/** A card that springs in with a title bar, then draws its diagram. */
export function ExplainerCard({ kind, title, box, skin, frame, reduced }: { kind: Overlay; title: string; box: Box; skin: PropSkin; frame: number; reduced: boolean }) {
  const { fps } = useVideoConfig();
  const k = STAGE_INK[skin];
  const pop = reduced ? 1 : spring({ frame: frame - 8, fps, config: { mass: 0.6, damping: 12, stiffness: 190 } });
  if (pop <= 0.01) return null;
  const barH = 58;
  return (
    <div
      style={{
        position: "absolute",
        left: box.x,
        top: box.y,
        width: box.w,
        height: box.h,
        boxSizing: "border-box",
        background: k.fill,
        border: `${skin === "paper" ? 6 : 4}px solid ${k.line}`,
        boxShadow: skin === "paper" ? `10px 10px 0 ${INK}` : k.glow,
        transform: `rotate(${skin === "paper" ? -2 : 0}deg) scale(${0.7 + 0.3 * pop})`,
        opacity: Math.min(1, pop * 1.4),
        transformOrigin: "50% 50%",
        overflow: "hidden",
      }}
    >
      <div style={{ height: barH, display: "flex", alignItems: "center", gap: 12, padding: "0 16px", background: skin === "paper" ? INK : "rgba(56,189,248,0.16)", borderBottom: `3px solid ${k.line}` }}>
        <span style={{ fontFamily: MONO, fontWeight: 700, fontSize: 24, color: skin === "paper" ? "#FFE600" : k.accent, letterSpacing: 2 }}>{kind === "wave-graph" ? "GRAFIK" : "PSIKOLOGI"}</span>
        <span style={{ fontFamily: HEAVY, fontWeight: 900, fontSize: 30, color: skin === "paper" ? "#FFFFFF" : k.text, whiteSpace: "nowrap" }}>{title}</span>
      </div>
      <svg viewBox={`0 0 ${box.w} ${box.h - barH}`} width="100%" height={box.h - barH} aria-hidden style={{ display: "block" }}>
        {kind === "wave-graph" ? <WaveGraph w={box.w} h={box.h - barH - 12} k={k} skin={skin} frame={frame} reduced={reduced} /> : <BrainBadge w={box.w} h={box.h - barH - 12} k={k} skin={skin} frame={frame} reduced={reduced} />}
      </svg>
    </div>
  );
}

/** Two traces: a choppy "separate" line settling into one smooth "blended" wave as the beat goes on. */
function WaveGraph({ w, h, k, skin, frame, reduced }: { w: number; h: number; k: StageInk; skin: PropSkin; frame: number; reduced: boolean }) {
  const pad = 26;
  const mid = h / 2 + 6;
  const amp = h * 0.28;
  const draw = reduced ? 1 : interpolate(frame, [14, 40], [0, 1], clamp);
  const settle = reduced ? 1 : interpolate(frame, [20, 70], [0, 1], clamp);
  const phase = reduced ? 0 : frame / 7;
  const n = 48;
  const xs = Array.from({ length: n + 1 }, (_, i) => pad + ((w - 2 * pad) * i) / n);
  const visible = Math.max(2, Math.round((n + 1) * draw));
  const choppy = xs.slice(0, visible).map((x, i) => `${i ? "L" : "M"}${x.toFixed(1)} ${(mid - amp * 0.9 * (i % 2 ? 1 : -0.6) * (1 - 0.7 * settle) * Math.sin(i * 1.7 + 1)).toFixed(1)}`).join(" ");
  const smooth = xs.slice(0, visible).map((x, i) => `${i ? "L" : "M"}${x.toFixed(1)} ${(mid - amp * Math.sin((i / n) * Math.PI * 3 + phase) * (0.35 + 0.65 * settle)).toFixed(1)}`).join(" ");
  const axis = skin === "paper" ? INK : k.muted;
  return (
    <g>
      <line x1={pad} y1={mid} x2={w - pad} y2={mid} stroke={axis} strokeWidth={3} strokeDasharray="10 8" opacity={0.6} />
      <line x1={pad} y1={10} x2={pad} y2={h} stroke={axis} strokeWidth={4} />
      <path d={choppy} fill="none" stroke={k.hot} strokeWidth={5} strokeLinejoin="round" opacity={1 - 0.6 * settle} />
      <path d={smooth} fill="none" stroke={skin === "paper" ? "#2A6F7B" : k.line} strokeWidth={8} strokeLinecap="round" strokeLinejoin="round" />
    </g>
  );
}

/** A brain icon with a pulsing glow and little spark lines. */
function BrainBadge({ w, h, k, skin, frame, reduced }: { w: number; h: number; k: StageInk; skin: PropSkin; frame: number; reduced: boolean }) {
  const r = Math.min(w * 0.3, h * 0.42);
  const cx = w / 2;
  const cy = h / 2 + 8;
  const pulse = reduced ? 1 : 1 + 0.06 * Math.sin(frame / 5);
  const sparks = reduced ? 1 : interpolate(frame, [16, 26], [0, 1], clamp);
  const pink = "#F9A8D4";
  const stroke = skin === "paper" ? INK : k.line;
  const lobes = [
    [-0.45, -0.35, 0.5],
    [0.05, -0.5, 0.52],
    [0.5, -0.25, 0.48],
    [-0.55, 0.2, 0.46],
    [0, 0.12, 0.52],
    [0.52, 0.25, 0.44],
  ];
  return (
    <g transform={`translate(${cx} ${cy}) scale(${pulse})`}>
      {skin === "hud" && <circle r={r * 1.25} fill="rgba(56,189,248,0.12)" />}
      {lobes.map(([x, y, s], i) => (
        <circle key={`o${i}`} cx={x * r} cy={y * r} r={s * r} fill={stroke} />
      ))}
      {lobes.map(([x, y, s], i) => (
        <circle key={`i${i}`} cx={x * r} cy={y * r} r={s * r - 6} fill={pink} />
      ))}
      <path d={`M0 ${-r * 0.85} C${-r * 0.1} ${-r * 0.4} ${r * 0.1} ${-r * 0.1} 0 ${r * 0.5}`} fill="none" stroke={stroke} strokeWidth={5} strokeLinecap="round" />
      <path d={`M${-r * 0.7} ${-r * 0.1} C${-r * 0.4} ${-r * 0.3} ${-r * 0.3} 0 ${-r * 0.15} ${-r * 0.2} M${r * 0.65} 0 C${r * 0.4} ${-r * 0.2} ${r * 0.35} ${r * 0.15} ${r * 0.15} ${r * 0.05}`} fill="none" stroke={stroke} strokeWidth={4} strokeLinecap="round" />
      <path d={`M${-r * 0.15} ${r * 0.62} L${-r * 0.1} ${r * 0.95} L${r * 0.12} ${r * 0.95} L${r * 0.12} ${r * 0.62}`} fill={pink} stroke={stroke} strokeWidth={5} strokeLinejoin="round" />
      {[0, 1, 2, 3, 4].map((i) => {
        const a = -Math.PI / 2 + (i - 2) * 0.55;
        const r0 = r * 1.15;
        const r1 = r0 + r * 0.3 * sparks;
        return <line key={i} x1={Math.cos(a) * r0} y1={Math.sin(a) * r0} x2={Math.cos(a) * r1} y2={Math.sin(a) * r1} stroke={skin === "paper" ? "#D9381E" : k.accent} strokeWidth={7} strokeLinecap="round" />;
      })}
    </g>
  );
}

// ------------------------------------------------------------------ thought bubble
/**
 * A comic thought cloud over `box`, with three puffs trailing to `toward` (the thinker's head) and the line's prop
 * inset inside (or "…" when the line has none).
 */
export function ThoughtBubble({ box, toward, skin, frame, reduced, children }: { box: Box; toward: { x: number; y: number }; skin: PropSkin; frame: number; reduced: boolean; children?: React.ReactNode }) {
  const { fps } = useVideoConfig();
  const pop = reduced ? 1 : spring({ frame: frame - 4, fps, config: { mass: 0.6, damping: 12, stiffness: 160 } });
  const bob = reduced ? 0 : Math.sin(frame / 14) * 5;
  const fill = skin === "paper" ? "#FFFFFF" : "#1E293B";
  const stroke = skin === "paper" ? INK : "#38BDF8";
  const cx = box.x + box.w / 2;
  const cy = box.y + box.h / 2;
  const rx = box.w / 2;
  const ry = box.h / 2;
  // scalloped cloud: bumps around an ellipse
  const bumps = Array.from({ length: 11 }, (_, i) => {
    const a = (i / 11) * Math.PI * 2;
    return { x: cx + Math.cos(a) * rx * 0.8, y: cy + Math.sin(a) * ry * 0.78, r: Math.min(rx, ry) * (0.34 + (i % 3) * 0.05) };
  });
  // puffs from the bubble's edge toward the head
  const dx = toward.x - cx;
  const dy = toward.y - cy;
  const len = Math.hypot(dx, dy) || 1;
  const ex = cx + (dx / len) * rx * 0.95;
  const ey = cy + (dy / len) * ry * 0.95;
  const puffs = [0.28, 0.55, 0.8].map((t, i) => ({ x: ex + (toward.x - ex) * t, y: ey + (toward.y - ey) * t, r: 26 - i * 7 }));
  const s = 0.4 + 0.6 * pop;
  return (
    <div style={{ position: "absolute", inset: 0, transform: `translateY(${bob}px)`, opacity: Math.min(1, pop * 1.5) }}>
      <svg width={1080} height={1920} style={{ position: "absolute", left: 0, top: 0, overflow: "visible" }} aria-hidden>
        <g transform={`translate(${cx} ${cy}) scale(${s}) translate(${-cx} ${-cy})`} style={{ filter: skin === "hud" ? "drop-shadow(0 0 12px rgba(56,189,248,0.5))" : undefined }}>
          {puffs.map((p, i) => (
            <circle key={`p${i}`} cx={p.x} cy={p.y} r={p.r} fill={fill} stroke={stroke} strokeWidth={6} opacity={reduced ? 1 : interpolate(frame, [i * 3, i * 3 + 6], [0, 1], clamp)} />
          ))}
          {bumps.map((b, i) => (
            <circle key={`o${i}`} cx={b.x} cy={b.y} r={b.r + 6} fill={stroke} />
          ))}
          <ellipse cx={cx} cy={cy} rx={rx * 0.86 + 6} ry={ry * 0.84 + 6} fill={stroke} />
          {bumps.map((b, i) => (
            <circle key={`i${i}`} cx={b.x} cy={b.y} r={b.r} fill={fill} />
          ))}
          <ellipse cx={cx} cy={cy} rx={rx * 0.86} ry={ry * 0.84} fill={fill} />
        </g>
      </svg>
      <div style={{ position: "absolute", left: cx - rx * 0.62 * s, top: cy - ry * 0.6 * s, width: rx * 1.24 * s, height: ry * 1.2 * s, display: "flex", alignItems: "center", justifyContent: "center" }}>
        {children ?? <span style={{ fontFamily: HEAVY, fontWeight: 900, fontSize: 96 * s, color: stroke, letterSpacing: 6 }}>…</span>}
      </div>
    </div>
  );
}
