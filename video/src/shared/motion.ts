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

/** Per character: bounce on vocal peaks (px), squash-stretch, head / torso tilt (°) and its sway period (frames). */
export const BODY_ENERGY = {
  uco: { bob: 12, stretch: 0.045, squash: 0.025, tilt: 2.8, sway: 9 },
  ocu: { bob: 6, stretch: 0.045, squash: 0.025, tilt: 1.2, sway: 14 },
} as const;
/** Idle breathing, always on (talking, listening or thinking): a slow 1.5 px rise and a 0.5 % chest swell. */
const BREATH = { px: 1.5, swell: 0.005, period: 22 };

/**
 * Audio-reactive puppet motion in canvas px / degrees, driven by the voice's loudness (0..1): a clear vertical bounce
 * on peaks (Uco up to 12 px, Ocu up to 6: a loud peak, level ≥ 0.5, lifts Uco 6-12 px and Ocu 3-6), squash-stretch
 * (scaleY up to 1.045, scaleX down to 0.975) and a swaying tilt (±2.8° Uco, ±1.2° Ocu), over a breathing idle so a
 * figure is never frozen. Inner thoughts only breathe.
 */
export function bodyMotion(who: "uco" | "ocu", level: number, globalFrame: number, thought: boolean): { dy: number; sx: number; sy: number; tilt: number } {
  const b = Math.sin((2 * Math.PI * globalFrame) / (BREATH.period * 4));
  const idle = { dy: -BREATH.px * b, sy: 1 + BREATH.swell * b };
  if (thought) return { dy: idle.dy, sx: 1, sy: idle.sy, tilt: 0 };
  const l = Math.min(1, Math.max(0, level));
  const e = BODY_ENERGY[who];
  return { dy: idle.dy - e.bob * l, sx: 1 - e.squash * l, sy: idle.sy * (1 + e.stretch * l), tilt: e.tilt * l * Math.sin(globalFrame / e.sway) };
}

/** Frames of a speaker's entrance after a cut. */
export const ENTRANCE_FRAMES = 6;
/**
 * A speaker landing on a cut: a 6-frame spring (scale 0.92 → 1.03 at frame 3 → 1.00) with a short slide in from their
 * side (Uco from the left, Ocu from the right), so cuts land with a punch instead of teleporting.
 */
export function entranceAt(who: "uco" | "ocu", frame: number): { scale: number; dx: number } {
  if (frame >= ENTRANCE_FRAMES) return { scale: 1, dx: 0 };
  const f = Math.max(0, frame);
  const scale = f <= 3 ? 0.92 + (1.03 - 0.92) * ease(f / 3) : 1.03 + (1 - 1.03) * ((f - 3) / 3);
  return { scale, dx: (who === "uco" ? -1 : 1) * 46 * (1 - ease(f / ENTRANCE_FRAMES)) };
}

const ease = (t: number) => {
  const c = Math.min(1, Math.max(0, t));
  return 1 - Math.pow(1 - c, 3);
};

/** Beats that explain something get the slow Ken Burns push. */
export function isExplanation(b: Beat): boolean {
  return b.beatType === "insight" || b.emotion === "explaining" || b.emotion === "inspecting" || Boolean(b.overlay);
}

/** A beat longer than this gets a mid-beat accent (2.8 s): no shot holds still longer than ~1.8 s after it. */
export const LONG_BEAT = Math.round(2.8 * FPS);
/** The mid-beat accent: a crisp +8 % punch-in. */
export const MICRO_PUNCH = 1.08;
/** Punch close-up: the camera snaps to 1.26× (overshooting to 1.30) framed on face and upper chest, ±2.5° Dutch tilt. */
export const PUNCH_SCALE = 1.26;
export const PUNCH_TILT = 2.5;
/** Slow dramatic creep on investigative / explaining lines: 1.00 → 1.10 over the beat. */
export const CREEP = [1, 1.1] as const;
/** The tightest the camera gets on a beat with an explainer card (creep × mid-beat punch): the card's clearance. */
export const CARD_CAMERA_MAX = CREEP[1] * MICRO_PUNCH;

export type Framing = "still" | "medium" | "punch-closeup" | "creep";
/**
 * The beat's camera framing: punch-closeup for shocked / angry lines and deadpan punchlines (never on a card, a takeover
 * or a thought), a slow creep on explaining / inspecting lines, else the medium push-in. The outro stays still.
 */
export function framingOf(b: Pick<Beat, "cameraShot" | "emotion" | "thought" | "overlay" | "layout" | "angry" | "beatType">): Framing {
  if (b.cameraShot === "cta-stinger") return "still";
  if (!b.thought && !b.overlay && b.layout !== "takeover" && (b.emotion === "shocked" || b.angry || (b.emotion === "deadpan" && b.beatType === "button"))) return "punch-closeup";
  if (isExplanation(b as Beat)) return "creep";
  return "medium";
}

/** Frame (inside the beat) of the mid-beat accent: half way through a beat over 2.8 s, else null. */
export function midAccentFrame(b: Pick<Beat, "durationInFrames" | "cameraShot">): number | null {
  return b.cameraShot !== "cta-stinger" && b.durationInFrames > LONG_BEAT ? Math.round(b.durationInFrames * 0.5) : null;
}

/**
 * The camera for one beat, by framing: medium (the style's push-in), creep (1.00 → 1.10), or punch-closeup (snaps in
 * over 5 frames to 1.30 and settles at 1.26, a ±2.5° Dutch tilt, shifted toward the speaker's face; an existing extreme
 * close-up only gets a light 1.06 snap and the tilt), then the mid-beat +8 % punch-in on long beats and the impact
 * shake (an angry delivery or a keyword slam).
 */
export function cameraAt(b: Beat, frame: number, basePush: [number, number] = [1, 1.04]): Camera {
  const framing = framingOf(b);
  if (framing === "still") return { scale: 1, rotate: 0, x: 0, y: 0 };
  const t = Math.min(1, Math.max(0, frame / Math.max(1, b.durationInFrames)));
  const push = framing === "creep" ? CREEP : basePush;
  let scale = push[0] + (push[1] - push[0]) * t;
  let rotate = 0;
  let x = 0;
  let y = 0;
  if (framing === "punch-closeup") {
    const closeup = b.cameraShot === "closeup-punch";
    const target = closeup ? 1.06 : PUNCH_SCALE;
    const peak = closeup ? 1.08 : 1.3;
    const k = Math.min(1, frame / 5);
    const zoom = frame < 5 ? 1 + (peak - 1) * ease(k) : peak + (target - peak) * Math.min(1, (frame - 5) / 6);
    scale = zoom;
    const side = b.speaker === "ocu" ? 1 : -1;
    rotate = side * PUNCH_TILT * Math.min(1, frame / 5);
    // keep face and upper chest in frame: lean the frame toward the speaker's side, and a little up
    if (!closeup) {
      x = -side * 70 * (zoom - 1) / (peak - 1);
      y = 60 * (zoom - 1) / (peak - 1);
    }
  }
  const mid = midAccentFrame(b);
  if (mid !== null) scale *= 1 + (MICRO_PUNCH - 1) * ease((frame - mid) / 4);
  const shake = impactShake(frame, b.impactFrame);
  return { scale, rotate, x: x + shake.x, y: y + shake.y };
}

export type Camera = { scale: number; rotate: number; x: number; y: number };

export const SHAKE_FRAMES = 6;
export const SHAKE_PX = 5;
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
/** The largest single-line subtitle (px): up from 46, still inside the band above the platforms' bottom UI. */
export const SUBTITLE_MAX = 52;
/** The spoken word's pop: warm yellow, 1.12× for a beat. */
export const ACTIVE_WORD = { color: [0xff, 0xc8, 0x1f], scale: 1.12 } as const;
const PILL_PAD = { x: 22, y: 9 };
const LINE = 1.12;

/** Font size, lines and the dark pill's box for one subtitle chunk, always inside the band. */
export function subtitleLayout(text: string): { size: number; lines: string[]; pill: { x: number; y: number; w: number; h: number } } {
  const inner = SUBTITLE_BAND.width - 2 * PILL_PAD.x;
  const maxH = SUBTITLE_BAND.bottom - SUBTITLE_BAND.top;
  let size = SUBTITLE_MAX;
  let lines = [text];
  // one line, as large as fits (52 → 32 px); else two lines at the size whose two lines fit the band's height
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
/** Evidence Takeover: the hero stage (70 % of the canvas width, y 340..1090) and the speaker's corner cameo below it. */
export const TAKEOVER_HERO = { x: 162, y: 340, w: 756, h: 750 } as const;
/** The speaker's corner cameo: 22 % larger than the first version (324 × 320), so the narrator reads as alive. */
export const CAMEO = { w: 395, h: 390, bottom: 1500 } as const;
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

// ------------------------------------------------------------------ on-screen callout badge
/** Safe margins a callout badge never crosses, on any frame of its entrance (canvas px). */
export const BADGE_SAFE = { left: 48, right: 1032, top: 96 } as const;
const BADGE_PAD = { x: 20, top: 12, bottom: 14, border: 6 };
const BADGE_TILT = 4; // degrees (paper stamp)
const BADGE_BOB = 4; // px idle float
export const BADGE_SLAM = 1.7;

/** Largest size (76 → 44 px) at which the callout fits `w` in at most two lines. */
export function badgeFit(text: string, w: number): { size: number; lines: string[] } {
  for (let size = 76; size >= 44; size -= 4) {
    const lines = wrapHeadline(text, size, w - 40);
    if (lines.length <= 2 && lines.every((l) => textWidth(l, size) <= w - 40)) return { size, lines };
  }
  return { size: 44, lines: wrapHeadline(text, 44, w - 40) };
}

export type BadgeRect = { x: number; y: number; w: number; h: number; size: number; lines: string[] };

/**
 * The callout badge's resting rectangle on the canvas: sized to its text, aligned in its stage box, then pushed back
 * inside the safe margins with room for its tilt and idle float.
 */
export function badgeRect(text: string, box: { x: number; y: number; w: number }, align: "left" | "center" | "right", tilted = true): BadgeRect {
  // never wider than the safe area minus room for the tilt and the drop shadow
  const { size, lines } = badgeFit(text, Math.min(box.w, BADGE_SAFE.right - BADGE_SAFE.left - 40));
  const w = Math.ceil(Math.max(...lines.map((l) => textWidth(l, size))) + 2 * BADGE_PAD.x + 2 * BADGE_PAD.border);
  const h = Math.ceil(lines.length * size * 1.05 + BADGE_PAD.top + BADGE_PAD.bottom + 2 * BADGE_PAD.border);
  let x = align === "left" ? box.x : align === "right" ? box.x + box.w - w : box.x + (box.w - w) / 2;
  let y = box.y;
  const { hw, hh } = halfExtent(w, h, tilted ? BADGE_TILT : 0, 1);
  const cx = x + w / 2;
  const cy = y + h / 2;
  const ncx = Math.min(BADGE_SAFE.right - hw, Math.max(BADGE_SAFE.left + hw, cx));
  const ncy = Math.max(BADGE_SAFE.top + hh + BADGE_BOB, cy);
  x += ncx - cx;
  y += ncy - cy;
  return { x, y, w, h, size, lines };
}

/** Half the width / height of a w × h box rotated by `deg` and scaled by `k` (its axis-aligned bounds). */
function halfExtent(w: number, h: number, deg: number, k: number) {
  const r = (Math.abs(deg) * Math.PI) / 180;
  return { hw: (k * (w * Math.cos(r) + h * Math.sin(r))) / 2, hh: (k * (w * Math.sin(r) + h * Math.cos(r))) / 2 };
}

/** The largest entrance scale at which the badge, tilted and floating, still stays inside the safe margins. */
export function badgeMaxScale(r: BadgeRect, tilted = true): number {
  const cx = r.x + r.w / 2;
  const cy = r.y + r.h / 2;
  const one = halfExtent(r.w, r.h, tilted ? BADGE_TILT : 0, 1);
  const k = Math.min((cx - BADGE_SAFE.left) / one.hw, (BADGE_SAFE.right - cx) / one.hw, (cy - BADGE_BOB - BADGE_SAFE.top) / one.hh);
  return Math.max(1, Math.min(BADGE_SLAM, k));
}

/** The badge's scale on a frame: hidden before it lands, a slam from (at most) 1.7× down to 1 over 8 frames. */
export function badgeScale(frame: number, at: number, maxScale: number): number {
  const k = frame - at;
  if (k < 0) return 0;
  const t = Math.min(1, k / 8);
  return Math.min(maxScale, BADGE_SLAM) + (1 - Math.min(maxScale, BADGE_SLAM)) * t;
}

/** The badge's on-screen bounds on a frame (for the safe-margin tests). */
export function badgeBounds(r: BadgeRect, frame: number, at: number, tilted = true) {
  const k = badgeScale(frame, at, badgeMaxScale(r, tilted));
  if (!k) return null;
  const { hw, hh } = halfExtent(r.w, r.h, tilted ? BADGE_TILT : 0, k);
  const cx = r.x + r.w / 2;
  const cy = r.y + r.h / 2;
  return { left: cx - hw, right: cx + hw, top: cy - hh - BADGE_BOB, bottom: cy + hh + BADGE_BOB };
}

/** Undoes the camera move around the same origin, for overlays that must not zoom or shake off-screen. */
export function inverseCamera(cam: { scale: number; rotate: number; x: number; y: number }): string {
  return `rotate(${-cam.rotate}deg) scale(${1 / cam.scale}) translate(${-cam.x}px, ${-cam.y}px)`;
}

// ------------------------------------------------------------------ stage column (kinetic stamp, card, prop)
/** Height a kinetic block needs for `text` in a box `w` wide. */
export const kineticHeight = (text: string, w: number) => {
  const { size, lines } = badgeFit(text, w);
  return Math.ceil(lines.length * size * 1.05) + 44;
};

/** The paper stamp's drop shadow (VisualStage KineticText: 9 px down). */
const BADGE_SHADOW = 9;
/** Clear air between the callout stamp and an explainer card under it, at the stamp's biggest (mid-slam) frame. */
export const STAMP_CARD_GAP = 24;
/** Worst-case camera on a card beat (creep × the mid-beat punch; a card beat never punches close). The card zooms
 *  with the camera; the stamp doesn't (it's un-cameraed so it never zooms off-screen). */
const CAMERA_MAX = CARD_CAMERA_MAX;
/** The beat's transform origin ("50% 40%" of 1080 × 1920) */
const CAMERA_ORIGIN_Y = 768;

/** The lowest canvas y the kinetic stamp ever covers (its 1.7× slam, 4° tilt, idle float and shadow included). */
export function stampFloor(text: string, box: { x: number; y: number; w: number }, align: "left" | "center" | "right", tilted = true): number {
  const r = badgeRect(text, box, align, tilted);
  const k = badgeMaxScale(r, tilted);
  const { hh } = halfExtent(r.w, r.h, tilted ? BADGE_TILT : 0, k);
  return Math.ceil(r.y + r.h / 2 + hh + BADGE_BOB + (tilted ? BADGE_SHADOW : 0));
}

/** The highest canvas y a card placed at `y` (camera space) reaches under the worst-case camera (2° roll, shake). */
export function cardCeiling(y: number, x: number, w: number): number {
  const lift = Math.max(0, (CAMERA_MAX - 1) * (CAMERA_ORIGIN_Y - y));
  const roll = Math.max(Math.abs(x - 540), Math.abs(x + w - 540)) * Math.sin((2 * Math.PI) / 180);
  return Math.floor(y - lift - roll - SHAKE_PX);
}

export type StageBox = { x: number; y: number; w: number; h: number };
export type StageColumn = { kineticBox: StageBox | null; cardBox: StageBox | null; propBox: StageBox | null; bubbleBox: StageBox | null };

/**
 * One stage column, top-down: the kinetic stamp, then the explainer card, then the prop (a thought line puts its prop in
 * a bubble instead). Space goes to the prop first, then the stamp, then the card. A card always sits STAMP_CARD_GAP
 * under the stamp's biggest frame, camera move included, so the red stamp never covers the card's title; when both
 * can't fit, the card (the explanation) stays and the stamp gives way.
 */
export function stackColumn(
  o: { kinetic: string | null; align: "left" | "center" | "right"; tilted: boolean; thought: boolean; overlay: boolean; hasProp: boolean },
  col: { x: number; w: number },
  top: number,
  bottom: number,
  propMinH = 300,
): StageColumn {
  const out: StageColumn = { kineticBox: null, cardBox: null, propBox: null, bubbleBox: null };
  const kh = o.kinetic ? kineticHeight(o.kinetic, col.w) + 8 : 0;
  let showKinetic = Boolean(o.kinetic) && (o.thought || !o.hasProp || bottom - top - kh >= propMinH);
  if (o.thought) {
    let y = top;
    if (showKinetic) {
      out.kineticBox = { x: col.x, y, w: col.w, h: kh - 8 };
      y += kh;
    }
    out.bubbleBox = { x: col.x, y, w: col.w, h: Math.min(bottom - y, col.w * 0.95) };
    return out;
  }
  const cardAt = (y: number) => {
    const free = bottom - y - (o.hasProp ? propMinH : 0);
    const h = o.hasProp ? Math.min(300, free - 22) : Math.min(col.w * 1.15, bottom - y);
    return h >= 200 ? { x: col.x, y, w: col.w, h } : null;
  };
  let card: StageBox | null = null;
  if (o.overlay && showKinetic && o.kinetic) {
    // the lowest card top whose highest camera-moved point still clears the stamp's floor by the gap
    const floor = stampFloor(o.kinetic, { x: col.x, y: top, w: col.w }, o.align, o.tilted) + STAMP_CARD_GAP;
    let cy = floor;
    while (cardCeiling(cy, col.x, col.w) < floor) cy += 2;
    card = cardAt(cy);
    // no room for both: the explainer card takes the slot and the redundant stamp gives way
    const alone = card ? null : cardAt(top);
    if (alone) {
      card = alone;
      showKinetic = false;
    }
  } else if (o.overlay) card = cardAt(top);
  if (showKinetic) out.kineticBox = { x: col.x, y: top, w: col.w, h: kh - 8 };
  out.cardBox = card;
  const y = card ? card.y + card.h + 22 : showKinetic ? top + kh : top;
  if (o.hasProp) out.propBox = { x: col.x, y, w: col.w, h: Math.max(propMinH, bottom - y) };
  return out;
}

// ------------------------------------------------------------------ takeover stat card text
/** Largest size (≤ max, ≥ 24) at which `text` wraps into at most `maxLines` lines that each fit `w` px. */
export function statWrap(text: string, w: number, max: number, maxLines: number): { size: number; lines: string[] } {
  const t = text.toUpperCase();
  for (let size = max; size >= 24; size -= 2) {
    const lines = wrapHeadline(t, size, w);
    if (lines.length <= maxLines && lines.every((l) => textWidth(l, size) <= w)) return { size, lines };
  }
  // still too long at the smallest size: whole lines only, the last one ending on a whole word with "…"
  const lines = wrapHeadline(t, 24, w);
  if (lines.length <= maxLines) return { size: 24, lines };
  const kept = lines.slice(0, maxLines);
  kept[maxLines - 1] = `${kept[maxLines - 1].replace(/\s+\S+$/, "")}…`;
  return { size: 24, lines: kept };
}

/**
 * The stat card's headline and subline, wrapped between words and shrunk together until both fit the card's text
 * area (`w` × `h`): headline ≤ 2 lines under a prop (3 alone), subline ≤ 3 lines. Never cut mid-word.
 */
export function statCardText(stat: { headline: string; subline: string | null }, w: number, h: number, withProp: boolean) {
  const height = (hd: { size: number; lines: string[] }, sb: { size: number; lines: string[] } | null) =>
    hd.lines.length * hd.size * 1.02 + (sb ? 6 + 6 + sb.lines.length * sb.size * 1.08 : 0);
  let headMax = withProp ? 64 : 132;
  let subMax = withProp ? 36 : 56;
  for (;;) {
    const head = statWrap(stat.headline, w, headMax, withProp ? 2 : 3);
    const sub = stat.subline ? statWrap(stat.subline, w, subMax, 3) : null;
    if (height(head, sub) <= h || (headMax <= 32 && subMax <= 24)) return { head, sub, height: height(head, sub) };
    headMax = Math.max(32, headMax - 4);
    subMax = Math.max(24, subMax - 2);
  }
}

// ------------------------------------------------------------------ takeover stat card motion
/**
 * The takeover's staggered entrance, in frames from `at` (the voice onset): the headline strip slams down over 0-6
 * (with a 4 px screen shake), the red stat card springs in over 4-12, then the subline wipes on over 12-18. Each value
 * is 0..1 (`shake` in px).
 */
export const TAKEOVER_STEPS = { strip: [0, 6], card: [4, 12], sub: [12, 18], shakePx: 4 } as const;
export function takeoverTimeline(frame: number, at: number): { strip: number; card: number; sub: number; shake: { x: number; y: number } } {
  const k = frame - at;
  const span = ([a, b]: readonly [number, number]) => Math.min(1, Math.max(0, (k - a) / (b - a)));
  const shakeK = k >= 0 && k < SHAKE_FRAMES ? TAKEOVER_STEPS.shakePx * (1 - k / SHAKE_FRAMES) : 0;
  return { strip: span(TAKEOVER_STEPS.strip), card: span(TAKEOVER_STEPS.card), sub: span(TAKEOVER_STEPS.sub), shake: { x: (k % 2 ? -1 : 1) * shakeK, y: (k % 2 ? 1 : -1) * shakeK * 0.5 } };
}

/** The first number in a stat headline ("9,6 JUTA", "2.800+ KASUS", "76%", "10 KALI LIPAT"), Indonesian style. */
export function statNumber(headline: string): { value: number; decimals: number; thousands: boolean; start: number; end: number } | null {
  const m = /\d{1,3}(?:\.\d{3})+(?:,\d+)?|\d+(?:,\d+)?/.exec(headline);
  if (!m) return null;
  const [int, frac = ""] = m[0].split(",");
  return { value: Number(int.replace(/\./g, "") + (frac ? `.${frac}` : "")), decimals: frac.length, thousands: int.includes("."), start: m.index, end: m.index + m[0].length };
}

const formatId = (v: number, decimals: number, thousands: boolean) => {
  const [i, f] = v.toFixed(decimals).split(".");
  const int = thousands ? i.replace(/\B(?=(\d{3})+(?!\d))/g, ".") : i;
  return f ? `${int},${f}` : int;
};

/** Frames the number counts up over (0.6 s), then the pop when it locks. */
export const COUNT_FRAMES = Math.round(0.6 * FPS);
export const LOCK_POP_FRAMES = 6;
/**
 * The headline as shown on a frame: its number counting up from 0 over the first 0.6 s after the card lands (an
 * ease-out, so it slows into the value) in the headline's own format, then a 1.15× overshoot pop as it locks on the
 * final value. A headline without a number shows as it is.
 */
export function countUp(headline: string, frame: number, at: number): { text: string; scale: number; counting: boolean; number: string | null; final: string | null } {
  const n = statNumber(headline);
  if (!n) return { text: headline, scale: 1, counting: false, number: null, final: null };
  const start = at + TAKEOVER_STEPS.card[0];
  const k = frame - start;
  const t = Math.min(1, Math.max(0, k / COUNT_FRAMES));
  const v = n.value * ease(t);
  const shown = t >= 1 ? headline.slice(n.start, n.end) : formatId(n.decimals ? v : Math.floor(v), n.decimals, n.thousands);
  const after = k - COUNT_FRAMES;
  const scale = after >= 0 && after < LOCK_POP_FRAMES ? 1 + 0.15 * Math.sin((Math.PI * after) / LOCK_POP_FRAMES) : 1;
  return { text: headline.slice(0, n.start) + shown + headline.slice(n.end), scale, counting: t < 1, number: shown, final: headline.slice(n.start, n.end) };
}

// ------------------------------------------------------------------ inspecting: the prop at Ocu's magnifying glass
/**
 * The prop box on an inspecting beat: just above Ocu's magnifying-glass lens (canvas point + radius), the lens's top rim
 * overlapping its lower edge so he's visibly examining it, kept inside the safe columns (x 60..940) and under the
 * stage top.
 */
export function lensPropBox(lens: { x: number; y: number; r: number }, size: number, top: number, offset: { dx: number; dy: number } = { dx: 0, dy: 0 }): { x: number; y: number; w: number; h: number } {
  const w = size;
  const x = Math.min(940 - w, Math.max(60, lens.x - w * 0.6 + offset.dx));
  const y = Math.max(top, lens.y - lens.r * 0.35 - w + offset.dy);
  return { x, y, w, h: w };
}

/** Solo inspecting: a smaller (240 px) prop nudged right and up so it floats above the lens beside Ocu's face, its
 *  left edge past his right pupil and its bottom 40 px higher, instead of across his glasses and nose; the right-hand
 *  icon rail still clear (x ≤ 940). */
export const SOLO_LENS_PROP = { size: 240, dx: 70, dy: -40 } as const;

/** The prop's hover on an inspecting beat: a slow 6 px float and a gentle 1.00-1.04 zoom pulse. */
export function lensHover(frame: number): { dy: number; scale: number } {
  return { dy: -6 * Math.sin(frame / 14), scale: 1.02 + 0.02 * Math.sin(frame / 9) };
}
