// Unit tests for the audio / pacing / continuity pass. Pure code: no database, no network, no AI.
// Run: npm run test:unit
import assert from "node:assert/strict";
import { test } from "node:test";
import { parseManualScript } from "../../src/lib/manualScriptParser.ts";
import { ttsText } from "../../src/lib/voice/phonetic.ts";
import { buildBeats, cleanCallout } from "../../video/src/beats.ts";
import { parseDirection } from "../../video/src/direction.ts";
import { CTA_HOLD, END_FRAMES, cueTotalFrames, timeline, type EpisodeLine } from "../../video/src/types.ts";

const line = (o: Partial<EpisodeLine> & Pick<EpisodeLine, "speaker" | "text">, i = 0): EpisodeLine =>
  ({ index: i, beat: "escalation", subtitle: "", expression: "neutral", hasAudio: true, audio: null, frames: 90, envelope: [], ...o }) as EpisodeLine;
const exact = { ...parseDirection(""), exact: true };

test("TTS text: '&' is read as 'dan' and 'Uco' isn't slurred; the script text itself is untouched", () => {
  assert.equal(ttsText("Follow Uco & Ocu buat konten cerdas!"), "Follow U-co dan Ocu buat konten cerdas!");
  assert.equal(ttsText("UCO&OCU"), "U-co dan OCU");
  assert.equal(ttsText("Ucok bukan Uco"), "Ucok bukan U-co", "only the whole word");
  const original = "Uco & Ocu";
  ttsText(original);
  assert.equal(original, "Uco & Ocu");
});

test("callouts: quote marks are stripped before trimming to 4 words (no unclosed leading quote)", () => {
  assert.equal(cleanCallout('"KIRIM KE TEMEN LO, SIAPA TAHU'), "KIRIM KE TEMEN LO,");
  assert.equal(cleanCallout("“BENIGN MASOCHISM”"), "BENIGN MASOCHISM");
  assert.equal(cleanCallout("'LEVEL 10' MASIH SANTAI"), "LEVEL 10 MASIH SANTAI");
  assert.equal(cleanCallout("LO'S OK"), "LO'S OK", "apostrophes inside words stay");
  assert.equal(cleanCallout('""'), null);
  const b = buildBeats([line({ speaker: "ocu", text: "Habis tiga es teh.", kinetic_text: '"HABIS 3 ES TEH, SERIUS' })], exact);
  assert.equal(b[0].kinetic, "HABIS 3 ES TEH,");
});

test("manual (exact) scripts: no keyword-guessed props, coded props or cards; explicit ones still show", () => {
  const lines = [
    // words that used to call up props: "biaya" → receipt, "es teh" → iced coffee, "nasi padang" → blender, "dopamin" → brain card
    line({ speaker: "uco", text: "Rasanya menang perang, biaya cuma 50 ribu!" }, 0),
    line({ speaker: "ocu", text: "Habis tiga es teh, nasi padang juga. Dopamin!" }, 1),
    line({ speaker: "ocu", text: "Ini mangkoknya.", prop_tag: "bubur-mixed" }, 2),
    line({ speaker: "uco", text: "Struk!", prop_tag: "receipt-magnifier", overlay: "brain-badge" }, 3),
  ];
  const b = buildBeats(lines, exact);
  for (const i of [0, 1]) {
    assert.equal(b[i].propImage, null, `line ${i + 1} PNG`);
    assert.equal(b[i].propTag, "none", `line ${i + 1} coded prop`);
    assert.equal(b[i].overlay, null, `line ${i + 1} card`);
  }
  assert.equal(b[2].propImage, "bubur-mixed");
  assert.equal(b[3].propTag, "receipt-magnifier");
  assert.equal(b[3].overlay?.kind, "brain-badge");
  // the AI writers' room path (not exact) still guesses from keywords, as before
  const auto = buildBeats(lines.slice(0, 2), parseDirection(""));
  assert.equal(auto[1].propImage, "nasi-padang-blender");
});

test("beats are gapless: each starts where the previous ends, the last ends at the video's end", () => {
  const lines = [0, 4, 8, 13].map((s, i) => line({ speaker: i % 2 ? "ocu" : "uco", text: `l${i}`, frames: 100, start_s: s }, i));
  const beats = buildBeats(lines, exact);
  for (let i = 1; i < beats.length; i++) assert.equal(beats[i].startFrame, beats[i - 1].startFrame + beats[i - 1].durationInFrames, `beat ${i + 1}`);
  const last = beats[beats.length - 1];
  assert.equal(last.startFrame + last.durationInFrames, cueTotalFrames(lines, exact));
});

test("a last line posed cta becomes the outro: the CTA two-shot plays during it and holds 0.5 s", () => {
  const lines = [line({ speaker: "uco", text: "Pedas itu seni.", frames: 120 }, 0), line({ speaker: "ocu", text: "Kirim ke temen lo yang sok kuat.", frames: 120, emotion: "cta" }, 1)];
  const beats = buildBeats(lines, exact);
  assert.equal(beats.length, 2, "no extra silent end card");
  assert.equal(beats[1].cameraShot, "cta-stinger");
  assert.equal(beats[1].line, 1, "the line's own audio and subtitles play in it");
  const { end } = timeline(lines, exact);
  assert.equal(cueTotalFrames(lines, exact), end + CTA_HOLD);
  assert.equal(CTA_HOLD, 15);
  // exact scripts: call-to-action words alone don't add the Follow outro any more; the line stays a normal beat
  const words = [lines[0], line({ speaker: "ocu", text: "Kirim ke temen lo yang sok kuat.", frames: 120, emotion: "explaining" }, 1)];
  assert.notEqual(buildBeats(words, exact).at(-1)!.cameraShot, "cta-stinger");
  // the AI writers' room path keeps its defaults: a CTA line merges, a plain last line gets the 3-second end card
  const auto = parseDirection("");
  assert.equal(buildBeats(words, auto).at(-1)!.cameraShot, "cta-stinger");
  const plain = [lines[0], line({ speaker: "ocu", text: "Iya.", frames: 60 }, 1)];
  assert.equal(buildBeats(plain, auto).length, 3);
  assert.equal(cueTotalFrames(plain, auto), timeline(plain, auto).end + END_FRAMES);
});

test("thought lines duck the music −12 dB by default", () => {
  assert.equal(parseDirection("BGM on").thoughtDuck, 0.25);
  assert.equal(parseDirection("BGM on\nBGM off on thought lines").thoughtDuck, 0);
});

test("poses written in a line's notes are respected (header notes and line-cue labels)", () => {
  const r = parseManualScript({
    script: `4. UCO (0:13-0:18 | triumphant, fist up): "Rasanya menang perang!"
13. OCU (0:55-0:59): "Habis tiga es teh."
LINE-BY-LINE VISUAL, ON-SCREEN TEXT & SFX CUES
- Line 13 (Ocu, deadpan): flat stare`,
  });
  assert.equal(r.lines[0].emotion, "triumphant");
  assert.equal(r.lines[1].emotion, "deadpan");
  const b = buildBeats(r.lines.map((l, i) => ({ ...l, index: i, hasAudio: false, audio: null, frames: 120, envelope: [] }) as unknown as EpisodeLine), exact);
  assert.equal(b[0].emotion, "triumphant");
  assert.equal(b[1].emotion, "deadpan");
});
