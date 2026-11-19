// Where each uploaded sprite's head is, measured on the exported 900×1700 PNG. Sprites are always drawn at their own
// proportions (never stretched); the Director reads these to size and place each figure so the hair stays under the
// headline card, the mouth above the subtitles, and the face where the shot wants it.
// Sprites not listed here are assumed to use the README framing (hair top 40, chin 520, face centred on x 450).

export type HeadBox = {
  hairTop: number;
  chin: number;
  faceX: number;
  /** pointing fingertip (px on the 900×1700 sprite), for poses that point at TikTok's + Follow */
  fingertip?: { x: number; y: number };
};
export const TARGET_HEAD: HeadBox = { hairTop: 40, chin: 520, faceX: 450 };

const MEASURED: Record<string, HeadBox> = {
  // closed and open frames share one crop, so one entry covers both
  // both pairs were exported at one shared head size (hair top y 150, chin y 720) and sit flush at y 1700
  "uco/triumphant": { hairTop: 150, chin: 720, faceX: 410 },
  "ocu/deadpan": { hairTop: 150, chin: 720, faceX: 493 },
  // batch 1: each head was aligned to the starter's head ink before export, so the box is identical
  "uco/defensive": { hairTop: 150, chin: 720, faceX: 410 },
  "uco/shocked": { hairTop: 150, chin: 720, faceX: 410 },
  "ocu/cta": { hairTop: 150, chin: 720, faceX: 493, fingertip: { x: 816, y: 721 } },
};

export const headBoxFor = (who: "uco" | "ocu", emotion: string): HeadBox => MEASURED[`${who}/${emotion}`] ?? TARGET_HEAD;
