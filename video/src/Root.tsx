import React from "react";
import { Composition } from "remotion";
import { Episode } from "./Episode";
import { END_FRAMES, FPS, GAP_FRAMES, HEIGHT, WIDTH, type EpisodeProps } from "./types";

const sample: EpisodeProps = {
  title: "Preview",
  lines: [
    { index: 0, beat: "hook", speaker: "ocu", text: "", subtitle: "A sample line from Ocu, calm and deadpan.", expression: "deadpan", on_screen_text: "CONTOH", hasAudio: false, audio: null, frames: 90, envelope: [] },
    { index: 1, beat: "counter", speaker: "uco", text: "", subtitle: "And Uco, loud and angry about it!", expression: "angry", hasAudio: false, audio: null, frames: 90, envelope: [] },
    { index: 2, beat: "concession", speaker: "uco", text: "", subtitle: "Dammit, that actually makes sense. Don't tell him.", expression: "thinking", thought_bubble: true, hasAudio: false, audio: null, frames: 90, envelope: [] },
    { index: 3, beat: "button", speaker: "ocu", text: "", subtitle: "Extra ice. The dose has to be right.", expression: "deadpan", on_screen_text: "Tulis di komen.", hasAudio: false, audio: null, frames: 60, envelope: [] },
  ],
};

export function Root() {
  return (
    <Composition
      id="Episode"
      component={Episode}
      fps={FPS}
      width={WIDTH}
      height={HEIGHT}
      durationInFrames={300}
      defaultProps={sample}
      calculateMetadata={({ props }) => ({
        durationInFrames: props.lines.reduce((s, l) => s + l.frames + GAP_FRAMES, 0) + END_FRAMES,
      })}
    />
  );
}
