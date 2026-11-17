-- 009: AI voices (ElevenLabs voice clones of the owner, one per character)
CREATE TABLE IF NOT EXISTS voice_profiles (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id     uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  speaker     text NOT NULL,                 -- 'uco' | 'ocu'
  provider    text NOT NULL DEFAULT 'elevenlabs',
  voice_id    text NOT NULL,                 -- the provider's voice id
  name        text,
  settings    jsonb NOT NULL DEFAULT '{}',   -- {stability, similarity_boost, style, model}
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now(),
  UNIQUE (user_id, speaker)
);

-- AI takes live in `recordings` like any other take (source = 'ai'), so the booth, renderer and upload stay the same.
ALTER TABLE recordings ADD COLUMN IF NOT EXISTS ai_prompt text;  -- exact text + delivery tags sent to the voice model

DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'studio_app') THEN
    ALTER TABLE voice_profiles OWNER TO studio_app;
  END IF;
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon') THEN
    ALTER TABLE voice_profiles ENABLE ROW LEVEL SECURITY;
    REVOKE ALL ON voice_profiles FROM anon, authenticated;
  END IF;
END $$;
