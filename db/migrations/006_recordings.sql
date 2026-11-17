-- 006: voice recordings, one or more takes per script line
ALTER TYPE project_status_t ADD VALUE IF NOT EXISTS 'recorded' AFTER 'awaiting_recording';

CREATE TABLE IF NOT EXISTS recordings (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id    uuid NOT NULL REFERENCES content_projects(id) ON DELETE CASCADE,
  script_id     uuid NOT NULL REFERENCES scripts(id) ON DELETE CASCADE,
  line_index    int NOT NULL,
  speaker       text NOT NULL,                -- 'uco' | 'ocu' (IP character)
  take          int NOT NULL,
  storage_path  text NOT NULL,                -- path in the private 'recordings' bucket
  mime_type     text NOT NULL,
  size_bytes    int,
  duration_ms   int,
  source        text NOT NULL DEFAULT 'booth', -- 'booth' (recorded in the app) | 'upload'
  is_selected   boolean NOT NULL DEFAULT true,
  created_at    timestamptz NOT NULL DEFAULT now(),
  UNIQUE (script_id, line_index, take)
);
CREATE INDEX IF NOT EXISTS recordings_script_idx ON recordings (script_id, line_index);

DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'studio_app') THEN
    ALTER TABLE recordings OWNER TO studio_app;
  END IF;
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon') THEN
    ALTER TABLE recordings ENABLE ROW LEVEL SECURITY;
    REVOKE ALL ON recordings FROM anon, authenticated;
  END IF;
END $$;
