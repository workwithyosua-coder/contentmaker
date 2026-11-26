-- The visual style of scheduled episodes (Schedule page → Visual style). Koran Kinetik by default: the illustrated
-- PNG cast, generated props, callout badges, stat / explainer cards and lower-safe-zone subtitles. The legacy
-- "2D Vertical Comic" (procedural SVG) is not allowed here. Safe to run more than once.
ALTER TABLE content_schedules ADD COLUMN IF NOT EXISTS visual_style text NOT NULL DEFAULT 'editorial-paper-cutout';

DO $$ BEGIN
  ALTER TABLE content_schedules ADD CONSTRAINT content_schedules_visual_style_check CHECK (visual_style IN ('editorial-paper-cutout', 'tactical-vector-hud'));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
