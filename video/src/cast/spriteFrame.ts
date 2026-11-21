// Framing for uploaded sprites (Studio Assets). The repo's sprites are drawn on a fixed 900×1700 frame and calibrated
// by hand (spriteCalibration.ts); an upload can be any shape, with the character anywhere in it. Drawn as is, a square
// or padded upload shrinks to the frame's width and sinks to its bottom: the head vanishes under a takeover cameo's
// edge or behind the subtitles. Instead, the drawn content (the opaque pixels) is measured once and placed so its top
// lands on the calibrated hair line, its bottom on the frame's bottom and its head on the calibrated face line,
// exactly like the hand-calibrated sprites. Deterministic pixel rules, no AI.

/** The opaque content of an image, in its own pixels, plus the centre of its head (the top fifth of the content). */
export type SpriteBox = { w: number; h: number; top: number; bottom: number; left: number; right: number; headCx: number };

const ALPHA = 24;

/** Measures the opaque content of RGBA pixels (alpha > 24). Null when the image is empty. */
export function boxFromAlpha(data: ArrayLike<number>, w: number, h: number): SpriteBox | null {
  let top = -1;
  let bottom = -1;
  let left = w;
  let right = -1;
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      if (data[(y * w + x) * 4 + 3] > ALPHA) {
        if (top < 0) top = y;
        bottom = y;
        if (x < left) left = x;
        if (x > right) right = x;
      }
    }
  }
  if (top < 0) return null;
  // the head's centre: the mean column of opaque pixels in the top fifth of the content (hair and face)
  const headRows = Math.max(1, Math.round((bottom - top + 1) * 0.2));
  let sum = 0;
  let n = 0;
  for (let y = top; y < top + headRows; y++) {
    for (let x = left; x <= right; x++) {
      if (data[(y * w + x) * 4 + 3] > ALPHA) {
        sum += x;
        n++;
      }
    }
  }
  return { w, h, top, bottom: bottom + 1, left, right: right + 1, headCx: n ? sum / n + 0.5 : (left + right + 1) / 2 };
}

/** The 900×1700 sprite frame every figure is laid out in. */
export const SPRITE_FRAME = { w: 900, h: 1700 } as const;

/**
 * Where to draw a measured upload inside its figure frame (percent of the frame): scaled so its content runs from the
 * calibrated hair line (`hairTop`, px on the 900×1700 frame) to the frame's bottom, shifted so its head sits on the
 * calibrated face line (`faceX`). Matches the head size and position of the hand-calibrated sprites.
 */
export function framedRect(box: SpriteBox, hairTop: number, faceX: number): { left: number; top: number; width: number; height: number } {
  const contentH = Math.max(1, box.bottom - box.top);
  // image px → frame px
  const s = (SPRITE_FRAME.h - hairTop) / contentH;
  const width = box.w * s;
  const height = box.h * s;
  const top = hairTop - box.top * s;
  const left = faceX - box.headCx * s;
  return { left: (left / SPRITE_FRAME.w) * 100, top: (top / SPRITE_FRAME.h) * 100, width: (width / SPRITE_FRAME.w) * 100, height: (height / SPRITE_FRAME.h) * 100 };
}

// measured boxes by URL (the preview measures before playback; the renderer at the composition's start)
const boxes = new Map<string, SpriteBox>();
export const registerSpriteBox = (url: string, box: SpriteBox) => void boxes.set(url, box);
export const spriteBox = (url: string): SpriteBox | null => boxes.get(url) ?? null;

/**
 * Browser only: loads an image (CORS: Supabase's public URLs allow it), draws it at ≤ 400 px and measures its content,
 * scaled back to the image's own pixels. Null when it can't be read; the sprite is then drawn as before.
 */
export async function measureSprite(url: string): Promise<SpriteBox | null> {
  const hit = boxes.get(url);
  if (hit) return hit;
  try {
    const img = new Image();
    img.crossOrigin = "anonymous";
    img.src = url;
    await img.decode();
    const k = Math.min(1, 400 / Math.max(img.naturalWidth, img.naturalHeight));
    const w = Math.max(1, Math.round(img.naturalWidth * k));
    const h = Math.max(1, Math.round(img.naturalHeight * k));
    const canvas = document.createElement("canvas");
    canvas.width = w;
    canvas.height = h;
    const ctx = canvas.getContext("2d", { willReadFrequently: true });
    if (!ctx) return null;
    ctx.drawImage(img, 0, 0, w, h);
    const b = boxFromAlpha(ctx.getImageData(0, 0, w, h).data, w, h);
    if (!b) return null;
    const u = 1 / k;
    const box = { w: img.naturalWidth, h: img.naturalHeight, top: b.top * u, bottom: b.bottom * u, left: b.left * u, right: b.right * u, headCx: b.headCx * u };
    boxes.set(url, box);
    return box;
  } catch {
    return null;
  }
}
