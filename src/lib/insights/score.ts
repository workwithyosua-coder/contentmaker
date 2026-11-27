// The engagement score a post's numbers come down to, for the leaderboard and the pattern analyst. Actions that say
// "this was worth something" (shares, saves, comments) and how much of the video people watched count far more than
// raw views: per-view rates, so a 300-view post that got shared beats a 3,000-view post nobody touched, plus a small
// log term for reach. Pure, so it's unit-tested.

export type PostNumbers = { views: number; likes: number; comments: number; shares: number; saves: number; avg_view_pct: number | null };

export const SCORE_WEIGHTS = { shares: 6, saves: 5, comments: 3, likes: 1, avgViewPct: 0.5, reach: 2 } as const;
/** below this many views the per-view rates use this floor, so 1 share on 2 views isn't a 3,000-point outlier */
export const VIEW_FLOOR = 50;

const n = (v: unknown) => (Number.isFinite(Number(v)) && Number(v) > 0 ? Number(v) : 0);

/**
 * engagement_score = (6·shares + 5·saves + 3·comments + likes) per 1,000 views (views floored at 50)
 *                  + 0.5 × average view percentage (0 when the platform doesn't give it)
 *                  + 2 × log10(1 + views)
 * Rounded to 2 decimals.
 */
export function engagementScore(m: PostNumbers): number {
  const W = SCORE_WEIGHTS;
  const views = n(m.views);
  const actions = W.shares * n(m.shares) + W.saves * n(m.saves) + W.comments * n(m.comments) + W.likes * n(m.likes);
  const perK = (actions / Math.max(views, VIEW_FLOOR)) * 1000;
  const watched = m.avg_view_pct == null ? 0 : W.avgViewPct * Math.min(n(m.avg_view_pct), 200);
  return Math.round((perK + watched + W.reach * Math.log10(1 + views)) * 100) / 100;
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
