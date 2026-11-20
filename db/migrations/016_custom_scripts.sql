-- 016: no-AI custom scripts (Dapur Konten "Your own script" studio).
-- direction: the episode's plain-text direction / pacing notes (pause, BGM, ducking, CTA), parsed by fixed rules in
--   video/src/direction.ts at render time. NULL for writers'-room scripts.
-- custom: true when the user wrote the script themselves and it was parsed without AI (the Beat Inspector edits it).
-- Per-line timing, SFX, callouts and overlays live inside the existing jsonb `lines` (start_s, end_s, sfx, ...).
ALTER TABLE scripts ADD COLUMN IF NOT EXISTS direction text;
ALTER TABLE scripts ADD COLUMN IF NOT EXISTS custom boolean NOT NULL DEFAULT false;
