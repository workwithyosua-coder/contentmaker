// Turns any picked image (a phone-gallery JPEG, a flat-white PNG, a WebP/GIF/AVIF) into a clean transparent prop PNG,
// in the browser, before it's uploaded. Deterministic pixel rules, no AI:
//   1. scale down to at most 1024 px on the long side (aspect ratio kept)
//   2. an image that already has meaningful transparency is kept as it is
//   3. an opaque image (when "Remove white background" is on): flood-fill from the borders through connected
//      near-white pixels (the background), make them transparent, then soften a 2 px fringe so dark comic outlines
//      stay crisp without a white halo; white areas *inside* the drawing are never touched
//   4. export a PNG
// The pixel functions are pure (they take and return RGBA arrays), so the unit tests run them without a browser.

export type Rgba = { width: number; height: number; data: Uint8ClampedArray };

export const MAX_SIDE = 1024;

/** Output size for an image of w × h, fitting inside max × max (never upscaled). */
export function fitWithin(w: number, h: number, max = MAX_SIDE): { width: number; height: number } {
  const s = Math.min(1, max / Math.max(w, h));
  return { width: Math.max(1, Math.round(w * s)), height: Math.max(1, Math.round(h * s)) };
}

/** True when enough pixels are see-through (alpha < 250) to treat the image as already cut out: ≥ 0.5 % of them. */
export function hasMeaningfulTransparency(img: Rgba, minShare = 0.005): boolean {
  const { data } = img;
  const total = data.length / 4;
  let count = 0;
  const need = Math.max(1, Math.ceil(total * minShare));
  for (let i = 3; i < data.length; i += 4) if (data[i] < 250 && ++count >= need) return true;
  return false;
}

export type WhiteOptions = {
  /** a pixel is "near white" when its darkest channel is at least this (JPEG backgrounds are rarely pure 255) */
  minChannel?: number;
  /** …and its channels differ by at most this (keeps pale yellows and blues) */
  maxSpread?: number;
  /** soft edge width in px between the cut-out and the removed background */
  fringe?: number;
};

/**
 * Removes the white background connected to the image border. Returns a new image and how many pixels were
 * cleared. Near-white pixels that aren't connected to the border (a white plate, eye highlights) stay opaque.
 */
export function removeWhiteBackground(img: Rgba, opts: WhiteOptions = {}): { image: Rgba; cleared: number } {
  const { width: w, height: h } = img;
  const minChannel = opts.minChannel ?? 232;
  const maxSpread = opts.maxSpread ?? 18;
  const fringe = Math.max(0, Math.min(3, opts.fringe ?? 2));
  const src = img.data;
  const out = new Uint8ClampedArray(src);
  const n = w * h;
  const near = (p: number) => {
    const i = p * 4;
    const r = src[i];
    const g = src[i + 1];
    const b = src[i + 2];
    const mn = Math.min(r, g, b);
    return mn >= minChannel && Math.max(r, g, b) - mn <= maxSpread && src[i + 3] > 0;
  };

  // 1. flood-fill (4-connected) from every near-white border pixel
  const bg = new Uint8Array(n);
  const queue = new Int32Array(n);
  let head = 0;
  let tail = 0;
  const seed = (p: number) => {
    if (!bg[p] && near(p)) {
      bg[p] = 1;
      queue[tail++] = p;
    }
  };
  for (let x = 0; x < w; x++) {
    seed(x);
    seed((h - 1) * w + x);
  }
  for (let y = 0; y < h; y++) {
    seed(y * w);
    seed(y * w + w - 1);
  }
  while (head < tail) {
    const p = queue[head++];
    const x = p % w;
    if (x > 0) seed(p - 1);
    if (x < w - 1) seed(p + 1);
    if (p >= w) seed(p - w);
    if (p < n - w) seed(p + w);
  }

  // 2. clear the background
  let cleared = 0;
  for (let p = 0; p < n; p++) {
    if (!bg[p]) continue;
    out[p * 4 + 3] = 0;
    cleared++;
  }

  // 3. defringe: kept pixels within `fringe` px of the background get alpha from how dark they are (a light
  //    anti-aliasing pixel fades out, a dark outline pixel stays solid) and their colour un-mixed from white
  if (fringe > 0 && cleared) {
    const dist = new Uint8Array(n).fill(255);
    head = 0;
    tail = 0;
    for (let p = 0; p < n; p++) {
      if (bg[p]) {
        dist[p] = 0;
        queue[tail++] = p;
      }
    }
    while (head < tail) {
      const p = queue[head++];
      if (dist[p] >= fringe) continue;
      const x = p % w;
      const y = (p - x) / w;
      for (let dy = -1; dy <= 1; dy++) {
        for (let dx = -1; dx <= 1; dx++) {
          const nx = x + dx;
          const ny = y + dy;
          if ((!dx && !dy) || nx < 0 || ny < 0 || nx >= w || ny >= h) continue;
          const q = ny * w + nx;
          if (dist[q] > dist[p] + 1) {
            dist[q] = dist[p] + 1;
            queue[tail++] = q;
          }
        }
      }
    }
    for (let p = 0; p < n; p++) {
      // near-white pixels that weren't flooded are inside the drawing (behind a thin outline): never fade those
      if (bg[p] || dist[p] > fringe || near(p)) continue;
      const i = p * 4;
      const mn = Math.min(src[i], src[i + 1], src[i + 2]);
      const a = Math.max(0, Math.min(1, (255 - mn) / 185)); // dark (≤ 70) → fully opaque
      if (a >= 1) continue;
      out[i + 3] = Math.round(Math.min(src[i + 3], a * 255));
      if (a > 0) for (let c = 0; c < 3; c++) out[i + c] = Math.max(0, Math.min(255, Math.round((src[i + c] - (1 - a) * 255) / a)));
    }
  }
  return { image: { width: w, height: h, data: out }, cleared };
}

/** The whole pipeline on pixels (after decoding and scaling): keep transparency, or cut out a white background. */
export function processPixels(img: Rgba, removeWhite: boolean): { image: Rgba; hadTransparency: boolean; removedBackground: boolean } {
  if (hasMeaningfulTransparency(img)) return { image: img, hadTransparency: true, removedBackground: false };
  if (!removeWhite) return { image: img, hadTransparency: false, removedBackground: false };
  const { image, cleared } = removeWhiteBackground(img);
  return { image, hadTransparency: false, removedBackground: cleared > 0 };
}

export type ProcessedProp = { blob: Blob; width: number; height: number; hadTransparency: boolean; removedBackground: boolean };

/**
 * Browser only: decodes any image the browser can read, scales it to ≤ 1024 px, applies processPixels and exports a
 * PNG Blob. Throws a readable error when the file can't be decoded.
 */
export async function processPropFile(file: Blob, opts: { removeWhite: boolean }): Promise<ProcessedProp> {
  let bitmap: ImageBitmap;
  try {
    bitmap = await createImageBitmap(file);
  } catch {
    throw new Error("Couldn't read that image. Pick a JPEG, PNG, WebP, GIF or AVIF file.");
  }
  const { width, height } = fitWithin(bitmap.width, bitmap.height);
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext("2d", { willReadFrequently: true });
  if (!ctx) throw new Error("This browser can't process images. Try another browser.");
  ctx.imageSmoothingQuality = "high";
  ctx.drawImage(bitmap, 0, 0, width, height);
  bitmap.close();
  const pixels = ctx.getImageData(0, 0, width, height);
  const r = processPixels({ width, height, data: pixels.data }, opts.removeWhite);
  if (r.image.data !== pixels.data) ctx.putImageData(new ImageData(new Uint8ClampedArray(r.image.data), width, height), 0, 0);
  const blob = await new Promise<Blob | null>((res) => canvas.toBlob(res, "image/png"));
  if (!blob) throw new Error("Couldn't convert the image to PNG. Try another file.");
  return { blob, width, height, hadTransparency: r.hadTransparency, removedBackground: r.removedBackground };
}
