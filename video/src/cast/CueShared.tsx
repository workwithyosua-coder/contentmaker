import "@fontsource/montserrat/800.css";
import "@fontsource/montserrat/900.css";
import "@fontsource/jetbrains-mono/400.css";
import "@fontsource/jetbrains-mono/700.css";
import React from "react";
import { Audio, Easing, Sequence, interpolate, staticFile } from "remotion";
import { CAST_VIEW, OCU_FINGERTIP } from "./CastSvg";
import { SAFE_ZONE, type Beat } from "../beats";
import type { EpisodeLine } from "../types";

// Shared by the cue-based styles (Koran Kinetik, Diagram Taktis).

export const HEAVY = "Montserrat, 'Arial Black', sans-serif";
export const MONO = "'JetBrains Mono', ui-monospace, monospace";

/** Width/height of the safe frame; children are laid out in these coordinates (0,0 = x 60, y 250 on the canvas). */
export const FRAME_W = SAFE_ZONE.right - SAFE_ZONE.left; // 880
export const FRAME_H = SAFE_ZONE.bottom - SAFE_ZONE.top; // 1010
/** TikTok "+ Follow" target in safe-frame coordinates. */
export const FOLLOW = { x: SAFE_ZONE.followX - SAFE_ZONE.left, y: SAFE_ZONE.followY - SAFE_ZONE.top }; // (860, 530)

/**
 * Everything that is text or a focal point renders inside this box and is clipped to it, so nothing (even mid
 * transition) can land under TikTok's top bar, right-hand buttons or caption area: x 60..940, y 250..1260.
 */
export function SafeFrame({ children }: { children: React.ReactNode }) {
  return (
    <div
      style={{
        position: "absolute",
        left: SAFE_ZONE.left,
        top: SAFE_ZONE.top,
        width: FRAME_W,
        height: FRAME_H,
        overflow: "hidden",
      }}
    >
      {children}
    </div>
  );
}

/** Each line's voice at its beat's start (same timing as every other style). */
export function VoiceTrack({ lines, beats }: { lines: EpisodeLine[]; beats: Beat[] }) {
  return (
    <>
      {lines.map((l, i) =>
        l.audio ? (
          <Sequence key={`a${i}`} from={beats[i].startFrame} durationInFrames={l.frames} layout="none" name={`voice ${i + 1}`}>
            <Audio src={/^(https?:|blob:|\/)/.test(l.audio) ? l.audio : staticFile(l.audio)} trimBefore={l.trimFrom ?? 0} />
          </Sequence>
        ) : null,
      )}
    </>
  );
}

/** Headline size from its length, so 5 words fit the card in at most 3 lines (≈ 250 px tall at most). */
export function headlineSize(text: string) {
  const n = text.length;
  return n <= 14 ? 100 : n <= 22 ? 88 : n <= 30 ? 78 : 66;
}


/** Arrow from (x1,y1) toward the Follow target, drawn up to `progress` (0..1). Safe-frame coordinates. */
export function FollowArrow({ from, color, outline, progress, width = 14 }: { from: { x: number; y: number }; color: string; outline: string; progress: number; width?: number }) {
  const to = { x: FOLLOW.x - 26, y: FOLLOW.y };
  const x = from.x + (to.x - from.x) * progress;
  const y = from.y + (to.y - from.y) * progress;
  const ang = Math.atan2(to.y - from.y, to.x - from.x);
  const head = 34;
  const p1 = { x: x - head * Math.cos(ang - 0.5), y: y - head * Math.sin(ang - 0.5) };
  const p2 = { x: x - head * Math.cos(ang + 0.5), y: y - head * Math.sin(ang + 0.5) };
  const d = `M${from.x} ${from.y} L${x} ${y}`;
  const headD = `M${p1.x} ${p1.y} L${x} ${y} L${p2.x} ${p2.y}`;
  return (
    <svg width={FRAME_W} height={FRAME_H} style={{ position: "absolute", left: 0, top: 0, overflow: "visible" }} aria-hidden>
      <path d={d} stroke={outline} strokeWidth={width + 8} strokeLinecap="round" fill="none" />
      <path d={headD} stroke={outline} strokeWidth={width + 8} strokeLinecap="round" strokeLinejoin="round" fill="none" />
      <path d={d} stroke={color} strokeWidth={width} strokeLinecap="round" fill="none" />
      <path d={headD} stroke={color} strokeWidth={width} strokeLinecap="round" strokeLinejoin="round" fill="none" />
    </svg>
  );
}

/** Small target ring on the Follow button position (kept inside the safe frame). */
export function FollowTarget({ color, scale }: { color: string; scale: number }) {
  const r = 16;
  return (
    <div
      aria-hidden
      style={{
        position: "absolute",
        left: FOLLOW.x - r,
        top: FOLLOW.y - r,
        width: r * 2,
        height: r * 2,
        borderRadius: 9999,
        border: `5px solid ${color}`,
        transform: `scale(${scale})`,
        boxSizing: "border-box",
      }}
    />
  );
}

// ------------------------------------------------------------------ portrait cast stage (both cue styles)
// Legacy layout (the old headline-card styles): characters from just under the card down to y 1620.
// Only bodies run below TikTok's caption line (y 1260); faces, eyes and mouths always stay above it, and all text
// (card, subtitle, CTA) stays inside the safe frame on top of the characters.

export const CAST_BOTTOM = 1620;
/** Gap between the headline card and the top of the characters' hair. */
export const CAST_GAP = 28;
/** Where Ocu's fingertip ends up in the CTA pose (canvas x); the arrow runs from there to + Follow (920, 780). */
const TIP_X = 815;

/** Montserrat 900 glyph widths in em, measured in Chromium (unknown characters count as 0.9 em). */
const GLYPH_EM: Record<string, number> = { "0": 0.69, "1": 0.42, "2": 0.61, "3": 0.61, "4": 0.71, "5": 0.62, "6": 0.66, "7": 0.65, "8": 0.68, "9": 0.66, "A": 0.81, "B": 0.77, "C": 0.74, "D": 0.83, "E": 0.67, "F": 0.64, "G": 0.77, "H": 0.8, "I": 0.35, "J": 0.57, "K": 0.77, "L": 0.62, "M": 0.95, "N": 0.8, "O": 0.85, "P": 0.74, "Q": 0.85, "R": 0.75, "S": 0.66, "T": 0.65, "U": 0.78, "V": 0.79, "W": 1.21, "X": 0.76, "Y": 0.71, "Z": 0.69, " ": 0.3, ".": 0.3, ",": 0.3, "!": 0.31, "?": 0.61, ":": 0.3, ";": 0.3, "%": 0.92, "&": 0.78, "=": 0.62, "+": 0.62, "-": 0.39, "/": 0.44, "(": 0.38, ")": 0.38, "'": 0.25, "\"": 0.49, "#": 0.74, "@": 1.04, "\u00d7": 0.62, "\u00c9": 0.67, "\u00c8": 0.67, "\u00c0": 0.81 };
/** Text width in px at `size`, with 4% headroom so our line breaks are never later than the browser's would be. */
export const textWidth = (t: string, size: number) => [...t].reduce((a, c) => a + (GLYPH_EM[c] ?? GLYPH_EM[c.toUpperCase()] ?? 0.9), 0) * size * 1.04;

/**
 * Wraps a headline into lines that fit `width` px. Breaking ourselves (instead of letting the browser wrap) makes
 * the card's height exact, so the characters can start right under it without ever touching it.
 */
export function wrapHeadline(text: string, size: number, width: number): string[] {
  const words = text.trim().split(/\s+/).filter(Boolean);
  const lines: string[] = [];
  let cur = "";
  for (const word of words) {
    const next = cur ? `${cur} ${word}` : word;
    if (cur && textWidth(next, size) > width) {
      lines.push(cur);
      cur = word;
    } else cur = next;
  }
  if (cur) lines.push(cur);
  return lines.length ? lines : [""];
}

export type CastLayout = { s: number; top: number; uco: number; ocu: number; tip: { x: number; y: number } };

/**
 * Positions for the two figures (centre x on the canvas), their scale and Ocu's fingertip. In the CTA stinger the
 * pair slides left over 10 frames so Ocu's raised hand sits just left of the + Follow button.
 */
export function castLayout({ cardBottom, cta, frame, reduced }: { cardBottom: number; cta: boolean; frame: number; reduced: boolean }): CastLayout {
  const top = cardBottom + CAST_GAP;
  const s = (CAST_BOTTOM - top) / CAST_VIEW.height;
  const normal = { uco: 290, ocu: 790 };
  const ocuCta = TIP_X - (OCU_FINGERTIP.x - 90) * s;
  // Uco's body ends at x 158 of 180, Ocu's starts at 20: keep 12 px between them
  const ucoCta = Math.min(normal.uco, ocuCta - (158 - 90) * s - (90 - 20) * s - 12);
  const k = !cta ? 0 : reduced ? 1 : interpolate(frame, [0, 10], [0, 1], { extrapolateLeft: "clamp", extrapolateRight: "clamp", easing: Easing.out(Easing.cubic) });
  const uco = normal.uco + (ucoCta - normal.uco) * k;
  const ocu = normal.ocu + (ocuCta - normal.ocu) * k;
  return { s, top, uco, ocu, tip: { x: ocu + (OCU_FINGERTIP.x - 90) * s, y: top + OCU_FINGERTIP.y * s } };
}

/** One figure on the canvas: `cx` is its centre line, `top` its top edge, `s` the scale of the 180×340 drawing. */
export function CastFigure({ cx, top, s, transform, dim = 0, children }: { cx: number; top: number; s: number; transform?: string; dim?: number; children: React.ReactNode }) {
  return (
    <div
      style={{
        position: "absolute",
        left: cx - (CAST_VIEW.width / 2) * s,
        top,
        width: CAST_VIEW.width * s,
        height: CAST_VIEW.height * s,
        // listeners are dimmed (not made transparent, so the background never shows through them)
        filter: dim ? `brightness(${1 - dim}) saturate(${1 - dim / 2})` : undefined,
        transform,
        transformOrigin: "50% 30%",
      }}
    >
      {children}
    </div>
  );
}

/** Canvas point → safe-frame coordinates (what SafeFrame children use). */
export const toFrame = (p: { x: number; y: number }) => ({ x: p.x - SAFE_ZONE.left, y: p.y - SAFE_ZONE.top });
