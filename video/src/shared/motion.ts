// Frame-driven motion for the Director styles: lip-sync stages, blinks, audio-reactive body motion, camera moves,
// the 4-frame cut transition and when a prop pops in. Pure functions of (frame, beat, envelope), so every render of
// the same episode is identical and the rules can be unit-tested without a browser.

import type { Beat, SubtitleChunk } from "../beats";
import { FPS } from "../types";
import { textWidth, wrapHeadline } from "./textMetrics";

/** Voice loudness at `frame`, smoothed over 3 frames so the mouth and body don't flicker on single-frame spikes. */
export function levelAt(envelope: number[], frame: number): number {
  if (!envelope.length) return 0;
  const at = (i: number) => envelope[Math.min(envelope.length - 1, Math.max(0, i))] ?? 0;
  if (frame < 0 || frame >= envelope.length) return 0;
  return at(frame - 1) * 0.25 + at(frame) * 0.5 + at(frame + 1) * 0.25;
}

/** 0 closed, 1 half-open, 2 wide-open. */
export type MouthStage = 0 | 1 | 2;
export const MOUTH_HALF = 0.2;
export const MOUTH_WIDE = 0.55;

/** Mouth stage from the smoothed loudness: loud, stressed syllables open wider than soft ones. */
export function mouthStage(level: number): MouthStage {
  return level >= MOUTH_WIDE ? 2 : level >= MOUTH_HALF ? 1 : 0;
}

/** Without a recording (script-only preview): a steady closed → half → wide → half chatter. */
export function chatterStage(frame: number): MouthStage {
  return ([0, 1, 2, 1] as const)[Math.floor(frame / 3) % 4];
}

/** Deterministic 0..1 from a string seed and an index (FNV-1a + xorshift; no Math.random). */
export function seeded(seed: string, i: number): number {
  let h = 2166136261 ^ i;
  for (let k = 0; k < seed.length; k++) h = Math.imul(h ^ seed.charCodeAt(k), 16777619);
  h ^= h << 13;
  h ^= h >>> 17;
  h ^= h << 5;
  return ((h >>> 0) % 100000) / 100000;
}

export const BLINK_FRAMES = 4;
/** first blink 0.8–2 s into the beat, then every 2.5–4.5 s */
const FIRST_BLINK: [number, number] = [24, 60];
const BLINK_GAP: [number, number] = [75, 135];

/** Frames (inside the beat) where blinks start, seeded per beat and character. */
export function blinkStarts(seed: string, durationInFrames: number): number[] {
  const out: number[] = [];
  let t = Math.round(FIRST_BLINK[0] + seeded(seed, 0) * (FIRST_BLINK[1] - FIRST_BLINK[0]));
  for (let i = 1; t < durationInFrames - 2 && i < 200; i++) {
    out.push(t);
    t += Math.round(BLINK_GAP[0] + seeded(seed, i) * (BLINK_GAP[1] - BLINK_GAP[0]));
  }
  return out;
}

/** How closed the eyes are this frame: 0 open, 1 shut (a 4-frame blink: half, shut, shut, half). */
export function blinkAt(seed: string, frame: number, durationInFrames: number): number {
  const s = blinkStarts(seed, durationInFrames).find((b) => frame >= b && frame < b + BLINK_FRAMES);
  if (s === undefined) return 0;
  return [0.6, 1, 1, 0.6][frame - s];
}

/** Audio-reactive body motion in canvas px / degrees: Uco bouncy, Ocu calm; still during inner thoughts. */
export function bodyMotion(who: "uco" | "ocu", level: number, globalFrame: number, thought: boolean): { dy: number; scale: number; tilt: number } {
  if (thought) return { dy: 0, scale: 1, tilt: 0 };
  const l = Math.min(1, Math.max(0, level));
  const e = who === "uco" ? { bob: 4, scale: 0.025, tilt: 1.5, sway: 9 } : { bob: 2, scale: 0.012, tilt: 0.7, sway: 14 };
  return { dy: -e.bob * l, scale: 1 + e.scale * l, tilt: e.tilt * l * Math.sin(globalFrame / e.sway) };
}

const ease = (t: number) => {
  const c = Math.min(1, Math.max(0, t));
  return 1 - Math.pow(1 - c, 3);
};

/** Beats that explain something get the slow Ken Burns push. */
export function isExplanation(b: Beat): boolean {
  return b.beatType === "insight" || b.emotion === "explaining" || b.emotion === "inspecting" || Boolean(b.overlay);
}

export const LONG_BEAT = 5 * FPS;
export const MICRO_PUNCH = 1.07;
export const SHOCK_PUNCH = 1.12;

/**
 * The camera for one beat: a slow 1.00 → 1.06 push on explanation beats (else the style's own push-in), a snappy
 * 1.12× punch with a 2° tilt on shocked beats, and a 1.07× micro punch-in halfway through any beat over 5 s so a
 * long hold never looks frozen. The outro stays still so both characters stay whole.
 */
export function cameraAt(b: Beat, frame: number, basePush: [number, number] = [1, 1.04]): Camera {
  if (b.cameraShot === "cta-stinger") return { scale: 1, rotate: 0, x: 0, y: 0 };
  const t = frame / Math.max(1, b.durationInFrames);
  const push = isExplanation(b) ? [1, 1.06] : basePush;
  let scale = push[0] + (push[1] - push[0]) * Math.min(1, Math.max(0, t));
  let rotate = 0;
  if (b.emotion === "shocked" && !b.thought) {
    // snaps in over 5 frames with a small overshoot, then holds
    const k = Math.min(1, frame / 5);
    const snap = k < 1 ? ease(k) * 1.08 : 1 + 0.08 * Math.max(0, 1 - (frame - 5) / 6);
    scale *= 1 + (SHOCK_PUNCH - 1) * Math.min(snap, 1.08);
    rotate = -2 * Math.min(1, snap);
  }
  if (b.durationInFrames > LONG_BEAT) {
    const mid = Math.round(b.durationInFrames / 2);
    scale *= 1 + (MICRO_PUNCH - 1) * ease((frame - mid) / 6);
  }
  return { scale, rotate, ...impactShake(frame, b.impactFrame) };
}

export type Camera = { scale: number; rotate: number; x: number; y: number };

export const SHAKE_FRAMES = 6;
export const SHAKE_PX = 6;
/**
 * Urgent beats (angry delivery, a stamp SFX): a damped ±6 px shake for 6 frames from the impact frame, alternating
 * direction each frame and settling to 0.
 */
export function impactShake(frame: number, impact: number | null | undefined): { x: number; y: number } {
  if (impact == null) return { x: 0, y: 0 };
  const k = frame - impact;
  if (k < 0 || k >= SHAKE_FRAMES) return { x: 0, y: 0 };
  const a = SHAKE_PX * (1 - k / SHAKE_FRAMES);
  return { x: (k % 2 ? -1 : 1) * a, y: (k % 3 === 1 ? 1 : -1) * a * 0.5 };
}

export const CUT_FRAMES = 4;

/**
 * Direction of the cut into beat `i`: +1 slides in from the right (cutting to Ocu, who stands right), −1 from the
 * left (to Uco), 0 no transition (the first beat, or the same shot and speaker continuing).
 */
export function cutDirection(beats: Beat[], i: number): -1 | 0 | 1 {
  if (i <= 0) return 0;
  const a = beats[i - 1];
  const b = beats[i];
  if (a.cameraShot === b.cameraShot && a.speaker === b.speaker) return 0;
  if (b.speaker === "ocu") return 1;
  if (b.speaker === "uco") return -1;
  return a.speaker === "ocu" ? -1 : 1;
}

/** Horizontal offset (px) of the incoming shot during the 4-frame whip: ~180 → 0 with a hard ease-out. */
export function whipOffset(dir: -1 | 0 | 1, frame: number): number {
  if (!dir || frame >= CUT_FRAMES) return 0;
  return dir * 420 * (1 - ease((frame + 1) / CUT_FRAMES));
}

/**
 * Frames the outgoing beat stays mounted past its end: the length of the whip into the next beat, so the next beat
 * slides in over it (an overlapping push) instead of over an empty background.
 */
export function holdFrames(beats: Beat[], i: number): number {
  return i + 1 < beats.length && cutDirection(beats, i + 1) !== 0 ? CUT_FRAMES : 0;
}

export type Layer = { index: number; frame: number; x: number; held: boolean };

/**
 * The beat layers on screen at episode frame `g`, bottom to top: the beat that is playing, and during a whip the
 * outgoing beat held on its last frame underneath the incoming one. Each layer is a full-canvas opaque picture
 * (its own background, wash, cast and stage) offset by `x`.
 */
export function layersAt(beats: Beat[], g: number, reduced = false): Layer[] {
  const out: Layer[] = [];
  beats.forEach((b, i) => {
    const local = g - b.startFrame;
    if (local < 0 || local >= b.durationInFrames + holdFrames(beats, i)) return;
    const held = local >= b.durationInFrames;
    out.push({ index: i, frame: held ? b.durationInFrames - 1 : local, x: held || reduced ? 0 : whipOffset(cutDirection(beats, i), local), held });
  });
  return out;
}

/** Whether opaque full-width layers at offsets `xs` cover every column of a `width`-px canvas. */
export function coversCanvas(xs: number[], width = 1080): boolean {
  const spans = xs.map((x) => [Math.max(0, x), Math.min(width, x + width)] as const).filter(([a, b]) => b > a).sort((p, q) => p[0] - q[0]);
  let reach = 0;
  for (const [a, b] of spans) {
    if (a > reach + 0.5) return false;
    reach = Math.max(reach, b);
  }
  return reach >= width - 0.5;
}

// ------------------------------------------------------------------ speech onset
/** A frame counts as speech when the voice loudness is over this (the envelope is 0..1, noise floor removed). */
export const SPEECH_THRESHOLD = 0.12;

/**
 * First and last spoken frames of a beat from its loudness envelope: the first frame where two frames in a row are
 * over the threshold, and the frame after the last such frame. No envelope (or silence): the whole beat.
 */
/** A voice onset later than this (1.5 s, or half the beat) is treated as bad loudness data, not a real pause. */
export const LATE_ONSET = Math.round(1.5 * FPS);

export function speechBounds(envelope: number[] | null | undefined, durationInFrames: number): { start: number; end: number } {
  const whole = { start: 0, end: Math.max(1, Math.round(Number.isFinite(durationInFrames) ? durationInFrames : 1)) };
  const env = Array.isArray(envelope) ? envelope : [];
  const n = Math.min(env.length, whole.end);
  const loud = (i: number) => {
    const v = Number(env[i]);
    return Number.isFinite(v) && v > SPEECH_THRESHOLD;
  };
  let start = -1;
  for (let i = 0; i < n; i++) {
    if (loud(i) && (i + 1 >= n || loud(i + 1))) {
      start = i;
      break;
    }
  }
  // missing, flat or silent data, or an onset so late it can't be the line's real start: the whole beat, so props,
  // callouts and takeover cards always show (live preview and cached audio included)
  if (start < 0 || start > Math.min(LATE_ONSET, whole.end * 0.5)) return whole;
  let end = start + 1;
  for (let i = n - 1; i > start; i--) {
    if (loud(i) && loud(i - 1)) {
      end = i + 1;
      break;
    }
  }
  return { start, end: Math.max(start + 1, Math.min(whole.end, end)) };
}

/**
 * Whether the beat's subtitle shows at `frame`: never before the voice starts, and never while the beat is still
 * whipping in over the previous one (so no subtitle floats over the overlap).
 */
export function subtitleVisible(b: Pick<Beat, "speechStart">, frame: number, cutDir: -1 | 0 | 1): boolean {
  return frame >= b.speechStart && !(cutDir !== 0 && frame < CUT_FRAMES);
}

// ------------------------------------------------------------------ lower-zone subtitles
/** The subtitle band on the 1080×1920 canvas: under the characters' hands, above the platforms' bottom UI. */
export const SUBTITLE_BAND = { left: 60, width: 880, top: 1540, bottom: 1630 } as const;
const PILL_PAD = { x: 22, y: 9 };
const LINE = 1.12;

/** Font size, lines and the dark pill's box for one subtitle chunk, always inside the band. */
export function subtitleLayout(text: string): { size: number; lines: string[]; pill: { x: number; y: number; w: number; h: number } } {
  const inner = SUBTITLE_BAND.width - 2 * PILL_PAD.x;
  const maxH = SUBTITLE_BAND.bottom - SUBTITLE_BAND.top;
  let size = 46;
  let lines = [text];
  // one line, as large as fits (46 → 32 px); else two lines at the size whose two lines fit the band's height
  for (; size >= 32 && textWidth(text, size) > inner; size -= 2);
  if (size < 32) {
    size = Math.floor((maxH - 2 * PILL_PAD.y) / (2 * LINE));
    lines = wrapHeadline(text, size, inner).slice(0, 2);
  }
  const w = Math.min(SUBTITLE_BAND.width, Math.max(...lines.map((l) => textWidth(l, size))) + 2 * PILL_PAD.x);
  const h = Math.ceil(lines.length * size * LINE + 2 * PILL_PAD.y);
  const y = SUBTITLE_BAND.top + (maxH - h) / 2;
  return { size, lines, pill: { x: SUBTITLE_BAND.left + (SUBTITLE_BAND.width - w) / 2, y, w, h } };
}

// ------------------------------------------------------------------ evidence takeover layout
/** Evidence Takeover: the hero stage (70 % of the canvas width, y 340..1160) and the speaker's corner cameo. */
export const TAKEOVER_HERO = { x: 162, y: 340, w: 756, h: 820 } as const;
export const CAMEO = { w: 324, h: 320, bottom: 1500 } as const;
/** The speaker's cameo box: lower-left for Uco, lower-right for Ocu, inside the safe columns, ending at y 1500. */
export function cameoBox(who: "uco" | "ocu"): { x: number; y: number; w: number; h: number } {
  return { x: who === "uco" ? 60 : 940 - CAMEO.w, y: CAMEO.bottom - CAMEO.h, w: CAMEO.w, h: CAMEO.h };
}

/** A prop without a keyword pops in this long after the voice starts (0.25 s). */
export const PROP_LEAD = Math.round(0.25 * FPS);

/**
 * Frame (inside the beat) where the prop pops in, never before the voice starts: on the hook beat right as the voice
 * starts (frame one hooks the viewer), else just before the word that calls it up is spoken (read from the line's
 * text and spread over the spoken frames, as the subtitles are), else 0.25 s after the voice starts.
 */
export function propEntryFrame(
  text: string | null | undefined,
  rx: RegExp | null,
  envelope: number[],
  durationInFrames: number,
  opts: { speechStart?: number; speechEnd?: number; hook?: boolean } = {},
): number {
  const start = Math.max(0, opts.speechStart ?? 0);
  const end = Math.max(start + 1, Math.min(durationInFrames, opts.speechEnd ?? durationInFrames));
  if (opts.hook) return start;
  const latest = Math.max(start + PROP_LEAD, Math.min(durationInFrames - 20, Math.round(durationInFrames * 0.6)));
  const t = text ?? "";
  const m = rx ? new RegExp(rx.source, rx.flags.replace("g", "")).exec(t) : null;
  if (!m || !t.length) return Math.min(start + PROP_LEAD, Math.max(start, durationInFrames - 1));
  const voiced = envelope.map((v, i) => (v > 0.08 ? i : -1)).filter((i) => i >= start && i < end);
  const frames = voiced.length >= 6 ? voiced : Array.from({ length: end - start }, (_, i) => start + i);
  const at = frames[Math.min(frames.length - 1, Math.floor((m.index / t.length) * frames.length))] - 3;
  return Math.max(start, Math.min(latest, at));
}

/** Frame (inside the outro) where Ocu's arrow taps FOLLOW +: after the arrow has drawn on, with time left to read
 *  FOLLOWED ✔ (frame 40 of the 3-second end card; earlier on a short merged outro). */
export function ctaTapFrame(durationInFrames: number): number {
  return Math.max(26, Math.min(40, durationInFrames - 30));
}

/** Index of the subtitle word being spoken at `frame` (the last one whose start has passed), or −1. */
export function activeWord(c: SubtitleChunk, frame: number): number {
  let k = -1;
  c.words.forEach((w, i) => {
    if (frame >= w.startFrame) k = i;
  });
  return k;
}
