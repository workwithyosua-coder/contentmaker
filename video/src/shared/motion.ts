// Frame-driven motion for the Director styles: lip-sync stages, blinks, audio-reactive body motion, camera moves,
// the 4-frame cut transition and when a prop pops in. Pure functions of (frame, beat, envelope), so every render of
// the same episode is identical and the rules can be unit-tested without a browser.

import type { Beat, SubtitleChunk } from "../beats";
import { FPS } from "../types";

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
export function cameraAt(b: Beat, frame: number, basePush: [number, number] = [1, 1.04]): { scale: number; rotate: number } {
  if (b.cameraShot === "cta-stinger") return { scale: 1, rotate: 0 };
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
  return { scale, rotate };
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

/** Default prop entrance: ~0.35 s into the beat. */
export const PROP_ENTRY = Math.round(0.35 * FPS);

/**
 * Frame (inside the beat) where the prop pops in: just before the word that calls it up is spoken, read from the
 * line's text and spread over the voiced frames (as the subtitles are), else ~0.35 s in.
 */
export function propEntryFrame(text: string | null | undefined, rx: RegExp | null, envelope: number[], durationInFrames: number): number {
  const latest = Math.max(PROP_ENTRY, Math.min(durationInFrames - 20, Math.round(durationInFrames * 0.6)));
  const t = text ?? "";
  const m = rx ? new RegExp(rx.source, rx.flags.replace("g", "")).exec(t) : null;
  if (!m || !t.length) return Math.min(PROP_ENTRY, latest);
  const voiced = envelope.map((v, i) => (v > 0.08 ? i : -1)).filter((i) => i >= 0 && i < durationInFrames);
  const frames = voiced.length >= 6 ? voiced : Array.from({ length: durationInFrames }, (_, i) => i);
  const at = frames[Math.min(frames.length - 1, Math.floor((m.index / t.length) * frames.length))] - 3;
  return Math.max(6, Math.min(latest, at));
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
