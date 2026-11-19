import { propFile, sfxFile } from "./assets";
import { KINETIC_SLAM, sfxCuesFor } from "./shared/sfxCues";
import { PNG_PROPS, isPropName, pngPropByName } from "./props/library";
import { END_FRAMES, timeline, type EpisodeLine, type ManifestLine } from "./types";

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
  /** illustrated prop from public/props ({name}.png), shown instead of the coded propTag; null when none fits or
   *  the file isn't there yet */
  propImage: string | null;
  /** callout labels pointing at parts of propImage (ids from props/library.ts), in the order they appear */
  callouts: string[];
  /** explainer card on the visual stage, with its 1-word title */
  overlay: { kind: Overlay; title: string } | null;
  /** inner thought: dimmed backdrop, comic thought bubble with the prop inside, italic subtitle */
  thought: boolean;
  /** 2–4 word floating kinetic text on emphasis beats (hook, insight, button, close-ups) and the CTA; else null */
  kinetic: string | null;
  sceneImageUrl: string | null;
};

export const OVERLAYS = ["wave-graph", "brain-badge"] as const;
export type Overlay = (typeof OVERLAYS)[number];

export type SubtitleChunk = { text: string; startFrame: number; endFrame: number };

export const CAMERA_SHOTS = ["solo-uco", "solo-ocu", "closeup-punch", "two-shot", "cta-stinger"] as const;
export type CameraShot = (typeof CAMERA_SHOTS)[number];
export const EMOTIONS = ["triumphant", "defensive", "shocked", "phone", "deadpan", "explaining", "inspecting", "cta"] as const;
export type Emotion = (typeof EMOTIONS)[number];
export const PROP_TAGS = ["iced-coffee", "checkout-phone", "payday-slips", "receipt-magnifier", "cash-vs-paylater", "none"] as const;
export type PropTag = (typeof PROP_TAGS)[number];

const oneOf = <T extends string>(list: readonly T[], v: string | null | undefined): T | null => (v && (list as readonly string[]).includes(v) ? (v as T) : null);

// ------------------------------------------------------------------ director defaults (when the script didn't set them)
// Older and imported scripts have no emotion/shot tags. These defaults read the line itself (punctuation, keywords in
// the Indonesian text, the English subtitle and the visual note) and only pick poses each character has sprites for:
// Uco triumphant / defensive / shocked / phone, Ocu deadpan / explaining / inspecting (cta is the end card's).
// When nothing in the line decides, the pose alternates from that speaker's previous line so it never sits still.

const UCO_POSES = ["triumphant", "defensive", "shocked", "phone"] as const satisfies readonly Emotion[];
const OCU_POSES = ["deadpan", "explaining", "inspecting"] as const satisfies readonly Emotion[];

const RX = {
  phone: /\b(phone|hp|handphone|smartphone|checkout|check out|keranjang|cart|scroll(ing)?|app|apps|aplikasi|paylater|pay later|spaylater|gopaylater|klik|click|tap|order|pesan online|flash ?sale|e-?wallet|ovo|gopay|shopee|tokopedia|tiktok shop|notif\w*)\b/i,
  shockWord: /\b(hah|hah\?|loh|lho|serius|astaga|astagfirullah|waduh|wah|anjir|anjay|gila|kok bisa|what the|wait|seriously|no way)\b/i,
  defendWord: /\b(tapi|cuma|cuman|doang|emang|emangnya|gapapa|nggak papa|gak papa|biarin|but|only|just|it's fine|whatever)\b/i,
  bragWord: /\b(pasti|dong|gampang|santai|worth it|hemat|untung|cuan|menang|easy|smart|genius|deal)\b/i,
  // fine print, hidden costs, checking: Ocu leans in with the magnifier
  inspect: /\b(magnif\w*|struk|receipt|fine print|zoom|detail|syarat|ketentuan|terms|hidden|tersembunyi|biaya admin|admin fee|denda|late fee|cek|check|baca|read|teliti|lihat lagi|look closer)\b/i,
  // prices, fees and arithmetic: Ocu walks through the numbers with an open hand
  math: /(\d|\brp\.?\b|%|\b(ribu|rb|juta|jt|k|harga|price|biaya|fee|fees|bunga|interest|\w*cicil\w*|nyicil\w*|installments?|tenor|total|hitung\w*|calculat\w*|times|per bulan|a month|per month|setahun|a year|artinya)\b)/i,
};

function cueText(l: EpisodeLine) {
  return `${l.visual ?? ""} ${l.text} ${l.subtitle ?? ""} ${l.on_screen_text ?? ""}`;
}

function defaultEmotion(l: EpisodeLine, prev: Emotion | null): Emotion {
  const v = cueText(l);
  const said = `${l.text} ${l.subtitle ?? ""}`;
  const e = String(l.expression ?? "").toLowerCase();
  const exclaim = /!/.test(said);
  const question = /\?/.test(said);
  const loud = /\?!|!\?|!!/.test(said);

  if (l.speaker === "uco") {
    if (RX.phone.test(v)) return "phone";
    if (loud || e === "shocked" || e === "worried" || RX.shockWord.test(said)) return "shocked";
    if (question || e === "thinking" || RX.defendWord.test(said)) return "defensive";
    if (["angry", "furious", "excited", "smug"].includes(e) || RX.bragWord.test(said)) return "triumphant";
    if (exclaim) return "shocked";
    return prev === "triumphant" ? "defensive" : "triumphant";
  }
  if (/magnif|struk|receipt|fine print|zoom/i.test(l.visual ?? "")) return "inspecting";
  if (RX.inspect.test(v)) return "inspecting";
  if (RX.math.test(said) || l.beat === "insight") return "explaining";
  if (question) return "inspecting"; // Ocu's questions are skeptical: he looks closer
  if (exclaim || e === "smug" || e === "calm") return "explaining";
  return prev === "deadpan" ? "explaining" : "deadpan";
}

/** Punchlines and big reactions get an extreme close-up; everything else (inner thoughts too) the speaker's solo. */
function defaultShot(l: EpisodeLine, emotion: Emotion, prevShot: CameraShot | null): CameraShot {
  if (l.thought_bubble) return l.speaker === "uco" ? "solo-uco" : "solo-ocu";
  if (l.beat === "button") return "closeup-punch";
  if (emotion === "shocked" && prevShot !== "closeup-punch" && /\?!|!\?|!!/.test(`${l.text} ${l.subtitle ?? ""}`)) return "closeup-punch";
  return l.speaker === "uco" ? "solo-uco" : "solo-ocu";
}

/** Emotion and shot for every line: explicit tags win, the defaults above fill the gaps in script order. */
function directLines(lines: EpisodeLine[]): { emotion: Emotion; cameraShot: CameraShot }[] {
  const prev: Record<string, Emotion | null> = { uco: null, ocu: null };
  let prevShot: CameraShot | null = null;
  return lines.map((l) => {
    const poses: readonly Emotion[] = l.speaker === "uco" ? UCO_POSES : OCU_POSES;
    const emotion = oneOf(EMOTIONS.filter((x) => x !== "cta"), l.emotion) ?? defaultEmotion(l, prev[l.speaker] ?? null);
    const cameraShot = oneOf(CAMERA_SHOTS.filter((c) => c !== "cta-stinger"), l.camera_shot) ?? defaultShot(l, emotion, prevShot);
    // an explicit emotion the character has no sprite for still renders (castSprites falls back); the alternation
    // memory only tracks poses that show
    prev[l.speaker] = poses.includes(emotion) ? emotion : prev[l.speaker];
    prevShot = cameraShot;
    return { emotion, cameraShot };
  });
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

// ------------------------------------------------------------------ visual stage: props, explainer cards, kinetic text
type PropLine = Pick<ManifestLine, "text" | "subtitle" | "visual" | "on_screen_text" | "prop_tag">;
const propText = (l: PropLine) => `${l.visual ?? ""} ${l.text} ${l.subtitle ?? ""} ${l.on_screen_text ?? ""}`;

/**
 * The illustrated prop a line asks for: an explicit prop_tag naming a PNG prop, else the first library prop whose
 * words appear in the line. `file` is null when that PNG hasn't been added to public/props yet.
 */
export function wantedPropImage(l: PropLine): { name: string; explicit: boolean } | null {
  const tag = l.prop_tag?.trim() ?? "";
  const hit = PNG_PROPS.find((p) => p.rx.test(propText(l)) && propFile(p.name));
  // a coded prop tag (the older, generic set) only wins when no illustrated prop matches the line's own words
  if ((PROP_TAGS as readonly string[]).includes(tag) && tag !== "none") return hit ? { name: hit.name, explicit: false } : null;
  if (isPropName(tag) && tag !== "none") {
    // a named prop: use it when its file exists; when it doesn't, an existing prop the line itself is about wins
    // (e.g. a line about blending nasi padang tagged "sate-padang" uses nasi-padang-blender); only otherwise is the
    // name reported as a prop to draw
    if (propFile(tag) || !hit) return { name: tag, explicit: true };
  }
  return hit ? { name: hit.name, explicit: false } : null;
}

const OVERLAY_RX: Record<Overlay, RegExp> = {
  "wave-graph": /\b(emulsi\w*|emulsion|emulsify|tekstur|texture|kental|creamy|krimi|homogen\w*|viscos\w*|gelombang|waves?|grafik|graph|lumer|menyatu|blends? together)\b/i,
  "brain-badge": /\b(otak|brain|psikolog\w*|psycholog\w*|dopamin\w*|dopamine|mental|bias|sugesti|placebo|persepsi|perception|nostalgi\w*|kebiasaan|habit|emosi\w*|emotion\w*|ilusi|illusion|kognitif|cognitive)\b/i,
};

const OVERLAY_TITLES: Record<Overlay, [RegExp, string][]> = {
  "wave-graph": [[/emulsi|emulsion|emulsify/i, "EMULSI"], [/tekstur|texture/i, "TEKSTUR"], [/kental|creamy|krimi|viscos/i, "KEKENTALAN"], [/homogen|menyatu|lumer|blend/i, "MENYATU"]],
  "brain-badge": [[/dopamin/i, "DOPAMIN"], [/nostalgi/i, "NOSTALGIA"], [/kebiasaan|habit/i, "KEBIASAAN"], [/placebo|sugesti/i, "SUGESTI"], [/persepsi|perception|ilusi|illusion/i, "PERSEPSI"], [/\bbias\b/i, "BIAS"], [/emosi|emotion/i, "EMOSI"]],
};

function overlayFor(l: EpisodeLine): { kind: Overlay; title: string } | null {
  const tag = (l as { overlay?: string | null }).overlay;
  if (tag === "none") return null;
  const v = `${l.visual ?? ""} ${l.text} ${l.subtitle ?? ""}`;
  const kind = oneOf(OVERLAYS, tag) ?? OVERLAYS.find((o) => OVERLAY_RX[o].test(v)) ?? null;
  if (!kind) return null;
  const title = OVERLAY_TITLES[kind].find(([rx]) => rx.test(v))?.[1] ?? (kind === "wave-graph" ? "GRAFIK" : "PSIKOLOGI");
  return { kind, title };
}

/** Parts of the prop the line names (in the order spoken), or up to 3 parts when the speaker is explaining it. */
function calloutsFor(l: EpisodeLine, name: string | null, emotion: Emotion): string[] {
  const prop = name ? pngPropByName(name) : null;
  if (!prop) return [];
  const v = `${l.text} ${l.subtitle ?? ""} ${l.visual ?? ""}`;
  const named = prop.parts
    .map((p) => ({ id: p.id, at: v.search(p.rx) }))
    .filter((p) => p.at >= 0)
    .sort((a, b) => a.at - b.at)
    .map((p) => p.id);
  if (named.length) return named.slice(0, 3);
  return emotion === "explaining" || emotion === "inspecting" ? prop.parts.slice(0, 3).map((p) => p.id) : [];
}

const EMPHASIS_BEATS = new Set(["hook", "insight", "button"]);
/** Floating kinetic text: only on emphasis beats and close-ups, 2–4 words (the stamp, else a short headline). */
function kineticFor(beatType: string, shot: CameraShot, cue: ImportantMessage): string | null {
  if (!EMPHASIS_BEATS.has(beatType) && shot !== "closeup-punch") return null;
  const pick = [cue.stamp, cue.headline].map((t) => (t ?? "").trim()).find((t) => t && t.split(/\s+/).length <= 4);
  if (pick) return pick;
  const w = cue.headline.trim().split(/\s+/);
  return w.length >= 2 ? w.slice(0, 3).join(" ") : null;
}

export type AssetCheck = { name: string; file: string; ready: boolean; lines: number[] };

/**
 * What an episode needs from public/props and public/sfx (for the pre-render checklist): the PNG props its lines
 * call for and the sound effects the cue styles cue. `lines` are 1-based line numbers that need the prop.
 */
export function requiredAssets(lines: (PropLine & Omit<ManifestLine, "hasAudio" | "index"> & Partial<Pick<ManifestLine, "index">>)[], opts: { stamp?: boolean } = {}) {
  const props = new Map<string, AssetCheck>();
  lines.forEach((l, i) => {
    const w = wantedPropImage(l);
    if (!w) return;
    const file = propFile(w.name);
    const c = props.get(w.name) ?? { name: w.name, file: file ?? `props/${w.name}.png`, ready: Boolean(file), lines: [] };
    c.lines.push(i + 1);
    props.set(w.name, c);
  });
  const beats = buildBeats(lines.map((l, i) => ({ ...l, index: l.index ?? i, hasAudio: false, audio: null, frames: 90, envelope: [] }) as EpisodeLine));
  const sfx = new Map<string, AssetCheck>();
  for (const cue of new Set(sfxCuesFor(beats, { stampAt: opts.stamp ? KINETIC_SLAM : undefined }).map((c) => c.name))) {
    const file = sfxFile(cue);
    sfx.set(cue, { name: cue, file: file ?? `sfx/${cue}.mp3`, ready: Boolean(file), lines: [] });
  }
  return { props: [...props.values()], sfx: [...sfx.values()] };
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

function stageFor(l: EpisodeLine, d: { emotion: Emotion; cameraShot: CameraShot }) {
  const want = wantedPropImage(l);
  const propImage = want && propFile(want.name) ? want.name : null;
  const cue = clampCue(l.important_message, fallbackCue(l));
  return {
    propImage,
    callouts: calloutsFor(l, propImage, d.emotion),
    overlay: overlayFor(l),
    thought: Boolean(l.thought_bubble),
    kinetic: l.thought_bubble ? null : kineticFor(l.beat, d.cameraShot, cue),
  };
}

export function buildBeats(lines: EpisodeLine[]): Beat[] {
  const { starts, end } = timeline(lines);
  const directed = directLines(lines);
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
    cameraShot: directed[i].cameraShot,
    emotion: directed[i].emotion,
    propTag: oneOf(PROP_TAGS, l.prop_tag) ?? defaultProp(l),
    ...stageFor(l, directed[i]),
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
    propImage: null,
    callouts: [],
    overlay: null,
    thought: false,
    kinetic: CTA_CUE.stamp ?? null,
    sceneImageUrl: null,
  });
  return beats;
}
