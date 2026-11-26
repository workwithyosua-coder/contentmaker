// Autonomous scheduler: slot generation in WIB (>= 2 a day), Prop Bank resolution (unattended scripts never name a
// missing prop), queue status transitions, the non-fatal Studio Assets bucket limit, and zero Anthropic calls.
// Pure code: no database, no network, no AI. Run: npm run test:unit
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { test } from "node:test";
import { requiredAssets } from "../../video/src/beats.ts";
import { FREE_PLAN_FILE_LIMIT, isTooLarge, overLimitMessage, raiseModelLimit } from "../../src/lib/bucketLimit.ts";
import {
  DEFAULT_RULE,
  LEAD_MINUTES,
  QUEUE_STATUSES,
  assignSeeds,
  canAdvance,
  defaultSlotTimes,
  formatWib,
  missingProps,
  normalizeRule,
  parseKeywords,
  plannedSlots,
  resolveProp,
  sanitizeScript,
  slotDue,
  slotsPerDay,
  statusAfterPublishing,
  utcToWib,
  wibToUtc,
  type BankProp,
} from "../../src/lib/scheduler.ts";
import { ROOT, pathTo } from "./importGraph.mts";

// Thursday 26 Nov 2026, 08:00 WIB (01:00 UTC)
const NOW = new Date("2026-11-26T01:00:00Z");

test("11:00 and 19:00 WIB are 04:00 and 12:00 UTC, and back again", () => {
  assert.equal(wibToUtc("2026-11-27", "11:00").toISOString(), "2026-11-27T04:00:00.000Z");
  assert.equal(wibToUtc("2026-11-27", "19:00").toISOString(), "2026-11-27T12:00:00.000Z");
  // just after midnight WIB is still the previous day in UTC
  assert.equal(wibToUtc("2026-12-01", "00:30").toISOString(), "2026-11-30T17:30:00.000Z");
  assert.deepEqual(utcToWib(new Date("2026-11-30T17:30:00Z")), { date: "2026-12-01", time: "00:30", weekday: 2, day: 1 });
  assert.equal(formatWib(new Date("2026-11-27T04:00:00Z")), "Fri 27 Nov, 11:00 WIB");
  assert.deepEqual(defaultSlotTimes(2), ["11:00", "19:00"]);
  assert.deepEqual(defaultSlotTimes(3), ["11:00", "15:00", "19:00"]);
});

test("daily: 2 slots every day at 11:00 and 19:00 WIB for the next 3 days, oldest first", () => {
  const plan = plannedSlots(DEFAULT_RULE, NOW, 3);
  assert.deepEqual(
    plan.map((p) => [p.scheduledFor.toISOString(), p.slotIndex, p.format]),
    [
      ["2026-11-26T04:00:00.000Z", 0, "comedy_debate"],
      ["2026-11-26T12:00:00.000Z", 1, "koran_kinetik"],
      ["2026-11-27T04:00:00.000Z", 0, "comedy_debate"],
      ["2026-11-27T12:00:00.000Z", 1, "koran_kinetik"],
      ["2026-11-28T04:00:00.000Z", 0, "comedy_debate"],
      ["2026-11-28T12:00:00.000Z", 1, "koran_kinetik"],
    ],
  );
  // a slot that already passed today isn't planned (13:00 WIB: only 19:00 is left today)
  const afternoon = plannedSlots(DEFAULT_RULE, new Date("2026-11-26T06:00:00Z"), 1);
  assert.deepEqual(afternoon.map((p) => utcToWib(p.scheduledFor).time), ["19:00"]);
});

test("never fewer than 2 episodes a day, whatever the rule says", () => {
  for (const bad of [0, 1, -3, "x", null, undefined]) assert.equal(normalizeRule({ slots_per_day: bad }).slots_per_day, 2, String(bad));
  assert.equal(normalizeRule({ slots_per_day: 9 }).slots_per_day, 6);
  // one time given for 2 slots: the other is filled; invalid and duplicate times are dropped
  assert.deepEqual(normalizeRule({ slots_per_day: 2, slot_times: ["19:00", "19:00", "25:00"] }).slot_times, ["11:00", "19:00"]);
  const four = normalizeRule({ slots_per_day: 4, slot_times: ["7:30"], format_mix: ["koran_kinetik", "affiliate"] });
  assert.equal(four.slot_times.length, 4);
  assert.equal(four.slot_times[0], "07:30");
  assert.deepEqual(four.format_mix, ["koran_kinetik", "affiliate", "koran_kinetik", "affiliate"]);
  for (const cadence of ["daily", "weekly", "monthly"]) {
    const rule = { ...DEFAULT_RULE, cadence, slots_per_day: 1, days_of_week: [0, 3, 6], days_of_month: [1, 2, 28] };
    const perDay = slotsPerDay(plannedSlots(rule, new Date("2026-11-25T16:00:00Z"), 40));
    assert.ok(perDay.size > 0, cadence);
    for (const [day, n] of perDay) assert.ok(n >= 2, `${cadence} ${day}: ${n}`);
  }
});

test("weekly runs on the chosen weekdays only; monthly on the chosen dates (skipping dates a month doesn't have)", () => {
  const weekly = plannedSlots({ ...DEFAULT_RULE, cadence: "weekly", days_of_week: [1, 5] }, new Date("2026-11-22T17:00:00Z"), 14); // from Mon 23 Nov 00:00 WIB
  const days = [...new Set(weekly.map((p) => utcToWib(p.scheduledFor).date))];
  assert.deepEqual(days, ["2026-11-23", "2026-11-27", "2026-11-30", "2026-12-04"]);
  assert.ok(days.every((d) => [1, 5].includes(new Date(`${d}T12:00:00Z`).getUTCDay())));
  const monthly = plannedSlots({ ...DEFAULT_RULE, cadence: "monthly", days_of_month: [15, 31] }, new Date("2026-10-31T17:00:00Z"), 61); // Nov 1 … Dec 31
  assert.deepEqual([...new Set(monthly.map((p) => utcToWib(p.scheduledFor).date))], ["2026-11-15", "2026-12-15", "2026-12-31"], "no 31 November");
});

test("the cron produces a slot within 90 minutes of its time, marks long-missed ones, leaves the rest", () => {
  const at = (iso: string) => ({ status: "queued", scheduled_for: new Date(iso) });
  const run = new Date("2026-11-27T02:47:00Z"); // 09:47 WIB: the morning cron
  assert.equal(slotDue(at("2026-11-27T04:00:00Z"), run), "produce", "11:00 WIB slot, 73 min ahead");
  assert.equal(slotDue(at("2026-11-27T12:00:00Z"), run), "later", "19:00 WIB waits for the evening run");
  assert.equal(slotDue(at("2026-11-26T16:00:00Z"), run), "produce", "yesterday 23:00 WIB, under 12 h late: still made");
  assert.equal(slotDue(at("2026-11-26T12:00:00Z"), run), "missed", "yesterday 19:00 WIB, almost 15 h late");
  assert.equal(slotDue(at("2026-11-26T04:00:00Z"), run), "missed");
  assert.equal(slotDue({ status: "rendering", scheduled_for: run }, run), "skip");
  assert.equal(LEAD_MINUTES, 90);
});

test("queue statuses: queued → scripting → voicing → rendering → ready_to_post → published, any step → failed", () => {
  assert.deepEqual([...QUEUE_STATUSES], ["queued", "scripting", "voicing", "rendering", "ready_to_post", "published", "failed"]);
  const path = ["queued", "scripting", "voicing", "rendering", "ready_to_post", "published"];
  for (let i = 0; i < path.length - 1; i++) assert.equal(canAdvance(path[i], path[i + 1]), true, `${path[i]} → ${path[i + 1]}`);
  assert.equal(canAdvance("rendering", "published"), true, "nothing to hand off: straight to published");
  for (const s of ["queued", "scripting", "voicing", "rendering", "ready_to_post"]) assert.equal(canAdvance(s, "failed"), true, `${s} → failed`);
  // no skipping steps, no going back, published is final, failed only returns through retry
  for (const [f, t] of [
    ["queued", "voicing"],
    ["queued", "rendering"],
    ["scripting", "rendering"],
    ["voicing", "scripting"],
    ["rendering", "voicing"],
    ["published", "failed"],
    ["published", "queued"],
    ["failed", "scripting"],
    ["queued", "bogus"],
  ]) {
    assert.equal(canAdvance(f, t), false, `${f} → ${t}`);
  }
  assert.equal(canAdvance("failed", "queued"), true, "retry");
  assert.equal(canAdvance("failed", "ready_to_post"), true, "retry just the posting");
});

test("after the render: published only when every queued post is live and there's no TikTok hand-off", () => {
  const all = ["youtube", "instagram", "facebook"] as const;
  assert.equal(statusAfterPublishing({ targets: [...all], queued: ["youtube", "instagram"], published: [], failed: [] }), "ready_to_post");
  assert.equal(statusAfterPublishing({ targets: [...all], queued: ["youtube", "instagram"], published: ["youtube", "instagram"], failed: [] }), "published");
  assert.equal(statusAfterPublishing({ targets: [...all, "tiktok_drafts"], queued: ["youtube"], published: ["youtube"], failed: [] }), "ready_to_post", "waits for the TikTok hand-off");
  assert.equal(statusAfterPublishing({ targets: [...all], queued: [], published: [], failed: [] }), "ready_to_post", "nothing connected: the video waits");
  assert.equal(statusAfterPublishing({ targets: [...all], queued: ["youtube"], published: [], failed: ["youtube"] }), "failed");
});

test("bulk topics fill the next open slots in order and never overwrite a manual topic", () => {
  const slots = [
    { id: "a", topic_source: "manual", status: "queued" },
    { id: "b", topic_source: "gemini", status: "queued" },
    { id: "c", topic_source: null, status: "scripting" },
    { id: "d", topic_source: null, status: "queued" },
    { id: "e", topic_source: null, status: "queued" },
  ];
  assert.deepEqual(assignSeeds(slots, "Harga cabai\n\n  Paylater kopi  \n"), [
    { id: "b", seed: "Harga cabai" },
    { id: "d", seed: "Paylater kopi" },
  ]);
  assert.deepEqual(parseKeywords("Kopi,  es kopi; LATTE\nkopi,"), ["kopi", "es kopi", "latte"]);
});

// ------------------------------------------------------------------ Prop Bank
const BANK: BankProp[] = [
  { name: "nasi-padang-blender", keywords: ["rendang", "nasi padang", "blender"], category: null, vetted: true, available: true },
  { name: "bubur-kerupuk", keywords: ["kerupuk", "bubur"], category: null, vetted: true, available: true },
  { name: "bubur-mixed", keywords: ["diaduk"], category: null, vetted: false, available: true }, // switched off
  { name: "es-kopi-susu", keywords: ["kopi"], category: null, vetted: true, available: false }, // no file
];

test("prop tags resolve to vetted, existing props only, else a keyword match, else none", () => {
  assert.equal(resolveProp("bubur-kerupuk", "apa aja", BANK), "bubur-kerupuk");
  assert.equal(resolveProp("BUBUR-KERUPUK", "apa aja", BANK), "bubur-kerupuk");
  assert.equal(resolveProp("sate-padang", "Rendang diblender jadi jus?!", BANK), "nasi-padang-blender", "unknown name: the keyword the line mentions");
  assert.equal(resolveProp("bubur-mixed", "Bubur diaduk itu dosa", BANK), "bubur-kerupuk", "not vetted: never used, the bubur keyword wins");
  assert.equal(resolveProp("es-kopi-susu", "Es kopi susu 25 ribu", BANK), "none", "no file: never asked for");
  assert.equal(resolveProp(null, "Pajak naik lagi", BANK), "none");
  assert.equal(resolveProp("none", "Nasi padang", BANK), "nasi-padang-blender");
  // keywords match whole words, not inside other words
  assert.equal(resolveProp(null, "Rendangnya mana", BANK), "none");
});

test("an unattended script never references a missing prop, and its assets are all ready", () => {
  const draft = {
    title: "Rendang diblender — inovasi?",
    lines: [
      { beat: "hook", speaker: "uco", text: "Rendang diblender jadi jus — gila!", subtitle: "Blended rendang", emotion: "shocked", camera_shot: "solo-uco", prop_tag: "jus-rendang", kicker: "BREAKING", headline: "JUS RENDANG VIRAL HARI INI JUGA", layout: "standard" },
      { beat: "counter", speaker: "ocu", text: "Itu namanya bubur, Co.", subtitle: "That's porridge (the bank's bubur keyword).", emotion: "deadpan", camera_shot: "solo-ocu", prop_tag: "es-kopi-susu", kicker: "FAKTA", headline: "ITU BUBUR" },
      { beat: "escalation", speaker: "uco", text: "Pakai kerupuk biar crunchy!", subtitle: "Add crackers!", emotion: "deadpan", camera_shot: "fisheye", prop_tag: "bubur-kerupuk", kicker: "IDE", headline: "PAKAI KERUPUK" },
      { beat: "insight", speaker: "ocu", text: "Satu porsi rendang itu kalorinya tinggi.", subtitle: "High calories.", emotion: "explaining", camera_shot: "closeup-punch", prop_tag: "kalori-meter", layout: "takeover", stat: "TINGGI | KALORI SEPORSI", kicker: "FAKTA", headline: "KALORI TINGGI" },
      { beat: "concession", speaker: "uco", text: "Hmm, ada benarnya juga sih.", subtitle: "He has a point.", emotion: "triumphant", camera_shot: "two-shot", prop_tag: "none", thought_bubble: true, layout: "takeover", kicker: "DALAM HATI", headline: "ADA BENARNYA" },
      { beat: "button", speaker: "ocu", text: "Makan aja yang normal.", subtitle: "Just eat normally.", emotion: "inspecting", camera_shot: "solo-ocu", prop_tag: "", kicker: "INTINYA", headline: "MAKAN NORMAL" },
      { beat: "button", speaker: "wasit", text: "Saya juga mau ngomong" },
    ],
  };
  const { title, lines } = sanitizeScript(draft, BANK, "fallback");
  assert.equal(title, "Rendang diblender, inovasi?", "no em dash");
  assert.equal(lines.length, 6, "an unknown speaker is dropped");
  assert.deepEqual(missingProps(lines, BANK), []);
  assert.deepEqual(
    lines.map((l) => l.prop_tag),
    ["nasi-padang-blender", "bubur-kerupuk", "bubur-kerupuk", "nasi-padang-blender", "none", "none"],
  );
  assert.ok(lines.every((l) => !/—/.test(`${l.text} ${l.subtitle}`)));
  assert.equal(lines[0].important_message?.headline.split(" ").length, 5, "headline clamped to 5 words");
  assert.equal(lines[2].emotion, null, "Uco has no deadpan pose");
  assert.equal(lines[2].camera_shot, "solo-uco", "unknown shot → the speaker's solo");
  assert.deepEqual([lines[3].layout, lines[3].stat], ["takeover", "TINGGI | KALORI SEPORSI"]);
  assert.equal(lines[4].layout, "standard", "takeover without a stat is a normal line");
  // the render's own asset check (exact scripts: only named props) finds nothing to draw
  const props = requiredAssets(lines as never, { direction: { exact: true } as never }).props;
  assert.ok(props.length > 0);
  assert.ok(props.every((p) => p.ready), JSON.stringify(props));
  assert.throws(() => sanitizeScript({ lines: draft.lines.slice(0, 2) }, BANK, "x"), /only 2 usable line/);
});

// ------------------------------------------------------------------ Studio Assets: the 50 MB Free plan
test("the model bucket limit never aborts an upload: 100 MB, else 50 MB, else carry on", async () => {
  const calls: number[] = [];
  const free = async (bytes: number) => {
    calls.push(bytes);
    if (bytes > FREE_PLAN_FILE_LIMIT) throw new Error(`Couldn't raise the recordings bucket's size limit (413): {"statusCode":"413","error":"EntityTooLarge","message":"The object exceeded the maximum allowed size"}`);
  };
  assert.deepEqual(await raiseModelLimit(free, 100 * 1024 * 1024), { limit: FREE_PLAN_FILE_LIMIT, note: "Supabase Free plan: files up to 50 MB." });
  assert.deepEqual(calls, [100 * 1024 * 1024, FREE_PLAN_FILE_LIMIT]);
  // Pro: 100 MB goes through
  assert.deepEqual(await raiseModelLimit(async () => {}, 100 * 1024 * 1024), { limit: 100 * 1024 * 1024, note: null });
  // every bucket update refused (400 both times, or the bucket can't be read): resolves, never throws
  const r = await raiseModelLimit(async () => {
    throw new Error("Couldn't raise the recordings bucket's size limit (400): Bad Request");
  }, 100 * 1024 * 1024);
  assert.equal(r.limit, null);
  assert.match(r.note!, /unchanged/);
  const read = await raiseModelLimit(async () => {
    throw new Error("Couldn't read the recordings storage bucket (500).");
  }, 100 * 1024 * 1024);
  assert.equal(read.limit, null);
  assert.equal(isTooLarge(new Error("(400): payload too large")), true);
  // a 48 MB FP16 model fits; a 70 MB one gets the export hint before anything uploads
  assert.equal(overLimitMessage(48 * 1024 * 1024, FREE_PLAN_FILE_LIMIT), null);
  assert.equal(overLimitMessage(70 * 1024 * 1024, null), null, "unknown limit: let Supabase decide");
  assert.match(overLimitMessage(70 * 1024 * 1024, FREE_PLAN_FILE_LIMIT)!, /70\.0 MB, over the 50 MB.*FP16/);
});

test("the Studio Assets upload action uses the non-fatal limit (no bare raisePrivateBucketLimit await)", () => {
  const src = fs.readFileSync(path.join(ROOT, "src/app/studio-asset-actions.ts"), "utf8");
  assert.match(src, /raiseModelLimit\(\(bytes\) => raisePrivateBucketLimit\(bytes, \[MODEL_TYPE\]\), MODEL_MAX_BYTES\)/);
  assert.doesNotMatch(src, /await raisePrivateBucketLimit\(/);
});

// ------------------------------------------------------------------ $0: no Anthropic anywhere in the scheduler
test("the scheduler, its routes, page and worker step never reach the Anthropic API", () => {
  const AI = [/src\/lib\/agents\//, /@anthropic-ai\//, /^anthropic$/];
  for (const entry of [
    "src/lib/scheduler.ts",
    "src/lib/scheduler-server.ts",
    "src/lib/gemini-text.ts",
    "src/app/api/scheduler/tick/route.ts",
    "src/app/api/scheduler/slots/[id]/[step]/route.ts",
    "src/app/schedule/page.tsx",
    "src/app/schedule/actions.ts",
    "src/components/scheduler.tsx",
    "video/scheduler-step.mts",
  ]) {
    assert.equal(pathTo(entry, AI), null, `${entry} reaches AI via ${pathTo(entry, AI)?.join(" → ")}`);
  }
  const wf = fs.readFileSync(path.join(ROOT, ".github/workflows/autonomous-scheduler.yml"), "utf8");
  assert.doesNotMatch(wf, /ANTHROPIC_API_KEY|api\.anthropic\.com/);
  assert.match(wf, /cron: "47 2,10 \* \* \*"/, "09:47 and 17:47 WIB");
  assert.deepEqual([...wf.matchAll(/secrets\.(\w+)/g)].map((m) => m[1]), ["RENDER_TOKEN"], "no new GitHub secrets");
  // the worker's calls carry RENDER_TOKEN, not the login cookie: the login proxy must let /api/scheduler through
  assert.match(fs.readFileSync(path.join(ROOT, "src/proxy.ts"), "utf8"), /\|api\/scheduler\|/);
});
