-- 010: render jobs (the "Render video" button → GitHub Actions → upload back to the app)
CREATE TABLE IF NOT EXISTS render_jobs (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id  uuid NOT NULL REFERENCES content_projects(id) ON DELETE CASCADE,
  status      text NOT NULL DEFAULT 'queued',   -- queued | running | done | failed
  error       text,
  run_url     text,                              -- the GitHub Actions run
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS render_jobs_project_idx ON render_jobs (project_id, created_at DESC);

DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'studio_app') THEN
    ALTER TABLE render_jobs OWNER TO studio_app;
  END IF;
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon') THEN
    ALTER TABLE render_jobs ENABLE ROW LEVEL SECURITY;
    REVOKE ALL ON render_jobs FROM anon, authenticated;
  END IF;
END $$;
