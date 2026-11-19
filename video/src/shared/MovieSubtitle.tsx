import "@fontsource/montserrat/800.css";
import React from "react";
import { interpolate } from "remotion";
import type { SubtitleChunk } from "../beats";

// Movie-style English subtitles: white text with a thick ink outline, no box, one timed chunk at a time, inside the
// lower TikTok safe band (x 60..940, y 1120..1250). Chunks are at most ~52 characters (beats.ts), which fits two
// lines at these sizes, so nothing is ever clipped with "…".

const BAND = { left: 60, width: 880, top: 1120, bottom: 1250 } as const;

export function MovieSubtitle({ chunks, frame, reduced }: { chunks: SubtitleChunk[]; frame: number; reduced: boolean }) {
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
        alignItems: "flex-end",
        justifyContent: "center",
        pointerEvents: "none",
      }}
    >
      <div
        style={{
          fontFamily: "Montserrat, 'Arial Black', sans-serif",
          fontWeight: 800,
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
