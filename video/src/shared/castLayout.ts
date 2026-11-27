// Where the characters sit in each shot: figure-frame sizes, the hair / mouth limits and the takeover cameo framing.
// Pure code (no React, no CSS), shared by the Director and the unit tests, so "the mouth never reaches the subtitles"
// and "the cameo is filled" are checked for every pose.

import { castSprites } from "../assets";
import { SAFE_ZONE } from "../beats";
import { headBoxFor } from "../cast/spriteCalibration";
import { CAMEO, SUBTITLE_BAND, cameoBox } from "./motion";

/** Where the head sits inside a figure's frame, as fractions of the frame (sprite: calibrated; coded SVG: its drawing). */
export type HeadFrac = { hair: number; chin: number; mouth: number; faceX: number };
const SVG_HEAD: HeadFrac = { hair: 8 / 340, chin: 104 / 340, mouth: 86 / 340, faceX: 0.5 };

/**
 * The head's place in a character's figure frame for a pose. Uploaded sprites (Studio Assets) are drawn framed to the
 * same calibration (spriteFrame.ts), so the numbers hold for them too.
 */
export function headFracFor(who: "uco" | "ocu", emotion: string): { frac: HeadFrac; sprite: boolean; tip: { x: number; y: number } | null; lens: { x: number; y: number; r: number } | null } {
  const sp = castSprites(who, emotion);
  if (!sp) return { frac: SVG_HEAD, sprite: false, tip: null, lens: null };
  const h = headBoxFor(who, sp.emotion);
  return {
    frac: { hair: h.hairTop / 1700, chin: h.chin / 1700, mouth: (h.hairTop + 0.8 * (h.chin - h.hairTop)) / 1700, faceX: h.faceX / 900 },
    sprite: true,
    // fingertip as fractions of the figure frame
    tip: h.fingertip && sp.emotion === emotion ? { x: h.fingertip.x / 900, y: h.fingertip.y / 1700 } : null,
    // magnifying-glass lens as fractions of the figure frame (r as a fraction of its width)
    lens: h.lens && sp.emotion === emotion ? { x: h.lens.x / 900, y: h.lens.y / 1700, r: h.lens.r / 900 } : null,
  };
}

export const FRAME_BOTTOM = 1920;
/** highest point for hair and stage items: just inside the TikTok top bar */
export const STAGE_TOP = SAFE_ZONE.top + 24;
export const STAGE_BOTTOM = 1080;
/** solo medium shot: figure frame height (≈1.2× the old card-limited framing), never stretched */
export const SOLO_H = 1760;
/** two-shot / CTA figure frame height */
export const PAIR_H = 1440;
/** pointing CTA: figure frame height and face positions (heads clear of each other) */
// Uco's sprite reaches 374 px left of his face (his arm) and Ocu's 357 px right of his: at 1100 px tall (scale 0.647)
// Uco's face at x 250 keeps his arm and hair inside the frame (left edge ≈ 8), and Ocu's at 671 keeps the heads apart
// (≥ 401 px + margin) with his fingertip at x ≈ 880, clear of the right-hand icon rail.
export const CTA_H = 1100;
export const CTA_FACE = { uco: 250, ocu: 671 } as const;
/** mouths stay above TikTok's caption area (y 1260+), and so far above the subtitles (y 1540..1630) */
export const MOUTH_MAX_Y = 1100;
/** …and nothing of a face may come below this on any beat (the subtitle pill starts 60 px lower) */
export const FACE_MAX_Y = 1480;

/**
 * Figure frame height for a wanted size, kept between "hair under the stage top" and "mouth above the subtitles", with
 * the frame's bottom on the bottom of the video (no stretching: the sprite keeps its own proportions).
 */
export function fitFrameH(f: HeadFrac, want: number, hairMin = STAGE_TOP): number {
  const hMax = (FRAME_BOTTOM - hairMin) / (1 - f.hair);
  const hMin = (FRAME_BOTTOM - MOUTH_MAX_Y) / (1 - f.mouth);
  return Math.max(hMin, Math.min(want, hMax));
}

/** Close-up: the head fills the space between `hairMin` and the mouth limit (the chin may dip below it). */
export function closeupFrameH(f: HeadFrac, hairMin: number): number {
  const mouthInHead = (f.mouth - f.hair) / (f.chin - f.hair);
  const headPx = (MOUTH_MAX_Y - hairMin) / mouthInHead;
  return headPx / (f.chin - f.hair);
}

/** A figure's head on the canvas for a frame `H` tall whose bottom is at `bottom`. */
export function headOnCanvas(f: HeadFrac, H: number, bottom = FRAME_BOTTOM) {
  const top = bottom - H;
  return { hair: top + f.hair * H, mouth: top + f.mouth * H, chin: top + f.chin * H };
}

/**
 * The speaker inside the Evidence Takeover cameo (box coordinates): head-and-shoulders, the head filling ~58 % of the
 * box's height with its hair 22 px under the top edge, face centred. Same framing for every pose, upload or not.
 */
export function cameoFigure(who: "uco" | "ocu", emotion: string) {
  const f = headFracFor(who, emotion).frac;
  const box = cameoBox(who);
  const H = (box.h * 0.58) / (f.chin - f.hair);
  const s = H / 340;
  const w = 180 * s;
  return { box, H, s, w, left: box.w / 2 - f.faceX * w, top: 22 - f.hair * H, frac: f };
}

/** The cameo can't reach the subtitles: its box ends at y 1500, above the 1540 band. */
export const CAMEO_CLEAR = CAMEO.bottom < SUBTITLE_BAND.top;

/**
 * Ocu's magnifying-glass lens on the canvas for a placed figure (frame left / top / scale `s`, the 180 × 340 view),
 * or null when the pose has no measured lens.
 */
export function lensOnCanvas(fig: { cx: number; top: number; s: number }, lens: { x: number; y: number; r: number } | null): { x: number; y: number; r: number } | null {
  if (!lens) return null;
  const w = 180 * fig.s;
  const h = 340 * fig.s;
  return { x: fig.cx - w / 2 + lens.x * w, y: fig.top + lens.y * h, r: lens.r * w };
}

/** Ocu's face x in a solo inspecting shot: 100 px left of his usual 740, so the magnifying glass (and the prop he
 *  examines just above it) lands inside the safe columns instead of on the right-hand icon rail. */
export const INSPECT_FACE_X = 640;
/** Two-shot faces while Ocu inspects a prop: the pair shifted left (Uco 300 → 260, Ocu 790 → 700) for the same reason. */
export const INSPECT_PAIR_X = { uco: 260, ocu: 700 } as const;
