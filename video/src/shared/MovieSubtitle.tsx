import "@fontsource/montserrat/800.css";
import React from "react";
import { AbsoluteFill, interpolate, useCurrentFrame } from "remotion";
import type { Beat, SubtitleChunk } from "../beats";
import { SUBTITLE_BAND, activeWord, subtitleLayout, subtitleVisible } from "./motion";

// Kinetic English subtitles in the true lower safe zone (x 60..940, y 1540..1630): under both characters' hands and
// folded arms, above the platforms' bottom controls and caption text. One 3–5 word chunk at a time on a compact dark
// pill, over a soft dark scrim along the bottom of the frame, so white text and the warm-yellow spoken word stay
// readable on the paper and HUD styles alike. A chunk never shows before the voice starts, nor while its beat is
// still whipping in over the previous one.

export { SUBTITLE_BAND };
export const SUBTITLE_HIGHLIGHT = "#FFD43B";
const PILL = "rgba(11, 17, 32, 0.86)";

/** A soft dark gradient along the bottom of the frame, behind the subtitle pill. */
export function SubtitleScrim() {
  return (
    <AbsoluteFill
      style={{
        pointerEvents: "none",
        top: SUBTITLE_BAND.top - 260,
        background: "linear-gradient(to bottom, rgba(10, 15, 28, 0) 0%, rgba(10, 15, 28, 0.8) 100%)",
      }}
    />
  );
}

/** The beat's subtitle at the current frame (inside the beat's Sequence). */
export function BeatSubtitle({ beat, reduced, cutDir }: { beat: Beat; reduced: boolean; cutDir: -1 | 0 | 1 }) {
  const frame = useCurrentFrame();
  if (!subtitleVisible(beat, frame, cutDir)) return null;
  return <MovieSubtitle chunks={beat.subtitleChunks} frame={frame} reduced={reduced} italic={beat.thought} />;
}

export function MovieSubtitle({ chunks, frame, reduced, italic = false }: { chunks: SubtitleChunk[]; frame: number; reduced: boolean; italic?: boolean }) {
  const c = chunks.find((x) => frame >= x.startFrame && frame < x.endFrame);
  if (!c) return null;
  const local = frame - c.startFrame;
  const opacity = reduced ? 1 : interpolate(local, [0, 3], [0, 1], { extrapolateRight: "clamp" });
  const { size, lines, pill } = subtitleLayout(c.text);
  const active = activeWord(c, frame);
  // words of each wrapped line, in order, so the highlight follows across a line break
  let w = 0;
  const rows = lines.map((l) => l.split(" ").map(() => c.words[w++] ?? null));
  return (
    <div
      style={{
        position: "absolute",
        left: pill.x,
        top: pill.y,
        width: pill.w,
        height: pill.h,
        boxSizing: "border-box",
        borderRadius: 14,
        background: PILL,
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        justifyContent: "center",
        pointerEvents: "none",
        opacity,
        fontFamily: "Montserrat, 'Arial Black', sans-serif",
        fontWeight: 800,
        fontStyle: italic ? "italic" : "normal",
        fontSize: size,
        lineHeight: 1.12,
        color: "#FFFFFF",
        letterSpacing: 0.3,
        whiteSpace: "nowrap",
      }}
    >
      {rows.map((row, r) => (
        <div key={r}>
          {row.map((word, i) => {
            const idx = word ? c.words.indexOf(word) : -1;
            const on = idx === active && idx >= 0;
            // the highlight fades in over 2 frames as the word is spoken
            const k = on && !reduced && word ? interpolate(frame - word.startFrame, [0, 2], [0.4, 1], { extrapolateRight: "clamp" }) : on ? 1 : 0;
            return (
              <React.Fragment key={i}>
                {i > 0 && " "}
                <span style={{ color: on ? mix(k) : "#FFFFFF" }}>{word?.text ?? lines[r].split(" ")[i]}</span>
              </React.Fragment>
            );
          })}
        </div>
      ))}
    </div>
  );
}

/** white → highlight yellow, k 0..1 */
function mix(k: number) {
  const from = [255, 255, 255];
  const to = [0xff, 0xd4, 0x3b];
  return `rgb(${from.map((v, i) => Math.round(v + (to[i] - v) * k)).join(",")})`;
}
