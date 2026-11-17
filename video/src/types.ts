export const FPS = 30;
export const WIDTH = 1080;
export const HEIGHT = 1920;
/** Pause between two lines. */
export const GAP_FRAMES = 6;
/** End card length. */
export const END_FRAMES = 3 * FPS;

export type Speaker = "uco" | "ocu";
export type Expression = "deadpan" | "angry" | "calm" | "furious" | "worried" | "excited" | "thinking" | "smug" | string;

/** One script line as the app sends it (GET /api/render/:id). */
export type ManifestLine = {
  index: number;
  beat: string;
  speaker: Speaker;
  text: string;
  subtitle: string;
  expression: Expression;
  visual?: string;
  on_screen_text?: string | null;
  thought_bubble?: boolean;
  hasAudio: boolean;
};

export type EpisodeLine = ManifestLine & {
  /** Path under public/, or null when the line has no recording yet. */
  audio: string | null;
  frames: number;
  /** Loudness per frame, 0..1, drives the mouth. */
  envelope: number[];
};

export type EpisodeProps = { title: string; lines: EpisodeLine[] };

// From the reference badge: warm amber Uco vs cool slate-teal Ocu on charcoal, split by a lightning bolt.
export const COLORS = {
  uco: "#F4A922", // amber
  ucoDeep: "#C9761A",
  ucoWarm: "#FFD36B",
  ucoSweater: "#D9962B",
  ucoSweaterDark: "#A86E17",
  ucoShirt: "#FBE3A0",
  ocu: "#5F8A93", // slate teal
  ocuDeep: "#3B5D66",
  ocuSlate: "#4A6E78",
  ocuBlazer: "#6F8C95",
  ocuBlazerLight: "#85A3AB",
  ocuTurtle: "#2F4A50",
  ink: "#1A1A1F",
  paper: "#FFF6E0",
  charcoal: "#2B3034",
  yellow: "#FFD23F",
};
