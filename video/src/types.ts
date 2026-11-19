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
  /** High-signal on-screen cue for the cue-based styles: kicker ≤ 2 words, headline ≤ 5 words (see beats.ts). */
  important_message?: { kicker: string; headline: string; stamp?: string | null } | null;
  /** Director fields (cue styles): camera shot, acting emotion, topic prop, optional topic image. All optional. */
  camera_shot?: string | null;
  emotion?: string | null;
  prop_tag?: string | null;
  scene_image_url?: string | null;
  hasAudio: boolean;
};

export type EpisodeLine = ManifestLine & {
  /** Path under public/, or null when the line has no recording yet. */
  audio: string | null;
  frames: number;
  /** Loudness per frame, 0..1, drives the mouth. */
  envelope: number[];
  /** Frames to skip at the start of the audio (silence), when it isn't pre-trimmed. Used by the in-app preview. */
  trimFrom?: number;
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

/**
 * When each line starts. Tight comedic cutting:
 * - Uco cuts in on Ocu: overlap 5 frames (~0.17 s), like an interruption.
 * - Ocu answers: 4 frames (~0.13 s); his punchlines (button beat) and answers to a question get a 12-frame (0.4 s) deadpan beat.
 * - Inner thoughts: 8 frames to let the room dim.
 */
export function timeline(lines: Pick<EpisodeLine, "speaker" | "frames" | "beat" | "thought_bubble" | "text">[]) {
  const starts: number[] = [];
  let t = 0;
  lines.forEach((l, i) => {
    if (i > 0) {
      const prev = lines[i - 1];
      let gap = 4;
      if (l.thought_bubble || prev.thought_bubble) gap = 8;
      else if (l.speaker === "uco" && prev.speaker === "ocu") gap = -5;
      else if (l.speaker === "ocu" && (l.beat === "button" || /\?\s*$|\?!\s*$/.test(prev.text))) gap = 12;
      t = Math.max(starts[i - 1] + 10, t + gap);
    }
    starts.push(t);
    t += l.frames;
  });
  return { starts, end: t };
}

export const totalFrames = (lines: EpisodeLine[]) => timeline(lines).end + END_FRAMES;
