// Zero-AI approval, captions and publishing. Pure code: no database, no network, no AI. Run: npm run test:unit
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { test } from "node:test";
import { PUBLISH_PLATFORMS, defaultText, youtubeTitle } from "../../src/lib/publish/captions.ts";
import { CAPTION_LIMITS, captionProblems, clipWords, hookLine, manualCaptions, statusAfterApproval } from "../../src/lib/publish/manualCaptions.ts";

const ROOT = path.resolve(import.meta.dirname, "../..");

test("default captions are deterministic, built from the title and the opening line, within every platform limit", () => {
  const input = { title: "Mie Pedas Level 10", hook: "Mie pedas level 10 itu kemenangan, bukan siksaan!" };
  const a = manualCaptions(input);
  assert.deepEqual(manualCaptions(input), a, "same input, same captions");
  assert.equal(a.youtube.title, "Mie Pedas Level 10");
  assert.equal(youtubeTitle(a.youtube), "Mie Pedas Level 10 #Shorts");
  assert.match(a.tiktok.caption, /^Mie Pedas Level 10: Mie pedas level 10 itu kemenangan/);
  assert.ok(a.tiktok.hashtags.includes("MiePedasLevel10"));
  assert.equal(a.instagram.hook, "Mie Pedas Level 10");
  assert.match(a.facebook.description, /kemenangan/);
  for (const p of PUBLISH_PLATFORMS) {
    const d = defaultText(p, a);
    assert.ok(d.text.trim().length > 0, `${p} caption`);
    assert.ok(d.text.length <= CAPTION_LIMITS[p].text, `${p} caption length`);
    if (CAPTION_LIMITS[p].title) assert.ok((d.title ?? "").length <= CAPTION_LIMITS[p].title!, `${p} title length`);
  }
});

test("a very long title still gives a YouTube Shorts title within 100 characters, cut at a word", () => {
  const long = "Kenapa orang Indonesia rela antre dua jam demi mie pedas level sepuluh padahal besoknya sakit perut seharian penuh";
  const c = manualCaptions({ title: long, hook: null });
  const yt = youtubeTitle(c.youtube);
  assert.ok(yt.length <= 100, `${yt.length}`);
  assert.ok(yt.endsWith("… #Shorts"));
  assert.ok(!/\s…/.test(yt), "no space before the ellipsis");
  assert.equal(clipWords("satu dua tiga", 50), "satu dua tiga");
  // no hook: captions use the title alone, no empty paragraphs
  assert.equal(c.instagram.context, "");
  assert.ok(!defaultText("instagram", c).text.includes("\n\n\n\n"));
});

test("the opening line is the hook; an episode without a title still gets usable captions", () => {
  assert.equal(hookLine([{ text: "  " }, { text: "Halo  semua!" }]), "Halo semua!");
  assert.equal(hookLine([]), null);
  const c = manualCaptions({ title: "  ", hook: null });
  assert.equal(c.youtube.title, "Uco & Ocu");
});

test("approval without AI moves the episode on without ever moving a later step back", () => {
  assert.equal(statusAfterApproval("awaiting_script_approval", { lines: 10, recorded: 0 }), "awaiting_recording");
  assert.equal(statusAfterApproval("awaiting_script_approval", { lines: 10, recorded: 10 }), "recorded");
  assert.equal(statusAfterApproval("captioning", { lines: 4, recorded: 2 }), "awaiting_recording", "a stuck AI caption step is released");
  assert.equal(statusAfterApproval("awaiting_recording", { lines: 4, recorded: 0 }), "awaiting_recording");
  assert.equal(statusAfterApproval("recorded", { lines: 4, recorded: 4 }), "recorded");
  assert.equal(statusAfterApproval("rendering", { lines: 4, recorded: 4 }), "rendering");
  assert.equal(statusAfterApproval("published", { lines: 4, recorded: 4 }), "published");
});

test("a switched-on platform with a blank required title or caption can't be posted; switched-off ones are ignored", () => {
  assert.deepEqual(captionProblems({ tiktok: { enabled: true, text: "Halo" } }), []);
  const blank = captionProblems({ tiktok: { enabled: true, text: "   " }, instagram: { enabled: false, text: "" } });
  assert.equal(blank.length, 1);
  assert.deepEqual([blank[0].platform, blank[0].field], ["tiktok", "text"]);
  assert.match(blank[0].message, /TikTok: write a caption/);
  const yt = captionProblems({ youtube: { enabled: true, title: "", text: "" } });
  assert.deepEqual(yt.map((x) => x.field), ["title"], "YouTube needs a title; its description is optional");
  const fb = captionProblems({ facebook: { enabled: true, title: "", text: "" } });
  assert.deepEqual(fb.map((x) => x.field), ["text"], "Facebook needs a description; its title is optional");
  const over = captionProblems({ instagram: { enabled: true, text: "x".repeat(2201) } });
  assert.match(over[0].message, /over 2200/);
});

// ------------------------------------------------------------------ import graph: zero Anthropic on these paths
const AI = [/src\/lib\/agents\//, /@anthropic-ai\//, /^anthropic$/];

/** Static and dynamic value imports of a file (type-only imports are erased at build time, so they're skipped). */
function importsOf(file: string): string[] {
  const src = fs.readFileSync(file, "utf8");
  const out: string[] = [];
  for (const m of src.matchAll(/^\s*(import|export)\s+(type\s+)?[^;]*?\sfrom\s+["']([^"']+)["']/gm)) if (!m[2]) out.push(m[3]);
  for (const m of src.matchAll(/^\s*import\s+["']([^"']+)["']/gm)) out.push(m[1]);
  for (const m of src.matchAll(/import\(\s*["']([^"']+)["']\s*\)/g)) out.push(m[1]);
  return out;
}

function resolve(from: string, spec: string): string | null {
  const base = spec.startsWith("@/") ? path.join(ROOT, "src", spec.slice(2)) : spec.startsWith(".") ? path.resolve(path.dirname(from), spec) : null;
  if (!base) return null; // a package
  for (const ext of ["", ".ts", ".tsx", ".mts", "/index.ts", "/index.tsx"]) if (fs.existsSync(base + ext) && fs.statSync(base + ext).isFile()) return base + ext;
  return null;
}

/** Every module reachable from `entry`, and the first path that reaches an AI module (or null). */
function aiPath(entry: string): string[] | null {
  const seen = new Set<string>();
  const queue: { file: string; trail: string[] }[] = [{ file: path.join(ROOT, entry), trail: [entry] }];
  while (queue.length) {
    const { file, trail } = queue.shift()!;
    if (seen.has(file)) continue;
    seen.add(file);
    for (const spec of importsOf(file)) {
      const hit = resolve(file, spec);
      const name = hit ? path.relative(ROOT, hit) : spec;
      if (AI.some((rx) => rx.test(name))) return [...trail, name];
      if (hit) queue.push({ file: hit, trail: [...trail, name] });
    }
  }
  return null;
}

test("approve without AI, caption editing, post now and schedule never import the Anthropic client", () => {
  for (const entry of [
    "src/app/create/publish-actions.ts", // approveWithoutAiAction, publishAction, setAutoPublishAction
    "src/components/publish-panel.tsx", // caption editing, shared caption, post / schedule buttons
    "src/lib/publish/approval.ts",
    "src/lib/publish/requests.ts", // post now / schedule / retry / cancel
    "src/lib/publish/engine.ts", // the publishing worker
    "src/app/create/studio-actions.ts", // Manual / Exact Import (pre-approved with default captions)
    "src/app/api/render/[id]/video/complete/route.ts", // auto-post on render complete
    "src/app/api/cron/process-scheduled-posts/route.ts", // scheduled posts going out
    "src/app/api/episodes/[id]/publish/route.ts",
  ]) {
    assert.equal(aiPath(entry), null, `${entry} reaches AI via ${aiPath(entry)?.join(" → ")}`);
  }
  // the check itself works: the AI caption action does reach the client
  assert.ok(aiPath("src/app/create/actions.ts"));
});
