-- 001: fields for real platform connections
ALTER TABLE social_accounts ADD COLUMN IF NOT EXISTS refresh_expires_at timestamptz;
ALTER TABLE social_accounts ADD COLUMN IF NOT EXISTS display_name text;
ALTER TABLE social_accounts ADD COLUMN IF NOT EXISTS avatar_url text;
ALTER TABLE social_accounts ADD COLUMN IF NOT EXISTS last_sync_error text;
ALTER TABLE posts ADD COLUMN IF NOT EXISTS thumbnail_url text;
