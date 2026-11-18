-- 012: per-episode video style (video/STYLE.md = classic, video/styles/comic.md = comic)
ALTER TABLE content_projects ADD COLUMN IF NOT EXISTS video_style text NOT NULL DEFAULT 'classic';
