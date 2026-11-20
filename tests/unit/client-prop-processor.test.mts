// Unit tests for the browser prop pipeline (pure pixel functions) and slot-based naming. No DOM, no network, no AI.
// Run: npm run test:unit
import assert from "node:assert/strict";
import { test } from "node:test";
import { audioUploadType, maxPickBytes, slotFileName, slotFromFile } from "../../src/lib/assetSlots.ts";
import { fitWithin, hasMeaningfulTransparency, processPixels, removeWhiteBackground, type Rgba } from "../../src/lib/clientPropProcessor.ts";

/** A w×h image filled by `paint(x, y)` → [r, g, b, a]. */
function image(w: number, h: number, paint: (x: number, y: number) => [number, number, number, number]): Rgba {
  const data = new Uint8ClampedArray(w * h * 4);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) data.set(paint(x, y), (y * w + x) * 4);
  return { width: w, height: h, data };
}
const px = (img: Rgba, x: number, y: number) => Array.from(img.data.slice((y * img.width + x) * 4, (y * img.width + x) * 4 + 4));

/**
 * A comic "sticker" on a JPEG-ish white background (254/253/251): a 3 px black outline ring from 10 to 29, a white
 * interior (the plate) from 13 to 26, a grey anti-aliasing pixel just outside the ring, and a coloured dot inside.
 */
function sticker(): Rgba {
  return image(40, 40, (x, y) => {
    const ring = x >= 10 && x <= 29 && y >= 10 && y <= 29 && !(x >= 13 && x <= 26 && y >= 13 && y <= 26);
    if (ring) return [20, 22, 25, 255];
    if (x === 9 && y === 20) return [150, 150, 150, 255]; // anti-aliasing next to the outline
    if (x === 20 && y === 20) return [230, 80, 40, 255];
    return [254, 253, 251, 255]; // white: background outside, the plate inside
  });
}

test("opaque white background: corners become transparent, the white interior stays", () => {
  const src = sticker();
  assert.equal(hasMeaningfulTransparency(src), false);
  const { image: out, cleared } = removeWhiteBackground(src);
  assert.ok(cleared > 0);
  for (const [x, y] of [[0, 0], [39, 0], [0, 39], [39, 39], [5, 20]]) assert.equal(px(out, x, y)[3], 0, `corner/background ${x},${y}`);
  // white inside the outline is untouched (not connected to the border)
  assert.deepEqual(px(out, 15, 15), [254, 253, 251, 255]);
  assert.deepEqual(px(out, 13, 20), [254, 253, 251, 255], "white right behind the outline stays solid");
  assert.deepEqual(px(out, 20, 20), [230, 80, 40, 255]);
  // the dark outline stays crisp
  assert.deepEqual(px(out, 10, 10), [20, 22, 25, 255]);
  // the grey anti-aliasing pixel fades (no white halo) and its colour is un-mixed from white
  const aa = px(out, 9, 20);
  assert.ok(aa[3] > 0 && aa[3] < 255, `anti-alias alpha ${aa[3]}`);
  assert.ok(aa[0] < 150, "un-mixed toward the outline colour");
});

test("already-transparent images are kept exactly as they are", () => {
  const src = image(20, 20, (x) => (x < 5 ? [255, 255, 255, 0] : [255, 255, 255, 255]));
  assert.equal(hasMeaningfulTransparency(src), true);
  const r = processPixels(src, true);
  assert.equal(r.hadTransparency, true);
  assert.equal(r.removedBackground, false);
  assert.equal(r.image, src);
});

test("background removal can be switched off (intentional white edges)", () => {
  const src = sticker();
  const r = processPixels(src, false);
  assert.equal(r.removedBackground, false);
  assert.equal(px(r.image, 0, 0)[3], 255);
});

test("an image without a white border is left opaque", () => {
  const src = image(10, 10, () => [30, 120, 200, 255]);
  const r = processPixels(src, true);
  assert.equal(r.removedBackground, false);
  assert.ok(Array.from(r.image.data).every((v, i) => i % 4 !== 3 || v === 255));
});

test("pale colours are not mistaken for white (spread check)", () => {
  const src = image(10, 10, (x) => (x < 5 ? [255, 236, 170, 255] : [254, 254, 254, 255]));
  const { image: out } = removeWhiteBackground(src);
  assert.equal(px(out, 0, 0)[3], 255, "pale yellow touching the border stays");
  assert.equal(px(out, 9, 9)[3], 0);
});

test("oversized images scale to 1024 px on the long side, aspect kept, never upscaled", () => {
  assert.deepEqual(fitWithin(4032, 3024), { width: 1024, height: 768 });
  assert.deepEqual(fitWithin(1080, 2400), { width: 461, height: 1024 });
  assert.deepEqual(fitWithin(600, 400), { width: 600, height: 400 });
});

test("slot naming ignores the user's file name", () => {
  assert.equal(slotFileName("props", "mie-pedas-level10", { name: "IMG_4821.jpg", type: "image/jpeg" }), "mie-pedas-level10.png");
  assert.equal(slotFileName("props", "mie-pedas-level10", { name: "1000100991.webp", type: "image/webp" }), "mie-pedas-level10.png");
  assert.equal(slotFileName("sfx", "slurp", { name: "Recording 12.m4a", type: "audio/x-m4a" }), "slurp.m4a");
  assert.equal(slotFileName("sfx", "slurp", { name: "voice.MP3", type: "" }), "slurp.mp3", "falls back to the extension");
  assert.equal(slotFileName("sfx", "slurp", { name: "notes.txt", type: "text/plain" }), null);
  assert.equal(slotFileName("props", "Bad Name", { name: "a.png", type: "image/png" }), null);
  assert.deepEqual(audioUploadType({ name: "x.ogg", type: "application/octet-stream" }), { type: "audio/ogg", ext: "ogg" });
  assert.deepEqual(slotFromFile("props/mie-pedas-level10.png"), { kind: "props", name: "mie-pedas-level10" });
  assert.equal(slotFromFile("../etc/passwd"), null);
});

test("big phone photos can be picked for props (they're shrunk before upload); audio stays at 10 MB", () => {
  assert.ok(maxPickBytes("props") >= 25 * 1024 * 1024);
  assert.equal(maxPickBytes("sfx"), 10 * 1024 * 1024);
});
