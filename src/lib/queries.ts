import "server-only";
import { db } from "./db";

export const PLATFORMS = ["instagram", "tiktok", "youtube", "linkedin", "x", "facebook", "threads"] as const;
export type Platform = (typeof PLATFORMS)[number];

export const DIMENSIONS = {
  hook_type: { label: "Hook type", expr: "f.hook_type" },
  style: { label: "Editing style", expr: "s.name" },
  duration: { label: "Length", expr: "f.duration_bucket" },
  pillar: { label: "Content pillar", expr: "f.pillar" },
  posting_time: {
    label: "Posting time (UTC)",
    expr: `CASE WHEN f.posted_hour < 10 THEN 'Morning (<10h)' WHEN f.posted_hour < 17 THEN 'Midday (10–17h)'
                WHEN f.posted_hour <= 21 THEN 'Evening (18–21h)' ELSE 'Late (22h+)' END`,
  },
  face: { label: "Face in first 2s", expr: "CASE WHEN f.has_face_in_first_2s THEN 'Face in first 2s' ELSE 'No face' END" },
} as const;
export type Dimension = keyof typeof DIMENSIONS;

export async function getOwner() {
  const sql = db();
  const email = process.env.OWNER_EMAIL;
  const rows = email
    ? await sql<{ id: string; email: string }[]>`SELECT id, email FROM users WHERE email = ${email}`
    : await sql<{ id: string; email: string }[]>`SELECT id, email FROM users ORDER BY created_at LIMIT 1`;
  return rows[0] ?? null;
}

export async function getKpis(userId: string, days: number, platform?: Platform) {
  const sql = db();
  const pf = platform ? sql`AND pp.platform = ${platform}` : sql``;
  const [posts] = await sql<
    { posts: number; views: string | null; median_score: string | null; winners: number; underperformers: number }[]
  >`
    SELECT count(*)::int AS posts,
           sum(pp.views) AS views,
           percentile_cont(0.5) WITHIN GROUP (ORDER BY pp.performance_score)
             FILTER (WHERE pp.verdict NOT IN ('too_early', 'not_enough')) AS median_score,
           count(*) FILTER (WHERE pp.verdict = 'winner')::int AS winners,
           count(*) FILTER (WHERE pp.verdict = 'underperformer')::int AS underperformers
    FROM post_performance pp
    WHERE pp.user_id = ${userId} AND pp.published_at >= now() - make_interval(days => ${days}) ${pf}`;
  const apf = platform ? sql`AND sa.platform = ${platform}` : sql``;
  const [followers] = await sql<{ total: string | null; delta: string | null }[]>`
    SELECT (SELECT sum(f) FROM (SELECT DISTINCT ON (a.social_account_id) a.followers AS f
                                FROM account_metric_daily a JOIN social_accounts sa ON sa.id = a.social_account_id
                                WHERE sa.user_id = ${userId} ${apf}
                                ORDER BY a.social_account_id, a.day DESC) t) AS total,
           (SELECT sum(a.followers_delta) FROM account_metric_daily a JOIN social_accounts sa ON sa.id = a.social_account_id
             WHERE sa.user_id = ${userId} AND a.day > current_date - ${days}::int ${apf}) AS delta`;
  return {
    posts: posts.posts,
    views: Number(posts.views ?? 0),
    medianScore: posts.median_score === null ? null : Number(posts.median_score),
    winners: posts.winners,
    underperformers: posts.underperformers,
    followers: Number(followers.total ?? 0),
    followersDelta: Number(followers.delta ?? 0),
  };
}

export type PostRow = {
  id: string;
  platform: Platform;
  caption_text: string | null;
  permalink: string | null;
  published_at: Date;
  views: number | null;
  weighted_engagement_rate: string | null;
  completion_rate: string | null;
  performance_score: string;
  verdict: string;
  hook_type: string | null;
  style_name: string | null;
  duration_bucket: string | null;
};

export async function getPosts(userId: string, days: number, platform?: Platform, limit = 60) {
  const sql = db();
  const pf = platform ? sql`AND pp.platform = ${platform}` : sql``;
  return sql<PostRow[]>`
    SELECT p.id, pp.platform, p.caption_text, p.permalink, pp.published_at, pp.views,
           pp.weighted_engagement_rate, pp.completion_rate, pp.performance_score, pp.verdict,
           f.hook_type, s.name AS style_name, f.duration_bucket
    FROM post_performance pp
    JOIN posts p ON p.id = pp.post_id
    LEFT JOIN post_features f ON f.post_id = p.id
    LEFT JOIN editing_styles s ON s.id = f.editing_style_id
    WHERE pp.user_id = ${userId} AND pp.published_at >= now() - make_interval(days => ${days}) ${pf}
    ORDER BY pp.published_at DESC
    LIMIT ${limit}`;
}

export type BreakdownRow = {
  label: string;
  posts: number;
  avg_score: number;
  median_views: number;
  avg_completion: number | null;
  lift: number;
};

/** Average performance per value of one feature, vs. the overall average. Excludes posts < 48h old. */
export async function getBreakdown(userId: string, dim: Dimension, days: number, platform?: Platform) {
  const sql = db();
  const expr = DIMENSIONS[dim].expr; // allow-listed SQL expression, never user input
  const params: (string | number)[] = [userId, days];
  let pf = "";
  if (platform) {
    params.push(platform);
    pf = "AND pp.platform = $3";
  }
  const rows = await sql.unsafe<
    { label: string | null; posts: number; avg_score: string; median_views: string; avg_completion: string | null }[]
  >(
    `SELECT ${expr} AS label, count(*)::int AS posts,
            avg(pp.performance_score) AS avg_score,
            percentile_cont(0.5) WITHIN GROUP (ORDER BY pp.views) AS median_views,
            avg(pp.completion_rate) AS avg_completion
     FROM post_performance pp
     JOIN post_features f ON f.post_id = pp.post_id
     LEFT JOIN editing_styles s ON s.id = f.editing_style_id
     WHERE pp.user_id = $1 AND pp.verdict NOT IN ('too_early', 'not_enough')
       AND pp.published_at >= now() - make_interval(days => $2::int) ${pf}
     GROUP BY 1`,
    params,
  );
  const total = rows.reduce((a, r) => a + r.posts, 0);
  const overall = total ? rows.reduce((a, r) => a + Number(r.avg_score) * r.posts, 0) / total : 0;
  return rows
    .filter((r) => r.label !== null)
    .map<BreakdownRow>((r) => ({
      label: r.label as string,
      posts: r.posts,
      avg_score: Number(r.avg_score),
      median_views: Number(r.median_views),
      avg_completion: r.avg_completion === null ? null : Number(r.avg_completion),
      lift: overall ? Number(r.avg_score) / overall : 1,
    }))
    .sort((a, b) => b.avg_score - a.avg_score);
}

export async function getWeeklyViews(userId: string, weeks = 12) {
  const sql = db();
  const rows = await sql<{ week: Date; platform: Platform; views: string }[]>`
    SELECT date_trunc('week', pp.published_at) AS week, pp.platform, sum(pp.views) AS views
    FROM post_performance pp
    WHERE pp.user_id = ${userId} AND pp.published_at >= now() - make_interval(weeks => ${weeks})
    GROUP BY 1, 2 ORDER BY 1`;
  const byWeek = new Map<string, Record<string, number | string>>();
  for (const r of rows) {
    const key = r.week.toISOString().slice(0, 10);
    const entry = byWeek.get(key) ?? { week: key };
    entry[r.platform] = Number(r.views);
    byWeek.set(key, entry);
  }
  return [...byWeek.values()];
}

export async function getConnectedPlatforms(userId: string) {
  const sql = db();
  const rows = await sql<{ platform: Platform }[]>`
    SELECT DISTINCT platform FROM social_accounts WHERE user_id = ${userId} AND is_active ORDER BY platform`;
  return rows.map((r) => r.platform);
}

export type InsightRow = {
  id: string;
  platform: Platform | null;
  dimension: string;
  finding: string;
  recommendation: string | null;
  effect_size: string | null;
  sample_size: number;
  confidence: string | null;
  created_at: Date;
};

export async function getInsights(userId: string) {
  const sql = db();
  return sql<InsightRow[]>`
    SELECT id, platform, dimension, finding, recommendation, effect_size, sample_size, confidence, created_at
    FROM insights WHERE user_id = ${userId} AND status = 'active'
    ORDER BY confidence DESC NULLS LAST, created_at DESC`;
}

export async function getLatestReport(userId: string) {
  const sql = db();
  const rows = await sql<{ summary_md: string; created_at: Date }[]>`
    SELECT summary_md, created_at FROM performance_reports WHERE user_id = ${userId}
    ORDER BY created_at DESC LIMIT 1`;
  return rows[0] ?? null;
}
