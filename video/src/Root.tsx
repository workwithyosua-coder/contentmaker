import React from "react";
import { Composition } from "remotion";
import { KoranKinetik } from "./koran/KoranKinetik";
import { DiagramTaktis } from "./taktis/DiagramTaktis";
import { Episode } from "./Episode";
import { ComicEpisode } from "./comic/ComicEpisode";
import { LipstickEffect } from "./lipstick/LipstickEffect";
import lipstick from "./lipstick/data.json";
import { FPS, HEIGHT, WIDTH, cueTotalFrames, totalFrames, type EpisodeProps } from "./types";

const sample: EpisodeProps = {
  title: "Preview",
  lines: [
    {
      index: 0,
      beat: "hook",
      speaker: "ocu",
      text: "",
      subtitle: "A sample line from Ocu, calm and deadpan.",
      expression: "deadpan",
      on_screen_text: "CONTOH",
      hasAudio: false,
      audio: null,
      frames: 90,
      envelope: [],
    },
    {
      index: 1,
      beat: "counter",
      speaker: "uco",
      text: "",
      subtitle: "And Uco, loud and angry about it!",
      expression: "angry",
      hasAudio: false,
      audio: null,
      frames: 90,
      envelope: [],
    },
    {
      index: 2,
      beat: "concession",
      speaker: "uco",
      text: "",
      subtitle: "Dammit, that actually makes sense. Don't tell him.",
      expression: "thinking",
      thought_bubble: true,
      hasAudio: false,
      audio: null,
      frames: 90,
      envelope: [],
    },
    {
      index: 3,
      beat: "button",
      speaker: "ocu",
      text: "",
      subtitle: "Extra ice. The dose has to be right.",
      expression: "deadpan",
      on_screen_text: "Tulis di komen.",
      hasAudio: false,
      audio: null,
      frames: 60,
      envelope: [],
    },
  ],
};

export function Root() {
  return (
    <>
      <Composition
        id="Episode"
        component={Episode}
        fps={FPS}
        width={WIDTH}
        height={HEIGHT}
        durationInFrames={300}
        defaultProps={sample}
        calculateMetadata={({ props }) => ({
          durationInFrames: totalFrames(props.lines),
        })}
      />
      <Composition
        id="EpisodeComic"
        component={ComicEpisode}
        fps={FPS}
        width={WIDTH}
        height={HEIGHT}
        durationInFrames={300}
        defaultProps={{ ...sample, reducedMotion: false }}
        calculateMetadata={({ props }) => ({ durationInFrames: totalFrames(props.lines) })}
      />
      <Composition
        id="EpisodeKoran"
        component={KoranKinetik}
        fps={FPS}
        width={WIDTH}
        height={HEIGHT}
        durationInFrames={300}
        defaultProps={{ ...sample, reducedMotion: false }}
        calculateMetadata={({ props }) => ({ durationInFrames: cueTotalFrames(props.lines, props.direction) })}
      />
      <Composition
        id="EpisodeTaktis"
        component={DiagramTaktis}
        fps={FPS}
        width={WIDTH}
        height={HEIGHT}
        durationInFrames={300}
        defaultProps={{ ...sample, reducedMotion: false }}
        calculateMetadata={({ props }) => ({ durationInFrames: cueTotalFrames(props.lines, props.direction) })}
      />
      <Composition
        id="LipstickEffect"
        component={LipstickEffect}
        fps={FPS}
        width={WIDTH}
        height={HEIGHT}
        durationInFrames={lipstick.totalFrames}
      />
    </>
  );
}
