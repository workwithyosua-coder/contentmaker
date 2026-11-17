export const FPS = 30;
export const WIDTH = 1080;
export const HEIGHT = 1920;
/** Pause between two lines. */
export const GAP_FRAMES = 6;
/** End card length. */
export const END_FRAMES = 3 * FPS;
/** Center 80% safe zone (TikTok / Reels / Shorts UI stays outside it). */
export const SAFE = { left: 108, right: 108, top: 192, bottom: 192 };

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

// Uco & Ocu style bible: high-contrast split on charcoal.
export const COLORS = {
  ink: "#0E0E12",
  canvas: "#1E1E24",
  // Uco, left, warm
  uco: "#E85D04", // burnt orange
  ucoAmber: "#F48C06",
  ucoDeep: "#9D3A02",
  // Ocu, right, cool
  ocu: "#3A5A78", // slate blue
  ocuTeal: "#2A6F7B",
  ocuDeep: "#16283A",
  // highlights
  yellow: "#FFD60A",
  white: "#F8F9FA",
};
