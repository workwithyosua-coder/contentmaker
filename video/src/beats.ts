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
  /** The line's English translation (the script's [EN] subtitle), or null. Never the Indonesian line. */
  subtitleEn: string | null;
  /** subtitleEn split into movie-style chunks, timed to the voice (frames relative to the beat start) */
  subtitleChunks: SubtitleChunk[];
  cameraShot: CameraShot;
  emotion: Emotion;
  propTag: PropTag;
  sceneImageUrl: string | null;
};

export type SubtitleChunk = { text: string; startFrame: number; endFrame: number };

export const CAMERA_SHOTS = ["solo-uco", "solo-ocu", "closeup-punch", "two-shot", "cta-stinger"] as const;
export type CameraShot = (typeof CAMERA_SHOTS)[number];
export const EMOTIONS = ["triumphant", "defensive", "shocked", "phone", "deadpan", "explaining", "inspecting", "cta"] as const;
export type Emotion = (typeof EMOTIONS)[number];
export const PROP_TAGS = ["iced-coffee", "checkout-phone", "payday-slips", "receipt-magnifier", "cash-vs-paylater", "none"] as const;
export type PropTag = (typeof PROP_TAGS)[number];

const oneOf = <T extends string>(list: readonly T[], v: string | null | undefined): T | null => (v && (list as readonly string[]).includes(v) ? (v as T) : null);

// ------------------------------------------------------------------ director defaults (when the script didn't set them)
/** Single-speaker lines get a solo shot, punchlines an extreme close-up, inner thoughts a two-shot. */
function defaultShot(l: EpisodeLine): CameraShot {
  if (l.beat === "button") return "closeup-punch";
  if (l.thought_bubble) return "two-shot";
  return l.speaker === "uco" ? "solo-uco" : "solo-ocu";
}

function defaultEmotion(l: EpisodeLine): Emotion {
  const v = `${l.visual ?? ""} ${l.text}`;
  if (/\b(phone|hp|checkout|keranjang|scroll)\b/i.test(v)) return "phone";
  if (l.speaker === "ocu" && /magnif|receipt|struk|fine print|zoom/i.test(v)) return "inspecting";
  const e = l.expression;
  if (["shocked", "worried"].includes(e)) return "shocked";
  if (e === "thinking") return "defensive";
  if (l.speaker === "uco") return ["angry", "furious", "excited", "smug"].includes(e) ? "triumphant" : "defensive";
  if (l.beat === "insight") return "explaining";
  return e === "smug" || e === "calm" ? "explaining" : "deadpan";
}

function defaultProp(l: EpisodeLine): PropTag {
  const v = `${l.visual ?? ""} ${l.text} ${l.subtitle} ${l.on_screen_text ?? ""}`;
  if (/kopi|coffee|matcha|latte|es batu|ice|kafe|cafe/i.test(v)) return "iced-coffee";
  if (/checkout|keranjang|cart|\bapp\b|aplikasi|promo|diskon|flash ?sale|12\.12|11\.11/i.test(v)) return "checkout-phone";
  if (/gaji|gajian|payday|salary|slip/i.test(v)) return "payday-slips";
  if (/struk|receipt|biaya|fee|admin|bunga|interest|denda/i.test(v)) return "receipt-magnifier";
  if (/cash|tunai|paylater|cicil|kredit|bnpl/i.test(v)) return "cash-vs-paylater";
  return "none";
}

// ------------------------------------------------------------------ movie-style subtitle chunks
/** Chunks of 5–8 words, broken at punctuation where possible, each short enough for two subtitle lines. */
export function chunkSubtitle(text: string): string[] {
  const words = text.replace(/\s+/g, " ").trim().split(" ").filter(Boolean);
  const chunks: string[] = [];
  let cur: string[] = [];
  const flush = () => {
    if (cur.length) chunks.push(cur.join(" "));
    cur = [];
  };
  words.forEach((w, i) => {
    cur.push(w);
    const left = words.length - i - 1;
    const len = cur.join(" ").length;
    const punct = /[.!?;:,…]$/.test(w);
    const hard = /[.!?…]$/.test(w);
    // break: at a sentence end (≥ 3 words), at a comma once ≥ 5 words, or at 8 words / 52 characters,
    // but never leave a 1–2 word orphan at the end
    if (left === 0) return;
    if ((hard && cur.length >= 3) || (punct && cur.length >= 5) || cur.length >= 8 || len >= 52) {
      // a 2-word tail is fine after a sentence end or when this chunk is already long
      if (left >= 3 || (left === 2 && (hard || len >= 40))) flush();
    }
  });
  flush();
  return chunks;
}

/**
 * Spreads chunks over the frames where the voice is actually speaking (loudness envelope), weighted by length,
 * so pauses fall between chunks. Without a recording, chunks share the beat evenly. Each chunk shows until the
 * next one starts (no flicker in short pauses); the last one holds to the end of the beat.
 */
export function timeSubtitle(text: string | null, envelope: number[], durationInFrames: number): SubtitleChunk[] {
  if (!text) return [];
  const chunks = chunkSubtitle(text);
  const voiced = envelope.map((v, i) => (v > 0.08 ? i : -1)).filter((i) => i >= 0 && i < durationInFrames);
  const frames = voiced.length >= chunks.length * 6 ? voiced : Array.from({ length: durationInFrames }, (_, i) => i);
  const weights = chunks.map((c) => c.length + 8);
  const total = weights.reduce((a, b) => a + b, 0);
  const out: SubtitleChunk[] = [];
  let acc = 0;
  chunks.forEach((c, i) => {
    const startIdx = Math.min(frames.length - 1, Math.round((acc / total) * frames.length));
    acc += weights[i];
    out.push({ text: c, startFrame: i === 0 ? 0 : frames[startIdx], endFrame: durationInFrames });
  });
  // snap each chunk start to where the voice resumes after a pause (≥ 6 quiet frames), when one is within 24 frames
  const resumes = frames === voiced ? voiced.filter((f, i) => i > 0 && f - voiced[i - 1] >= 6) : [];
  for (let i = 1; i < out.length; i++) {
    const near = resumes.filter((r) => Math.abs(r - out[i].startFrame) <= 24 && r > out[i - 1].startFrame + 10);
    if (near.length) out[i].startFrame = near.reduce((a, r) => (Math.abs(r - out[i].startFrame) < Math.abs(a - out[i].startFrame) ? r : a));
  }
  for (let i = 0; i < out.length - 1; i++) out[i].endFrame = Math.max(out[i].startFrame + 1, out[i + 1].startFrame);
  return out;
}

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

/** English subtitle for a line: the [EN] translation, never the Indonesian text (blank or identical → null). */
function englishOf(l: Pick<EpisodeLine, "subtitle" | "text">) {
  const en = l.subtitle?.replace(/\s+/g, " ").trim();
  if (!en) return null;
  if (en.toLowerCase() === l.text?.replace(/\s+/g, " ").trim().toLowerCase()) return null;
  return en;
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
    subtitleEn: englishOf(l),
    subtitleChunks: timeSubtitle(englishOf(l), l.envelope ?? [], Math.max(1, (starts[i + 1] ?? end) - starts[i])),
    cameraShot: oneOf(CAMERA_SHOTS.filter((c) => c !== "cta-stinger"), l.camera_shot) ?? defaultShot(l),
    emotion: oneOf(EMOTIONS.filter((e) => e !== "cta"), l.emotion) ?? defaultEmotion(l),
    propTag: oneOf(PROP_TAGS, l.prop_tag) ?? defaultProp(l),
    sceneImageUrl: /^https:\/\//.test(l.scene_image_url ?? "") ? l.scene_image_url! : null,
  }));
  beats.push({
    id: "cta",
    line: null,
    speaker: "both",
    beatType: "cta-stinger",
    startFrame: end,
    durationInFrames: END_FRAMES,
    importantMessage: CTA_CUE,
    subtitleEn: null,
    subtitleChunks: [],
    cameraShot: "cta-stinger",
    emotion: "cta",
    propTag: "none",
    sceneImageUrl: null,
  });
  return beats;
}
