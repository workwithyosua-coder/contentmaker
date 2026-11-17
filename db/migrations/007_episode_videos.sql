-- 007: rendered episode videos (animated Uco & Ocu over the recorded voices)
CREATE TABLE IF NOT EXISTS episode_videos (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id    uuid NOT NULL REFERENCES content_projects(id) ON DELETE CASCADE,
  script_id     uuid NOT NULL REFERENCES scripts(id) ON DELETE CASCADE,
  storage_path  text NOT NULL,                -- path in the private 'recordings' bucket
  size_bytes    int,
  duration_ms   int,
  renderer      text NOT NULL DEFAULT 'remotion',
  created_at    timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS episode_videos_project_idx ON episode_videos (project_id, created_at DESC);

DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'studio_app') THEN
    ALTER TABLE episode_videos OWNER TO studio_app;
  END IF;
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon') THEN
    ALTER TABLE episode_videos ENABLE ROW LEVEL SECURITY;
    REVOKE ALL ON episode_videos FROM anon, authenticated;
  END IF;
END $$;
