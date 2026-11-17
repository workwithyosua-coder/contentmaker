process.env.TOKEN_ENCRYPTION_KEY = Buffer.alloc(32, 7).toString("base64");
Object.assign(process.env, { META_APP_ID: "app", META_APP_SECRET: "sec", META_LOGIN_CONFIG_ID: "cfg" });
const calls: string[] = [];
const ok = (b: unknown) => new Response(JSON.stringify(b), { status: 200 });
const bad = (m: string) => new Response(JSON.stringify({ error: { message: m, code: 100 } }), { status: 400 });
globalThis.fetch = (async (input: string | URL) => {
  const u = new URL(String(input)); calls.push(u.pathname + "?" + (u.searchParams.get("metric") ?? ""));
  if (!u.searchParams.get("appsecret_proof") && !u.pathname.endsWith("/oauth/access_token")) throw new Error("missing appsecret_proof");
  const p = u.pathname.replace(/^\/v26\.0/, "");
  if (p === "/oauth/access_token") return ok({ access_token: u.searchParams.get("grant_type") ? "LONG" : "SHORT" });
  if (p === "/me/accounts") return ok({ data: [{ id: "PAGE1", name: "My Page", access_token: "PAGETOKEN", instagram_business_account: { id: "IG1", username: "me.ig" } }] });
  if (p === "/IG1") return ok({ username: "me.ig", followers_count: 500 });
  if (p === "/IG1/media") {
    const after = u.searchParams.get("after");
    const items = Array.from({ length: after ? 25 : 50 }, (_, i) => ({ id: `m${after ? 50 + i : i}`, media_type: i % 3 ? "VIDEO" : "IMAGE", media_product_type: i % 3 ? "REELS" : "FEED", timestamp: new Date(Date.now() - (i + 3) * 86400e3).toISOString(), like_count: 10 + i, comments_count: 2, permalink: "https://instagram.com/p/x", caption: `post ${i}` }));
    items.push({ id: "story1", media_type: "IMAGE", media_product_type: "STORY", timestamp: new Date().toISOString() } as never);
    return ok({ data: items, paging: after ? {} : { next: "https://graph.facebook.com/v26.0/IG1/media?after=CUR" } });
  }
  if (p.startsWith("/m") && p.endsWith("/insights")) {
    const metrics = u.searchParams.get("metric")!.split(",");
    if (metrics.includes("total_interactions")) return bad("(#100) metric total_interactions is not supported"); // simulate a renamed metric
    return ok({ data: metrics.map((name) => ({ name, values: [{ value: name === "ig_reels_avg_watch_time" ? 7500 : 1000 }] })) });
  }
  if (p === "/PAGE1") return ok({ name: "My Page", followers_count: 321 });
  if (p === "/PAGE1/posts") return ok({ data: [{ id: "PAGE1_1", message: "hello", created_time: new Date(Date.now() - 5 * 86400e3).toISOString(), status_type: "added_video", reactions: { summary: { total_count: 40 } }, comments: { summary: { total_count: 4 } }, shares: { count: 2 } }] });
  if (p === "/PAGE1_1/insights") { const m = u.searchParams.get("metric")!; if (m.includes("post_media_view") && m.includes(",")) return bad("bad"); if (m === "post_media_view") return bad("deprecated"); return ok({ data: [{ name: m, values: [{ value: 900 }] }] }); }
  throw new Error("unexpected " + u);
}) as typeof fetch;

const { exchangeMetaCode, listMetaPages } = await import("../../src/lib/platforms/meta.ts");
const { saveMetaAccounts, syncInstagramAccount, syncFacebookPage } = await import("../../src/lib/sync/meta.ts");
const { db } = await import("../../src/lib/db.ts");
const sql = db();
const [owner] = await sql`SELECT id FROM users ORDER BY created_at LIMIT 1`;
const tok = await exchangeMetaCode("CODE", "https://example.test");
const saved = await saveMetaAccounts(owner.id, await listMetaPages(tok));
console.log("token:", tok, "saved:", saved.map((s) => s.platform));
for (const s of saved) console.log(s.platform, await (s.platform === "instagram" ? syncInstagramAccount(s.id) : syncFacebookPage(s.id)));
const before = calls.length; await new Promise(r => setTimeout(r, 1100));
const igId = saved.find(s => s.platform === "instagram")!.id; console.log("ig re-sync", await syncInstagramAccount(igId), "insight calls on re-sync:", calls.slice(before).filter(c => c.includes("/insights")).length);
const rows = await sql`SELECT sa.platform, count(DISTINCT p.id)::int posts, count(s.post_id)::int snaps,
  max(s.views)::int max_views, max(s.reach)::int max_reach, max(s.avg_view_duration_s)::float avg_view,
  (SELECT count(*) FROM post_performance pp WHERE pp.social_account_id = sa.id)::int perf,
  (SELECT max(views)::int FROM post_performance pp WHERE pp.social_account_id = sa.id) perf_views
  FROM social_accounts sa LEFT JOIN posts p ON p.social_account_id = sa.id LEFT JOIN post_metric_snapshots s ON s.post_id = p.id
  WHERE sa.id IN ${sql(saved.map((s) => s.id))} GROUP BY sa.id, sa.platform`;
console.table(rows);
console.log("insight calls:", calls.filter((c) => c.includes("/insights")).length, "| ig fallback retries happened:", calls.some((c) => c.endsWith("?views")));
await sql`DELETE FROM social_accounts WHERE id IN ${sql(saved.map((s) => s.id))}`; await sql`REFRESH MATERIALIZED VIEW post_performance`; await sql.end();
