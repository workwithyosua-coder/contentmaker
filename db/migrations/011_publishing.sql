-- 011: multi-platform publishing (YouTube Shorts, TikTok, Instagram Reels, Facebook Reels)
ALTER TABLE content_projects ADD COLUMN IF NOT EXISTS platform_captions jsonb;       -- per-platform metadata from the Copywriter
ALTER TABLE content_projects ADD COLUMN IF NOT EXISTS publish_settings jsonb NOT NULL DEFAULT '{}'; -- toggles, privacy, caption edits
ALTER TABLE content_projects ADD COLUMN IF NOT EXISTS auto_publish boolean NOT NULL DEFAULT false;  -- post when a render lands
ALTER TABLE content_projects ADD COLUMN IF NOT EXISTS publish_at timestamptz;        -- scheduled publish time

-- One row per (rendered video, platform). The worker advances it: queued → uploading → processing → published | failed.
CREATE TABLE IF NOT EXISTS episode_publications (
  id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id         uuid NOT NULL REFERENCES content_projects(id) ON DELETE CASCADE,
  video_id           uuid NOT NULL REFERENCES episode_videos(id) ON DELETE CASCADE,
  platform           platform_t NOT NULL,
  social_account_id  uuid REFERENCES social_accounts(id) ON DELETE SET NULL,
  status             text NOT NULL DEFAULT 'queued',   -- idle | queued | uploading | processing | published | failed
  caption            jsonb NOT NULL DEFAULT '{}',      -- exactly what is (or was) sent
  settings           jsonb NOT NULL DEFAULT '{}',
  step               jsonb NOT NULL DEFAULT '{}',      -- adapter progress (container id, publish id, …)
  external_post_id   text,
  external_post_url  text,
  error              text,
  attempts           int NOT NULL DEFAULT 0,
  run_after          timestamptz NOT NULL DEFAULT now(),
  locked_until       timestamptz,
  published_at       timestamptz,
  created_at         timestamptz NOT NULL DEFAULT now(),
  updated_at         timestamptz NOT NULL DEFAULT now(),
  UNIQUE (video_id, platform)
);
CREATE INDEX IF NOT EXISTS episode_publications_due_idx ON episode_publications (status, run_after);
CREATE INDEX IF NOT EXISTS episode_publications_project_idx ON episode_publications (project_id);

-- Small key/value store for app internals (e.g. the hash of the publish worker's token).
CREATE TABLE IF NOT EXISTS app_settings (key text PRIMARY KEY, value text NOT NULL, updated_at timestamptz NOT NULL DEFAULT now());

DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'studio_app') THEN
    ALTER TABLE episode_publications OWNER TO studio_app;
    ALTER TABLE app_settings OWNER TO studio_app;
  END IF;
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon') THEN
    ALTER TABLE episode_publications ENABLE ROW LEVEL SECURITY;
    ALTER TABLE app_settings ENABLE ROW LEVEL SECURITY;
    REVOKE ALL ON episode_publications FROM anon, authenticated;
    REVOKE ALL ON app_settings FROM anon, authenticated;
  END IF;
END $$;
