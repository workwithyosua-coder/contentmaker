import { END_FRAMES, timeline, type EpisodeLine } from "./types";

// The shared beat timeline. Every style can read an episode as a list of beats; the cue-based styles (Koran Kinetik,
// Diagram Taktis) render only from it. One beat per spoken line (same start frames as the audio, from timeline()),
// plus a closing 3-second channel CTA stinger with both characters.

export const SAFE_ZONE = { width: 1080, height: 1920, left: 60, right: 940, top: 250, bottom: 1260, followX: 920, followY: 780 } as const;

export type BeatSpeaker = "uco" | "ocu" | "both";
export type ImportantMessage = {
  /** ≤ 2 words, e.g. "BIAYA LAYANAN" */
  kicker: string;
  /** ≤ 5 words, the one thing to remember from the beat */
  headline: string;
  /** optional short stamp, ≤ 3 words */
  stamp?: string | null;
};
export type Beat = {
  id: string;
  /** index into the episode lines, or null for the CTA stinger */
  line: number | null;
  speaker: BeatSpeaker;
  /** script beat (hook, counter, …) or "cta-stinger" */
  beatType: string;
  startFrame: number;
  durationInFrames: number;
  importantMessage: ImportantMessage;
};

export const KICKER_MAX_WORDS = 2;
export const HEADLINE_MAX_WORDS = 5;
const STAMP_MAX_WORDS = 3;

const words = (s: string | null | undefined) =>
  (s ?? "")
    .replace(/[“”"«»]/g, "")
    .trim()
    .split(/\s+/)
    .filter(Boolean);
/** First n words, uppercased. Symbol-only tokens ("&", "=", "x") ride along without counting as words. */
function cap(s: string | null | undefined, n: number) {
  const out: string[] = [];
  let count = 0;
  for (const w of words(s)) {
    const isWord = /[\p{L}\p{N}]/u.test(w);
    if (isWord && count === n) break;
    if (isWord) count++;
    out.push(w);
  }
  while (out.length && !/[\p{L}\p{N}]/u.test(out[out.length - 1])) out.pop(); // no dangling "&"
  return out.join(" ").replace(/[,;:]+$/, "").toUpperCase();
}

/** Word count used for the limits (symbols don't count). */
export const cueWords = (s: string | null | undefined) => words(s).filter((w) => /[\p{L}\p{N}]/u.test(w)).length;

/** Enforces the word limits (the writer is asked for them; this is the backstop). */
export function clampCue(m: Partial<ImportantMessage> | null | undefined, fallback: { kicker: string; headline: string }): ImportantMessage {
  // never empty: the cue, else the line's own words (≤ 5), else the channel name
  const headline = cap(m?.headline, HEADLINE_MAX_WORDS) || cap(fallback.headline, HEADLINE_MAX_WORDS) || "UCO & OCU";
  const kicker = cap(m?.kicker, KICKER_MAX_WORDS) || cap(fallback.kicker, KICKER_MAX_WORDS) || "UCO & OCU";
  const stamp = cap(m?.stamp, STAMP_MAX_WORDS) || null;
  return { kicker, headline, stamp };
}

const KICKER_FOR_BEAT: Record<string, string> = {
  hook: "DENGER NIH",
  counter: "TUNGGU DULU",
  escalation: "MAKIN PARAH",
  insight: "FAKTANYA",
  concession: "DALAM HATI",
  button: "INTINYA",
};

/** A cue for a line without one (scripts written before cues existed): on-screen text first, then the line itself. */
function fallbackCue(l: Pick<EpisodeLine, "beat" | "text" | "on_screen_text" | "subtitle">) {
  return { kicker: KICKER_FOR_BEAT[l.beat] ?? l.beat, headline: l.on_screen_text?.trim() || l.text?.trim() || l.subtitle };
}

export const CTA_CUE: ImportantMessage = { kicker: "UCO & OCU", headline: "FOLLOW KONTEN PINTER ANTI ZONK", stamp: "FOLLOW +" };

export function buildBeats(lines: EpisodeLine[]): Beat[] {
  const { starts, end } = timeline(lines);
  const beats: Beat[] = lines.map((l, i) => ({
    id: `b${i + 1}`,
    line: i,
    speaker: l.speaker,
    beatType: l.beat,
    startFrame: starts[i],
    durationInFrames: Math.max(1, (starts[i + 1] ?? end) - starts[i]),
    importantMessage: clampCue(l.important_message, fallbackCue(l)),
  }));
  beats.push({
    id: "cta",
    line: null,
    speaker: "both",
    beatType: "cta-stinger",
    startFrame: end,
    durationInFrames: END_FRAMES,
    importantMessage: CTA_CUE,
  });
  return beats;
}
