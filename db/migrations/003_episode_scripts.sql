-- 003: dialogue scripts for two-character (Uco & Ocu) episodes
ALTER TYPE project_status_t ADD VALUE IF NOT EXISTS 'scripting' AFTER 'awaiting_concept';
ALTER TYPE project_status_t ADD VALUE IF NOT EXISTS 'awaiting_script_approval' AFTER 'scripting';
ALTER TYPE project_status_t ADD VALUE IF NOT EXISTS 'awaiting_recording' AFTER 'awaiting_script_approval';

CREATE TABLE IF NOT EXISTS scripts (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id      uuid NOT NULL REFERENCES content_projects(id) ON DELETE CASCADE,
  concept_id      uuid REFERENCES concepts(id) ON DELETE SET NULL,
  version         int NOT NULL,
  title           text NOT NULL,
  language        text NOT NULL DEFAULT 'id',
  subtitle_language text DEFAULT 'en',
  target_duration_s int,
  lines           jsonb NOT NULL,   -- [{beat, speaker:'uco'|'ocu', text, subtitle, expression, visual, on_screen_text}]
  fact_sheet      text,             -- research notes the script was written from
  sources         jsonb DEFAULT '[]', -- [{claim, url}]
  feedback        text,             -- the owner's notes that produced this version
  approved_at     timestamptz,
  created_at      timestamptz NOT NULL DEFAULT now(),
  UNIQUE (project_id, version)
);
CREATE INDEX IF NOT EXISTS scripts_project_idx ON scripts (project_id);

DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'studio_app') THEN
    ALTER TABLE scripts OWNER TO studio_app;
  END IF;
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon') THEN
    ALTER TABLE scripts ENABLE ROW LEVEL SECURITY;
    REVOKE ALL ON scripts FROM anon, authenticated;
  END IF;
END $$;
