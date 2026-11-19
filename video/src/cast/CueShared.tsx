import "@fontsource/montserrat/800.css";
import "@fontsource/montserrat/900.css";
import "@fontsource/jetbrains-mono/400.css";
import "@fontsource/jetbrains-mono/700.css";
import React from "react";
import { Audio, Sequence, staticFile } from "remotion";
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
