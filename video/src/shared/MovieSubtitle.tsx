import "@fontsource/montserrat/800.css";
import React from "react";
import { interpolate } from "remotion";
import type { SubtitleChunk } from "../beats";

// Movie-style English subtitles: white text with a thick ink outline, no box, one timed chunk at a time, in the lower
// safe zone (x 60..940, y 1420..1520, centred on 1470): below every face, mouth, hand-held prop and the visual stage,
// and above the platforms' bottom controls and caption text. Chunks are at most ~52 characters (beats.ts): one line
// at 50 px, or two lines at 44 px (≈ 99 px), so nothing is ever clipped with "…".

export const SUBTITLE_BAND = { left: 60, width: 880, top: 1420, bottom: 1520 } as const;
const BAND = SUBTITLE_BAND;

export function MovieSubtitle({ chunks, frame, reduced, italic = false }: { chunks: SubtitleChunk[]; frame: number; reduced: boolean; italic?: boolean }) {
  const c = chunks.find((x) => frame >= x.startFrame && frame < x.endFrame);
  if (!c) return null;
  const local = frame - c.startFrame;
  const opacity = reduced ? 1 : interpolate(local, [0, 4], [0, 1], { extrapolateRight: "clamp" });
  const size = c.text.length > 40 ? 44 : 50;
  return (
    <div
      style={{
        position: "absolute",
        left: BAND.left,
        width: BAND.width,
        top: BAND.top,
        height: BAND.bottom - BAND.top,
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        pointerEvents: "none",
      }}
    >
      <div
        style={{
          fontFamily: "Montserrat, 'Arial Black', sans-serif",
          fontWeight: 800,
          fontStyle: italic ? "italic" : "normal",
          fontSize: size,
          lineHeight: 1.12,
          textAlign: "center",
          color: "#FFFFFF",
          WebkitTextStroke: `9px #141619`,
          letterSpacing: 0.5,
          paintOrder: "stroke fill",
          textShadow: "0 4px 0 #141619",
          overflowWrap: "anywhere",
          opacity,
        }}
      >
        {c.text}
      </div>
    </div>
  );
}
