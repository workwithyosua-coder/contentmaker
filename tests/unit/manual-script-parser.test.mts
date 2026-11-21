// Unit tests for the Manual / Exact Import parser (no database, no network, no AI).
// Run: npm run test:unit
import assert from "node:assert/strict";
import { test } from "node:test";
import { estimatedRuntime, parseManualScript, POSES } from "../../src/lib/manualScriptParser.ts";

const FULL = `Title: Bubur Diaduk vs Nggak Diaduk
Target Runtime: 60s

[Beat: Hook]
1. UCO (0:00–0:05 | loud, Dutch tilt): "Dengerin! Bubur nggak diaduk itu kriminal!"
[EN] "Listen up! Not stirring your porridge is a crime!"
2. OCU (0:05–0:11 | deadpan): "Lihat lapisannya: ayam suwir, cakwe, baru bubur di bawah."
[EN] "Look at the layers: shredded chicken, cakwe, then the porridge underneath."

[Beat: Escalation]
3. UCO (0:11–0:17): "Diaduk itu bikin emulsi (katanya), teksturnya menyatu?!"
[EN] "Stirring makes an emulsion (so they say), the texture blends?!"
4. OCU (0:24–0:30 | holds up a blender): "Kalau semua makanan harus seragam demi efisiensi... besok nasi Padang lo masukin blender."
[EN] "If all food has to be uniform for efficiency... tomorrow you'll blend Nasi Padang."

[Beat: Concession]
11. UCO (thought) (0:58–1:03 | soft): "Dia ada benernya…  jangan sampai dia tahu."
[EN] "He has a point… he can't know."

DIRECTION & VISUAL NOTES
- Pause 0.3s between lines
- BGM on, volume 10%
- Duck BGM on thought lines
- CTA: Follow buat part 2

LINE-BY-LINE VISUAL, ON-SCREEN TEXT & SFX CUES
- Line 1 (Uco): Dutch tilt, phone feed of packed cafes. SFX: record scratch · on screen: "KRIMINAL!"
- Line 2 (Ocu): points at each layer. Prop: bubur-unmixed · Callout: ayam, cakwe, bubur · Pose: explaining
- Line 4 (Ocu): Prop: nasi-padang-blender · SFX: slurp + ding · on screen: "NASI PADANG DIBLENDER" · Shot: closeup
- Line 11 (Uco, thought): dim room, thought bubble. Pose: defensive
`;

test("full format: metadata, timestamps, [EN], thought, beats", () => {
  const r = parseManualScript({ script: FULL });
  assert.equal(r.title, "Bubur Diaduk vs Nggak Diaduk");
  assert.equal(r.targetRuntimeS, 60);
  assert.equal(r.lines.length, 5);
  assert.deepEqual(
    r.lines.map((l) => [l.speaker, l.start_s, l.end_s, l.thought_bubble, l.beat]),
    [
      ["uco", 0, 5, false, "hook"],
      ["ocu", 5, 11, false, "hook"],
      ["uco", 11, 17, false, "escalation"],
      ["ocu", 24, 30, false, "escalation"],
      ["uco", 58, 63, true, "concession"],
    ],
  );
  assert.equal(r.lines[0].delivery, "loud, Dutch tilt");
  assert.equal(r.lines[3].delivery, "holds up a blender");
});

test("exact import: dialogue and [EN] are kept character for character", () => {
  const r = parseManualScript({ script: FULL });
  assert.equal(r.lines[0].text, "Dengerin! Bubur nggak diaduk itu kriminal!");
  assert.equal(r.lines[0].subtitle, "Listen up! Not stirring your porridge is a crime!");
  // parentheses, ellipses and double spaces inside the quotes stay
  assert.equal(r.lines[2].text, "Diaduk itu bikin emulsi (katanya), teksturnya menyatu?!");
  assert.equal(r.lines[2].subtitle, "Stirring makes an emulsion (so they say), the texture blends?!");
  assert.equal(r.lines[4].text, "Dia ada benernya…  jangan sampai dia tahu.");
  assert.equal(r.lines[3].text, "Kalau semua makanan harus seragam demi efisiensi... besok nasi Padang lo masukin blender.");
});

test("line-by-line cues bind by line number (also when numbers skip)", () => {
  const r = parseManualScript({ script: FULL });
  const [l1, l2, , l4, l11] = r.lines;
  assert.deepEqual(l1.sfx, ["record-scratch"]);
  assert.equal(l1.on_screen_text, "KRIMINAL!");
  assert.match(l1.visual, /Dutch tilt, phone feed of packed cafes/);
  assert.equal(l2.prop_tag, "bubur-unmixed");
  assert.deepEqual(l2.callouts, ["ayam", "cakwe", "bubur"]);
  assert.equal(l2.emotion, "explaining");
  assert.equal(l4.prop_tag, "nasi-padang-blender");
  assert.deepEqual(l4.sfx, ["slurp", "ding"]);
  assert.equal(l4.on_screen_text, "NASI PADANG DIBLENDER");
  assert.equal(l4.camera_shot, "closeup-punch");
  assert.equal(l11.emotion, "defensive");
  assert.equal(l11.thought_bubble, true);
});

test("direction block becomes render direction", () => {
  const r = parseManualScript({ script: FULL });
  assert.equal(r.direction.pauseS, 0.3);
  assert.equal(r.direction.bgm, true);
  assert.equal(r.direction.bgmVolume, 0.1);
  assert.ok(r.direction.thoughtDuck < 1);
  assert.equal(r.direction.ctaText, "FOLLOW BUAT PART 2");
  assert.match(r.directionText, /Pause 0\.3s/);
});

test("minimal UCO:/OCU: script with no timestamps or cues", () => {
  const r = parseManualScript({
    topic: "Kopi susu",
    script: "UCO: Kopi susu 30 ribu itu wajar!\n[EN] A 30k iced coffee is normal!\nOCU: Wajar buat siapa?\nUCO: Buat gue!",
  });
  assert.equal(r.title, "Kopi susu");
  assert.equal(r.lines.length, 3);
  assert.deepEqual(
    r.lines.map((l) => [l.speaker, l.text, l.start_s, l.end_s, l.emotion, l.prop_tag, l.beat]),
    [
      ["uco", "Kopi susu 30 ribu itu wajar!", null, null, null, null, "hook"],
      ["ocu", "Wajar buat siapa?", null, null, null, null, "counter"],
      ["uco", "Buat gue!", null, null, null, null, "button"],
    ],
  );
  assert.equal(r.lines[0].subtitle, "A 30k iced coffee is normal!");
  assert.equal(r.lines[1].subtitle, "");
  assert.ok(r.warnings.some((w) => /Line 2 has no \[EN\]/.test(w)));
  assert.equal(r.direction.cta, true);
  // durations come from word count: 5 words ≈ 2.3 s, never under 1.5 s
  const est = estimatedRuntime(r.lines);
  assert.ok(est > 7 && est < 12, `runtime ${est}`);
});

test("cue rows under a line and inline bracket cues (simple format)", () => {
  const r = parseManualScript({
    script: "UCO (0:02–0:04 | SFX: pop): Hah?!\n[EN] What?!\nSFX: record-scratch\nPROP: sate-padang\nOCU: Iya.\nPOSE: dancing\nOCU: Tetap.\nPOSE: phone",
  });
  assert.equal(r.lines[0].start_s, 2);
  assert.deepEqual(r.lines[0].sfx, ["pop", "record-scratch"]);
  assert.equal(r.lines[0].prop_tag, "sate-padang");
  assert.equal(r.lines[1].emotion, null);
  assert.equal(r.lines[2].emotion, null);
  assert.ok(r.warnings.some((w) => /Line 2: unknown pose "dancing"/.test(w)));
  assert.ok(r.warnings.some((w) => /Line 3: Ocu has no "phone" pose/.test(w)));
});

test("poses offered per character match their sprites", () => {
  assert.deepEqual([...POSES.uco], ["triumphant", "defensive", "shocked", "phone"]);
  assert.deepEqual([...POSES.ocu], ["deadpan", "explaining", "inspecting", "cta"]);
});

test("same input, same output (deterministic)", () => {
  assert.deepEqual(parseManualScript({ script: FULL }), parseManualScript({ script: FULL }));
});

test("separate direction box; a backwards timestamp is flagged", () => {
  const r = parseManualScript({
    script: "UCO (0:10–0:12): Satu.\nOCU (0:05–0:08): Dua.",
    direction: "Pause: 0.4s\nNo CTA",
  });
  assert.equal(r.direction.pauseS, 0.4);
  assert.equal(r.direction.cta, false);
  assert.ok(r.warnings.some((w) => /Line 2 starts at 0:05/.test(w)));
});

test("Evidence Takeover cues: layout: takeover / takeover: true and a quoted stat with its own '|'", () => {
  const r = parseManualScript({
    script: `1. UCO (0:00-0:04): "Banjirnya sampai 20 kilometer."
[EN] "The flood reached 20 kilometres."
2. OCU (0:04-0:08 | angry): "Dan ikannya mati dalam dua hari."
[EN] "And the fish died within two days."
3. UCO: "Terus?"
[EN] "And then?"
LINE-BY-LINE VISUAL, ON-SCREEN TEXT & SFX CUES
- Line 1 (Uco): layout: takeover · prop: bubur-mixed · stat: "20 KM | MATI DALAM 2 HARI" · SFX: stamp
- Line 2 (Ocu): takeover: true | stat: "<50 EKOR | HAMIL 15-16 BULAN"`,
  });
  const [a, b, c] = r.lines;
  assert.equal(a.layout, "takeover");
  assert.equal(a.stat, "20 KM | MATI DALAM 2 HARI");
  assert.equal(a.prop_tag, "bubur-mixed");
  assert.deepEqual(a.sfx, ["stamp"]);
  assert.equal(b.layout, "takeover");
  assert.equal(b.stat, "<50 EKOR | HAMIL 15-16 BULAN");
  assert.equal(b.expression, "angry", "an angry note marks the delivery");
  assert.equal(b.emotion, null, "no angry sprite: the pose stays automatic");
  assert.equal(c.layout, "standard", "omitted means standard");
  assert.equal(c.stat, null);
  assert.ok(!r.warnings.some((w) => /angry/.test(w)), r.warnings.join(" | "));
});

test("a takeover with nothing to show warns and falls back; takeover: false is standard", () => {
  const r = parseManualScript({ script: `UCO: "Halo."\n[EN] "Hi."\nlayout: takeover\nOCU: "Hai."\n[EN] "Hey."\ntakeover: false` });
  assert.equal(r.lines[0].layout, "takeover");
  assert.ok(r.warnings.some((w) => /Evidence Takeover needs/.test(w)));
  assert.equal(r.lines[1].layout, "standard");
});
