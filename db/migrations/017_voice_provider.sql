-- Voice provider and delivery preset per episode (PR 2: Gemini TTS as the free default voice).
--   voice_provider:  gemini_tts (default, free) | elevenlabs | gemini_tts_rvc (Own-Voice, wired in PR 3)
--   delivery_preset: standard | angry (Angry / Urgent: more urgent acting direction for every line)
ALTER TABLE content_projects
  ADD COLUMN IF NOT EXISTS voice_provider text NOT NULL DEFAULT 'gemini_tts',
  ADD COLUMN IF NOT EXISTS delivery_preset text NOT NULL DEFAULT 'standard';

DO $$ BEGIN
  ALTER TABLE content_projects ADD CONSTRAINT content_projects_voice_provider_check CHECK (voice_provider IN ('gemini_tts', 'elevenlabs', 'gemini_tts_rvc'));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  ALTER TABLE content_projects ADD CONSTRAINT content_projects_delivery_preset_check CHECK (delivery_preset IN ('standard', 'angry'));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
