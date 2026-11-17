import "server-only";
import { db } from "../db";
import { decrypt, encrypt } from "../crypto";
import { getTikTokUser, listTikTokVideos, refreshTikTokToken, type TikTokToken } from "../platforms/tiktok";

const durationBucket = (s?: number) =>
  s === undefined ? null : s < 15 ? "<15s" : s <= 30 ? "15-30s" : s <= 60 ? "30-60s" : "60s+";

/** Saves (or updates) a connected TikTok account from a fresh token. Returns the social_accounts id. */
export async function saveTikTokAccount(userId: string, token: TikTokToken) {
  const sql = db();
  const user = await getTikTokUser(token.access_token);
  const [row] = await sql<{ id: string }[]>`
    INSERT INTO social_accounts (user_id, platform, handle, external_account_id, display_name, avatar_url,
                                 access_token_enc, refresh_token_enc, token_expires_at, refresh_expires_at, scopes, is_active)
    VALUES (${userId}, 'tiktok', ${user.display_name ?? "TikTok"}, ${token.open_id}, ${user.display_name ?? null},
            ${user.avatar_url ?? null}, ${encrypt(token.access_token)}, ${encrypt(token.refresh_token)},
            now() + make_interval(secs => ${token.expires_in}), now() + make_interval(secs => ${token.refresh_expires_in}),
            ${token.scope.split(",")}, true)
    ON CONFLICT (platform, external_account_id) DO UPDATE SET
      user_id = EXCLUDED.user_id, handle = EXCLUDED.handle, display_name = EXCLUDED.display_name,
      avatar_url = EXCLUDED.avatar_url, access_token_enc = EXCLUDED.access_token_enc,
      refresh_token_enc = EXCLUDED.refresh_token_enc, token_expires_at = EXCLUDED.token_expires_at,
      refresh_expires_at = EXCLUDED.refresh_expires_at, scopes = EXCLUDED.scopes, is_active = true,
      last_sync_error = NULL
    RETURNING id`;
  return row.id;
}

/** Valid access token for an account, refreshing it (and saving the new pair) when it is about to expire. */
async function accessTokenFor(accountId: string) {
  const sql = db();
  const [a] = await sql<{ access_token_enc: Buffer; refresh_token_enc: Buffer; token_expires_at: Date | null }[]>`
    SELECT access_token_enc, refresh_token_enc, token_expires_at FROM social_accounts WHERE id = ${accountId}`;
  if (!a) throw new Error("Account not found");
  if (a.token_expires_at && a.token_expires_at.getTime() - Date.now() > 10 * 60_000) return decrypt(a.access_token_enc);
  const t = await refreshTikTokToken(decrypt(a.refresh_token_enc));
  await sql`
    UPDATE social_accounts SET access_token_enc = ${encrypt(t.access_token)}, refresh_token_enc = ${encrypt(t.refresh_token)},
           token_expires_at = now() + make_interval(secs => ${t.expires_in}),
           refresh_expires_at = now() + make_interval(secs => ${t.refresh_expires_in})
    WHERE id = ${accountId}`;
  return t.access_token;
}

/** Pulls profile stats + every video's current metrics and stores a snapshot. */
export async function syncTikTokAccount(accountId: string) {
  const sql = db();
  try {
    const [acct] = await sql<{ user_id: string; timezone: string }[]>`
      SELECT sa.user_id, u.timezone FROM social_accounts sa JOIN users u ON u.id = sa.user_id WHERE sa.id = ${accountId}`;
    const token = await accessTokenFor(accountId);
    const [user, videos] = await Promise.all([getTikTokUser(token), listTikTokVideos(token)]);
    const now = new Date();

    await sql.begin(async (tx) => {
      for (const v of videos) {
        const publishedAt = new Date(v.create_time * 1000);
        const caption = v.title || v.video_description || null;
        const [post] = await tx<{ id: string }[]>`
          INSERT INTO posts (user_id, social_account_id, platform, format, external_post_id, permalink, thumbnail_url,
                             caption_text, duration_s, status, published_at)
          VALUES (${acct.user_id}, ${accountId}, 'tiktok', 'short_video', ${v.id}, ${v.share_url ?? null},
                  ${v.cover_image_url ?? null}, ${caption}, ${v.duration ?? null}, 'published', ${publishedAt})
          ON CONFLICT (platform, external_post_id) DO UPDATE SET
            permalink = EXCLUDED.permalink, thumbnail_url = EXCLUDED.thumbnail_url, caption_text = EXCLUDED.caption_text
          RETURNING id`;
        await tx`
          INSERT INTO post_features (post_id, duration_bucket, posted_dow, posted_hour)
          VALUES (${post.id}, ${durationBucket(v.duration)},
                  extract(dow from ${publishedAt}::timestamptz AT TIME ZONE ${acct.timezone})::smallint,
                  extract(hour from ${publishedAt}::timestamptz AT TIME ZONE ${acct.timezone})::smallint)
          ON CONFLICT (post_id) DO NOTHING`;
        await tx`
          INSERT INTO post_metric_snapshots (post_id, captured_at, hours_since_publish, views, likes, comments, shares, raw)
          VALUES (${post.id}, ${now}, ${Math.max(0, (now.getTime() - publishedAt.getTime()) / 3_600_000)},
                  ${v.view_count ?? null}, ${v.like_count ?? null}, ${v.comment_count ?? null}, ${v.share_count ?? null},
                  ${tx.json(v)})
          ON CONFLICT DO NOTHING`;
      }
      await tx`
        INSERT INTO account_metric_daily (social_account_id, day, followers, followers_delta)
        VALUES (${accountId}, (now() AT TIME ZONE ${acct.timezone})::date, ${user.follower_count ?? null},
                ${user.follower_count ?? null}::bigint - (
                  SELECT followers FROM account_metric_daily
                  WHERE social_account_id = ${accountId} AND day < (now() AT TIME ZONE ${acct.timezone})::date
                  ORDER BY day DESC LIMIT 1))
        ON CONFLICT (social_account_id, day) DO UPDATE SET followers = EXCLUDED.followers, followers_delta = EXCLUDED.followers_delta`;
      await tx`
        UPDATE social_accounts SET last_synced_at = now(), last_sync_error = NULL,
               display_name = ${user.display_name ?? null}, avatar_url = ${user.avatar_url ?? null}
        WHERE id = ${accountId}`;
    });
    await sql`REFRESH MATERIALIZED VIEW post_performance`;
    return { ok: true as const, videos: videos.length };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error("[sync:tiktok]", accountId, message);
    await sql`UPDATE social_accounts SET last_sync_error = ${message} WHERE id = ${accountId}`;
    return { ok: false as const, error: message };
  }
}
