// The engagement score a post's numbers come down to, for the leaderboard and the pattern analyst. Actions that say
// "this was worth something" (shares, saves, comments) and how much of the video people watched count far more than
// raw views: per-view rates, so a 300-view post that got shared beats a 3,000-view post nobody touched, plus a small
// log term for reach. Pure, so it's unit-tested.

export type PostNumbers = { views: number; likes: number; comments: number; shares: number; saves: number; avg_view_pct: number | null };

export const SCORE_WEIGHTS = { shares: 6, saves: 5, comments: 3, likes: 1, avgViewPct: 0.5, reach: 2 } as const;
/** below this many views the per-view rates use this floor, so 1 share on 2 views isn't a 3,000-point outlier */
export const VIEW_FLOOR = 50;

/**
 * The stored average view percentage: YouTube Shorts loop, so it routinely passes 100 (135.5 % = people watched it
 * 1.355 times on average), and on a very short or barely viewed Short it can pass 1000. Kept as a number from 0 to
 * 1000 (the column's CHECK constraint, migration 021); anything that isn't a finite, non-negative number is null.
 */
export const AVG_VIEW_PCT_MAX = 1000;
export function cleanViewPct(raw: unknown): number | null {
  if (raw == null || raw === "") return null;
  const v = Number(raw);
  if (!Number.isFinite(v) || v < 0) return null;
  return Math.round(Math.min(v, AVG_VIEW_PCT_MAX) * 100) / 100;
}

/** Watch time's share of the score is capped here: 200 % (two full plays on average) earns the maximum 100 points. */
export const WATCH_PCT_CAP = 200;

const n = (v: unknown) => (Number.isFinite(Number(v)) && Number(v) > 0 ? Number(v) : 0);

/** Below this many views a post's rates are a small sample: their points are scaled down smoothly (views / 100). */
export const CONFIDENCE_VIEWS = 100;
/** How much a post's rate-based and watch-time points count: views / 100, at most 1 (100+ views count in full). */
export const sampleConfidence = (views: number) => Math.min(1, n(views) / CONFIDENCE_VIEWS);

/**
 * engagement_score = confidence × [ (6·shares + 5·saves + 3·comments + likes) per 1,000 views (views floored at 50)
 *                                   + 0.5 × average view percentage, capped at 200 % (0 when the platform doesn't give it) ]
 *                  + 2 × log10(1 + views)
 * where confidence = min(1, views / 100). A 7-view Short with a 1000 % looping anomaly keeps 7 % of its rate points
 * (about 9 in all), so it can't outscore a 2,000-view post with 11 shares and 4 saves (about 95). Rounded to 2 decimals.
 */
export function engagementScore(m: PostNumbers): number {
  const W = SCORE_WEIGHTS;
  const views = n(m.views);
  const actions = W.shares * n(m.shares) + W.saves * n(m.saves) + W.comments * n(m.comments) + W.likes * n(m.likes);
  const perK = (actions / Math.max(views, VIEW_FLOOR)) * 1000;
  const watched = m.avg_view_pct == null ? 0 : W.avgViewPct * Math.min(n(m.avg_view_pct), WATCH_PCT_CAP);
  return Math.round((sampleConfidence(views) * (perK + watched) + W.reach * Math.log10(1 + views)) * 100) / 100;
}

/** The Pattern Analyst and the winning-hooks anchor only learn from settled, meaningful samples. */
export const MIN_SAMPLE_VIEWS = 100;
/** YouTube Analytics' retention (average view %) arrives 48-72 h after posting: until then a YouTube row waits. */
export const RETENTION_SETTLE_HOURS = 72;

export type EligibilityRow = { platform: string; views: number; avg_view_pct: number | null; published_at: Date | string | null };

/** A row the winning-hooks anchor may use: at least 100 views. */
export const hookEligible = (r: Pick<EligibilityRow, "views">) => n(r.views) >= MIN_SAMPLE_VIEWS;

/**
 * A row the Pattern Analyst may compare: at least 100 views and, on YouTube, either its retention has arrived
 * (avg_view_pct set) or the post is at least 72 h old (a fresh 24 h Short waiting on YouTube Analytics would
 * otherwise read as a bottom-quartile flop). Mirrors the SQL in insights/server.ts (ANALYST_ELIGIBLE).
 */
export function analystEligible(r: EligibilityRow, now = new Date()): boolean {
  if (!hookEligible(r)) return false;
  if (r.platform !== "youtube" || r.avg_view_pct != null) return true;
  if (!r.published_at) return false;
  return now.getTime() - new Date(r.published_at).getTime() >= RETENTION_SETTLE_HOURS * 3_600_000;
}

/** The snapshot a sync files a post under, by its age: "24h" (< 48 h), "72h" (< 5 days), else "7d". */
export function snapshotWindow(ageHours: number): "24h" | "72h" | "7d" {
  if (ageHours < 48) return "24h";
  if (ageHours < 120) return "72h";
  return "7d";
}

/** Top and bottom quartiles of a scored list (at least one each), for the pattern analyst. */
export function quartiles<T extends { engagement_score: number }>(rows: T[]): { top: T[]; bottom: T[] } {
  const sorted = [...rows].sort((a, b) => b.engagement_score - a.engagement_score);
  const k = Math.max(1, Math.floor(sorted.length / 4));
  return { top: sorted.slice(0, k), bottom: sorted.slice(-k).reverse() };
}
