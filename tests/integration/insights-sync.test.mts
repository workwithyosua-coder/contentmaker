// Post Metrics Sync, the pattern analyst and the playbook cap against a real Postgres (migration 021 applied), with
// YouTube, the Graph API and Gemini faked at fetch(). YouTube Analytics answers 403 (scope not granted); Instagram
// refuses "saved"; one post's account was removed. Run: tsx --conditions=react-server tests/integration/insights-sync.test.mts
import assert from "node:assert/strict";
process.env.TOKEN_ENCRYPTION_KEY = Buffer.alloc(32, 7).toString("base64");
Object.assign(process.env, { META_APP_ID: "app", META_APP_SECRET: "sec", META_LOGIN_CONFIG_ID: "cfg", GEMINI_API_KEY: "test", GEMINI_API_BASE: "http://gemini.test" });
const ok = (b: unknown) => new Response(JSON.stringify(b), { status: 200 });
const calls: string[] = [];
let analystPrompt = "";
globalThis.fetch = (async (input: string | URL, init?: RequestInit) => {
  const u = new URL(String(input));
  calls.push(`${u.hostname}${u.pathname}`);
  if (u.hostname === "gemini.test") {
    analystPrompt = JSON.parse(String(init?.body)).contents[0].parts[0].text;
    return ok({ candidates: [{ content: { parts: [{ text: JSON.stringify({ rules: [{ category: "script", rule: "Name a price in the first line." }, { category: "pacing", rule: "Land the stat card before second 20." }] }) }] } }] });
  }
  if (u.hostname === "www.googleapis.com" && u.pathname.endsWith("/videos")) {
    assert.equal(init?.headers && (init.headers as Record<string, string>).Authorization, "Bearer YT");
    return ok({ items: [{ statistics: { viewCount: "5000", likeCount: "200", commentCount: "30" } }] });
  }
  if (u.hostname === "youtubeanalytics.googleapis.com") return new Response(JSON.stringify({ error: { message: "Insufficient Permission" } }), { status: 403 });
  if (u.hostname === "graph.facebook.com") {
    const p = u.pathname.replace(/^\/v[\d.]+/, "");
    const metric = u.searchParams.get("metric") ?? "";
    if (p === "/IGM1/insights") {
      if (metric.includes(",") || metric === "saved") return new Response(JSON.stringify({ error: { message: "(#100) unsupported", code: 100 } }), { status: 400 });
      return ok({ data: [{ name: metric, values: [{ value: { views: 800, reach: 600, likes: 90, comments: 12, shares: 25 }[metric] }] }] });
    }
  }
  throw new Error(`unexpected ${u}`);
}) as typeof fetch;

const { db } = await import("../../src/lib/db.ts");
const { encrypt } = await import("../../src/lib/crypto.ts");
const S = await import("../../src/lib/insights/server.ts");
const sql = db();
const [owner] = await sql`SELECT id FROM users ORDER BY created_at LIMIT 1`;
// leftovers of an earlier interrupted run
await sql`DELETE FROM content_projects WHERE title LIKE 'Insights ep %'`;
await sql`DELETE FROM social_accounts WHERE external_account_id LIKE 'UC-%' OR external_account_id LIKE 'IG-%'`;
await sql`DELETE FROM episode_metrics`;
await sql`DELETE FROM studio_lessons`;
await sql`DELETE FROM app_settings WHERE key = ${S.ANALYSIS_KEY}`;
const yt = (await sql`INSERT INTO social_accounts (user_id, platform, handle, external_account_id, access_token_enc, token_expires_at) VALUES (${owner.id}, 'youtube', 'yt', ${`UC-${Date.now()}`}, ${encrypt("YT")}, now() + interval '1 hour') RETURNING id`)[0].id;
const ig = (await sql`INSERT INTO social_accounts (user_id, platform, handle, external_account_id, access_token_enc) VALUES (${owner.id}, 'instagram', 'ig', ${`IG-${Date.now()}`}, ${encrypt("IGT")}) RETURNING id`)[0].id;
const episodes: string[] = [];
for (const [i, hook] of ["Kopi 50 ribu tiap hari!", "Skincare sejuta sebulan?", "Paylater buat nonton konser", "Langganan lima aplikasi streaming"].entries()) {
  const [p] = await sql`INSERT INTO content_projects (user_id, title, format, target_platforms, status) VALUES (${owner.id}, ${`Insights ep ${i}`}, 'short_video', '{youtube}', 'recorded') RETURNING id`;
  const [s] = await sql`INSERT INTO scripts (project_id, version, title, lines, sources) VALUES (${p.id}, 1, 't', ${sql.json([{ speaker: "uco", text: hook }])}, '[]') RETURNING id`;
  const [v] = await sql`INSERT INTO episode_videos (project_id, script_id, storage_path) VALUES (${p.id}, ${s.id}, 'x.mp4') RETURNING id`;
  episodes.push(p.id);
  if (i === 0) await sql`INSERT INTO episode_publications (project_id, video_id, platform, social_account_id, status, external_post_id, published_at) VALUES (${p.id}, ${v.id}, 'youtube', ${yt}, 'published', 'YTV1', now() - interval '30 hours')`;
  if (i === 1) await sql`INSERT INTO episode_publications (project_id, video_id, platform, social_account_id, status, external_post_id, published_at) VALUES (${p.id}, ${v.id}, 'instagram', ${ig}, 'published', 'IGM1', now() - interval '4 days')`;
  if (i === 2) await sql`INSERT INTO episode_publications (project_id, video_id, platform, social_account_id, status, external_post_id, published_at) VALUES (${p.id}, ${v.id}, 'facebook', NULL, 'published', 'FBV1', now() - interval '2 days')`;
  // an old post (> 14 days) is not synced
  if (i === 3) await sql`INSERT INTO episode_publications (project_id, video_id, platform, social_account_id, status, external_post_id, published_at) VALUES (${p.id}, ${v.id}, 'youtube', ${yt}, 'published', 'OLD', now() - interval '20 days')`;
}

const r = await S.syncMetrics();
console.log(JSON.stringify(r, null, 1));
assert.equal(r.synced, 2);
assert.equal(r.failed, 1, "the Facebook post whose account was removed fails alone");
assert.match(r.posts.find((p) => p.platform === "facebook")!.error!, /account was removed/);
assert.ok(r.notices.some((n) => /Reconnect YouTube/.test(n)), "the 403 on Analytics becomes a notice");
assert.ok(r.notices.includes("Instagram didn't return: saved."));
assert.ok(!calls.some((c) => c.includes("OLD")));
const rows = await sql`SELECT platform, snapshot_window, views, shares, saves, avg_view_pct, engagement_score::float8 AS s FROM episode_metrics ORDER BY platform`;
console.table(rows);
assert.deepEqual(rows.map((x) => `${x.platform}:${x.snapshot_window}:${x.views}:${x.avg_view_pct}`), ["instagram:72h:800:null", "youtube:24h:5000:null"]);
assert.equal(r.analysis, null, "2 newly scored episodes: not enough for the analyst yet");

// a second sync in the same window updates, never duplicates
await S.syncMetrics();
assert.equal((await sql`SELECT count(*)::int AS n FROM episode_metrics`)[0].n, 2);

// a third scored episode (TikTok, logged by hand): but the YouTube Short is 30 h old with no retention yet
// (Analytics 403 → avg_view_pct null), so it's held out and only 2 settled episodes remain: the analyst waits
await S.logTikTokMetrics({ episodeId: episodes[2], views: "1.200", likes: 50, comments: 9, shares: 31, saves: 12 });
const r2 = await S.syncMetrics();
assert.equal(r2.analysis, null, "a fresh YouTube Short without retention isn't compared yet");
// a 7-view outlier never counts toward the analyst (or the winning hooks), however it scores
await S.logTikTokMetrics({ episodeId: episodes[3], views: 7, likes: 3, comments: 1, shares: 1, saves: 0 });
assert.equal(await S.analyzePatterns(), null);
assert.ok(!(await S.getPlaybook()).topHooks.includes("Langganan lima aplikasi streaming"), "a 7-view post is no winning hook");
// 72 h after posting the YouTube Short is settled (even without retention): 3 eligible episodes, the analyst runs
const r3 = await S.analyzePatterns(new Date(Date.now() + 45 * 3_600_000));
assert.match(r3!, /updated 2 metrics rule\(s\)/);
assert.doesNotMatch(analystPrompt, /Insights ep 3/, "the 7-view outlier isn't in the comparison");
assert.match(analystPrompt, /TOP QUARTILE[\s\S]*BOTTOM QUARTILE/);
const lessons = await S.listLessons();
assert.deepEqual(lessons.map((l) => `${l.source}:${l.rule_text}`).sort(), ["metrics_insight:Land the stat card before second 20.", "metrics_insight:Name a price in the first line."]);
assert.equal(await S.analyzePatterns(), null, "no new scores since the last analysis");

// the 12 cap in the database: 13 distinct rules leave exactly 12 active; resume at the cap is refused
const distinct = [
  "Open with Uco's dumbest claim",
  "Show the receipt prop early",
  "Keep music low under data",
  "End on a stubborn punchline",
  "Round numbers people can check",
  "Call back the first joke",
  "Ocu stays deadpan always",
  "Thoughts confess the hypocrisy",
  "Pause before every reveal",
  "Pick everyday money topics",
  "Stat cards carry one number",
  "Bounce harder on outrage",
  "Outro asks a question",
];
for (const t of distinct) await S.learnLesson("script", t, "owner_feedback");
const after = await S.listLessons();
assert.equal(after.filter((l) => l.status === "active").length, 12);
const paused = after.find((l) => l.status === "paused")!;
await assert.rejects(S.setLessonStatus(paused.id, "active"), /already has 12 active rules/);
// a duplicate reinforces instead
const before = after.find((l) => l.rule_text === "Name a price in the first line.");
await S.learnLesson("script", "Name a price in the first line!", "owner_feedback");
const re = (await S.listLessons()).find((l) => l.id === before?.id);
if (before) assert.equal(re!.evidence_count, before.evidence_count + 1);

// the scheduler's playbook: ≤ 12 lessons, the 2 best hooks, the target line count
const pb = await S.getPlaybook();
assert.equal(pb.lessons.length, 12);
assert.equal(pb.topHooks.length, 2);
assert.equal(pb.targetLines, pb.tunables.target_line_count);
console.log("top hooks:", pb.topHooks);
console.log("leaderboard:", (await S.leaderboard()).map((x) => `${x.title} ${x.platform} ${x.engagement_score}`));

for (const id of episodes) await sql`DELETE FROM content_projects WHERE id = ${id}`;
await sql`DELETE FROM social_accounts WHERE id IN (${yt}, ${ig})`;
await sql`DELETE FROM studio_lessons`;
await sql`DELETE FROM app_settings WHERE key = ${S.ANALYSIS_KEY}`;
await sql.end();
console.log("insights-sync: OK");
