-- 013: dashboard accuracy. Per-account "count posts from" date, videos only, no score until 5 posts to compare.
ALTER TYPE verdict_t ADD VALUE IF NOT EXISTS 'not_enough';
ALTER TABLE social_accounts ADD COLUMN IF NOT EXISTS count_from date DEFAULT (current_date - 30);
UPDATE social_accounts SET count_from = DATE '2026-11-01';
BEGIN;
DROP MATERIALIZED VIEW IF EXISTS post_performance;
CREATE MATERIALIZED VIEW post_performance AS
WITH latest AS (
  SELECT DISTINCT ON (s.post_id) s.*
  FROM post_metric_snapshots s
  ORDER BY s.post_id, s.captured_at DESC
),
base AS (
  SELECT p.id AS post_id, p.user_id, p.social_account_id, p.platform, p.format, p.published_at,
         l.hours_since_publish, COALESCE(l.views, l.reach) AS views, l.likes, l.comments, l.shares, l.saves,
         l.follows_gained, l.completion_rate, l.avg_view_duration_s,
         -- engagement per view: weights shares/saves higher (strong distribution signals)
         CASE WHEN COALESCE(l.views, l.reach, 0) = 0 THEN NULL
              ELSE (COALESCE(l.likes,0) + 2*COALESCE(l.comments,0)
                    + 3*COALESCE(l.shares,0) + 3*COALESCE(l.saves,0))::numeric / COALESCE(l.views, l.reach) END
           AS weighted_engagement_rate
  FROM posts p
  JOIN latest l ON l.post_id = p.id
  JOIN social_accounts sa ON sa.id = p.social_account_id
  -- videos only (page photos and text posts aren't episodes), and only since the account's "count posts from" date
  WHERE p.status = 'published'
    AND p.format IN ('short_video','long_video')
    AND (sa.count_from IS NULL OR p.published_at >= sa.count_from)
),
ranked AS (
  -- percentile vs. YOUR OWN posts on the same account+format (not vs. the internet)
  SELECT b.*,
         count(*) OVER (PARTITION BY social_account_id, format)::int AS peers,
         percent_rank() OVER (PARTITION BY social_account_id, format ORDER BY views NULLS FIRST)                    AS views_pctl,
         percent_rank() OVER (PARTITION BY social_account_id, format ORDER BY weighted_engagement_rate NULLS FIRST) AS engagement_pctl,
         percent_rank() OVER (PARTITION BY social_account_id, format ORDER BY completion_rate NULLS FIRST)          AS completion_pctl
  FROM base b
),
composite AS (
  SELECT r.*, (0.4*views_pctl + 0.35*engagement_pctl + 0.25*completion_pctl) AS composite_raw
  FROM ranked r
),
scored AS (
  -- Re-rank the blended score so 0.5 = your typical post and "winner" = your top 15%
  -- (averaging three percentiles otherwise squeezes everything toward the middle).
  -- Fewer than 5 posts of a format on an account: nothing meaningful to rank against, so no score.
  SELECT c.*,
         CASE WHEN peers < 5 THEN NULL
              ELSE round(percent_rank() OVER (PARTITION BY social_account_id, format ORDER BY composite_raw)::numeric, 3) END
           AS performance_score
  FROM composite c
)
SELECT s.*,
       CASE
         WHEN hours_since_publish < 48 THEN 'too_early'::verdict_t
         WHEN peers < 5 THEN 'not_enough'
         WHEN performance_score >= 0.85 THEN 'winner'
         WHEN performance_score >= 0.65 THEN 'above_avg'
         WHEN performance_score >= 0.35 THEN 'average'
         WHEN performance_score >= 0.15 THEN 'below_avg'
         ELSE 'underperformer'
       END AS verdict
FROM scored s;
CREATE UNIQUE INDEX ON post_performance (post_id);
CREATE INDEX ON post_performance (user_id, platform, verdict);
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'studio_app') THEN
    ALTER MATERIALIZED VIEW post_performance OWNER TO studio_app;
  END IF;
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon') THEN
    REVOKE ALL ON post_performance FROM anon, authenticated;
  END IF;
END $$;
COMMIT;
