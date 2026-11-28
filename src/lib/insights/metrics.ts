// Post Metrics Sync: one published post's numbers from its platform, with partial permissions handled gracefully.
//   YouTube    Data API v3 videos.list(part=statistics) for views / likes / comments; YouTube Analytics v2 for
//              averageViewPercentage and shares when the connected login has yt-analytics.readonly. A 403 there keeps
//              avg_view_pct null and returns a notice suggesting a reconnect; the post still syncs.
//   Instagram  Graph insights (views or, on older media, plays; reach, likes, comments, shares, saved), each metric
//              tried alone when the batch is refused, then the media's like / comment counts as the last fallback.
//   Facebook   Reel video_insights (plays, reach, social actions), with the video's likes / comments summaries as
//              the fallback.
// The HTTP layer is passed in (`get`), so every fallback is unit-tested without a network.
import { AVG_VIEW_PCT_MAX, cleanViewPct, type PostNumbers } from "./score";

export class HttpError extends Error {
  constructor(message: string, public status: number, public code?: number) {
    super(message);
  }
}
/** GET a URL with query params; resolves the JSON body or throws HttpError. */
export type Getter = (url: string, params: Record<string, string>) => Promise<unknown>;
export type Fetched = { numbers: PostNumbers; notices: string[] };

const num = (v: unknown) => (typeof v === "number" ? v : typeof v === "string" && /^\d+(\.\d+)?$/.test(v) ? Number(v) : 0);
const errText = (e: unknown) => (e instanceof Error ? e.message : String(e)).replace(/\s+/g, " ").slice(0, 140);
/** Meta / Google "you didn't grant this": HTTP 403, Graph codes 10 / 200-299 (permissions), 190 (token). */
export const isPermissionError = (e: unknown) => e instanceof HttpError && (e.status === 403 || e.status === 401 || e.code === 10 || e.code === 190 || (e.code != null && e.code >= 200 && e.code < 300));

export const YT_DATA = "https://www.googleapis.com/youtube/v3";
export const YT_ANALYTICS = "https://youtubeanalytics.googleapis.com/v2";
const ymd = (d: Date) => d.toISOString().slice(0, 10);

export async function fetchYouTube(get: Getter, videoId: string, publishedAt: Date, now = new Date()): Promise<Fetched> {
  const notices: string[] = [];
  const j = (await get(`${YT_DATA}/videos`, { part: "statistics", id: videoId })) as { items?: { statistics?: Record<string, string> }[] };
  const st = j.items?.[0]?.statistics;
  if (!st) throw new HttpError(`YouTube video ${videoId} not found (deleted or private?)`, 404);
  const numbers: PostNumbers = { views: num(st.viewCount), likes: num(st.likeCount), comments: num(st.commentCount), shares: 0, saves: 0, avg_view_pct: null };
  try {
    const r = (await get(`${YT_ANALYTICS}/reports`, {
      ids: "channel==MINE",
      startDate: ymd(new Date(Math.min(publishedAt.getTime(), now.getTime()) - 86_400_000)),
      endDate: ymd(now),
      metrics: "averageViewPercentage,shares",
      filters: `video==${videoId}`,
    })) as { columnHeaders?: { name: string }[]; rows?: unknown[][] };
    const cols = (r.columnHeaders ?? []).map((c) => c.name);
    const row = r.rows?.[0];
    if (row) {
      const pct = row[cols.indexOf("averageViewPercentage")];
      if (pct != null && cols.includes("averageViewPercentage")) {
        numbers.avg_view_pct = cleanViewPct(pct);
        // a value past the column's range is stored at its limit, and said so (with YouTube's own number)
        if (Number(pct) > AVG_VIEW_PCT_MAX) notices.push(`YouTube reported ${Number(pct)}% average view for ${videoId}; stored as ${AVG_VIEW_PCT_MAX}%.`);
      }
      if (cols.includes("shares")) numbers.shares = num(row[cols.indexOf("shares")]);
    }
  } catch (e) {
    if (e instanceof HttpError && e.status === 403)
      notices.push("YouTube Analytics access isn't granted, so average view % stays empty. Reconnect YouTube on the Accounts page to allow it.");
    else notices.push(`YouTube Analytics unavailable (${errText(e)}); average view % stays empty.`);
  }
  return { numbers, notices };
}

export const GRAPH_BASE = "https://graph.facebook.com";

type InsightRow = { name: string; values?: { value?: unknown }[]; total_value?: { value?: unknown } };
/** Insights for an object, batch first, then one metric at a time; refused metrics are listed. */
async function insights(get: Getter, base: string, path: string, metrics: string[]): Promise<{ got: Record<string, unknown>; refused: string[]; permission: boolean }> {
  const got: Record<string, unknown> = {};
  const read = (rows: InsightRow[] = []) => {
    for (const r of rows) {
      const v = r.total_value?.value ?? r.values?.[0]?.value;
      if (v != null) got[r.name] = v;
    }
  };
  try {
    read(((await get(`${base}${path}`, { metric: metrics.join(",") })) as { data?: InsightRow[] }).data);
    return { got, refused: [], permission: false };
  } catch (e) {
    if (isPermissionError(e) && !(e instanceof HttpError && e.code === 100)) {
      // a missing permission refuses every metric alike: don't burn one request per metric
      return { got, refused: metrics, permission: true };
    }
  }
  const refused: string[] = [];
  for (const m of metrics) {
    try {
      read(((await get(`${base}${path}`, { metric: m })) as { data?: InsightRow[] }).data);
    } catch {
      refused.push(m);
    }
  }
  return { got, refused, permission: false };
}

export async function fetchInstagram(get: Getter, mediaId: string, base = GRAPH_BASE): Promise<Fetched> {
  const notices: string[] = [];
  const r = await insights(get, base, `/${mediaId}/insights`, ["views", "reach", "likes", "comments", "shares", "saved"]);
  // older media / API versions call it "plays"
  if (r.got.views == null && r.refused.includes("views") && !r.permission) {
    const p = await insights(get, base, `/${mediaId}/insights`, ["plays"]);
    if (p.got.plays != null) r.got.views = p.got.plays;
  }
  const numbers: PostNumbers = { views: num(r.got.views), likes: num(r.got.likes), comments: num(r.got.comments), shares: num(r.got.shares), saves: num(r.got.saved), avg_view_pct: null };
  if (r.permission || r.got.likes == null || r.got.comments == null) {
    try {
      const m = (await get(`${base}/${mediaId}`, { fields: "like_count,comments_count" })) as { like_count?: number; comments_count?: number };
      if (r.got.likes == null) numbers.likes = num(m.like_count);
      if (r.got.comments == null) numbers.comments = num(m.comments_count);
    } catch (e) {
      notices.push(`Instagram media counts unavailable (${errText(e)}).`);
    }
  }
  if (r.permission) notices.push("Instagram insights permission is missing, so only likes and comments synced. Reconnect Instagram on the Accounts page to allow insights.");
  else if (r.refused.length) notices.push(`Instagram didn't return: ${r.refused.filter((m) => !(m === "views" && r.got.views != null)).join(", ") || "none"}.`);
  return { numbers, notices: notices.filter((n) => !n.endsWith(": none.")) };
}

export async function fetchFacebook(get: Getter, videoId: string, base = GRAPH_BASE): Promise<Fetched> {
  const notices: string[] = [];
  const r = await insights(get, base, `/${videoId}/video_insights`, ["blue_reels_play_count", "post_impressions_unique", "post_video_social_actions"]);
  const actions = (r.got.post_video_social_actions ?? {}) as Record<string, unknown>;
  const pick = (...keys: string[]) => keys.reduce((n, k) => n + num(actions[k] ?? actions[k.toUpperCase()]), 0);
  const numbers: PostNumbers = {
    views: num(r.got.blue_reels_play_count),
    likes: pick("like", "reaction"),
    comments: pick("comment"),
    shares: pick("share"),
    saves: pick("save"),
    avg_view_pct: null,
  };
  if (!numbers.likes || !numbers.comments) {
    try {
      const v = (await get(`${base}/${videoId}`, { fields: "likes.summary(true).limit(0),comments.summary(true).limit(0)" })) as {
        likes?: { summary?: { total_count?: number } };
        comments?: { summary?: { total_count?: number } };
      };
      numbers.likes ||= num(v.likes?.summary?.total_count);
      numbers.comments ||= num(v.comments?.summary?.total_count);
    } catch (e) {
      notices.push(`Facebook like / comment counts unavailable (${errText(e)}).`);
    }
  }
  if (r.permission) notices.push("Facebook video insights permission is missing, so plays and shares stay at 0. Reconnect Facebook on the Accounts page to allow insights.");
  else if (r.refused.length) notices.push(`Facebook didn't return: ${r.refused.join(", ")}.`);
  return { numbers, notices };
}
