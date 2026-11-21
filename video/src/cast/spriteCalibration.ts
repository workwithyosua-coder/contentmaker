// Where each uploaded sprite's head is, measured on the exported 900×1700 PNG. Sprites are always drawn at their own
// proportions (never stretched); the Director reads these to size and place each figure so the hair stays inside the
// safe zone, the mouth above the subtitles, and the face where the shot wants it.
// Sprites not listed here are assumed to use the README framing (hair top 40, chin 520, face centred on x 450).

export type HeadBox = {
  hairTop: number;
  chin: number;
  faceX: number;
  /** pointing fingertip (px on the 900×1700 sprite), for poses that point at TikTok's + Follow */
  fingertip?: { x: number; y: number };
  /** centre of the comic sweat drop: just outside the temple/cheek silhouette (on the sprite's left), clear of
   *  the glasses and below the hair */
  sweat?: { x: number; y: number };
  /** eye whites (ellipses on the sprite), covered with eyelid skin and an ink lash line for a blink */
  eyes?: Eye[];
  /** eyelid skin colour, sampled around the eyes */
  skin?: string;
  /** mouth region (closed and open frames combined), for the 3-stage lip sync */
  mouth?: { x0: number; y0: number; x1: number; y1: number };
};
export type Eye = { cx: number; cy: number; rx: number; ry: number };
export const TARGET_HEAD: HeadBox = { hairTop: 40, chin: 520, faceX: 450 };

// sweat drops: the head's left silhouette edge at temple height (y 430) is x 262–272 on Uco's sprites and x 171–177
// on Ocu's; the drop sits ~50 px outside it
const UCO_SWEAT = { x: 215, y: 440 };
const OCU_SWEAT = { x: 122, y: 430 };

// eyes: the eye-white blobs on each sprite (all poses of a character share a head alignment, so one set fits all),
// padded a few px so pupils are covered too; skin: the median colour of the lids around them
const UCO_EYES: Eye[] = [
  { cx: 328, cy: 471, rx: 33, ry: 38 },
  { cx: 461, cy: 469, rx: 42, ry: 38 },
];
const OCU_EYES: Eye[] = [
  { cx: 394, cy: 508, rx: 50, ry: 20 },
  { cx: 543, cy: 507, rx: 35, ry: 19 },
];
const UCO = { sweat: UCO_SWEAT, eyes: UCO_EYES, skin: "#F6A86B" };
const OCU = { sweat: OCU_SWEAT, eyes: OCU_EYES, skin: "#96BABD" };

const MEASURED: Record<string, HeadBox> = {
  // closed and open frames share one crop, so one entry covers both
  // both pairs were exported at one shared head size (hair top y 150, chin y 720) and sit flush at y 1700
  "uco/triumphant": { hairTop: 150, chin: 720, faceX: 410, ...UCO, mouth: { x0: 321, y0: 558, x1: 503, y1: 708 } },
  "ocu/deadpan": { hairTop: 150, chin: 720, faceX: 493, ...OCU, mouth: { x0: 371, y0: 608, x1: 535, y1: 692 } },
  // batch 1: each head was aligned to the starter's head ink before export, so the box is identical
  "uco/defensive": { hairTop: 150, chin: 720, faceX: 410, ...UCO, mouth: { x0: 335, y0: 592, x1: 468, y1: 659 } },
  "uco/shocked": { hairTop: 150, chin: 720, faceX: 410, ...UCO, mouth: { x0: 332, y0: 584, x1: 486, y1: 711 } },
  "ocu/cta": { hairTop: 150, chin: 720, faceX: 493, ...OCU, mouth: { x0: 371, y0: 608, x1: 532, y1: 698 }, fingertip: { x: 816, y: 721 } },
  "uco/phone": { hairTop: 150, chin: 720, faceX: 410, ...UCO, mouth: { x0: 324, y0: 555, x1: 502, y1: 695 } },
  "ocu/explaining": { hairTop: 150, chin: 720, faceX: 493, ...OCU, mouth: { x0: 376, y0: 618, x1: 530, y1: 698 } },
  // angry (Studio Assets uploads): assumed exported in the same 900×1700 framing as the set above; no eye or mouth
  // boxes are measured for an upload, so it blinks not and swaps its two mouth frames
  "uco/angry": { hairTop: 150, chin: 720, faceX: 410, sweat: UCO_SWEAT },
  "ocu/angry": { hairTop: 150, chin: 720, faceX: 493, sweat: OCU_SWEAT },
  "ocu/inspecting": { hairTop: 150, chin: 720, faceX: 493, ...OCU, mouth: { x0: 372, y0: 608, x1: 535, y1: 696 } },
};

export const headBoxFor = (who: "uco" | "ocu", emotion: string): HeadBox => MEASURED[`${who}/${emotion}`] ?? TARGET_HEAD;

/** Sweat-drop centre for a head box: measured, else just left of an average head at temple height. */
export function sweatPoint(h: HeadBox): { x: number; y: number } {
  const len = h.chin - h.hairTop;
  return h.sweat ?? { x: h.faceX - 0.42 * len - 45, y: h.hairTop + 0.5 * len };
}
