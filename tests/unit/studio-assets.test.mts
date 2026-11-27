// Studio Assets: slot allowlist, sprite / urgent BGM resolution priority, and the cut-out keeping interior whites.
// Pure code (plus sharp to decode a real sprite): no database, no network, no AI. Run: npm run test:unit
import assert from "node:assert/strict";
import path from "node:path";
import { test } from "node:test";
import sharp from "sharp";
import { processPixels, type Rgba } from "../../src/lib/clientPropProcessor.ts";
import {
  STUDIO_SLOTS,
  isStudioObjectPath,
  needsAngry,
  originalPath,
  originalType,
  parseOriginal,
  studioSlot,
  studioVideoUrls,
  withVersion,
  type StudioAssetStatus,
} from "../../src/lib/studioAssets.ts";
import { bgmFile, castSprites, registerRemoteAssets, resetRemoteAssets } from "../../video/src/assets/index.ts";

const ROOT = path.resolve(import.meta.dirname, "../..");
const URL_UCO_C = "https://x.supabase.co/storage/v1/object/public/studio-assets/sprites/uco-angry-closed.png?v=1";
const URL_UCO_O = "https://x.supabase.co/storage/v1/object/public/studio-assets/sprites/uco-angry-open.png?v=1";

test("the global slots map to fixed keys (public sprites and audio, private voice models)", () => {
  assert.deepEqual(
    STUDIO_SLOTS.filter((s) => s.kind !== "model").map((s) => s.path),
    ["sprites/uco-angry-closed.png", "sprites/uco-angry-open.png", "sprites/ocu-angry-closed.png", "sprites/ocu-angry-open.png", "sfx/bgm-urgent.mp3"],
  );
  assert.deepEqual(
    STUDIO_SLOTS.filter((s) => s.kind === "model").map((s) => s.path),
    ["studio-assets/voices/uco-voice.pth", "studio-assets/voices/uco-voice.index", "studio-assets/voices/ocu-voice.pth", "studio-assets/voices/ocu-voice.index"],
  );
});

test("slot keys and object paths outside the allowlist are rejected", () => {
  assert.equal(studioSlot("uco-angry-closed")?.path, "sprites/uco-angry-closed.png");
  for (const bad of ["", "uco-angry", "../uco-angry-closed", "sprites/uco-angry-closed.png", "UCO-ANGRY-CLOSED", "uco-happy-closed", "bgm", 42, null, undefined]) {
    assert.equal(studioSlot(bad), null, `key ${String(bad)}`);
  }
  for (const ok of ["sprites/uco-angry-closed.png", "sfx/bgm-urgent.mp3", "originals/ocu-angry-open.cut.jpg", "originals/uco-angry-closed.keep.webp"]) {
    assert.equal(isStudioObjectPath(ok), true, ok);
  }
  for (const bad of [
    "sprites/evil.png",
    "sprites/uco-angry-closed.png/../../recordings/x.webm",
    "../sprites/uco-angry-closed.png",
    "sfx/bgm.mp3",
    "props/sate.png",
    "originals/bgm-urgent.cut.jpg",
    "originals/uco-angry-closed.cut.exe",
    "originals/uco-angry-closed.jpg",
    "/sprites/uco-angry-closed.png",
  ]) {
    assert.equal(isStudioObjectPath(bad), false, bad);
  }
  // originals: only sprites, only image types, with the background switch in the name
  assert.equal(originalPath(studioSlot("uco-angry-open")!, false, "image/jpeg"), "originals/uco-angry-open.keep.jpg");
  assert.equal(originalPath(studioSlot("bgm-urgent")!, true, "audio/mpeg"), null);
  assert.equal(originalPath(studioSlot("uco-angry-open")!, true, "application/pdf"), null);
  assert.deepEqual(parseOriginal("originals/ocu-angry-closed.cut.png"), { key: "ocu-angry-closed", removeWhite: true });
  assert.equal(originalType("https://x/originals/uco-angry-closed.cut.jpg?v=12"), "image/jpeg");
  assert.equal(originalType("/api/media/studio-assets/originals/uco-angry-open.keep.webp?exp=1&sig=2"), "image/webp");
  assert.equal(originalType("originals/uco-angry-open.keep.exe"), null);
});

test("sprites: an uploaded studio file wins, then the repo's public/cast, then shocked / defensive / the default pose", () => {
  resetRemoteAssets();
  // nothing uploaded, no angry sprite in the repo: Uco stands in as shocked, Ocu (no shocked / defensive) as deadpan
  assert.equal(castSprites("uco", "angry")?.emotion, "shocked");
  assert.equal(castSprites("uco", "angry")?.closed, "cast/uco/shocked-closed.png");
  assert.equal(castSprites("ocu", "angry")?.emotion, "deadpan");
  // uploaded: the Supabase URLs, for both mouth frames
  registerRemoteAssets({ cast: { "uco/angry-closed.png": URL_UCO_C, "uco/angry-open.png": URL_UCO_O } });
  const s = castSprites("uco", "angry")!;
  assert.deepEqual([s.emotion, s.closed, s.open, s.remote], ["angry", URL_UCO_C, URL_UCO_O, true]);
  // an upload also overrides a pose the repo has
  registerRemoteAssets({ cast: { "uco/shocked-closed.png": URL_UCO_C } });
  assert.equal(castSprites("uco", "shocked")?.closed, URL_UCO_C);
  assert.equal(castSprites("uco", "shocked")?.open, URL_UCO_C, "one uploaded frame serves as both until its pair arrives");
  // anything but a cast sprite key, or a non-URL, is ignored
  registerRemoteAssets({ cast: { "../../etc/passwd": "https://x/y", "ocu/angry-closed.png": "javascript:alert(1)" } });
  assert.equal(castSprites("ocu", "angry")?.emotion, "deadpan");
  resetRemoteAssets();
  assert.equal(castSprites("uco", "angry")?.emotion, "shocked", "removing the upload falls back again");
});

test("urgent BGM: the uploaded bgm-urgent, else the repo's, else the regular bgm (never a crash)", () => {
  resetRemoteAssets();
  assert.equal(bgmFile(true), "sfx/bgm-urgent.mp3", "no upload: public/sfx/bgm-urgent.mp3 from the repo");
  assert.equal(bgmFile(false), "sfx/bgm.mp3");
  registerRemoteAssets({ sfx: { bgm: "https://x/bgm.mp3" } });
  assert.equal(bgmFile(true), "sfx/bgm-urgent.mp3", "the repo's urgent track before an uploaded regular bed");
  registerRemoteAssets({ sfx: { "bgm-urgent": "https://x/studio/bgm-urgent.mp3?v=2" } });
  assert.equal(bgmFile(true), "https://x/studio/bgm-urgent.mp3?v=2");
  assert.equal(bgmFile(false), "https://x/bgm.mp3", "calm episodes keep the regular bed");
  resetRemoteAssets();
});

test("the video's asset map comes from uploaded slots only, with cache-busted URLs", () => {
  const status: StudioAssetStatus[] = [
    { key: "uco-angry-closed", url: withVersion("https://x/sprites/uco-angry-closed.png", 1700000000000), updatedAt: 1700000000000, originalUrl: null, removeWhite: true },
    { key: "ocu-angry-open", url: null, updatedAt: null, originalUrl: null, removeWhite: true },
    { key: "bgm-urgent", url: "https://x/sfx/bgm-urgent.mp3?v=5", updatedAt: 5, originalUrl: null, removeWhite: true },
    { key: "nope", url: "https://x/evil", updatedAt: 1, originalUrl: null, removeWhite: true },
  ];
  assert.deepEqual(studioVideoUrls(status), {
    cast: { "uco/angry-closed.png": "https://x/sprites/uco-angry-closed.png?v=1700000000000" },
    sfx: { "bgm-urgent": "https://x/sfx/bgm-urgent.mp3?v=5" },
  });
  assert.equal(withVersion("https://x/a.png?token=1", 9), "https://x/a.png?token=1&v=9");
});

test("episodes need the global angry assets for an angry pose or an angry delivery", () => {
  assert.equal(needsAngry([{ emotion: "angry" }]), true);
  assert.equal(needsAngry([{ expression: "furious" }]), true);
  assert.equal(needsAngry([{ expression: "angry", thought_bubble: true }]), false, "a thought isn't delivered angrily");
  assert.equal(needsAngry([{ emotion: "shocked", expression: "excited" }]), false);
});

test("the white-background cut-out keeps a sprite's white teeth and eye whites (real sprite on a white JPEG-like background)", async () => {
  // Uco's shocked, mouth-open sprite flattened onto white, as a phone export of a drawing would look
  const { data, info } = await sharp(path.join(ROOT, "public/cast/uco/shocked-open.png")).flatten({ background: "#ffffff" }).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  const img: Rgba = { width: info.width, height: info.height, data: new Uint8ClampedArray(data) };
  const at = (im: Rgba, x: number, y: number) => {
    const i = (y * im.width + x) * 4;
    return [im.data[i], im.data[i + 1], im.data[i + 2], im.data[i + 3]];
  };
  const white = (p: number[]) => Math.min(p[0], p[1], p[2]) >= 232;
  // interior whites measured on the sprite: the eye whites and the teeth inside the open mouth
  const find = (x0: number, y0: number, x1: number, y1: number) => {
    for (let y = y0; y < y1; y++) for (let x = x0; x < x1; x++) if (white(at(img, x, y))) return [x, y];
    return null;
  };
  const eye = find(305, 450, 350, 500);
  const teeth = find(340, 590, 480, 700);
  assert.ok(eye && teeth, "the sprite has white eyes and teeth to protect");
  const { image: out, removedBackground } = processPixels(img, true);
  assert.equal(removedBackground, true);
  assert.equal(at(out, 2, 2)[3], 0, "the white background is gone");
  assert.equal(at(out, out.width - 3, 3)[3], 0);
  for (const [name, p] of [["eye white", eye], ["teeth", teeth]] as const) {
    const px = at(out, p![0], p![1]);
    assert.equal(px[3], 255, `${name} stays opaque`);
    assert.ok(white(px), `${name} stays white`);
  }
});
