-- Showrunner Playbook: the studio learns from the owner's critique (Director's Review) and from how published posts
-- perform (Post Metrics Sync), and the production pipeline reads it back (prompts, TTS, render).
--   episode_feedback          the Director's Review of an episode: a rating, issue tags, notes
--   episode_metrics           real platform numbers per post and snapshot window (synced, or logged by hand for TikTok)
--   studio_lessons            the Playbook: atomic rules, at most 12 active (enforced by the app, which consolidates)
--   studio_tunables           one row of bounded numbers the pipeline reads (gaps, BGM level, motion, expressiveness)
--   pronunciation_overrides   "written term → spoken as" fixes for the TTS input only (subtitles never change)
-- Plain tables, CHECK constraints and indexes only: nothing session-scoped, so it runs on Supabase's transaction
-- pooler (port 6543). Safe to run more than once.

CREATE TABLE IF NOT EXISTS episode_feedback (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  episode_id uuid NOT NULL REFERENCES content_projects(id) ON DELETE CASCADE,
  rating text NOT NULL CHECK (rating IN ('winner', 'needs_work', 'unwatchable')),
  issue_tags text[] NOT NULL DEFAULT '{}' CHECK (issue_tags <@ ARRAY['too_fast', 'too_slow', 'monotone_rhythm', 'preachy_script', 'weak_hook', 'flat_emotion', 'mispronunciation', 'bgm_too_loud', 'bgm_too_quiet', 'too_static', 'staging_mismatch']::text[]),
  notes text,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS episode_feedback_episode_idx ON episode_feedback (episode_id, created_at DESC);
CREATE INDEX IF NOT EXISTS episode_feedback_created_idx ON episode_feedback (created_at DESC);

CREATE TABLE IF NOT EXISTS episode_metrics (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  episode_id uuid NOT NULL REFERENCES content_projects(id) ON DELETE CASCADE,
  platform text NOT NULL CHECK (platform IN ('youtube', 'instagram', 'facebook', 'tiktok')),
  platform_post_id text,
  snapshot_window text NOT NULL CHECK (snapshot_window IN ('24h', '72h', '7d', 'manual')),
  views integer NOT NULL DEFAULT 0 CHECK (views >= 0),
  likes integer NOT NULL DEFAULT 0 CHECK (likes >= 0),
  comments integer NOT NULL DEFAULT 0 CHECK (comments >= 0),
  shares integer NOT NULL DEFAULT 0 CHECK (shares >= 0),
  saves integer NOT NULL DEFAULT 0 CHECK (saves >= 0),
  avg_view_pct numeric CHECK (avg_view_pct IS NULL OR (avg_view_pct >= 0 AND avg_view_pct <= 1000)),
  engagement_score numeric NOT NULL DEFAULT 0,
  captured_at timestamptz NOT NULL DEFAULT now(),
  -- one row per post and window: a later sync in the same window updates it
  UNIQUE (episode_id, platform, snapshot_window)
);
CREATE INDEX IF NOT EXISTS episode_metrics_score_idx ON episode_metrics (engagement_score DESC);
CREATE INDEX IF NOT EXISTS episode_metrics_captured_idx ON episode_metrics (captured_at DESC);

CREATE TABLE IF NOT EXISTS studio_lessons (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  category text NOT NULL CHECK (category IN ('topic', 'script', 'pacing', 'voice', 'visual')),
  rule_text text NOT NULL CHECK (length(rule_text) BETWEEN 3 AND 280),
  source text NOT NULL CHECK (source IN ('owner_feedback', 'metrics_insight')),
  status text NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'paused')),
  evidence_count integer NOT NULL DEFAULT 1 CHECK (evidence_count >= 1),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS studio_lessons_status_idx ON studio_lessons (status, evidence_count DESC, updated_at DESC);

-- one row (id = 1); every value bounded by the same limits the app clamps to
CREATE TABLE IF NOT EXISTS studio_tunables (
  id smallint PRIMARY KEY DEFAULT 1 CHECK (id = 1),
  rapid_cut_gap_ms integer NOT NULL DEFAULT 100 CHECK (rapid_cut_gap_ms BETWEEN 80 AND 160),
  standard_gap_ms integer NOT NULL DEFAULT 220 CHECK (standard_gap_ms BETWEEN 160 AND 320),
  pre_punchline_gap_ms integer NOT NULL DEFAULT 380 CHECK (pre_punchline_gap_ms BETWEEN 280 AND 500),
  bgm_speech_volume numeric(4, 3) NOT NULL DEFAULT 0.13 CHECK (bgm_speech_volume BETWEEN 0.08 AND 0.20),
  motion_energy numeric(4, 2) NOT NULL DEFAULT 1.00 CHECK (motion_energy BETWEEN 0.80 AND 1.40),
  target_line_count integer NOT NULL DEFAULT 14 CHECK (target_line_count BETWEEN 12 AND 16),
  voice_expressiveness numeric(4, 2) NOT NULL DEFAULT 1.00 CHECK (voice_expressiveness BETWEEN 0.80 AND 1.30),
  updated_at timestamptz NOT NULL DEFAULT now()
);
INSERT INTO studio_tunables (id) VALUES (1) ON CONFLICT (id) DO NOTHING;

-- the term is stored trimmed and lower-cased, so the primary key is the case-insensitive match
CREATE TABLE IF NOT EXISTS pronunciation_overrides (
  term text PRIMARY KEY CHECK (term = lower(btrim(term)) AND length(term) BETWEEN 1 AND 60),
  spoken_as text NOT NULL CHECK (length(btrim(spoken_as)) BETWEEN 1 AND 80),
  created_at timestamptz NOT NULL DEFAULT now()
);

DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'studio_app') THEN
    ALTER TABLE episode_feedback OWNER TO studio_app;
    ALTER TABLE episode_metrics OWNER TO studio_app;
    ALTER TABLE studio_lessons OWNER TO studio_app;
    ALTER TABLE studio_tunables OWNER TO studio_app;
    ALTER TABLE pronunciation_overrides OWNER TO studio_app;
  END IF;
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon') THEN
    ALTER TABLE episode_feedback ENABLE ROW LEVEL SECURITY;
    ALTER TABLE episode_metrics ENABLE ROW LEVEL SECURITY;
    ALTER TABLE studio_lessons ENABLE ROW LEVEL SECURITY;
    ALTER TABLE studio_tunables ENABLE ROW LEVEL SECURITY;
    ALTER TABLE pronunciation_overrides ENABLE ROW LEVEL SECURITY;
    REVOKE ALL ON episode_feedback FROM anon, authenticated;
    REVOKE ALL ON episode_metrics FROM anon, authenticated;
    REVOKE ALL ON studio_lessons FROM anon, authenticated;
    REVOKE ALL ON studio_tunables FROM anon, authenticated;
    REVOKE ALL ON pronunciation_overrides FROM anon, authenticated;
  END IF;
END $$;
