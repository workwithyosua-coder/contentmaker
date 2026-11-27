// The Uco & Ocu Show Bible for scheduled scripts: length / structure checks and the one stricter retry, populated
// visual fields, the FOLLOW @UCO.OCU outro, fresh prop specs (no Prop Bank recycling) and the Pillow cut-out that keeps
// interior whites. Pure code (plus Pillow when installed): no database, no network, no AI. Run: npm run test:unit
import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";
import { parseDirection } from "../../video/src/direction.ts";
import { sanitizeScript, type BankProp, type DraftLine } from "../../src/lib/scheduler.ts";
import {
  CTA_LINE,
  FORMAT_SPEC,
  MIN_LINES,
  SHOW_DIRECTION,
  SHOW_SCHEMA,
  betterAttempt,
  dropProp,
  episodePropName,
  mapPropSlugs,
  parsePropSpecs,
  showBibleProblems,
  showBiblePrompt,
  withCta,
} from "../../src/lib/showBible.ts";
import { ttsText } from "../../src/lib/voice/phonetic.ts";
import { ROOT, pathTo } from "./importGraph.mts";

const BANK: BankProp[] = [
  { name: "kalkulator-9-juta", keywords: ["kalkulator", "uang", "juta"], category: null, vetted: true, available: true },
  { name: "bubur-kerupuk", keywords: ["kerupuk"], category: null, vetted: true, available: true },
];
const EP = "1a2b3c4d-0000-4000-8000-000000000000";

/** A full comedy debate draft in the Show Bible shape (n lines, the last one the CTA). */
function draft(n: number, extra: (i: number) => Partial<DraftLine> = () => ({})): DraftLine[] {
  return Array.from({ length: n }, (_, i) => {
    const uco = i % 2 === 0;
    const last = i === n - 1;
    return {
      beat: i === 0 ? "hook" : last ? "button" : i === 7 ? "insight" : "escalation",
      speaker: last ? "ocu" : uco ? "uco" : "ocu",
      // three rapid-fire interjections (3-7 words) between the 8-word lines
      text: last ? "Follow @uco.ocu biar nggak ketipu lagi!" : [2, 5, 12].includes(i) ? "Hah, serius lo?!" : `Baris ${i + 1}, gue bilang skincare mahal itu perlu banget.`,
      subtitle: `Line ${i + 1}`,
      pose: last ? "cta" : i === 9 ? "thought" : uco ? "triumphant" : "deadpan",
      shot: uco ? "solo-uco" : "solo-ocu",
      callout: [0, 3, 7, 11, n - 1].includes(i) ? "SERUM 900 RIBU" : "",
      sfx: [0, 3, 7, 11].includes(i) ? ["pop"] : [],
      explainerCard: i === 7 ? "brain-badge" : "none",
      prop: i === 0 || i === 3 ? "serum-mahal" : "none",
      kicker: "FAKTA",
      headline: "SERUM MAHAL",
      ...extra(i),
    };
  });
}
const clean = (lines: DraftLine[], fresh: string[] = []) => withCta(sanitizeScript({ lines }, { fresh, bank: BANK }, "x", 1).lines);

test("Show Bible lengths: every format 13-15 lines (55-68 s), Koran Kinetik with 3-4 takeovers; never under 12", () => {
  for (const f of Object.values(FORMAT_SPEC)) assert.deepEqual([f.lines, f.seconds], [[13, 15], "55-68"]);
  assert.deepEqual(FORMAT_SPEC.koran_kinetik.takeovers, [3, 4]);
  assert.equal(MIN_LINES, 12);
  assert.deepEqual(showBibleProblems(clean(draft(15)), "comedy_debate"), [], "a full debate passes");
  // the 9-line "Skincare Mahal Investasi Wajah" kind of draft is rejected
  assert.match(showBibleProblems(clean(draft(9)), "comedy_debate").join("; "), /only 9 lines \(needs 13-15\)/);
  // the 17-line, 82 s "100 lamaran" kind of draft is too long
  assert.match(showBibleProblems(clean(draft(17)), "comedy_debate").join("; "), /17 lines \(max 15, about 55-68 s\)/);
  // Koran Kinetik without takeovers is rejected; with 3 it passes
  const k = draft(14, (i) => (i === 0 ? { pose: "angry" } : {}));
  assert.match(showBibleProblems(clean(k), "koran_kinetik").join("; "), /0 takeover stat card\(s\) \(needs 3-4\)/);
  const k3 = draft(14, (i) => ([3, 8, 12].includes(i) ? { layout: "takeover", statCard: "900 RIBU | SEBULAN BUAT SERUM" } : {}));
  assert.deepEqual(showBibleProblems(clean(k3), "koran_kinetik"), []);
});

test("Show Bible content checks: thought twist, explainer card, callouts, SFX, the outro CTA", () => {
  const flat = draft(15, (i) => ({ pose: i === 14 ? "cta" : "triumphant", callout: "", sfx: [], explainerCard: "none" }));
  const problems = showBibleProblems(clean(flat), "comedy_debate").join("; ");
  assert.match(problems, /0 thought line\(s\)/);
  assert.match(problems, /no explainerCard/);
  // a flat draft gets callouts from the dead-air rule: never two lines in a row with an empty stage
  const flatLines = clean(flat);
  assert.doesNotMatch(problems, /callout/);
  for (let i = 1; i < flatLines.length; i++) assert.ok(flatLines[i - 1].kinetic_text || flatLines[i].kinetic_text || flatLines[i].layout === "takeover" || flatLines[i - 1].layout === "takeover", `lines ${i}-${i + 1}`);
  assert.doesNotMatch(problems, /SFX/, "SFX are automatic now (takeover stamp, new-prop pop): a draft needs none");
  // no CTA at the end: the outro line is appended (spoken), and the direction gives the animated FOLLOW @UCO.OCU
  const noCta = draft(14).slice(0, 13);
  const withOutro = clean(noCta);
  assert.equal(withOutro.length, 14);
  assert.deepEqual(withOutro.at(-1), CTA_LINE);
  assert.equal(SHOW_DIRECTION.split("\n")[0], "CTA: FOLLOW @UCO.OCU");
  assert.equal(parseDirection(SHOW_DIRECTION).ctaText, "FOLLOW @UCO.OCU");
  assert.equal(ttsText(CTA_LINE.text), "Follow U-co Ocu biar nggak ketipu lagi!", "the handle is spoken as a name");
});

test("visual direction is populated on every line: pose, shot, callouts, SFX, stat cards, explainer cards", () => {
  const lines = clean(draft(15, (i) => (i === 5 ? { layout: "takeover", statCard: "900 RIBU | SEBULAN" } : i === 2 ? { pose: "", shot: "" } : {})));
  assert.ok(lines.every((l) => l.emotion && l.camera_shot), "no blank pose or shot");
  assert.equal(lines[2].emotion, "triumphant");
  assert.equal(lines[9].thought_bubble, true, "pose thought → an inner-monologue line");
  assert.equal(lines[9].kinetic_text, "SERUM MAHAL", "a thought with no callout: its headline as the 2-5 word caption, never blank");
  assert.deepEqual([lines[5].layout, lines[5].stat, lines[5].sfx], ["takeover", "900 RIBU | SEBULAN", ["stamp"]]);
  assert.equal(lines[7].overlay, "brain-badge");
  assert.equal(lines[0].kinetic_text, "SERUM 900 RIBU");
  assert.ok(lines.filter((l) => l.kinetic_text).every((l) => l.kinetic_text!.split(" ").length <= 4), "callouts are 2-4 words");
  assert.ok(lines.flatMap((l) => l.sfx).every((x) => ["whoosh", "pop", "stamp", "record-scratch", "ding"].includes(x)));
  // the schema Gemini writes to requires the visual fields on every line
  const req = (SHOW_SCHEMA.properties.lines.items as { required: string[] }).required;
  for (const f of ["pose", "shot", "layout", "explainerCard", "sfx", "prop", "subtitle"]) assert.ok(req.includes(f), f);
  assert.ok(SHOW_SCHEMA.required.includes("propSpecs"));
});

test("a short script is retried once with the problems spelled out; the better attempt wins", () => {
  const short = { lines: clean(draft(9)), problems: ["only 9 lines (needs 14-16)"] };
  const full = { lines: clean(draft(15)), problems: [] as string[] };
  assert.equal(betterAttempt(short, full), full);
  assert.equal(betterAttempt(full, short), full, "a passing attempt is never replaced");
  const longerFlawed = { lines: clean(draft(13)), problems: ["only 13 lines"] };
  assert.equal(betterAttempt(short, longerFlawed), longerFlawed, "more lines beat fewer");
  const prompt = showBiblePrompt({ format: "comedy_debate", label: "Comedy Debate", brief: "b", seed: "Skincare mahal", bankProps: "", strict: ["only 9 lines (needs 14-16)"] });
  assert.match(prompt, /PERCOBAAN SEBELUMNYA DITOLAK karena: only 9 lines \(needs 14-16\)/);
  assert.match(prompt, /13-15 baris termasuk outro CTA \(sekitar 55-68 detik\)/);
  assert.match(prompt, /lo\/gue/);
  assert.match(prompt, /wajib demi investasi masa depan wajah" = salah/);
  assert.match(prompt, /FOLLOW|follow @UCO\.OCU|@UCO\.OCU/i);
  // the server: two attempts at most, under 12 lines after both fails the slot, the problems go to the retry
  const src = fs.readFileSync(path.join(ROOT, "src/lib/scheduler-server.ts"), "utf8");
  assert.match(src, /for \(const strict of \[false, true\]\) \{\s*if \(strict && best && !best\.problems\.length\) break;/);
  assert.match(src, /strict: strict \? \(best\?\.problems \?\? \[/);
  assert.match(src, /if \(best\.lines\.length < MIN_LINES\) throw new Error\(`Gemini wrote only/);
  assert.match(src, /\$\{showDirection\(r\.visual_style\)\}, true, now\(\)\)/, "every scheduled script carries the FOLLOW @UCO.OCU outro (and BGM, pacing)");
});

test("fresh props: 2-3 clean specs, stored per episode, mapped onto the beats; a failed one becomes none", () => {
  const specs = parsePropSpecs([
    { slug: "Serum Mahal!", prompt: "a tiny luxury serum bottle with a gold dropper" },
    { slug: "struk-belanja", prompt: "a long shopping receipt" },
    { slug: "serum-mahal", prompt: "duplicate" },
    { slug: "x", prompt: "too short a slug" },
    { slug: "kaca-pembesar", prompt: "" },
    { slug: "cermin-retak", prompt: "a cracked hand mirror" },
    { slug: "fourth-one", prompt: "never kept, max 3" },
  ]);
  assert.deepEqual(specs.map((s) => s.slug), ["serum-mahal", "struk-belanja", "cermin-retak"]);
  assert.deepEqual(parsePropSpecs(null), []);
  const name = episodePropName("serum-mahal", EP);
  assert.equal(name, "serum-mahal-1a2b3c");
  assert.match(name, /^[a-z0-9]+(-[a-z0-9]+)*$/);
  const names = { "serum-mahal": name, "struk-belanja": episodePropName("struk-belanja", EP) };
  const lines = clean(mapPropSlugs(draft(15, (i) => (i === 5 ? { prop: "struk-belanja" } : i === 6 ? { prop: "kalkulator-9-juta-xyz" } : {})), names), Object.values(names));
  assert.deepEqual(lines.slice(0, 7).map((l) => l.prop_tag), [name, "none", "none", name, "none", "struk-belanja-1a2b3c", "none"]);
  // no Prop Bank recycling: the calculator never lands on a skincare episode, not even via its keywords
  assert.ok(!lines.some((l) => l.prop_tag === "kalkulator-9-juta"));
  const noProps = clean(draft(15, () => ({ prop: "none", text: "Kalkulator bilang serum 9 juta, uang habis!" })));
  assert.ok(noProps.every((l) => l.prop_tag === "none"), "keywords (kalkulator, uang, juta) attach nothing");
  // a failed image: its beats show no prop, the rest keep theirs
  const after = dropProp(lines, name);
  assert.deepEqual(after.slice(0, 6).map((l) => l.prop_tag), ["none", "none", "none", "none", "none", "struk-belanja-1a2b3c"]);
  // the worker drops a failed prop to none, never swaps in another
  const stage = fs.readFileSync(path.join(ROOT, "video/prop-stage.mts"), "utf8");
  assert.match(stage, /prop-finish`, \{ name, ok: false/);
  assert.doesNotMatch(stage, /prop-bank|propBank|keywords/);
});

const hasPillow = spawnSync("python3", ["-c", "import PIL"]).status === 0;
test("the Pillow cut-out removes the white background, keeps interior whites, defringes the edge", { skip: hasPillow ? false : "Pillow isn't installed" }, () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "cutout-"));
  const src = path.join(dir, "in.png");
  const out = path.join(dir, "out.png");
  // a 1K "generated prop": an orange bottle with a black outline, a white label inside, a light halo pixel ring
  execFileSync("python3", [
    "-c",
    `from PIL import Image, ImageDraw
im = Image.new("RGB", (1024, 1024), "white")
d = ImageDraw.Draw(im)
d.rectangle((300, 200, 724, 860), fill=(235, 110, 40), outline=(12, 12, 12), width=10)
d.rectangle((400, 420, 624, 620), fill=(255, 255, 255), outline=(12, 12, 12), width=6)
d.rectangle((296, 196, 728, 864), outline=(225, 225, 225), width=2)
im.save(${JSON.stringify(src)})`,
  ]);
  execFileSync("python3", [path.join(ROOT, "scripts/prop_cutout.py"), src, out]);
  const probe = JSON.parse(
    execFileSync("python3", [
      "-c",
      `import json
from PIL import Image
im = Image.open(${JSON.stringify(out)}); w, h = im.size
row = [im.getpixel((x, h // 2))[3] for x in range(0, 40)]
edge = next(i for i, a in enumerate(row) if a > 0)
print(json.dumps({"mode": im.mode, "w": w, "h": h, "corner": im.getpixel((2, 2))[3], "label": list(im.getpixel((w // 2, h // 2))), "bottom": im.getpixel((w // 2, h - 2))[3], "halo": row[edge], "inside": row[edge + 2]}))`,
    ]).toString(),
  );
  assert.equal(probe.mode, "RGBA");
  assert.ok(probe.w < 1024 && probe.h < 1024, "cropped to the drawing (16 px margin)");
  assert.equal(probe.corner, 0, "the background is transparent");
  assert.equal(probe.bottom, 0);
  assert.deepEqual(probe.label, [255, 255, 255, 255], "the white label inside the bottle stays opaque white");
  assert.ok(probe.halo > 0 && probe.halo < 128, `the light halo next to the background is faded (alpha ${probe.halo})`);
  assert.equal(probe.inside, 255, "the dark outline stays solid");
  // an all-white image is refused (the worker then drops the prop)
  execFileSync("python3", ["-c", `from PIL import Image; Image.new("RGB", (64, 64), "white").save(${JSON.stringify(src)})`]);
  assert.notEqual(spawnSync("python3", [path.join(ROOT, "scripts/prop_cutout.py"), src, out]).status, 0);
  fs.rmSync(dir, { recursive: true, force: true });
});

test("zero Anthropic anywhere in the scheduler, its worker steps and the new prop / Show Bible code", () => {
  const AI = [/src\/lib\/agents\//, /@anthropic-ai\//, /^anthropic$/];
  for (const entry of [
    "src/lib/showBible.ts",
    "src/lib/scheduler.ts",
    "src/lib/scheduler-server.ts",
    "src/lib/gemini-text.ts",
    "src/lib/voice/gemini.ts",
    "src/app/api/scheduler/tick/route.ts",
    "src/app/api/scheduler/slots/[id]/[step]/route.ts",
    "src/app/schedule/page.tsx",
    "src/app/schedule/actions.ts",
    "src/components/scheduler.tsx",
    "video/scheduler-step.mts",
    "video/prop-stage.mts",
    "video/edge-stage.mts",
  ]) {
    assert.equal(pathTo(entry, AI), null, `${entry} reaches AI via ${pathTo(entry, AI)?.join(" → ")}`);
  }
  for (const f of ["scripts/prop_cutout.py", "scripts/edge_tts_worker.py", ".github/workflows/autonomous-scheduler.yml"]) {
    assert.doesNotMatch(fs.readFileSync(path.join(ROOT, f), "utf8"), /ANTHROPIC_API_KEY|api\.anthropic\.com|import anthropic/, f);
  }
  const wf = fs.readFileSync(path.join(ROOT, ".github/workflows/autonomous-scheduler.yml"), "utf8");
  assert.deepEqual([...new Set([...wf.matchAll(/secrets\.(\w+)/g)].map((m) => m[1]))], ["RENDER_TOKEN"], "no new secret: the image model is called by the app");
  assert.match(fs.readFileSync(path.join(ROOT, "worker/edge/requirements.txt"), "utf8"), /^Pillow>=/m);
});
