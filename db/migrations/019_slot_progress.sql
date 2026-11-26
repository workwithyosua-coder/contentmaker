-- Pipeline progress for the Schedule page's slot cards (PR: live pipeline progress bar). Reported by the GitHub worker
-- through POST /api/scheduler/slots/:id/progress (RENDER_TOKEN); never estimated by a timer.
--   progress_percent:    0-100, NULL while starting / indeterminate
--   progress_stage:      starting | scripting | props | voicing | converting_voice | rendering | uploading | done | failed
--   progress_detail:     the real step ("Voicing line 8 of 15", "Rendering video (64%)")
--   progress_updated_at: when the worker last reported
-- Safe to run more than once.
ALTER TABLE episode_queue
  ADD COLUMN IF NOT EXISTS progress_percent integer,
  ADD COLUMN IF NOT EXISTS progress_stage text,
  ADD COLUMN IF NOT EXISTS progress_detail text,
  ADD COLUMN IF NOT EXISTS progress_updated_at timestamptz;

DO $$ BEGIN
  ALTER TABLE episode_queue ADD CONSTRAINT episode_queue_progress_percent_check CHECK (progress_percent IS NULL OR progress_percent BETWEEN 0 AND 100);
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  ALTER TABLE episode_queue ADD CONSTRAINT episode_queue_progress_stage_check
    CHECK (progress_stage IS NULL OR progress_stage IN ('starting', 'scripting', 'props', 'voicing', 'converting_voice', 'rendering', 'uploading', 'done', 'failed'));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
