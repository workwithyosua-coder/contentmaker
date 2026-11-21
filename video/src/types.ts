import type { RenderDirection } from "./direction";
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
  /** explicit timing from a custom script ("0:24–0:28"), in seconds of the finished video; the line starts there */
  start_s?: number | null;
  end_s?: number | null;
  /** sound effects that play as the line starts (names of public/sfx files, without the extension) */
  sfx?: string[] | null;
  /** explainer card: wave-graph / brain-badge / none (rules pick one when omitted) */
  overlay?: string | null;
  /** Manual mode: public HTTPS URLs of the uploaded custom props / SFX this line uses (name → URL) */
  asset_urls?: AssetUrls | null;
  /** Manual / Exact Import: short on-screen callout (2–4 words) that floats as kinetic text on this line */
  kinetic_text?: string | null;
  /** callout labels on the line's prop (part ids from video/src/props/library.ts) */
  callouts?: string[] | null;
  /** "takeover": Evidence Takeover (prop / stat centre stage, speaker in a corner cameo); omitted = standard */
  layout?: string | null;
  /** Evidence Takeover data callout, "HEADLINE | SUBLINE" (e.g. "20 KM | MATI DALAM 2 HARI") */
  stat?: string | null;
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

/** Uploaded custom props / SFX by name → HTTPS URL (Supabase Storage), passed in by the renderer and the preview. */
export type AssetUrls = { props?: Record<string, string>; sfx?: Record<string, string> };

export type EpisodeProps = { title: string; lines: EpisodeLine[]; direction?: RenderDirection | null; assetUrls?: AssetUrls | null };

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
 * - Uco cuts in on Ocu: overlap 3 frames (0.1 s), only over the 0.15 s of silence kept at the end of each take, so
 *   he never talks over Ocu's last word.
 * - Ocu answers: 4 frames (~0.13 s); his punchlines (button beat) and answers to a question get a 12-frame (0.4 s) deadpan beat.
 * - Inner thoughts: 8 frames to let the room dim.
 */
export function timeline(lines: Pick<EpisodeLine, "speaker" | "frames" | "beat" | "thought_bubble" | "text" | "start_s">[], direction?: RenderDirection | null) {
  const starts: number[] = [];
  const pause = direction?.pauseS != null ? Math.round(direction.pauseS * FPS) : null;
  const thoughtPause = direction?.thoughtPauseS != null ? Math.round(direction.thoughtPauseS * FPS) : null;
  let t = 0;
  lines.forEach((l, i) => {
    if (i > 0) {
      const prev = lines[i - 1];
      let gap = 4;
      if (l.thought_bubble || prev.thought_bubble) gap = thoughtPause ?? Math.max(8, pause ?? 0);
      else if (pause !== null) gap = pause; // the direction's pause replaces the comedic defaults (no cut-ins)
      else if (l.speaker === "uco" && prev.speaker === "ocu") gap = -3;
      else if (l.speaker === "ocu" && (l.beat === "button" || /\?\s*$|\?!\s*$/.test(prev.text))) gap = 12;
      t = Math.max(starts[i - 1] + 10, t + gap);
    }
    // an explicit timestamp anchors the line exactly (so timing never drifts from the script's), but never so early
    // that it talks over the previous line: at most a 3-frame cut-in on its trailing silence
    if (l.start_s != null && Number.isFinite(l.start_s)) {
      const floor = i > 0 ? Math.max(starts[i - 1] + 10, starts[i - 1] + lines[i - 1].frames - 3) : 0;
      t = Math.max(floor, Math.round(l.start_s * FPS));
    }
    starts.push(t);
    t += l.frames;
  });
  return { starts, end: t };
}

/** Video length (classic / comic styles): the lines, plus the 3-second end card unless the direction turns the CTA off. */
export const totalFrames = (lines: EpisodeLine[], direction?: RenderDirection | null) => timeline(lines, direction).end + (direction?.cta === false ? 0 : END_FRAMES);

/** After the last spoken word of a CTA line, the outro holds this long (0.5 s), instead of a separate silent end card. */
export const CTA_HOLD = 15;
const CTA_WORDS = /\b(follow|ikuti|subscribe|langganan|share|bagikan|kirim(?:in)? ke|tag (?:temen|teman)|komen|comment|like|save|simpan|klik|tap)\b/i;

/**
 * Cue styles: when the last line is itself a call to action ("Follow …", "Kirim ke temen lo"), the outro two-shot plays
 * *during* that line and holds 0.5 s after it, instead of a 3-second silent end card after it.
 */
export function ctaMergesIntoLastLine(lines: Pick<EpisodeLine, "text" | "subtitle" | "on_screen_text" | "kinetic_text">[], direction?: RenderDirection | null) {
  const last = lines[lines.length - 1];
  if (!last || direction?.cta === false) return false;
  return CTA_WORDS.test(`${last.text} ${last.subtitle ?? ""} ${last.on_screen_text ?? ""} ${last.kinetic_text ?? ""}`);
}

/** Video length for the cue styles (Koran Kinetik, Diagram Taktis): lines + 0.5 s hold (CTA line) or + the 3 s end card. */
export function cueTotalFrames(lines: EpisodeLine[], direction?: RenderDirection | null) {
  const { end } = timeline(lines, direction);
  if (direction?.cta === false) return end;
  return end + (ctaMergesIntoLastLine(lines, direction) ? CTA_HOLD : END_FRAMES);
}
