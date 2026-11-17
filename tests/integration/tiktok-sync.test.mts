// Simulated TikTok API → real sync code → local Postgres
process.env.TOKEN_ENCRYPTION_KEY = Buffer.alloc(32, 7).toString("base64");
process.env.TIKTOK_CLIENT_KEY = "test"; process.env.TIKTOK_CLIENT_SECRET = "test";
let call = 0;
globalThis.fetch = (async (url: string, init?: RequestInit) => {
  const u = String(url);
  const ok = (data: unknown) => new Response(JSON.stringify({ data, error: { code: "ok", message: "" } }), { status: 200 });
  if (u.includes("/oauth/token/")) return new Response(JSON.stringify({ access_token: "acc2", expires_in: 86400, refresh_token: "ref2", refresh_expires_in: 31536000, open_id: "real-open-id-1", scope: "user.info.basic,video.list" }));
  if (u.includes("/user/info/")) return ok({ user: { open_id: "real-open-id-1", display_name: "Real Me", avatar_url: "https://x/a.jpg", follower_count: 1234 + call } });
  if (u.includes("/video/list/")) {
    call++;
    const body = JSON.parse(String(init?.body));
    const page = body.cursor ? 2 : 1;
    const vids = Array.from({ length: page === 1 ? 20 : 5 }, (_, i) => ({ id: `v${page}-${i}`, create_time: Math.floor(Date.now()/1000) - (i+1+page*20)*86400, title: `Video ${page}-${i}`, duration: [10,25,45,90][i%4], view_count: 1000*(i+1)*call, like_count: 50*(i+1), comment_count: 5, share_count: 3, share_url: "https://tiktok.com/x", cover_image_url: "https://x/c.jpg" }));
    return ok({ videos: vids, cursor: page === 1 ? 123 : 0, has_more: page === 1 });
  }
  throw new Error("unexpected fetch " + u);
}) as typeof fetch;

const { saveTikTokAccount, syncTikTokAccount } = await import("../../src/lib/sync/tiktok.ts");
const { db } = await import("../../src/lib/db.ts");
const sql = db();
const [owner] = await sql`SELECT id FROM users ORDER BY created_at LIMIT 1`;
const id = await saveTikTokAccount(owner.id, { access_token: "acc1", expires_in: 86400, refresh_token: "ref1", refresh_expires_in: 31536000, open_id: "real-open-id-1", scope: "user.info.basic,user.info.stats,video.list" });
console.log("sync 1:", await syncTikTokAccount(id));
await sql`UPDATE social_accounts SET token_expires_at = now() WHERE id = ${id}`; // force a token refresh
await new Promise(r => setTimeout(r, 1100));
console.log("sync 2 (with token refresh):", await syncTikTokAccount(id));
const [c] = await sql`SELECT (SELECT count(*) FROM posts WHERE social_account_id=${id})::int posts,
  (SELECT count(*) FROM post_metric_snapshots s JOIN posts p ON p.id=s.post_id WHERE p.social_account_id=${id})::int snaps,
  (SELECT count(*) FROM post_performance WHERE social_account_id=${id})::int perf,
  (SELECT count(*) FROM post_features f JOIN posts p ON p.id=f.post_id WHERE p.social_account_id=${id} AND f.duration_bucket IS NOT NULL)::int feats,
  (SELECT followers FROM account_metric_daily WHERE social_account_id=${id} ORDER BY day DESC LIMIT 1)::int followers,
  (SELECT encode(access_token_enc,'escape') LIKE '%acc2%' FROM social_accounts WHERE id=${id}) token_plaintext_visible`;
console.log(c);
const [tok] = await sql`SELECT access_token_enc FROM social_accounts WHERE id=${id}`;
const { decrypt } = await import("../../src/lib/crypto.ts");
console.log("decrypted token after refresh:", decrypt(tok.access_token_enc));
await sql`DELETE FROM social_accounts WHERE id=${id}`; await sql`REFRESH MATERIALIZED VIEW post_performance`;
await sql.end();
