process.env.TOKEN_ENCRYPTION_KEY = Buffer.alloc(32, 7).toString("base64");
Object.assign(process.env, { GOOGLE_CLIENT_ID: "cid", GOOGLE_CLIENT_SECRET: "csec" });
let analyticsUp = false; let refreshed = 0;
const ok = (b: unknown) => new Response(JSON.stringify(b), { status: 200 });
globalThis.fetch = (async (input: string | URL, init?: RequestInit) => {
  const u = new URL(String(input));
  if (u.hostname === "oauth2.googleapis.com") { const b = new URLSearchParams(String(init?.body)); if (b.get("grant_type") === "refresh_token") refreshed++; return ok({ access_token: "AT" + refreshed, expires_in: 3600, refresh_token: b.get("grant_type") === "authorization_code" ? "RT" : undefined, scope: "a b" }); }
  if (u.pathname.endsWith("/channels")) return ok({ items: [{ id: "UC1", snippet: { title: "Uco Ocu", thumbnails: { default: { url: "https://x/t.jpg" } } }, statistics: { subscriberCount: "42" }, contentDetails: { relatedPlaylists: { uploads: "UU1" } } }] });
  if (u.pathname.endsWith("/playlistItems")) { const p2 = u.searchParams.get("pageToken"); return ok({ items: Array.from({ length: p2 ? 10 : 50 }, (_, i) => ({ contentDetails: { videoId: `v${p2 ? 50 + i : i}` } })), nextPageToken: p2 ? undefined : "NEXT" }); }
  if (u.pathname.endsWith("/videos")) return ok({ items: u.searchParams.get("id")!.split(",").map((id, i) => ({ id, snippet: { title: `Video ${id}`, description: "", publishedAt: new Date(Date.now() - (i + 3) * 86400e3).toISOString() }, contentDetails: { duration: i % 4 === 0 ? "PT12M3S" : i % 4 === 1 ? "PT58S" : i % 4 === 2 ? "PT2M30S" : "PT15S" }, statistics: { viewCount: String(100 * (i + 1)), likeCount: "5", commentCount: "1" } })) });
  if (u.hostname === "youtubeanalytics.googleapis.com") { if (!analyticsUp || u.searchParams.get("sort")) return new Response(JSON.stringify({ error: { message: "Internal error encountered." } }), { status: 500 }); if (!u.searchParams.get("filters")?.startsWith("video==v")) throw new Error("bad filter"); if (u.searchParams.get("startDate")! < "2026-01-01") throw new Error("start date not derived from oldest video: " + u.searchParams.get("startDate")); return ok({ columnHeaders: [{ name: "video" }, { name: "views" }, { name: "averageViewDuration" }, { name: "averageViewPercentage" }, { name: "shares" }, { name: "subscribersGained" }], rows: [["v1", 100, 40, 69.5, 3, 2], ["v3", 400, 10, 66.7, 1, 0]] }); }
  throw new Error("unexpected " + u);
}) as typeof fetch;
const { exchangeGoogleCode, isoDurationToSeconds } = await import("../../src/lib/platforms/youtube.ts");
const { saveYouTubeAccount, syncYouTubeChannel } = await import("../../src/lib/sync/youtube.ts");
const { db } = await import("../../src/lib/db.ts");
console.log("durations:", ["PT58S","PT2M30S","PT1H2M","P1DT1S"].map(isoDurationToSeconds));
const sql = db(); const [owner] = await sql`SELECT id FROM users ORDER BY created_at LIMIT 1`;
const id = (await saveYouTubeAccount(owner.id, await exchangeGoogleCode("CODE", "https://x.test")))!;
console.log("sync 1 (analytics unavailable):", await syncYouTubeChannel(id));
analyticsUp = true; await sql`UPDATE social_accounts SET token_expires_at = now() WHERE id = ${id}`; await new Promise(r => setTimeout(r, 1100));
console.log("sync 2 (analytics on, token refresh):", await syncYouTubeChannel(id), "refreshes:", refreshed);
console.table(await sql`SELECT p.format, count(*)::int posts, count(*) FILTER (WHERE p.permalink LIKE '%/shorts/%')::int shorts_links, max(s.completion_rate)::float max_completion, max(s.avg_view_duration_s)::float max_avg_view
  FROM posts p JOIN LATERAL (SELECT * FROM post_metric_snapshots x WHERE x.post_id = p.id ORDER BY captured_at DESC LIMIT 1) s ON true
  WHERE p.social_account_id = ${id} GROUP BY 1`);
console.log(await sql`SELECT followers FROM account_metric_daily WHERE social_account_id=${id}`);
await sql`DELETE FROM social_accounts WHERE id=${id}`; await sql`REFRESH MATERIALIZED VIEW post_performance`; await sql.end();
