// "Redo all N lines with AI" in the recording booth: every already-voiced line voiced again, one at a time, through
// the single-line redo path with the booth's current provider and delivery. Cached-audio protection stays everywhere
// else. Pure code: no network, no database, no AI.
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { test } from "node:test";
import { linesToVoice } from "../../src/lib/voice/acting.ts";
import { RVC_BASE_MARK, rvcPlan } from "../../src/lib/renderWorker.ts";
import { redoGapMs, runRedoAll, voicedLineIndexes } from "../../src/lib/voice/redo-all.ts";
import { TTS_MIN_INTERVAL_MS } from "../../src/lib/voice/tts-pacing.ts";
import { ROOT } from "./importGraph.mts";

const read = (f: string) => fs.readFileSync(path.join(ROOT, f), "utf8");
const lines = Array.from({ length: 6 }, (_, i) => ({ index: i, speaker: i % 2 ? "ocu" : "uco", text: `Baris ${i + 1}` }));
const recorded: Record<number, { take: number }> = { 0: { take: 1 }, 1: { take: 2 }, 3: { take: 1 }, 5: { take: 3 } };

test("cached-audio protection: the default voicing path still skips every line that has a take", () => {
  assert.deepEqual(linesToVoice(lines, (i) => Boolean(recorded[i]), "missing").map((l) => l.index), [2, 4]);
  const actions = read("src/app/create/[id]/record/ai-actions.ts");
  const missing = actions.slice(actions.indexOf("export async function generateAiTakesAction"), actions.indexOf("export async function redoLineAction"));
  assert.match(missing, /const mode = form\.get\("mode"\) === "line" \? "line" : "missing";/, "the booth's default is missing-only");
  // only the booth's two redo controls reach a line with audio: nothing in the scheduler, the render or the worker
  // calls the redo action
  const callers = ["src/lib/scheduler-server.ts", "src/app/api/render/[id]/route.ts", "video/render.mts", "video/scheduler-step.mts", "src/lib/render-jobs.ts"];
  for (const f of callers) assert.doesNotMatch(read(f), /redoLineAction|runRedoAll/, f);
  assert.match(read("src/lib/scheduler-server.ts"), /const todo = linesToVoice\(booth\.lines, \(i\) => Boolean\(booth\.recorded\[i\]\), "missing"\);/);
});

test("redo all: every voiced line, in order, one at a time, with the selected provider and delivery", async () => {
  const voiced = voicedLineIndexes(lines, recorded);
  assert.deepEqual(voiced, [0, 1, 3, 5]);
  let now = 0;
  const clock = { now: () => now, sleep: async (ms: number) => void (now += ms) };
  let inFlight = 0;
  let maxInFlight = 0;
  const calls: { index: number; provider: string; preset: string; at: number }[] = [];
  const progress: string[] = [];
  const provider = "gemini_tts";
  const preset = "angry";
  const result = await runRedoAll({
    indexes: voiced,
    gapMs: redoGapMs(provider),
    clock,
    onProgress: (c, t) => progress.push(`${c}/${t}`),
    redo: async (i) => {
      inFlight++;
      maxInFlight = Math.max(maxInFlight, inFlight);
      calls.push({ index: i, provider, preset, at: now });
      now += 2500; // the request itself
      inFlight--;
      return { ok: true, message: "ok" };
    },
  });
  assert.equal(maxInFlight, 1, "sequential");
  assert.deepEqual(calls.map((c) => c.index), [0, 1, 3, 5]);
  assert.deepEqual(progress, ["1/4", "2/4", "3/4", "4/4"]);
  assert.deepEqual(result, { done: [0, 1, 3, 5], failed: [] });
  // Gemini: request starts ≥ 60 / 9 s apart (#63), so the batch never trips the 10 RPM limit across requests
  for (let k = 1; k < calls.length; k++) assert.ok(calls[k].at - calls[k - 1].at >= TTS_MIN_INTERVAL_MS);
  assert.equal(redoGapMs("gemini_tts_rvc"), TTS_MIN_INTERVAL_MS);
  assert.equal(redoGapMs("elevenlabs"), 0);
  // the booth sends the pickers' current choice with every line, through the single-line redo path
  const card = read("src/components/ai-voices-card.tsx");
  assert.match(card, /redo: \(i\) => redoLine\(i, p, d\),/);
  assert.match(card, /onChange=\{\(p, d\) => \{\s*setProvider\(p\);\s*setPreset\(d\);/);
  const action = read("src/app/create/[id]/record/ai-actions.ts");
  assert.match(action, /voiceTake\(\{ userId: owner\.id, projectId, scriptId: booth\.script\.id, lineIndex: line\.index, line, provider: asProvider\(provider\), preset: asPreset\(preset\) \}\)/, "the same voiceTake as Redo one line: acronyms, paced 429s, the tail trimmer, a new selected take");
});

test("a partial failure keeps every line that worked; a quota error stops the batch; failed lines can be retried", async () => {
  const outcome: Record<number, { ok: boolean; message: string }> = { 1: { ok: false, message: "Gemini TTS 500 (gemini-3.8-flash-tts): internal error" } };
  const r = await runRedoAll({ indexes: [0, 1, 3, 5], gapMs: 0, redo: async (i) => outcome[i] ?? { ok: true, message: "ok" } });
  assert.deepEqual(r.done, [0, 3, 5], "the lines around the failure are still redone");
  assert.deepEqual(r.failed, [{ index: 1, message: "Gemini TTS 500 (gemini-3.8-flash-tts): internal error" }]);
  // a thrown error is a failure too, never an unhandled rejection
  const thrown = await runRedoAll({ indexes: [0], gapMs: 0, redo: async () => Promise.reject(new Error("network down")) });
  assert.deepEqual(thrown.failed, [{ index: 0, message: "network down" }]);
  // quota: the lines not tried yet are listed (no more quota burned), the done ones stay done
  const q = await runRedoAll({ indexes: [0, 1, 3, 5], gapMs: 0, redo: async (i) => (i === 1 ? { ok: false, message: "Gemini TTS: the Gemini TTS quota is used up for now (429 after 3 retries)" } : { ok: true, message: "ok" }) });
  assert.deepEqual(q.done, [0]);
  assert.deepEqual(q.failed.map((f) => f.index), [1, 3, 5]);
  assert.match(q.failed[1].message, /Not tried: the voice provider's quota is used up/);
  // retry runs only the failed lines
  const retried: number[] = [];
  await runRedoAll({ indexes: q.failed.map((f) => f.index), gapMs: 0, redo: async (i) => (retried.push(i), { ok: true, message: "ok" }) });
  assert.deepEqual(retried, [1, 3, 5]);
  assert.match(read("src/components/ai-voices-card.tsx"), /onClick=\{\(\) => start\(failed\.map\(\(f\) => f\.index\)\)\}[\s\S]{0,80}Retry failed lines \(\{failed\.length\}\)/);
});

test("Own Voice: a fresh Stage A take is stored as a Gemini base take, so the next render converts it with RVC again", () => {
  // the line already had a converted take; the redo stores a new base take (the selected one)
  const takes = [
    { line_index: 0, source: "ai", ai_prompt: `${RVC_BASE_MARK} style: Cocky, hyped | text: Gue bilang ini investasi!`, id: "new-base" },
    { line_index: 1, source: "ai", ai_prompt: "[rvc] converted from abc", id: "old-converted" },
  ];
  const plan = rvcPlan([{ speaker: "uco" }, { speaker: "ocu" }], takes, { uco: true, ocu: true });
  assert.deepEqual(plan.convert, [{ lineIndex: 0, speaker: "uco", recordingId: "new-base" }]);
  assert.match(read("src/lib/voice/providers.ts"), /const mark = route\.rvc \? RVC_BASE_MARK : "\[gemini_tts\]";/);
});

test("the booth UI: beside the primary button, an inline confirmation (Escape cancels), live progress, everything locked while running", () => {
  const card = read("src/components/ai-voices-card.tsx");
  assert.match(card, /<div className="flex flex-wrap items-start gap-2">\s*<form action=\{runMissing\}>/, "one action row with the primary button");
  assert.match(card, /type="button"\s*data-redo-all\s*disabled=\{count === 0 \|\| locked \|\| pending\}/);
  assert.match(card, /Redo all \$\{count\} lines with AI/);
  assert.match(card, /Redo all \{count\} voiced lines using \{providerLabel\} \(\{deliveryLabel\}\)\? New AI takes will be added and set active for each line\./);
  assert.match(card, /Confirm redo \(\{count\} lines\)/);
  assert.match(card, /if \(e\.key === "Escape"\) \{\s*e\.preventDefault\(\);\s*close\(\);/);
  assert.match(card, /redoAllRef\.current\?\.focus\(\);/, "focus returns to the Redo all button");
  assert.doesNotMatch(card, /window\.confirm|confirm\(/);
  assert.match(card, /aria-live="polite"/);
  assert.match(card, /<p className="tabular-nums">\s*Redoing line \{run\.current\} of \{run\.total\} with \{providerLabel\}…/);
  assert.match(card, /Redid \{run\.total\} \{run\.total === 1 \? "line" : "lines"\} with \{providerLabel\} \(\{deliveryLabel\}\)\. Ready to render\./);
  // locked while running: the pickers, the one-line redo, the full voice-over upload
  assert.match(card, /locked=\{locked\}/);
  assert.match(card, /<fieldset disabled=\{locked \|\| pending\}/);
  assert.match(read("src/components/full-voiceover.tsx"), /const busy = boothBusy \|\|/);
  assert.match(read("src/components/voice-provider.tsx"), /disabled=\{pending \|\| locked\}/);
  assert.doesNotMatch(card, /—/, "no em dashes in UI copy");
});
