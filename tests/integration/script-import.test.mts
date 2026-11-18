// Parser for pasted scripts: run with `npm run test:integration`.
import assert from "node:assert/strict";
import { estimateSeconds, formatDuration, parsePastedScript } from "../../src/lib/script-import.ts";

const paste = `
# Ngaku Bokek, Kafe Penuh
HOOK
1. UCO (0:00–0:06 | Hook — loud, fast, holding phone): "Semua ngaku bokek, tapi kafe penuh!"
[EN] Everyone says they're broke, but cafes are packed!
2) OCU: "Justru itu tanda kita lagi bokek." (flat, sips matcha)
   [EN] That's exactly the sign we're broke.
**UCO** — Bokek apaan? Antre matcha 65 ribu! [EN] Broke how? People queue for a 65k matcha!
Act 3 — Concession
UCO (thought): Sial, masuk akal. Jangan sampai dia tahu.
OCU Inner Thought: "Dia ada benernya. Simpan aja."
0:40–0:44 | some table row about SFX: bell ding
Visual: both look away
OCU — Es batunya yang banyak... Dosisnya harus pas.
UCO & OCU logo end card
`;
const { lines, context } = parsePastedScript(paste);
assert.equal(lines.length, 6, JSON.stringify(lines, null, 2));
assert.deepEqual(lines.map((l) => l.speaker), ["uco", "ocu", "uco", "uco", "ocu", "ocu"]);
assert.equal(lines[0].text, "Semua ngaku bokek, tapi kafe penuh!");
assert.equal(lines[0].en, "Everyone says they're broke, but cafes are packed!");
assert.ok(lines[0].cues.some((c) => c.includes("loud")));
assert.equal(lines[1].text, "Justru itu tanda kita lagi bokek.");
assert.equal(lines[1].en, "That's exactly the sign we're broke.");
assert.deepEqual(lines[1].cues, ["flat, sips matcha"]);
assert.equal(lines[2].text, "Bokek apaan? Antre matcha 65 ribu!");
assert.equal(lines[2].en, "Broke how? People queue for a 65k matcha!");
assert.equal(lines[3].thought, true);
assert.equal(lines[3].text, "Sial, masuk akal. Jangan sampai dia tahu.");
assert.equal(lines[4].thought, true);
assert.equal(lines[4].text, "Dia ada benernya. Simpan aja.");
assert.equal(lines[5].text, "Es batunya yang banyak... Dosisnya harus pas.");
assert.equal(lines[3].heading, "Act 3 — Concession");
assert.ok(context.some((c) => c.includes("bell ding")));
assert.ok(context.some((c) => c.includes("logo end card")));
assert.equal(formatDuration(estimateSeconds(lines)), "16 s");
assert.equal(formatDuration(125), "2:05");
console.log("script import parser: ok", lines.length, "lines");

// Speaker header on its own row, words on the next; a shared closing line with one [EN] row for both speakers.
{
  const paste = `[Beat: Hook]
1. UCO (0:00–0:05 | Hook — loud):
"Promo 11.11 bikin gue bokek!"
[EN] "The 11.11 sale made me broke!"

2. OCU (0:05–0:09 | Counter — deadpan, inner thought):
"Dia beli tiga blender."
[EN] "He bought three blenders."

18. OCU (1:57–2:00 | Punchline — deadpan closer):
"Iya, sampai tanggal kembar bulan depan."
[EN] "Sure, until next month's double-date sale."

[Beat: Channel CTA Stinger]
19. UCO & OCU (2:00–2:04 | Channel CTA Stinger — Uco quick, Ocu deadpan pointing right):
UCO: "Biar otak lo nggak gampang dikibulin promo kayak gue barusan..."
OCU: "...follow Uco & Ocu buat konten pinter kayak gini!"
[EN] UCO: "So your brain doesn't get fooled by promos as easily as mine just did..." OCU: "...follow Uco & Ocu for smart content like this!"

IMPORT MODE: Exact Import (Preserve all 19 Indonesian lines & [EN] translations 1:1; do not rewrite dialogue).`;
  const { lines, context } = parsePastedScript(paste);
  assert.equal(lines.length, 5, JSON.stringify(lines, null, 2));
  assert.deepEqual(lines.map((l) => l.speaker), ["uco", "ocu", "ocu", "uco", "ocu"]);
  assert.equal(lines[0].text, "Promo 11.11 bikin gue bokek!");
  assert.equal(lines[0].en, "The 11.11 sale made me broke!");
  assert.ok(lines[0].cues.some((c) => c.includes("loud")));
  assert.equal(lines[1].thought, true);
  assert.equal(lines[2].text, "Iya, sampai tanggal kembar bulan depan.");
  assert.equal(lines[2].en, "Sure, until next month's double-date sale.");
  assert.equal(lines[3].en, "So your brain doesn't get fooled by promos as easily as mine just did...");
  assert.equal(lines[4].en, "...follow Uco & Ocu for smart content like this!");
  assert.ok(!context.some((c) => c.startsWith("18. OCU")));
  assert.ok(context.some((c) => c.startsWith("IMPORT MODE")));
}
console.log("header-then-text paste: ok");
