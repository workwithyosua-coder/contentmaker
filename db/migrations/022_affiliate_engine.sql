-- Affiliate engine: the Affiliate Product Bank, per-episode affiliate links and distribution copy, and hand-logged
-- affiliate conversions (TikTok Shop, Shopee Video, Instagram bio, YouTube pinned comment).
--   affiliate_products       the bank a scheduled Affiliate Debate picks from (least recently used active product)
--   affiliate_conversions    clicks / orders / commission the owner logs per episode and platform
--   episode_queue            .affiliate_product_id: a slot pinned to one product (else the rotation picks)
--   content_projects         .affiliate_product_id, .pinned_comment, .affiliate_handoff_note: what the episode sold
--                            and its ready-to-paste pinned comment and TikTok Shop / Shopee posting checklist
-- (The app's "episodes" are content_projects and its schedule slots are episode_queue.)
-- Plain tables, columns, CHECK constraints, foreign keys and indexes only: nothing session-scoped, so it runs on
-- Supabase's transaction pooler (port 6543). Safe to run more than once. Until it is applied, scheduled episodes run
-- as before: an Affiliate Debate slot falls back to a regular Comedy Debate.

CREATE TABLE IF NOT EXISTS affiliate_products (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL CHECK (length(btrim(name)) BETWEEN 1 AND 120),
  category text NOT NULL CHECK (length(btrim(category)) BETWEEN 1 AND 40),
  problem_angle text NOT NULL CHECK (length(btrim(problem_angle)) BETWEEN 3 AND 300),
  price_idr integer NOT NULL CHECK (price_idr > 0),
  commission_pct numeric(5, 2) CHECK (commission_pct >= 0 AND commission_pct <= 100),
  tiktok_shop_url text CHECK (tiktok_shop_url IS NULL OR tiktok_shop_url ~ '^https://'),
  shopee_url text CHECK (shopee_url IS NULL OR shopee_url ~ '^https://'),
  prop_slug text,
  status text NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'paused', 'out_of_stock')),
  times_used integer NOT NULL DEFAULT 0 CHECK (times_used >= 0),
  last_used_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
-- the rotation: active products, never used first, then the longest unused
CREATE INDEX IF NOT EXISTS affiliate_products_rotation_idx ON affiliate_products (status, last_used_at NULLS FIRST, created_at);

CREATE TABLE IF NOT EXISTS affiliate_conversions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  episode_id uuid NOT NULL REFERENCES content_projects(id) ON DELETE CASCADE,
  affiliate_product_id uuid REFERENCES affiliate_products(id) ON DELETE SET NULL,
  platform text NOT NULL CHECK (platform IN ('tiktok_shop', 'shopee_video', 'instagram_bio', 'youtube_pinned')),
  clicks integer NOT NULL DEFAULT 0 CHECK (clicks >= 0),
  orders integer NOT NULL DEFAULT 0 CHECK (orders >= 0),
  commission_idr integer NOT NULL DEFAULT 0 CHECK (commission_idr >= 0),
  recorded_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS affiliate_conversions_episode_idx ON affiliate_conversions (episode_id, recorded_at DESC);

ALTER TABLE episode_queue ADD COLUMN IF NOT EXISTS affiliate_product_id uuid REFERENCES affiliate_products(id) ON DELETE SET NULL;
ALTER TABLE content_projects ADD COLUMN IF NOT EXISTS affiliate_product_id uuid REFERENCES affiliate_products(id) ON DELETE SET NULL;
ALTER TABLE content_projects ADD COLUMN IF NOT EXISTS pinned_comment text;
ALTER TABLE content_projects ADD COLUMN IF NOT EXISTS affiliate_handoff_note text;

DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'studio_app') THEN
    ALTER TABLE affiliate_products OWNER TO studio_app;
    ALTER TABLE affiliate_conversions OWNER TO studio_app;
  END IF;
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon') THEN
    ALTER TABLE affiliate_products ENABLE ROW LEVEL SECURITY;
    ALTER TABLE affiliate_conversions ENABLE ROW LEVEL SECURITY;
    REVOKE ALL ON affiliate_products FROM anon, authenticated;
    REVOKE ALL ON affiliate_conversions FROM anon, authenticated;
  END IF;
END $$;
