import "@fontsource/montserrat/800.css";
import React from "react";
import { interpolate } from "remotion";
import type { SubtitleChunk } from "../beats";
import { activeWord } from "./motion";

// Kinetic English subtitles: white text with a thick ink outline, no box, one 3–5 word chunk at a time, in the lower
// safe zone (x 60..940, y 1420..1520, centred on 1470): below every face, mouth, hand-held prop and the visual stage,
// and above the platforms' bottom controls and caption text. The word being spoken turns warm yellow (with a small
// lift) as the voice reaches it. Chunks are short (beats.ts): one line at 50 px, or two at 44 px, never clipped.

export const SUBTITLE_HIGHLIGHT = "#FFD43B";

export const SUBTITLE_BAND = { left: 60, width: 880, top: 1420, bottom: 1520 } as const;
const BAND = SUBTITLE_BAND;

export function MovieSubtitle({ chunks, frame, reduced, italic = false }: { chunks: SubtitleChunk[]; frame: number; reduced: boolean; italic?: boolean }) {
  const c = chunks.find((x) => frame >= x.startFrame && frame < x.endFrame);
  if (!c) return null;
  const local = frame - c.startFrame;
  const opacity = reduced ? 1 : interpolate(local, [0, 4], [0, 1], { extrapolateRight: "clamp" });
  const size = c.text.length > 40 ? 44 : 50;
  const active = activeWord(c, frame);
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
        {c.words.length
          ? c.words.map((w, i) => {
              // the highlight fades in over 2 frames and the word lifts 4 % as it's spoken
              const on = i === active;
              const k = on && !reduced ? interpolate(frame - w.startFrame, [0, 2], [0.4, 1], { extrapolateRight: "clamp" }) : on ? 1 : 0;
              return (
                <React.Fragment key={i}>
                  {i > 0 && " "}
                  <span style={{ display: "inline-block", color: on ? mix(k) : "#FFFFFF", transform: on && !reduced ? `translateY(${-3 * k}px) scale(${1 + 0.04 * k})` : undefined }}>{w.text}</span>
                </React.Fragment>
              );
            })
          : c.text}
      </div>
    </div>
  );
}

/** white → highlight yellow, k 0..1 */
function mix(k: number) {
  const from = [255, 255, 255];
  const to = [0xff, 0xd4, 0x3b];
  return `rgb(${from.map((v, i) => Math.round(v + (to[i] - v) * k)).join(",")})`;
}
