// The rebuilt angry cast (public/cast/{uco,ocu}/angry-*.png) and the editorial SFX (record-scratch, ding): the sprites
// are 900×1700 RGBA, flush at y 1700, framed like the set (shared head box) and calibrated for the blink and lip sync;
// the angry pose renders its own sprites (no stand-in); both SFX are short, clean 44.1 kHz MP3s wired into the mix.
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { test } from "node:test";
import manifest from "../../video/src/assets/assetManifest.json" with { type: "json" };
import { castSprites, resetRemoteAssets } from "../../video/src/assets/index.ts";
import { headBoxFor } from "../../video/src/cast/spriteCalibration.ts";
import { SFX_VOLUME } from "../../video/src/shared/sfxCues.ts";
import { ROOT } from "./importGraph.mts";

const file = (f: string) => path.join(ROOT, f);
/** width, height, colour type from a PNG's IHDR */
const png = (f: string) => {
  const b = fs.readFileSync(file(f));
  return { w: b.readUInt32BE(16), h: b.readUInt32BE(20), colorType: b[25] };
};

test("angry sprites: four 900×1700 RGBA PNGs in the repo, listed in the asset manifest", () => {
  for (const who of ["uco", "ocu"]) {
    for (const frame of ["closed", "open"]) {
      const f = `public/cast/${who}/angry-${frame}.png`;
      assert.deepEqual(png(f), { w: 900, h: 1700, colorType: 6 }, f);
      assert.ok(manifest.cast.includes(`${who}/angry-${frame}.png`), `${f} in the manifest`);
    }
  }
  assert.ok(!fs.existsSync(file("_raw_cast")), "the raw uploads are gone");
});

test("angry renders its own sprites (no shocked / defensive stand-in) and shares the set's head box", () => {
  resetRemoteAssets();
  for (const who of ["uco", "ocu"] as const) {
    const s = castSprites(who, "angry")!;
    assert.deepEqual([s.emotion, s.closed, s.open, s.remote], ["angry", `cast/${who}/angry-closed.png`, `cast/${who}/angry-open.png`, false]);
  }
  assert.doesNotMatch(fs.readFileSync(file("video/src/assets/index.ts"), "utf8"), /FALLBACK_EMOTION|angry: \["shocked"/);
  // the same head box as the poses it cuts between, so a cut never jumps in size
  const box = (who: "uco" | "ocu", e: string) => {
    const h = headBoxFor(who, e);
    return [h.hairTop, h.chin, h.faceX];
  };
  assert.deepEqual(box("uco", "angry"), box("uco", "defensive"));
  assert.deepEqual(box("uco", "angry"), box("uco", "triumphant"));
  assert.deepEqual(box("ocu", "angry"), box("ocu", "deadpan"));
  assert.deepEqual(box("ocu", "angry"), box("ocu", "inspecting"));
  // measured on the new sprites: eye whites for the blink (near the set's, narrower for the furrowed brows), lid skin
  // and the mouth for the 3-stage lip sync
  for (const [who, ref] of [["uco", "triumphant"], ["ocu", "deadpan"]] as const) {
    const a = headBoxFor(who, "angry");
    const r = headBoxFor(who, ref);
    assert.equal(a.eyes?.length, 2);
    a.eyes!.forEach((e, i) => {
      assert.ok(Math.abs(e.cx - r.eyes![i].cx) <= 8 && Math.abs(e.cy - r.eyes![i].cy) <= 4, `${who} eye ${i} sits where the set's does`);
    });
    assert.match(a.skin!, /^#[0-9A-F]{6}$/);
    assert.ok(a.mouth && a.mouth.y0 > a.eyes![0].cy + 60 && a.mouth.y1 < 760, `${who} mouth below the eyes, above the collar`);
  }
});

test("each sprite stands flush at y 1700 and every closed / open pair is pixel-locked (same body outline)", () => {
  // decode with ffmpeg (already used by the render pipeline) to raw alpha
  const alpha = (f: string) => execFileSync("ffmpeg", ["-nostdin", "-v", "error", "-i", file(f), "-vf", "alphaextract", "-f", "rawvideo", "-pix_fmt", "gray", "-"], { maxBuffer: 64 << 20 });
  for (const who of ["uco", "ocu"]) {
    const c = alpha(`public/cast/${who}/angry-closed.png`);
    const o = alpha(`public/cast/${who}/angry-open.png`);
    const row = (buf: Buffer, y: number) => buf.subarray(y * 900, (y + 1) * 900);
    assert.ok(row(c, 1699).filter((v) => v > 128).length > 300, `${who}: the body reaches the bottom edge`);
    // one shared crop / scale: the body below the face lines up best with no offset at all (any shift of the open
    // frame makes the outlines differ more), and differs in only a sliver of pixels (brush detail, not position)
    const mismatch = (dx: number, dy: number) => {
      let d = 0;
      for (let y = 900; y < 1690; y++) for (let x = 10; x < 890; x++) if ((c[y * 900 + x] > 128) !== (o[(y + dy) * 900 + x + dx] > 128)) d++;
      return d;
    };
    const still = mismatch(0, 0);
    for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1], [2, 0], [0, 2]]) assert.ok(mismatch(dx, dy) > still, `${who}: offset ${dx},${dy} fits worse`);
    assert.ok(still < 0.002 * 880 * 790, `${who}: ${still} body pixels differ between the mouth frames`);
    // the head starts near the set's hair line (y 150), never clipped at the top
    let top = 0;
    while (top < 1700 && !row(c, top).some((v) => v > 128)) top++;
    assert.ok(top >= 140 && top <= 175, `${who}: hair top at y ${top}`);
  }
});

const probe = (f: string) => {
  const raw = execFileSync("ffmpeg", ["-nostdin", "-v", "error", "-i", file(f), "-f", "f32le", "-ac", "1", "-ar", "44100", "-"], { maxBuffer: 64 << 20 });
  const x = new Float32Array(raw.buffer, raw.byteOffset, raw.byteLength / 4);
  let peak = 0;
  for (const v of x) peak = Math.max(peak, Math.abs(v));
  const first = x.findIndex((v) => Math.abs(v) > peak * 0.01);
  let last = x.length - 1;
  while (last > 0 && Math.abs(x[last]) <= peak * 0.01) last--;
  const rate = execFileSync("ffprobe", ["-v", "error", "-select_streams", "a:0", "-show_entries", "stream=sample_rate,codec_name", "-of", "csv=p=0", file(f)]).toString().trim();
  return { seconds: x.length / 44100, firstMs: (first / 44100) * 1000, lastS: last / 44100, peakDb: 20 * Math.log10(peak), rate };
};

test("record-scratch.mp3 and ding.mp3: 44.1 kHz MP3, sound from the first millisecond, about -3 dBFS, short tails", () => {
  const scratch = probe("public/sfx/record-scratch.mp3");
  const ding = probe("public/sfx/ding.mp3");
  for (const [name, p, [lo, hi]] of [["record-scratch", scratch, [0.3, 0.42]], ["ding", ding, [0.35, 0.45]]] as const) {
    assert.equal(p.rate, "mp3,44100", name);
    assert.ok(p.seconds >= lo && p.seconds <= hi, `${name} ${p.seconds.toFixed(3)} s`);
    assert.ok(p.firstMs <= 2, `${name}: no leading silence (${p.firstMs.toFixed(1)} ms)`);
    assert.ok(p.peakDb >= -3.6 && p.peakDb <= -2.5, `${name} peak ${p.peakDb.toFixed(2)} dBFS`);
    assert.ok(p.seconds - p.lastS <= 0.06, `${name}: no long tail`);
  }
  assert.ok(manifest.sfx.includes("record-scratch.mp3") && manifest.sfx.includes("ding.mp3"));
  // mixed under the dialogue: the file peaks at -3 dBFS, played at 0.24 / 0.28 (about -15 / -14 dB under full scale)
  assert.ok(SFX_VOLUME.scratch <= 0.28 && SFX_VOLUME.ding <= 0.28);
  // each one's audio slot is just longer than the file (Compositing SFX_FRAMES)
  const frames = fs.readFileSync(file("video/src/shared/Compositing.tsx"), "utf8");
  assert.match(frames, /ding: 16, "record-scratch": 14/);
});
