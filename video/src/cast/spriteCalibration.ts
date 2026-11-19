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
};
export const TARGET_HEAD: HeadBox = { hairTop: 40, chin: 520, faceX: 450 };

// sweat drops: the head's left silhouette edge at temple height (y 430) is x 262–272 on Uco's sprites and x 171–177
// on Ocu's; the drop sits ~50 px outside it
const UCO_SWEAT = { x: 215, y: 440 };
const OCU_SWEAT = { x: 122, y: 430 };

const MEASURED: Record<string, HeadBox> = {
  // closed and open frames share one crop, so one entry covers both
  // both pairs were exported at one shared head size (hair top y 150, chin y 720) and sit flush at y 1700
  "uco/triumphant": { hairTop: 150, chin: 720, faceX: 410, sweat: UCO_SWEAT },
  "ocu/deadpan": { hairTop: 150, chin: 720, faceX: 493, sweat: OCU_SWEAT },
  // batch 1: each head was aligned to the starter's head ink before export, so the box is identical
  "uco/defensive": { hairTop: 150, chin: 720, faceX: 410, sweat: UCO_SWEAT },
  "uco/shocked": { hairTop: 150, chin: 720, faceX: 410, sweat: UCO_SWEAT },
  "ocu/cta": { hairTop: 150, chin: 720, faceX: 493, sweat: OCU_SWEAT, fingertip: { x: 816, y: 721 } },
  "uco/phone": { hairTop: 150, chin: 720, faceX: 410, sweat: UCO_SWEAT },
  "ocu/explaining": { hairTop: 150, chin: 720, faceX: 493, sweat: OCU_SWEAT },
  "ocu/inspecting": { hairTop: 150, chin: 720, faceX: 493, sweat: OCU_SWEAT },
};

export const headBoxFor = (who: "uco" | "ocu", emotion: string): HeadBox => MEASURED[`${who}/${emotion}`] ?? TARGET_HEAD;

/** Sweat-drop centre for a head box: measured, else just left of an average head at temple height. */
export function sweatPoint(h: HeadBox): { x: number; y: number } {
  const len = h.chin - h.hairTop;
  return h.sweat ?? { x: h.faceX - 0.42 * len - 45, y: h.hairTop + 0.5 * len };
}
