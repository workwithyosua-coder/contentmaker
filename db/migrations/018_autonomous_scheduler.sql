-- Autonomous scheduler (PR 4): schedule rules, the episode queue the GitHub Actions cron works through, and the
-- Reusable Prop Bank that limits unattended scripts to props that already exist.
--
--   content_schedules: one rule per schedule. At least 2 slots on every active day (11:00 and 19:00 WIB by default).
--   episode_queue:     one row per slot: queued → scripting → voicing → rendering → ready_to_post | published | failed
--   prop_bank:         keyword tags and a "vetted" switch per existing prop (repo PNG or uploaded prop)
--
-- Safe to run more than once.

CREATE TABLE IF NOT EXISTS content_schedules (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id          uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  name             text NOT NULL DEFAULT 'Main schedule',
  cadence          text NOT NULL DEFAULT 'daily',
  days_of_week     smallint[] NOT NULL DEFAULT '{1,2,3,4,5}',   -- weekly: 0 = Sunday … 6 = Saturday
  days_of_month    smallint[] NOT NULL DEFAULT '{1,8,15,22}',   -- monthly: 1 … 31 (skipped in shorter months)
  slots_per_day    smallint NOT NULL DEFAULT 2,
  slot_times       text[] NOT NULL DEFAULT '{11:00,19:00}',     -- HH:MM in time_zone, one per slot
  time_zone        text NOT NULL DEFAULT 'Asia/Jakarta',
  format_mix       text[] NOT NULL DEFAULT '{comedy_debate,koran_kinetik}', -- slot 1, slot 2, … (cycled)
  voice_provider   text NOT NULL DEFAULT 'gemini_tts',
  target_platforms text[] NOT NULL DEFAULT '{youtube,instagram,facebook,tiktok_drafts}',
  topic_hint       text,                                          -- optional steer for Gemini's topic seeds
  auto_execute     boolean NOT NULL DEFAULT false,                -- the cron produces and posts due slots by itself
  is_active        boolean NOT NULL DEFAULT true,
  created_at       timestamptz NOT NULL DEFAULT now(),
  updated_at       timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS content_schedules_user_idx ON content_schedules (user_id);

DO $$ BEGIN
  ALTER TABLE content_schedules ADD CONSTRAINT content_schedules_cadence_check CHECK (cadence IN ('daily', 'weekly', 'monthly'));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  ALTER TABLE content_schedules ADD CONSTRAINT content_schedules_slots_check CHECK (slots_per_day BETWEEN 2 AND 6 AND cardinality(slot_times) = slots_per_day);
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  ALTER TABLE content_schedules ADD CONSTRAINT content_schedules_voice_check CHECK (voice_provider IN ('gemini_tts_rvc', 'gemini_tts'));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  ALTER TABLE content_schedules ADD CONSTRAINT content_schedules_platforms_check CHECK (target_platforms <@ ARRAY['youtube', 'instagram', 'facebook', 'tiktok_drafts']::text[]);
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

CREATE TABLE IF NOT EXISTS episode_queue (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  schedule_id    uuid NOT NULL REFERENCES content_schedules(id) ON DELETE CASCADE,
  user_id        uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  scheduled_for  timestamptz NOT NULL,
  slot_index     smallint NOT NULL DEFAULT 0,
  format         text NOT NULL,
  topic_seed     text,
  topic_source   text,                     -- manual | gemini
  status         text NOT NULL DEFAULT 'queued',
  episode_id     uuid REFERENCES content_projects(id) ON DELETE SET NULL,
  render_job_id  uuid REFERENCES render_jobs(id) ON DELETE SET NULL,
  error_message  text,
  run_url        text,                     -- the GitHub Actions run working on it
  handoff        jsonb,                    -- ready_to_post: TikTok caption and what was queued where
  attempts       int NOT NULL DEFAULT 0,
  started_at     timestamptz,
  finished_at    timestamptz,
  created_at     timestamptz NOT NULL DEFAULT now(),
  updated_at     timestamptz NOT NULL DEFAULT now(),
  UNIQUE (schedule_id, scheduled_for)
);
CREATE INDEX IF NOT EXISTS episode_queue_due_idx ON episode_queue (status, scheduled_for);
CREATE INDEX IF NOT EXISTS episode_queue_user_idx ON episode_queue (user_id, scheduled_for);

DO $$ BEGIN
  ALTER TABLE episode_queue ADD CONSTRAINT episode_queue_status_check
    CHECK (status IN ('queued', 'scripting', 'voicing', 'rendering', 'ready_to_post', 'published', 'failed'));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

CREATE TABLE IF NOT EXISTS prop_bank (
  user_id    uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  name       text NOT NULL,                -- the prop's file name without extension (kebab-case)
  keywords   text[] NOT NULL DEFAULT '{}',
  category   text,
  vetted     boolean NOT NULL DEFAULT true,
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, name)
);

DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'studio_app') THEN
    ALTER TABLE content_schedules OWNER TO studio_app;
    ALTER TABLE episode_queue OWNER TO studio_app;
    ALTER TABLE prop_bank OWNER TO studio_app;
  END IF;
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon') THEN
    ALTER TABLE content_schedules ENABLE ROW LEVEL SECURITY;
    ALTER TABLE episode_queue ENABLE ROW LEVEL SECURITY;
    ALTER TABLE prop_bank ENABLE ROW LEVEL SECURITY;
    REVOKE ALL ON content_schedules FROM anon, authenticated;
    REVOKE ALL ON episode_queue FROM anon, authenticated;
    REVOKE ALL ON prop_bank FROM anon, authenticated;
  END IF;
END $$;
