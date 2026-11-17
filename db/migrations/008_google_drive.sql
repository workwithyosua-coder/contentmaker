-- 008: Google Drive as the long-term home for rendered episode videos
CREATE TABLE IF NOT EXISTS drive_connections (
  id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id            uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE UNIQUE,
  email              text,
  refresh_token_enc  bytea NOT NULL,
  folder_id          text,                -- the "Uco Ocu / Episodes" folder the app created
  created_at         timestamptz NOT NULL DEFAULT now(),
  updated_at         timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE episode_videos ADD COLUMN IF NOT EXISTS drive_file_id text;
ALTER TABLE episode_videos ADD COLUMN IF NOT EXISTS drive_url text;
ALTER TABLE episode_videos ADD COLUMN IF NOT EXISTS drive_error text;

DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'studio_app') THEN
    ALTER TABLE drive_connections OWNER TO studio_app;
  END IF;
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon') THEN
    ALTER TABLE drive_connections ENABLE ROW LEVEL SECURITY;
    REVOKE ALL ON drive_connections FROM anon, authenticated;
  END IF;
END $$;

-- The private 'recordings' bucket also holds rendered videos (and their upload parts): allow MP4 up to 50 MB.
UPDATE storage.buckets
SET file_size_limit = 52428800,
    allowed_mime_types = array_cat(allowed_mime_types, ARRAY['video/mp4', 'application/octet-stream'])
WHERE id = 'recordings' AND NOT ('video/mp4' = ANY (allowed_mime_types));
