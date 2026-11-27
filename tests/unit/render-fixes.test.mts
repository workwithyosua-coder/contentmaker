// Unit tests for the render fixes: prop resolution on the Nasi Padang line, timestamp anchoring, CTA spacing.
// Pure code (no database, no network, no AI). Run: npm run test:unit
import assert from "node:assert/strict";
import { test } from "node:test";
import { buildBeats, wantedPropImage } from "../../video/src/beats.ts";
import { FPS, timeline, type EpisodeLine } from "../../video/src/types.ts";

const LINE6 = {
  speaker: "ocu" as const,
  text: "Kalau semua makanan harus seragam demi efisiensi... besok nasi Padang rendang sama sayur nangka lo masukin blender, terus lo sedot pakai sedotan boba.",
  subtitle:
    "If all food has to be uniform for efficiency... tomorrow you'll throw Nasi Padang rendang and jackfruit curry into a blender and drink it through a boba straw.",
};

const line = (o: Partial<EpisodeLine> & Pick<EpisodeLine, "speaker" | "text">, i = 0): EpisodeLine =>
  ({ index: i, beat: "escalation", subtitle: "", expression: "deadpan", hasAudio: true, audio: null, frames: 90, envelope: [], ...o }) as EpisodeLine;

test("line 6 (Nasi Padang) resolves to nasi-padang-blender", () => {
  assert.equal(wantedPropImage({ ...LINE6, visual: "", on_screen_text: null, prop_tag: null })?.name, "nasi-padang-blender");
  // each keyword on its own also calls it up
  for (const w of ["blender", "nasi padang", "rendang", "sayur nangka", "sedotan boba", "boba"]) {
    assert.equal(wantedPropImage({ text: `ini ${w} ya`, subtitle: "", visual: "", on_screen_text: null, prop_tag: null })?.name, "nasi-padang-blender", w);
  }
});

test("line 6 renders the blender on the visual stage even when tagged close-up with a coded prop", () => {
  const lines = [
    line({ speaker: "uco", text: "Bukan semen, itu distribusi rasa yang adil!" }, 0),
    line({ ...LINE6, camera_shot: "closeup-punch", prop_tag: "checkout-phone" }, 1),
  ];
  const b = buildBeats(lines)[1];
  assert.equal(b.propImage, "nasi-padang-blender");
  assert.equal(b.cameraShot, "solo-ocu"); // not a face-filling close-up: the prop gets the stage
  assert.deepEqual(b.callouts.slice(0, 1), ["nasi"]);
});

test("explicit timestamps anchor a line exactly, without talking over the previous one", () => {
  const frames = (s: number) => Math.round(s * FPS);
  const lines = [
    line({ speaker: "uco", text: "a", frames: frames(7) }, 0),
    line({ speaker: "ocu", text: "b", frames: frames(7.5) }, 1),
    line({ speaker: "uco", text: "c", frames: frames(9.5) }, 2),
    line({ speaker: "ocu", text: "Mending daripada punya lo.", frames: frames(4.4), start_s: 24 }, 3),
  ];
  const { starts } = timeline(lines);
  assert.equal(starts[3], 24 * FPS, "line 4 starts at exactly 0:24");
  // previous take still talking at 0:24 → pushed just past its end (a 3-frame cut-in at most), never earlier
  const long = lines.map((l, i) => (i === 2 ? { ...l, frames: frames(11) } : l));
  const t = timeline(long).starts;
  assert.ok(t[3] >= t[2] + long[2].frames - 3, "no overlap beyond the trailing silence");
});

test("without timestamps, lines follow each other (unchanged comedic timing)", () => {
  const lines = [line({ speaker: "uco", text: "a", frames: 100 }, 0), line({ speaker: "ocu", text: "b", frames: 100 }, 1), line({ speaker: "uco", text: "c", frames: 100 }, 2)];
  assert.deepEqual(timeline(lines).starts, [0, 104, 201]);
});

test("a plain dialogue cut never whooshes (not even a script's whoosh); a major shift whooshes once", async () => {
  const { sfxCuesFor } = await import("../../video/src/shared/sfxCues.ts");
  const lines = [
    line({ speaker: "uco", text: "a", frames: 120 }, 0),
    line({ speaker: "ocu", text: "b", frames: 120, sfx: ["whoosh", "pop"] }, 1),
  ];
  const cues = sfxCuesFor(buildBeats(lines), { stampAt: 10 });
  const atCut = (cs: { name: string; frame: number }[]) => cs.filter((c) => c.name === "whoosh" && c.frame >= 120 && c.frame < 140);
  assert.equal(atCut(cues).length, 0, "uco → ocu back-and-forth: no whoosh");
  assert.ok(cues.some((c) => c.name === "pop"), "the line's other effect still plays");
  // into a two-shot: one whoosh, even with the line's own whoosh on top
  const shifted = sfxCuesFor(buildBeats([line({ speaker: "uco", text: "a", frames: 120 }, 0), line({ speaker: "ocu", text: "b", frames: 120, camera_shot: "two-shot", sfx: ["whoosh"] }, 1)]), { stampAt: 10 });
  assert.equal(atCut(shifted).length, 1, "one whoosh into the two-shot");
  assert.ok(shifted.some((c) => c.name === "whoosh" && c.frame >= 240), "and one into the outro");
  assert.ok(cues.every((c, i) => !cues.some((d, j) => j !== i && d.name === c.name && Math.abs(d.frame - c.frame) < 15)));
});
