-- 014: render progress (the renderer reports a percentage and the current stage while it works)
ALTER TABLE render_jobs ADD COLUMN IF NOT EXISTS progress smallint;
ALTER TABLE render_jobs ADD COLUMN IF NOT EXISTS stage text;
ALTER TABLE render_jobs ADD COLUMN IF NOT EXISTS started_at timestamptz;
