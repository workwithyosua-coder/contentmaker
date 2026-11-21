import React, { useState } from "react";
import { Img, interpolate, spring, useVideoConfig } from "remotion";
import { propFile } from "../assets";
import { assetSrc } from "../assets/src";
import type { BeatStat, Overlay } from "../beats";
import { HEAVY, MONO, textWidth, wrapHeadline } from "../cast/CueShared";
import { pngPropByName } from "../props/library";
import { PROP_SHADOW, PROP_SPRING, type Box, type PropSkin } from "./PropStage";

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
export function KineticText({ text, box, skin, frame: rawFrame, reduced, align = "center", at = 10 }: { text: string; box: Box; skin: PropSkin; frame: number; reduced: boolean; align?: "left" | "center" | "right"; /** frame the callout lands on (the voice onset) */ at?: number }) {
  // every animation below was drawn for a landing at frame 10; shift the clock so it lands at `at`
  const frame = rawFrame - at + 10;
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
  const src = assetSrc(propFile(name));
  const [failed, setFailed] = useState(false);
  // "below-left" / "below-right": labels stack under the prop inside its column (solo shots, so they never cover a
  // face); "sides": labels sit left or right of the prop, on the side their part is on (two-shots)
  const n = prop ? callouts.filter((id) => prop.parts.some((p) => p.id === id)).length : 0;
  const reserve = labels === "sides" || !n ? 0 : n * LABEL_STEP + 14;
  const rect = containRect({ ...box, h: Math.max(140, box.h - reserve) }, prop?.aspect ?? 1);
  // pops in on a snappy spring at `delay` (the keyword, synced with the pop sound), then floats ±4 px
  const pop = reduced ? 1 : spring({ frame: frame - delay, fps, config: PROP_SPRING });
  const driftY = reduced ? 0 : Math.sin((frame - delay) / 20) * 4;
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
          transform: `translateY(${driftY}px) rotate(${tilt + driftR}deg) scale(${0.3 + 0.7 * pop})`,
          opacity: Math.min(1, pop * 2),
          transformOrigin: "50% 60%",
          filter: PROP_SHADOW[skin],
        }}
      >
        {src && !failed && (
          // an uploaded prop that can't be loaded (expired link, deleted file) drops out instead of failing the render
          <Img src={src} maxRetries={2} onError={() => setFailed(true)} style={{ width: "100%", height: "100%", objectFit: "contain" }} />
        )}
      </div>
      {prop && n > 0 && <Callouts rect={rect} col={box} mode={labels} ids={callouts} prop={prop} k={k} skin={skin} frame={frame - delay} reduced={reduced} driftY={driftY} />}
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
            // `frame` counts from the prop's entrance: labels follow 10 frames after it lands, 10 frames apart
            const t0 = 10 + i * 10;
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
/**
 * A card that springs in with a title bar, then keeps moving for the whole beat: the graph's bars rise and its wave
 * settles toward the beat's midpoint; the brain pulses while ENDORFIN / DOPAMIN chips float up out of it.
 */
export function ExplainerCard({ kind, title, box, skin, frame, reduced, duration = 90 }: { kind: Overlay; title: string; box: Box; skin: PropSkin; frame: number; reduced: boolean; duration?: number }) {
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
        {kind === "wave-graph" ? (
          <WaveGraph w={box.w} h={box.h - barH - 12} k={k} skin={skin} frame={frame} reduced={reduced} mid={Math.max(30, duration / 2)} />
        ) : (
          <BrainBadge w={box.w} h={box.h - barH - 12} k={k} skin={skin} frame={frame} reduced={reduced} mid={Math.max(30, duration / 2)} title={title} />
        )}
      </svg>
    </div>
  );
}

/** Two traces: a choppy "separate" line settling into one smooth "blended" wave as the beat goes on. */
function WaveGraph({ w, h, k, skin, frame, reduced, mid: beatMid }: { w: number; h: number; k: StageInk; skin: PropSkin; frame: number; reduced: boolean; mid: number }) {
  const pad = 26;
  const mid = h / 2 + 6;
  const amp = h * 0.28;
  const draw = reduced ? 1 : interpolate(frame, [14, 40], [0, 1], clamp);
  // the wave calms into one smooth blend by the beat's midpoint
  const settle = reduced ? 1 : interpolate(frame, [20, Math.max(40, beatMid)], [0, 1], clamp);
  // three bars behind the trace rise one after another, reaching full height at the midpoint, then breathe
  const bars = [0.42, 0.66, 0.92].map((target, i) => {
    const t0 = 16 + i * 8;
    const grow = reduced ? 1 : interpolate(frame, [t0, Math.max(t0 + 12, beatMid - (2 - i) * 4)], [0, 1], { ...clamp, easing: (x: number) => 1 - Math.pow(1 - x, 3) });
    const breathe = reduced || frame < beatMid ? 0 : Math.sin((frame - beatMid) / 9 + i) * 0.03;
    return { h: (h - 24) * target * grow * (1 + breathe), x: pad + 30 + i * ((w - 2 * pad - 60) / 3) };
  });
  const bw = (w - 2 * pad - 60) / 3 - 22;
  const phase = reduced ? 0 : frame / 7;
  const n = 48;
  const xs = Array.from({ length: n + 1 }, (_, i) => pad + ((w - 2 * pad) * i) / n);
  const visible = Math.max(2, Math.round((n + 1) * draw));
  const choppy = xs.slice(0, visible).map((x, i) => `${i ? "L" : "M"}${x.toFixed(1)} ${(mid - amp * 0.9 * (i % 2 ? 1 : -0.6) * (1 - 0.7 * settle) * Math.sin(i * 1.7 + 1)).toFixed(1)}`).join(" ");
  const smooth = xs.slice(0, visible).map((x, i) => `${i ? "L" : "M"}${x.toFixed(1)} ${(mid - amp * Math.sin((i / n) * Math.PI * 3 + phase) * (0.35 + 0.65 * settle)).toFixed(1)}`).join(" ");
  const axis = skin === "paper" ? INK : k.muted;
  return (
    <g>
      {bars.map((b, i) => (
        <rect key={i} x={b.x} y={h - b.h} width={bw} height={b.h} fill={skin === "paper" ? "#FFE600" : "rgba(245,158,11,0.28)"} stroke={skin === "paper" ? INK : k.accent} strokeWidth={skin === "paper" ? 4 : 2} opacity={skin === "paper" ? 0.85 : 1} />
      ))}
      <line x1={pad} y1={mid} x2={w - pad} y2={mid} stroke={axis} strokeWidth={3} strokeDasharray="10 8" opacity={0.6} />
      <line x1={pad} y1={10} x2={pad} y2={h} stroke={axis} strokeWidth={4} />
      <path d={choppy} fill="none" stroke={k.hot} strokeWidth={5} strokeLinejoin="round" opacity={1 - 0.6 * settle} />
      <path d={smooth} fill="none" stroke={skin === "paper" ? "#2A6F7B" : k.line} strokeWidth={8} strokeLinecap="round" strokeLinejoin="round" />
    </g>
  );
}

/** A brain icon with a pulsing glow and little spark lines. */
function BrainBadge({ w, h, k, skin, frame, reduced, mid, title }: { w: number; h: number; k: StageInk; skin: PropSkin; frame: number; reduced: boolean; mid: number; title: string }) {
  const r = Math.min(w * 0.26, h * 0.36);
  const cx = w / 2;
  const cy = h / 2 + 22;
  // a heartbeat: two quick beats then a rest, getting stronger toward the beat's midpoint
  const strength = reduced ? 0 : 0.04 + 0.05 * interpolate(frame, [10, mid], [0, 1], clamp);
  const beatPhase = frame % 24;
  const pulse = reduced ? 1 : 1 + strength * (beatPhase < 4 ? Math.sin((beatPhase / 4) * Math.PI) : beatPhase >= 6 && beatPhase < 10 ? 0.6 * Math.sin(((beatPhase - 6) / 4) * Math.PI) : 0);
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
  // chemical chips float up out of the brain, released one by one up to the midpoint
  const named = title.toUpperCase().replace(/[^A-Z]/g, "");
  const chems = [...new Set([named === "ENDORFIN" || named === "DOPAMIN" || named === "SEROTONIN" ? named : null, "ENDORFIN", "DOPAMIN"].filter((c): c is string => Boolean(c)))].slice(0, 2);
  // each chip rises on its own side of the brain, kept inside the card
  const chipX = (c: string, i: number) => {
    const half = (c.length * 21 + 28) / 2;
    return Math.min(w - half - 8, Math.max(half + 8, cx + (i ? 1 : -1) * r * 0.9));
  };
  const chips = reduced
    ? chems.map((c, i) => ({ c, y: cy - r * (1.1 - i * 0.5), x: chipX(c, i), o: 1 }))
    : chems.flatMap((c, i) => {
        const period = 44;
        const first = 14 + i * Math.max(8, (mid - 14) / 3);
        if (frame < first) return [];
        const t = ((frame - first) % period) / period;
        return [{ c, x: chipX(c, i) + Math.sin((frame + i * 20) / 8) * 5, y: cy - r * 0.3 - t * (cy - r * 0.3 - 26), o: t < 0.15 ? t / 0.15 : t > 0.75 ? (1 - t) / 0.25 : 1 }];
      });
  return (
    <g>
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
    {chips.map(({ c, x, y, o }) => (
      <g key={c} transform={`translate(${x} ${y})`} opacity={o}>
        <rect x={-c.length * 10.5 - 14} y={-22} width={c.length * 21 + 28} height={40} rx={20} fill={skin === "paper" ? "#FFE600" : "#0F172A"} stroke={skin === "paper" ? INK : k.accent} strokeWidth={4} />
        <text y={10} textAnchor="middle" fontFamily={HEAVY} fontWeight={900} fontSize={26} fill={skin === "paper" ? INK : k.accent}>
          {c}
        </text>
      </g>
    ))}
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

// ------------------------------------------------------------------ evidence takeover
/**
 * Evidence Takeover hero: a framed stage centre screen (70 % of the canvas width) that springs in as the voice starts
 * and pushes in slowly (1.00 → 1.05) for the whole beat. `children` draws the prop in canvas coordinates inside
 * `propBox`; the stat card (a bold headline over a subline) sits at the bottom of the frame, or fills it alone.
 */
export function EvidenceStage({
  hero,
  skin,
  frame,
  duration,
  at,
  stat,
  callout = null,
  reduced,
  children,
}: {
  /** the line's on-screen callout, stamped across the top edge of the frame as the voice starts */
  callout?: string | null;
  hero: Box;
  skin: PropSkin;
  frame: number;
  duration: number;
  at: number;
  stat: BeatStat | null;
  reduced: boolean;
  children?: (propBox: Box) => React.ReactNode;
}) {
  const { fps } = useVideoConfig();
  const pop = reduced ? 1 : spring({ frame: frame - at, fps, config: { mass: 0.55, damping: 11, stiffness: 210 } });
  const zoom = reduced ? 1 : interpolate(frame, [at, Math.max(at + 1, duration)], [1, 1.05], clamp);
  const k = STAGE_INK[skin];
  const paper = skin === "paper";
  const pad = 26;
  const statH = stat ? (children ? 200 : hero.h - 2 * pad) : 0;
  const propBox: Box = { x: hero.x + pad, y: hero.y + pad, w: hero.w - 2 * pad, h: hero.h - 2 * pad - (stat ? statH + 18 : 0) };
  const statBox: Box = { x: hero.x + pad, y: hero.y + hero.h - pad - statH, w: hero.w - 2 * pad, h: statH };
  // the headline wraps (2 lines under a prop, 3 alone) rather than shrinking to one tiny line
  const head = stat ? statWrap(stat.headline, statBox.w - 48, children ? 64 : 132, children ? 2 : 3) : null;
  const sub = stat?.subline ? statWrap(stat.subline, statBox.w - 48, children ? 36 : 56, 2) : null;
  return (
    <div
      style={{
        position: "absolute",
        inset: 0,
        transform: `scale(${(0.6 + 0.4 * pop) * zoom})`,
        transformOrigin: `${hero.x + hero.w / 2}px ${hero.y + hero.h / 2}px`,
        opacity: Math.min(1, pop * 1.6),
      }}
    >
      <div
        style={{
          position: "absolute",
          left: hero.x,
          top: hero.y,
          width: hero.w,
          height: hero.h,
          boxSizing: "border-box",
          background: paper ? "#FFFDF6" : "rgba(15,23,42,0.92)",
          border: paper ? `8px solid ${INK}` : `4px solid ${k.line}`,
          boxShadow: paper ? `14px 14px 0 ${INK}` : `${k.glow}, inset 0 0 0 2px rgba(56,189,248,0.25)`,
          borderRadius: paper ? 6 : 4,
        }}
      />
      {children && propBox.h > 120 && children(propBox)}
      {stat && (
        <div
          style={{
            position: "absolute",
            left: statBox.x,
            top: statBox.y,
            width: statBox.w,
            height: statBox.h,
            boxSizing: "border-box",
            display: "flex",
            flexDirection: "column",
            alignItems: "center",
            justifyContent: "center",
            gap: 6,
            background: paper ? "#D9381E" : "#0B1222",
            border: paper ? `6px solid ${INK}` : `3px solid ${k.accent}`,
            color: paper ? "#FFFFFF" : k.accent,
            textAlign: "center",
            padding: "10px 20px",
          }}
        >
          {head!.lines.map((l, i) => (
            <div key={`h${i}`} style={{ fontFamily: HEAVY, fontWeight: 900, fontSize: head!.size, lineHeight: 1.02, letterSpacing: 1, whiteSpace: "nowrap" }}>
              {l}
            </div>
          ))}
          {sub &&
            sub.lines.map((l, i) => (
              <div key={`s${i}`} style={{ fontFamily: HEAVY, fontWeight: 900, fontSize: sub.size, lineHeight: 1.08, letterSpacing: 0.5, whiteSpace: "nowrap", color: paper ? "#FFE600" : k.text, marginTop: i ? 0 : 6 }}>
                {l}
              </div>
            ))}
        </div>
      )}
      {callout && (
        <KineticText text={callout} box={{ x: hero.x - 20, y: hero.y - 66, w: hero.w + 40, h: 120 }} skin={skin} frame={frame} reduced={reduced} align="center" at={at} />
      )}
    </div>
  );
}

/** Largest size (≤ max, ≥ 24) at which `text` wraps into at most `maxLines` lines that each fit `w` px. */
export function statWrap(text: string, w: number, max: number, maxLines: number): { size: number; lines: string[] } {
  const t = text.toUpperCase();
  for (let size = max; size >= 24; size -= 2) {
    const lines = wrapHeadline(t, size, w);
    if (lines.length <= maxLines && lines.every((l) => textWidth(l, size) <= w)) return { size, lines };
  }
  return { size: 24, lines: wrapHeadline(t, 24, w).slice(0, maxLines) };
}
