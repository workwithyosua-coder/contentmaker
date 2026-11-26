// Gemini key lookup, text model fallback, error details and tolerant topic / JSON parsing (gemini-core.ts).
// Pure code: no network, no AI. Run: npm run test:unit
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { test } from "node:test";
import {
  GEMINI_KEY_MISSING,
  GEMINI_KEY_VARS,
  GEMINI_TEXT_DEFAULT,
  GEMINI_TEXT_FALLBACK,
  GeminiError,
  geminiApiKey,
  geminiErrorDetail,
  geminiTextModels,
  isModelError,
  parseGeminiJson,
  parseSeeds,
  stripFences,
} from "../../src/lib/gemini-core.ts";
import { ROOT } from "./importGraph.mts";

test("TTS and the scheduler read the Gemini key through one chain, and a missing key names GEMINI_API_KEY", () => {
  assert.deepEqual([...GEMINI_KEY_VARS], ["GEMINI_API_KEY", "GOOGLE_API_KEY", "GOOGLE_AI_API_KEY"]);
  assert.deepEqual(geminiApiKey({ GEMINI_API_KEY: " g ", GOOGLE_API_KEY: "x" }), { key: "g", from: "GEMINI_API_KEY" });
  assert.deepEqual(geminiApiKey({ GEMINI_API_KEY: "  ", GOOGLE_AI_API_KEY: "a" }), { key: "a", from: "GOOGLE_AI_API_KEY" });
  assert.equal(geminiApiKey({}), null);
  assert.equal(GEMINI_KEY_MISSING, "GEMINI_API_KEY is not set in environment variables.");
  // both callers use the shared lookup, none reads the env var on its own
  for (const f of ["src/lib/voice/gemini.ts", "src/lib/gemini-text.ts"]) {
    const src = fs.readFileSync(path.join(ROOT, f), "utf8");
    assert.match(src, /geminiApiKey\(\)/, f);
    assert.doesNotMatch(src, /process\.env\.GEMINI_API_KEY/, f);
  }
});

test("text models: gemini-3.5-flash-lite by default, GEMINI_TEXT_MODEL overrides, gemini-3.8-flash as the fallback", () => {
  assert.equal(GEMINI_TEXT_DEFAULT, "gemini-3.5-flash-lite");
  assert.deepEqual(geminiTextModels({}), ["gemini-3.5-flash-lite", "gemini-3.8-flash"]);
  assert.deepEqual(geminiTextModels({ GEMINI_TEXT_MODEL: "gemini-4-pro" }), ["gemini-4-pro", GEMINI_TEXT_FALLBACK]);
  assert.deepEqual(geminiTextModels({ GEMINI_TEXT_MODEL: "gemini-3.8-flash" }), ["gemini-3.8-flash"]);
  // no retired model id left in the scheduler's Gemini calls
  for (const f of ["src/lib/gemini-text.ts", "src/lib/gemini-core.ts", "src/lib/scheduler-server.ts"]) {
    assert.doesNotMatch(fs.readFileSync(path.join(ROOT, f), "utf8"), /gemini-2\.[05]-flash(?!-preview-tts)/, f);
  }
  // only a model problem moves on to the fallback; key, quota and prompt problems don't
  assert.equal(isModelError(404, "NOT_FOUND: models/gemini-2.0-flash is not found for API version v1beta"), true);
  assert.equal(isModelError(400, "INVALID_ARGUMENT: model gemini-x is not supported for generateContent"), true);
  assert.equal(isModelError(400, "INVALID_ARGUMENT: API key not valid"), false);
  assert.equal(isModelError(429, "RESOURCE_EXHAUSTED"), false);
  assert.equal(isModelError(403, "PERMISSION_DENIED"), false);
});

test("a Gemini failure carries the HTTP status, the model and Gemini's own message (never a generic line)", () => {
  const body = JSON.stringify({ error: { code: 404, message: "models/gemini-2.5-flash is not found for API version v1beta, or is not supported for generateContent.", status: "NOT_FOUND" } });
  const e = new GeminiError(404, "gemini-2.5-flash", geminiErrorDetail(404, body));
  assert.equal(e.message, "Gemini 404 (gemini-2.5-flash): NOT_FOUND: models/gemini-2.5-flash is not found for API version v1beta, or is not supported for generateContent.");
  assert.match(geminiErrorDetail(403, JSON.stringify({ error: { message: "API key not valid", status: "PERMISSION_DENIED" } })), /PERMISSION_DENIED: API key not valid\. The API key was rejected: check GEMINI_API_KEY\./);
  assert.match(geminiErrorDetail(429, "quota"), /quota\. The free quota is used up/);
  assert.equal(geminiErrorDetail(500, "<html>oops</html>"), "<html>oops</html>");
  assert.ok(geminiErrorDetail(500, "x".repeat(2000)).length <= 240);
  assert.match(new GeminiError(0, "m", "fetch failed").message, /^Gemini network error \(m\): fetch failed$/);
  // the scheduler passes the real cause on to the 422 the GitHub log and the Schedule page show
  const src = fs.readFileSync(path.join(ROOT, "src/lib/scheduler-server.ts"), "utf8");
  assert.doesNotMatch(src, /couldn't suggest one/);
  assert.match(src, /topic suggestion failed: \$\{\(e instanceof Error \? e\.message : String\(e\)\)\.replace/);
  const route = fs.readFileSync(path.join(ROOT, "src/app/api/scheduler/slots/[id]/[step]/route.ts"), "utf8");
  assert.match(route, /console\.error\(`\[scheduler\] slot \$\{id\} \$\{step\} failed: \$\{message\}`\)/);
  assert.match(route, /Response\.json\(\{ error: message \}, \{ status: 422 \}\)/);
});

test("code fences and whitespace are stripped before parsing Gemini's JSON", () => {
  assert.equal(stripFences('  ```json\n{"a":1}\n```  '), '{"a":1}');
  assert.equal(stripFences("```\n[1,2]\n```"), "[1,2]");
  assert.equal(stripFences(" plain "), "plain");
  assert.deepEqual(parseGeminiJson('```json\n{ "title": "x", "lines": [] }\n```'), { title: "x", lines: [] });
  assert.deepEqual(parseGeminiJson('Here you go:\n{"seeds":["a b c"]}\nEnjoy'), { seeds: ["a b c"] });
  assert.throws(() => parseGeminiJson("no json here"));
});

test("topic seeds parse from JSON, fenced JSON, bare lists and plain one-line topics", () => {
  const want = ["Kenapa harga cabai naik tiap Lebaran", "Paylater buat beli kopi, pintar atau bahaya?"];
  assert.deepEqual(parseSeeds(JSON.stringify({ seeds: want }), 5), want);
  assert.deepEqual(parseSeeds("```json\n" + JSON.stringify({ seeds: want }, null, 2) + "\n```", 5), want);
  assert.deepEqual(parseSeeds("```\n" + JSON.stringify(want) + "\n```", 5), want);
  assert.deepEqual(parseSeeds(JSON.stringify({ topics: want }), 5), want);
  assert.deepEqual(parseSeeds(JSON.stringify([{ topic: want[0] }]), 5), [want[0]]);
  // plain text: one topic, or a numbered / bulleted list, quotes and em dashes cleaned
  assert.deepEqual(parseSeeds('  "Kenapa harga cabai naik tiap Lebaran"  \n', 1), [want[0]]);
  assert.deepEqual(parseSeeds("1. Kenapa harga cabai naik tiap Lebaran\n- Paylater buat beli kopi — pintar atau bahaya?\n", 5), want);
  assert.deepEqual(parseSeeds(JSON.stringify("Satu topik saja ya"), 3), ["Satu topik saja ya"]);
  assert.deepEqual(parseSeeds(JSON.stringify({ seeds: want }), 1), [want[0]], "at most max");
  assert.deepEqual(parseSeeds('{"seeds":[]}', 2), []);
  assert.deepEqual(parseSeeds("   ", 2), []);
});
