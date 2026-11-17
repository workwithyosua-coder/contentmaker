import "server-only";
import type postgres from "postgres";
import { db } from "../db";
import { decrypt, encrypt } from "../crypto";
import { GraphError, graph, insightsBestEffort, type MetaPage } from "../platforms/meta";

// Every post gets insights once (first import); after that only the newest N are refreshed each sync,
// so daily syncs stay well inside Meta's rate limits.
const INSIGHTS_FOR_NEWEST = 60;
const MAX_PAGES = 6; // × 50 posts

/** Saves every Page the owner granted, plus the Instagram professional account linked to each Page. */
export async function saveMetaAccounts(userId: string, pages: MetaPage[]) {
  const sql = db();
  const ids: { id: string; platform: "facebook" | "instagram" }[] = [];
  for (const p of pages) {
    const token = encrypt(p.access_token);
    const [fb] = await sql<{ id: string }[]>`
      INSERT INTO social_accounts (user_id, platform, handle, external_account_id, display_name, avatar_url,
                                   access_token_enc, token_expires_at, is_active)
      VALUES (${userId}, 'facebook', ${p.name}, ${p.id}, ${p.name}, ${p.picture?.data?.url ?? null}, ${token}, NULL, true)
      ON CONFLICT (platform, external_account_id) DO UPDATE SET
        user_id = EXCLUDED.user_id, handle = EXCLUDED.handle, display_name = EXCLUDED.display_name,
        avatar_url = EXCLUDED.avatar_url, access_token_enc = EXCLUDED.access_token_enc, is_active = true, last_sync_error = NULL
      RETURNING id`;
    ids.push({ id: fb.id, platform: "facebook" });
    const ig = p.instagram_business_account;
    if (ig) {
      const handle = ig.username ? `@${ig.username}` : "Instagram";
      const [row] = await sql<{ id: string }[]>`
        INSERT INTO social_accounts (user_id, platform, handle, external_account_id, display_name, avatar_url,
                                     access_token_enc, token_expires_at, is_active)
        VALUES (${userId}, 'instagram', ${handle}, ${ig.id}, ${ig.username ?? null}, ${ig.profile_picture_url ?? null},
                ${token}, NULL, true)
        ON CONFLICT (platform, external_account_id) DO UPDATE SET
          user_id = EXCLUDED.user_id, handle = EXCLUDED.handle, display_name = EXCLUDED.display_name,
          avatar_url = EXCLUDED.avatar_url, access_token_enc = EXCLUDED.access_token_enc, is_active = true, last_sync_error = NULL
        RETURNING id`;
      ids.push({ id: row.id, platform: "instagram" });
    }
  }
  return ids;
}

type Acct = { id: string; user_id: string; external_account_id: string; access_token_enc: Buffer; timezone: string };

async function loadAccount(accountId: string) {
  const [a] = await db()<Acct[]>`
    SELECT sa.id, sa.user_id, sa.external_account_id, sa.access_token_enc, u.timezone
    FROM social_accounts sa JOIN users u ON u.id = sa.user_id WHERE sa.id = ${accountId}`;
  if (!a) throw new Error("Account not found");
  return { ...a, token: decrypt(a.access_token_enc) };
}

/** External ids of this account's posts that already have at least one metrics snapshot. */
async function alreadyMeasured(accountId: string) {
  const rows = await db()<{ external_post_id: string }[]>`
    SELECT p.external_post_id FROM posts p
    WHERE p.social_account_id = ${accountId}
      AND EXISTS (SELECT 1 FROM post_metric_snapshots s WHERE s.post_id = p.id)`;
  return new Set(rows.map((r) => r.external_post_id));
}

/** Newest N posts always get fresh insights; older ones only until they have their first snapshot. */
const needsInsights = (index: number, id: string, measured: Set<string>) => index < INSIGHTS_FOR_NEWEST || !measured.has(id);

async function paged<T>(path: string, token: string, params: Record<string, string>): Promise<T[]> {
  const out: T[] = [];
  let page = await graph<{ data: T[]; paging?: { next?: string } }>(path, token, params);
  for (let i = 0; ; i++) {
    out.push(...(page.data ?? []));
    if (!page.paging?.next || i + 1 >= MAX_PAGES) break;
    page = await graph<{ data: T[]; paging?: { next?: string } }>(page.paging.next, token);
  }
  return out;
}

type Snapshot = {
  views?: number | null;
  reach?: number | null;
  likes?: number | null;
  comments?: number | null;
  shares?: number | null;
  saves?: number | null;
  avgViewS?: number | null;
  raw: unknown;
};

async function upsertPost(
  tx: postgres.TransactionSql,
  a: Acct,
  platform: "instagram" | "facebook",
  p: {
    externalId: string;
    format: string;
    permalink: string | null;
    thumbnail: string | null;
    caption: string | null;
    publishedAt: Date;
  },
  snap: Snapshot | null,
  now: Date,
) {
  const [post] = await tx<{ id: string }[]>`
    INSERT INTO posts (user_id, social_account_id, platform, format, external_post_id, permalink, thumbnail_url,
                       caption_text, status, published_at)
    VALUES (${a.user_id}, ${a.id}, ${platform}, ${p.format}, ${p.externalId}, ${p.permalink}, ${p.thumbnail},
            ${p.caption}, 'published', ${p.publishedAt})
    ON CONFLICT (platform, external_post_id) DO UPDATE SET
      permalink = EXCLUDED.permalink, thumbnail_url = EXCLUDED.thumbnail_url, caption_text = EXCLUDED.caption_text,
      format = EXCLUDED.format
    RETURNING id`;
  await tx`
    INSERT INTO post_features (post_id, posted_dow, posted_hour)
    VALUES (${post.id}, extract(dow from ${p.publishedAt}::timestamptz AT TIME ZONE ${a.timezone})::smallint,
            extract(hour from ${p.publishedAt}::timestamptz AT TIME ZONE ${a.timezone})::smallint)
    ON CONFLICT (post_id) DO NOTHING`;
  if (snap) {
    await tx`
      INSERT INTO post_metric_snapshots (post_id, captured_at, hours_since_publish, views, reach, likes, comments,
                                         shares, saves, avg_view_duration_s, raw)
      VALUES (${post.id}, ${now}, ${Math.max(0, (now.getTime() - p.publishedAt.getTime()) / 3_600_000)},
              ${snap.views ?? null}, ${snap.reach ?? null}, ${snap.likes ?? null}, ${snap.comments ?? null},
              ${snap.shares ?? null}, ${snap.saves ?? null}, ${snap.avgViewS ?? null}, ${tx.json(snap.raw as never)})
      ON CONFLICT DO NOTHING`;
  }
}

async function saveFollowers(tx: postgres.TransactionSql, a: Acct, followers: number | null | undefined) {
  if (followers === null || followers === undefined) return;
  await tx`
    INSERT INTO account_metric_daily (social_account_id, day, followers, followers_delta)
    VALUES (${a.id}, (now() AT TIME ZONE ${a.timezone})::date, ${followers},
            ${followers}::bigint - (SELECT followers FROM account_metric_daily
                                    WHERE social_account_id = ${a.id} AND day < (now() AT TIME ZONE ${a.timezone})::date
                                    ORDER BY day DESC LIMIT 1))
    ON CONFLICT (social_account_id, day) DO UPDATE SET followers = EXCLUDED.followers, followers_delta = EXCLUDED.followers_delta`;
}

async function finish(accountId: string, fn: () => Promise<number>) {
  const sql = db();
  try {
    const n = await fn();
    await sql`UPDATE social_accounts SET last_synced_at = now(), last_sync_error = NULL WHERE id = ${accountId}`;
    await sql`REFRESH MATERIALIZED VIEW post_performance`;
    return { ok: true as const, videos: n };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error("[sync:meta]", accountId, message);
    await sql`UPDATE social_accounts SET last_sync_error = ${message} WHERE id = ${accountId}`;
    return { ok: false as const, error: message };
  }
}

type IgMedia = {
  id: string;
  caption?: string;
  media_type: string; // IMAGE | VIDEO | CAROUSEL_ALBUM
  media_product_type?: string; // FEED | REELS | STORY | AD
  permalink?: string;
  thumbnail_url?: string;
  media_url?: string;
  timestamp: string;
  like_count?: number;
  comments_count?: number;
};

export function syncInstagramAccount(accountId: string) {
  return finish(accountId, async () => {
    const a = await loadAccount(accountId);
    const profile = await graph<{ followers_count?: number; username?: string; profile_picture_url?: string }>(
      `/${a.external_account_id}`,
      a.token,
      { fields: "username,profile_picture_url,followers_count,media_count" },
    );
    const media = (
      await paged<IgMedia>(`/${a.external_account_id}/media`, a.token, {
        fields: "id,caption,media_type,media_product_type,permalink,thumbnail_url,media_url,timestamp,like_count,comments_count",
        limit: "50",
      })
    ).filter((m) => m.media_product_type !== "STORY" && m.media_product_type !== "AD");

    const unsupported = new Set<string>();
    const insights = new Map<string, Record<string, number>>();
    const measured = await alreadyMeasured(a.id);
    for (const [i, m] of media.entries()) {
      if (!needsInsights(i, m.id, measured)) continue;
      const reel = m.media_product_type === "REELS";
      const metrics = ["views", "reach", "saved", "shares", "total_interactions", ...(reel ? ["ig_reels_avg_watch_time"] : [])];
      insights.set(m.id, await insightsBestEffort(m.id, a.token, metrics, unsupported));
    }

    const now = new Date();
    await db().begin(async (tx) => {
      for (const m of media) {
        const ins = insights.get(m.id);
        const format =
          m.media_product_type === "REELS" || m.media_type === "VIDEO" ? "short_video" : m.media_type === "CAROUSEL_ALBUM" ? "carousel" : "image";
        await upsertPost(
          tx,
          a,
          "instagram",
          {
            externalId: m.id,
            format,
            permalink: m.permalink ?? null,
            thumbnail: m.thumbnail_url ?? (m.media_type === "IMAGE" ? (m.media_url ?? null) : null),
            caption: m.caption ?? null,
            publishedAt: new Date(m.timestamp),
          },
          ins
            ? {
                views: ins.views ?? null,
                reach: ins.reach ?? null,
                likes: m.like_count ?? null,
                comments: m.comments_count ?? null,
                shares: ins.shares ?? null,
                saves: ins.saved ?? null,
                avgViewS: ins.ig_reels_avg_watch_time ? ins.ig_reels_avg_watch_time / 1000 : null,
                raw: { media: m, insights: ins },
              }
            : null,
          now,
        );
      }
      await saveFollowers(tx, a, profile.followers_count);
      await tx`UPDATE social_accounts SET avatar_url = COALESCE(${profile.profile_picture_url ?? null}, avatar_url)
               WHERE id = ${a.id}`;
    });
    return media.length;
  });
}

type FbPost = {
  id: string;
  message?: string;
  created_time: string;
  permalink_url?: string;
  full_picture?: string;
  status_type?: string;
  shares?: { count?: number };
  reactions?: { summary?: { total_count?: number } };
  comments?: { summary?: { total_count?: number } };
};

export function syncFacebookPage(accountId: string) {
  return finish(accountId, async () => {
    const a = await loadAccount(accountId);
    const page = await graph<{ followers_count?: number; fan_count?: number; picture?: { data?: { url?: string } } }>(
      `/${a.external_account_id}`,
      a.token,
      { fields: "name,followers_count,fan_count,picture{url}" },
    );
    const postParams = {
      fields:
        "id,message,created_time,permalink_url,full_picture,status_type,shares,reactions.summary(total_count).limit(0),comments.summary(total_count).limit(0)",
      limit: "50",
    };
    // /posts needs pages_read_user_content; /published_posts is the fallback edge for the Page's own posts.
    const posts = await paged<FbPost>(`/${a.external_account_id}/posts`, a.token, postParams).catch(async (err) => {
      if (!(err instanceof GraphError) || err.code !== 10) throw err;
      return paged<FbPost>(`/${a.external_account_id}/published_posts`, a.token, postParams).catch(() => {
        throw new Error(
          "Facebook needs the 'pages_read_user_content' permission: add it in the Meta app (Page use case → Permissions) " +
            "and to the Facebook Login configuration, then tap Reconnect.",
        );
      });
    });

    const unsupported = new Set<string>();
    const insights = new Map<string, Record<string, number>>();
    const measured = await alreadyMeasured(a.id);
    for (const [i, p] of posts.entries()) {
      if (!needsInsights(i, p.id, measured)) continue;
      // Post metrics after Meta's June 2026 change: media views and unique viewers (reach).
      insights.set(p.id, await insightsBestEffort(p.id, a.token, ["post_media_view", "post_total_media_view_unique"], unsupported));
    }

    const now = new Date();
    await db().begin(async (tx) => {
      for (const p of posts) {
        const ins = insights.get(p.id);
        const video = (p.status_type ?? "").includes("video");
        await upsertPost(
          tx,
          a,
          "facebook",
          {
            externalId: p.id,
            format: video ? "short_video" : p.full_picture ? "image" : "text",
            permalink: p.permalink_url ?? null,
            thumbnail: p.full_picture ?? null,
            caption: p.message ?? null,
            publishedAt: new Date(p.created_time),
          },
          ins
            ? {
                views: ins.post_media_view ?? null,
                reach: ins.post_total_media_view_unique ?? null,
                likes: p.reactions?.summary?.total_count ?? null,
                comments: p.comments?.summary?.total_count ?? null,
                shares: p.shares?.count ?? 0,
                raw: { post: p, insights: ins },
              }
            : null,
          now,
        );
      }
      await saveFollowers(tx, a, page.followers_count ?? page.fan_count);
      await tx`UPDATE social_accounts SET avatar_url = COALESCE(${page.picture?.data?.url ?? null}, avatar_url)
               WHERE id = ${a.id}`;
    });
    return posts.length;
  });
}
