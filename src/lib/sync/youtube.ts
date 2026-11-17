import "server-only";
import { db } from "../db";
import { decrypt, encrypt } from "../crypto";
import {
  getMyChannel,
  listMyVideos,
  refreshGoogleToken,
  videoAnalytics,
  type GoogleToken,
  type YtAnalyticsRow,
} from "../platforms/youtube";

const SHORTS_MAX_S = 180; // YouTube treats vertical/square videos up to 3 minutes as Shorts
const durationBucket = (s: number) => (s < 15 ? "<15s" : s <= 30 ? "15-30s" : s <= 60 ? "30-60s" : "60s+");

/** Saves the channel behind a fresh Google token. Returns the social_accounts id, or null if the login has no channel. */
export async function saveYouTubeAccount(userId: string, token: GoogleToken) {
  const channel = await getMyChannel(token.access_token);
  if (!channel) return null;
  const sql = db();
  const [row] = await sql<{ id: string }[]>`
    INSERT INTO social_accounts (user_id, platform, handle, external_account_id, display_name, avatar_url,
                                 access_token_enc, refresh_token_enc, token_expires_at, scopes, is_active)
    VALUES (${userId}, 'youtube', ${channel.title}, ${channel.id}, ${channel.title}, ${channel.thumbnail ?? null},
            ${encrypt(token.access_token)}, ${token.refresh_token ? encrypt(token.refresh_token) : null},
            now() + make_interval(secs => ${token.expires_in}), ${token.scope.split(" ")}, true)
    ON CONFLICT (platform, external_account_id) DO UPDATE SET
      user_id = EXCLUDED.user_id, handle = EXCLUDED.handle, display_name = EXCLUDED.display_name,
      avatar_url = EXCLUDED.avatar_url, access_token_enc = EXCLUDED.access_token_enc,
      refresh_token_enc = COALESCE(EXCLUDED.refresh_token_enc, social_accounts.refresh_token_enc),
      token_expires_at = EXCLUDED.token_expires_at, scopes = EXCLUDED.scopes, is_active = true, last_sync_error = NULL
    RETURNING id`;
  return row.id;
}

async function accessTokenFor(accountId: string) {
  const sql = db();
  const [a] = await sql<{ access_token_enc: Buffer; refresh_token_enc: Buffer | null; token_expires_at: Date | null }[]>`
    SELECT access_token_enc, refresh_token_enc, token_expires_at FROM social_accounts WHERE id = ${accountId}`;
  if (!a) throw new Error("Account not found");
  if (a.token_expires_at && a.token_expires_at.getTime() - Date.now() > 5 * 60_000) return decrypt(a.access_token_enc);
  if (!a.refresh_token_enc) throw new Error("YouTube login expired: tap Reconnect.");
  const t = await refreshGoogleToken(decrypt(a.refresh_token_enc));
  await sql`
    UPDATE social_accounts SET access_token_enc = ${encrypt(t.access_token)},
           token_expires_at = now() + make_interval(secs => ${t.expires_in})
           ${t.refresh_token ? sql`, refresh_token_enc = ${encrypt(t.refresh_token)}` : sql``}
    WHERE id = ${accountId}`;
  return t.access_token;
}

export async function syncYouTubeChannel(accountId: string) {
  const sql = db();
  try {
    const [acct] = await sql<{ user_id: string; timezone: string }[]>`
      SELECT sa.user_id, u.timezone FROM social_accounts sa JOIN users u ON u.id = sa.user_id WHERE sa.id = ${accountId}`;
    const token = await accessTokenFor(accountId);
    const channel = await getMyChannel(token);
    if (!channel?.uploadsPlaylist) throw new Error("No YouTube channel found for this Google account.");
    const videos = await listMyVideos(token, channel.uploadsPlaylist);
    // Analytics can lag or be unavailable for brand-new channels; public stats still import without it.
    let analytics = new Map<string, YtAnalyticsRow>();
    try {
      const oldest = videos.reduce((min, v) => Math.min(min, new Date(v.publishedAt).getTime()), Date.now());
      analytics = await videoAnalytics(
        token,
        videos.map((v) => v.id),
        new Date(oldest - 86_400_000),
      );
    } catch (err) {
      console.warn("[sync:youtube] analytics unavailable:", err instanceof Error ? err.message : err);
    }
    const now = new Date();

    await sql.begin(async (tx) => {
      for (const v of videos) {
        const publishedAt = new Date(v.publishedAt);
        const a = analytics.get(v.id);
        const [post] = await tx<{ id: string }[]>`
          INSERT INTO posts (user_id, social_account_id, platform, format, external_post_id, permalink, thumbnail_url,
                             caption_text, duration_s, status, published_at)
          VALUES (${acct.user_id}, ${accountId}, 'youtube', ${v.durationS <= SHORTS_MAX_S ? "short_video" : "long_video"},
                  ${v.id}, ${v.durationS <= SHORTS_MAX_S ? `https://youtube.com/shorts/${v.id}` : `https://youtu.be/${v.id}`},
                  ${v.thumbnail ?? null}, ${v.title}, ${v.durationS}, 'published', ${publishedAt})
          ON CONFLICT (platform, external_post_id) DO UPDATE SET
            permalink = EXCLUDED.permalink, thumbnail_url = EXCLUDED.thumbnail_url, caption_text = EXCLUDED.caption_text,
            format = EXCLUDED.format, duration_s = EXCLUDED.duration_s
          RETURNING id`;
        await tx`
          INSERT INTO post_features (post_id, duration_bucket, posted_dow, posted_hour)
          VALUES (${post.id}, ${durationBucket(v.durationS)},
                  extract(dow from ${publishedAt}::timestamptz AT TIME ZONE ${acct.timezone})::smallint,
                  extract(hour from ${publishedAt}::timestamptz AT TIME ZONE ${acct.timezone})::smallint)
          ON CONFLICT (post_id) DO UPDATE SET duration_bucket = EXCLUDED.duration_bucket`;
        await tx`
          INSERT INTO post_metric_snapshots (post_id, captured_at, hours_since_publish, views, likes, comments, shares,
                                             follows_gained, avg_view_duration_s, completion_rate, raw)
          VALUES (${post.id}, ${now}, ${Math.max(0, (now.getTime() - publishedAt.getTime()) / 3_600_000)},
                  ${v.views ?? a?.views ?? null}, ${v.likes ?? null}, ${v.comments ?? null}, ${a?.shares ?? null},
                  ${a?.subscribersGained ?? null}, ${a?.averageViewDuration ?? null},
                  ${a?.averageViewPercentage !== undefined ? Math.min(1, a.averageViewPercentage / 100) : null},
                  ${tx.json({ video: v, analytics: a ?? null })})
          ON CONFLICT DO NOTHING`;
      }
      if (channel.subscribers !== undefined) {
        await tx`
          INSERT INTO account_metric_daily (social_account_id, day, followers, followers_delta)
          VALUES (${accountId}, (now() AT TIME ZONE ${acct.timezone})::date, ${channel.subscribers},
                  ${channel.subscribers}::bigint - (SELECT followers FROM account_metric_daily
                    WHERE social_account_id = ${accountId} AND day < (now() AT TIME ZONE ${acct.timezone})::date
                    ORDER BY day DESC LIMIT 1))
          ON CONFLICT (social_account_id, day) DO UPDATE SET followers = EXCLUDED.followers, followers_delta = EXCLUDED.followers_delta`;
      }
      await tx`
        UPDATE social_accounts SET last_synced_at = now(), last_sync_error = NULL, display_name = ${channel.title},
               avatar_url = ${channel.thumbnail ?? null}
        WHERE id = ${accountId}`;
    });
    await sql`REFRESH MATERIALIZED VIEW post_performance`;
    return { ok: true as const, videos: videos.length };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error("[sync:youtube]", accountId, message);
    await sql`UPDATE social_accounts SET last_sync_error = ${message} WHERE id = ${accountId}`;
    return { ok: false as const, error: message };
  }
}
