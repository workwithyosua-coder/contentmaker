-- 015: no schema change needed for the Koran Kinetik / Diagram Taktis styles.
-- content_projects.video_style is plain text (012) with no enum, CHECK constraint or lookup table, so the new ids
-- 'editorial-paper-cutout' and 'tactical-vector-hud' are stored as-is; the app validates ids against
-- video/src/styles/registry.ts (unknown ids fall back to 'classic').
-- scripts.lines is jsonb: the new per-line important_message {kicker, headline, stamp} needs no migration either.
SELECT 1;
