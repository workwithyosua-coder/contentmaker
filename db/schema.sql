-- =====================================================================
-- Auto Content Creation Platform — PostgreSQL 16 schema
-- Single-owner today, multi-user-ready (every row hangs off users.id).
-- Requires: pgvector (Supabase / Neon / RDS all ship it).
-- =====================================================================

CREATE EXTENSION IF NOT EXISTS pgcrypto;   -- gen_random_uuid()
CREATE EXTENSION IF NOT EXISTS vector;     -- embeddings for "what's similar to my winners"

-- ---------------------------------------------------------------------
-- ENUMS
-- ---------------------------------------------------------------------
CREATE TYPE platform_t        AS ENUM ('instagram','tiktok','youtube','linkedin','x','facebook','threads');
CREATE TYPE content_format_t  AS ENUM ('short_video','long_video','carousel','image','text','story');
CREATE TYPE project_status_t  AS ENUM (
  'draft',              -- direction given
  'ideating',           -- Strategist generating concepts
  'awaiting_concept',   -- user picks a concept            (HUMAN GATE 1)
  'scripting',          -- Writers' room researching + writing the dialogue
  'awaiting_script_approval', -- user approves/edits the Uco & Ocu script
  'captioning',         -- Copywriter writing platform captions
  'awaiting_recording', -- user records the voice lines
  'recorded',           -- every line has a selected take
  'awaiting_footage',   -- user uploads raw clips (or AI b-roll)
  'analyzing',          -- transcribe / scene detect
  'awaiting_style',     -- user picks an editing style      (HUMAN GATE 2)
  'awaiting_caption',   -- user picks a caption             (HUMAN GATE 3)
  'editing',            -- Editor agent building EDL + rendering
  'qa',                 -- QA agent reviewing render
  'awaiting_manual_edit', -- optional: you're polishing it in CapCut (handoff_packages)
  'awaiting_approval',  -- final human approval             (HUMAN GATE 4)
  'scheduled','published','failed','archived');
CREATE TYPE asset_kind_t      AS ENUM ('raw_footage','broll','music','sfx','voiceover','image','logo','font','preview','render','thumbnail',
                                       'design_export','overlay','captions_srt','handoff_zip');
CREATE TYPE design_tool_t     AS ENUM ('canva','figma','capcut');
CREATE TYPE job_status_t      AS ENUM ('queued','running','succeeded','failed','cancelled');
CREATE TYPE post_status_t     AS ENUM ('scheduled','publishing','published','failed','deleted');
CREATE TYPE verdict_t         AS ENUM ('winner','above_avg','average','below_avg','underperformer','too_early');
CREATE TYPE agent_name_t      AS ENUM ('orchestrator','analyst','strategist','creative_director','copywriter','editor','qa');

-- ---------------------------------------------------------------------
-- IDENTITY, ACCOUNTS, BRAND
-- ---------------------------------------------------------------------
CREATE TABLE users (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  email         text UNIQUE NOT NULL,
  display_name  text,
  timezone      text NOT NULL DEFAULT 'UTC',
  created_at    timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE social_accounts (
  id                    uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id               uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  platform              platform_t NOT NULL,
  handle                text NOT NULL,
  external_account_id   text NOT NULL,              -- IG user id, YT channel id, ...
  access_token_enc      bytea,                      -- encrypted (app-level KMS / pgsodium); never plaintext
  refresh_token_enc     bytea,
  token_expires_at      timestamptz,
  scopes                text[],
  is_active             boolean NOT NULL DEFAULT true,
  last_synced_at        timestamptz,
  refresh_expires_at    timestamptz,
  display_name          text,
  avatar_url            text,
  last_sync_error       text,
  created_at            timestamptz NOT NULL DEFAULT now(),
  UNIQUE (platform, external_account_id)
);

CREATE TABLE brand_kits (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id          uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  name             text NOT NULL,
  voice_guide      text,                 -- tone, words you use / never use
  banned_phrases   text[] DEFAULT '{}',
  colors           jsonb DEFAULT '{}',   -- {"primary":"#..","accent":"#.."}
  fonts            jsonb DEFAULT '{}',   -- {"caption":"Montserrat Black", ...}
  logo_asset_id    uuid,                 -- FK added after media_assets
  default_cta      text,
  is_default       boolean NOT NULL DEFAULT false,
  -- Source of truth for colors/fonts lives in Canva or Figma; a sync job copies it here.
  canva_brand_kit_id text,
  figma_file_key     text,
  synced_from        design_tool_t,
  synced_at          timestamptz,
  created_at       timestamptz NOT NULL DEFAULT now()
);

-- OAuth connections to your design tools (Canva Connect API, Figma REST API).
-- CapCut has no official API, so it normally has no row here.
CREATE TABLE design_tool_connections (
  id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id            uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  tool               design_tool_t NOT NULL,
  external_user_id   text,
  plan_tier          text,          -- 'pro' | 'teams' | 'enterprise': gates Canva autofill / Figma variables
  access_token_enc   bytea,
  refresh_token_enc  bytea,
  token_expires_at   timestamptz,
  scopes             text[],
  is_active          boolean NOT NULL DEFAULT true,
  created_at         timestamptz NOT NULL DEFAULT now(),
  UNIQUE (user_id, tool)
);

-- ---------------------------------------------------------------------
-- DIRECTION -> PROJECT -> OPTIONS  (the creation pipeline)
-- ---------------------------------------------------------------------
-- "I give direction on what kind of content I want to make"
CREATE TABLE content_directions (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id          uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  brand_kit_id     uuid REFERENCES brand_kits(id),
  title            text NOT NULL,
  prompt           text NOT NULL,                  -- your raw words
  goal             text,                           -- awareness / followers / leads / sales
  target_audience  text,
  pillars          text[] DEFAULT '{}',            -- content pillars / topics
  platforms        platform_t[] NOT NULL,
  formats          content_format_t[] NOT NULL DEFAULT '{short_video}',
  cadence_per_week int,
  constraints      jsonb DEFAULT '{}',             -- {"max_duration_s":45,"language":"en"}
  is_active        boolean NOT NULL DEFAULT true,
  created_at       timestamptz NOT NULL DEFAULT now()
);

-- One piece of content moving through the pipeline.
CREATE TABLE content_projects (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id             uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  direction_id        uuid REFERENCES content_directions(id) ON DELETE SET NULL,
  title               text,
  format              content_format_t NOT NULL DEFAULT 'short_video',
  target_platforms    platform_t[] NOT NULL,
  status              project_status_t NOT NULL DEFAULT 'draft',
  selected_concept_id uuid,   -- FKs added below (circular refs)
  selected_style_id   uuid,
  selected_caption_id uuid,
  workflow_run_id     text,   -- id in Inngest / Trigger.dev / Temporal
  last_error          text,   -- set when a background step (ideas, script) fails
  created_at          timestamptz NOT NULL DEFAULT now(),
  updated_at          timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX ON content_projects (user_id, status);

-- Strategist output: hooks / angles / outlines
CREATE TABLE concepts (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id      uuid NOT NULL REFERENCES content_projects(id) ON DELETE CASCADE,
  title           text NOT NULL,
  hook            text NOT NULL,
  hook_type       text,              -- question / contrarian / listicle / story / POV / tutorial
  outline         jsonb NOT NULL,    -- [{"beat":1,"say":"...","show":"..."}]
  shot_list       jsonb,             -- what to film if you still need footage
  rationale       text,              -- why it should work, citing insights
  cited_insight_ids uuid[] DEFAULT '{}',
  predicted_score numeric(4,3),      -- 0..1 from Analyst
  embedding       vector(1024),
  rank            int,
  is_selected     boolean NOT NULL DEFAULT false,
  created_at      timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX ON concepts (project_id);

-- Library of editing styles = parameterised render templates.
CREATE TABLE editing_styles (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id          uuid REFERENCES users(id) ON DELETE CASCADE,  -- NULL = built-in
  slug             text NOT NULL,
  name             text NOT NULL,             -- "Fast-cut Hormozi-style captions", "Calm vlog", ...
  description      text,
  template_id      text NOT NULL,             -- Remotion composition id / Shotstack template id
  design_source    design_tool_t,             -- where the look was designed (Figma frame / Canva template)
  design_ref       text,                      -- figma "fileKey:nodeId" or Canva brand-template id
  params           jsonb NOT NULL,            -- defaults: pace, cut_rate, zoom_punch, caption_style,
                                              --   font, colors, transitions, music_mood, sfx, broll_density
  example_asset_id uuid,
  is_active        boolean NOT NULL DEFAULT true,
  created_at       timestamptz NOT NULL DEFAULT now(),
  UNIQUE (user_id, slug)
);

-- The 2-4 styles offered for one project, each with a 5-8s preview render.
CREATE TABLE style_options (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id       uuid NOT NULL REFERENCES content_projects(id) ON DELETE CASCADE,
  editing_style_id uuid NOT NULL REFERENCES editing_styles(id),
  param_overrides  jsonb DEFAULT '{}',
  preview_asset_id uuid,
  rationale        text,           -- "fast-cut styles get 1.8x your median completion rate"
  rank             int,
  is_selected      boolean NOT NULL DEFAULT false,
  created_at       timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX ON style_options (project_id);

-- Caption / copy options, per platform.
CREATE TABLE caption_options (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id       uuid NOT NULL REFERENCES content_projects(id) ON DELETE CASCADE,
  platform         platform_t NOT NULL,
  variant_label    text,           -- "short & punchy", "storytelling", "SEO"
  on_screen_hook   text,           -- text burned into the first 2 seconds
  caption          text NOT NULL,
  hashtags         text[] DEFAULT '{}',
  cta              text,
  title            text,           -- YouTube title
  rationale        text,
  rank             int,
  is_selected      boolean NOT NULL DEFAULT false,
  created_at       timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX ON caption_options (project_id, platform);

ALTER TABLE content_projects
  ADD CONSTRAINT fk_sel_concept FOREIGN KEY (selected_concept_id) REFERENCES concepts(id)        ON DELETE SET NULL,
  ADD CONSTRAINT fk_sel_style   FOREIGN KEY (selected_style_id)   REFERENCES style_options(id)   ON DELETE SET NULL,
  ADD CONSTRAINT fk_sel_caption FOREIGN KEY (selected_caption_id) REFERENCES caption_options(id) ON DELETE SET NULL;

-- Dialogue scripts for Uco & Ocu episodes
CREATE TABLE IF NOT EXISTS scripts (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id      uuid NOT NULL REFERENCES content_projects(id) ON DELETE CASCADE,
  concept_id      uuid REFERENCES concepts(id) ON DELETE SET NULL,
  version         int NOT NULL,
  title           text NOT NULL,
  language        text NOT NULL DEFAULT 'id',
  subtitle_language text DEFAULT 'en',
  target_duration_s int,
  lines           jsonb NOT NULL,   -- [{beat, speaker:'uco'|'ocu', text, subtitle, expression, visual, on_screen_text}]
  fact_sheet      text,             -- research notes the script was written from
  sources         jsonb DEFAULT '[]', -- [{claim, url}]
  feedback        text,             -- the owner's notes that produced this version
  approved_at     timestamptz,
  created_at      timestamptz NOT NULL DEFAULT now(),
  UNIQUE (project_id, version)
);
CREATE INDEX IF NOT EXISTS scripts_project_idx ON scripts (project_id);


-- Voice recordings for scripts (one or more takes per line)
CREATE TABLE IF NOT EXISTS recordings (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id    uuid NOT NULL REFERENCES content_projects(id) ON DELETE CASCADE,
  script_id     uuid NOT NULL REFERENCES scripts(id) ON DELETE CASCADE,
  line_index    int NOT NULL,
  speaker       text NOT NULL,                -- 'uco' | 'ocu' (IP character)
  take          int NOT NULL,
  storage_path  text NOT NULL,                -- path in the private 'recordings' bucket
  mime_type     text NOT NULL,
  size_bytes    int,
  duration_ms   int,
  source        text NOT NULL DEFAULT 'booth', -- 'booth' (recorded in the app) | 'upload'
  is_selected   boolean NOT NULL DEFAULT true,
  created_at    timestamptz NOT NULL DEFAULT now(),
  UNIQUE (script_id, line_index, take)
);
CREATE INDEX IF NOT EXISTS recordings_script_idx ON recordings (script_id, line_index);


-- ---------------------------------------------------------------------
-- MEDIA
-- ---------------------------------------------------------------------
CREATE TABLE media_assets (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id        uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  project_id     uuid REFERENCES content_projects(id) ON DELETE SET NULL,
  kind           asset_kind_t NOT NULL,
  storage_key    text NOT NULL,          -- s3://bucket/key or r2 path
  mime_type      text,
  size_bytes     bigint,
  duration_s     numeric(8,3),
  width          int,
  height         int,
  fps            numeric(6,3),
  sha256         text,
  source         text,                   -- 'upload' | 'generated:veo' | 'stock:pexels' | 'render'
  license        text,
  created_at     timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX ON media_assets (project_id, kind);
CREATE UNIQUE INDEX ON media_assets (user_id, sha256) WHERE sha256 IS NOT NULL;

ALTER TABLE brand_kits     ADD CONSTRAINT fk_logo    FOREIGN KEY (logo_asset_id)    REFERENCES media_assets(id) ON DELETE SET NULL;
ALTER TABLE editing_styles ADD CONSTRAINT fk_example FOREIGN KEY (example_asset_id) REFERENCES media_assets(id) ON DELETE SET NULL;
ALTER TABLE style_options  ADD CONSTRAINT fk_preview FOREIGN KEY (preview_asset_id) REFERENCES media_assets(id) ON DELETE SET NULL;

-- Machine understanding of footage (what the Editor agent "sees").
CREATE TABLE asset_analyses (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  asset_id         uuid NOT NULL UNIQUE REFERENCES media_assets(id) ON DELETE CASCADE,
  transcript       jsonb,      -- [{"w":"hello","start":0.12,"end":0.40,"conf":0.98}]
  language         text,
  scenes           jsonb,      -- [{"start":0,"end":3.2,"keyframe_key":"..."}]
  silences         jsonb,      -- [{"start":..,"end":..}] for jump-cut removal
  faces_track      jsonb,      -- per-second face bbox for 9:16 auto-reframe
  loudness_lufs    numeric(5,2),
  visual_summary   text,       -- Claude's description from sampled keyframes
  highlights       jsonb,      -- Claude-ranked best moments
  embedding        vector(1024),
  created_at       timestamptz NOT NULL DEFAULT now()
);

-- ---------------------------------------------------------------------
-- EDITING & RENDERING
-- ---------------------------------------------------------------------
-- Edit Decision List produced by the Editor agent; versioned so QA feedback creates v2, v3...
CREATE TABLE edit_plans (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id    uuid NOT NULL REFERENCES content_projects(id) ON DELETE CASCADE,
  version       int NOT NULL,
  style_option_id uuid REFERENCES style_options(id),
  edl           jsonb NOT NULL,   -- timeline: clips (asset_id,in,out), captions (word-timed),
                                  -- zooms, broll overlays, music (asset_id, duck), sfx, transitions
  target_duration_s numeric(6,2),
  feedback      text,             -- your notes or QA notes that triggered this version
  created_by    agent_name_t NOT NULL DEFAULT 'editor',
  created_at    timestamptz NOT NULL DEFAULT now(),
  UNIQUE (project_id, version)
);

CREATE TABLE renders (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  edit_plan_id    uuid NOT NULL REFERENCES edit_plans(id) ON DELETE CASCADE,
  platform        platform_t,          -- per-platform variant (safe zones, length)
  aspect_ratio    text NOT NULL,       -- '9:16' | '1:1' | '16:9' | '4:5'
  status          job_status_t NOT NULL DEFAULT 'queued',
  renderer        text,                -- 'remotion-lambda' | 'ffmpeg-worker' | 'shotstack' | 'canva' | 'capcut-manual'
  output_asset_id uuid REFERENCES media_assets(id),
  thumbnail_asset_id uuid REFERENCES media_assets(id),
  qa_passed       boolean,
  qa_report       jsonb,               -- {"issues":[{"t":3.2,"type":"caption_overlap","severity":"high"}]}
  error           text,
  started_at      timestamptz,
  finished_at     timestamptz,
  created_at      timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX ON renders (edit_plan_id);

-- ---------------------------------------------------------------------
-- DESIGN TOOLS: Canva / Figma designs and CapCut handoffs
-- ---------------------------------------------------------------------
-- Any design the platform creates or reads in Canva or Figma:
-- thumbnails, carousels, covers, caption/lower-third overlays, style templates.
CREATE TABLE external_designs (
  id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id            uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  project_id         uuid REFERENCES content_projects(id) ON DELETE CASCADE,
  tool               design_tool_t NOT NULL,
  purpose            text NOT NULL,   -- 'thumbnail' | 'carousel' | 'cover' | 'overlay' | 'style_template' | 'brand'
  external_id        text NOT NULL,   -- Canva design id, or Figma "fileKey:nodeId"
  source_template_id text,            -- Canva brand template used for autofill
  autofill_data      jsonb,           -- the text/image fields the agent filled in
  edit_url           text,            -- "open in Canva/Figma" link for manual tweaks
  version            int NOT NULL DEFAULT 1,
  is_selected        boolean NOT NULL DEFAULT false,
  exported_asset_id  uuid REFERENCES media_assets(id) ON DELETE SET NULL,  -- PNG/MP4/PDF pulled back into storage
  last_synced_at     timestamptz,
  created_at         timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tool, external_id, version)
);
CREATE INDEX ON external_designs (project_id, purpose);

-- CapCut round trip: the platform packages the edit, you finish it in CapCut, you upload the export.
CREATE TABLE handoff_packages (
  id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id         uuid NOT NULL REFERENCES content_projects(id) ON DELETE CASCADE,
  edit_plan_id       uuid REFERENCES edit_plans(id) ON DELETE SET NULL,
  tool               design_tool_t NOT NULL DEFAULT 'capcut',
  method             text NOT NULL DEFAULT 'asset_bundle', -- 'asset_bundle' (official, safe) | 'draft_file' (unofficial CapCut draft JSON)
  package_asset_id   uuid REFERENCES media_assets(id),     -- zip: trimmed clips, music, overlays, cut list
  captions_asset_id  uuid REFERENCES media_assets(id),     -- .srt with word-timed captions
  instructions_md    text,                                 -- human-readable cut list / what to polish
  status             text NOT NULL DEFAULT 'sent',         -- 'sent' | 'returned' | 'abandoned'
  returned_asset_id  uuid REFERENCES media_assets(id),     -- your final CapCut export, uploaded back
  sent_at            timestamptz NOT NULL DEFAULT now(),
  returned_at        timestamptz
);
CREATE INDEX ON handoff_packages (project_id);

-- ---------------------------------------------------------------------
-- PUBLISHING
-- ---------------------------------------------------------------------
CREATE TABLE posts (
  id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id            uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  social_account_id  uuid NOT NULL REFERENCES social_accounts(id) ON DELETE CASCADE,
  project_id         uuid REFERENCES content_projects(id) ON DELETE SET NULL,  -- NULL for imported historic posts
  render_id          uuid REFERENCES renders(id),
  caption_option_id  uuid REFERENCES caption_options(id),
  design_id          uuid REFERENCES external_designs(id),  -- carousel/image posts made in Canva or Figma
  thumbnail_design_id uuid REFERENCES external_designs(id),
  edited_in          design_tool_t,                         -- NULL = fully automatic; 'capcut' = you polished it
  platform           platform_t NOT NULL,
  format             content_format_t,
  external_post_id   text,
  permalink          text,
  thumbnail_url      text,
  caption_text       text,          -- exactly what went live
  duration_s         numeric(8,3),
  status             post_status_t NOT NULL DEFAULT 'scheduled',
  scheduled_at       timestamptz,
  published_at       timestamptz,
  error              text,
  created_at         timestamptz NOT NULL DEFAULT now(),
  UNIQUE (platform, external_post_id)
);
CREATE INDEX ON posts (social_account_id, published_at DESC);

-- Features used for "what's working" attribution. One row per post.
-- Filled automatically for generated posts; by the Analyst (vision + transcript) for imported posts.
CREATE TABLE post_features (
  post_id           uuid PRIMARY KEY REFERENCES posts(id) ON DELETE CASCADE,
  pillar            text,
  topic             text,
  hook_type         text,
  hook_text         text,
  editing_style_id  uuid REFERENCES editing_styles(id),
  thumbnail_template text,       -- which Canva/Figma template: lets the Analyst compare thumbnails
  manually_edited   boolean,     -- did a CapCut pass beat fully automatic edits?
  duration_bucket   text,        -- '<15s','15-30s','30-60s','60s+'
  has_face_in_first_2s boolean,
  has_on_screen_text   boolean,
  has_trending_audio   boolean,
  cta_type          text,
  posted_dow        smallint,    -- 0..6 in user tz
  posted_hour       smallint,
  extra             jsonb DEFAULT '{}',
  embedding         vector(1024) -- of transcript + caption: "find posts like my winners"
);

-- ---------------------------------------------------------------------
-- METRICS (time-series)
-- ---------------------------------------------------------------------
-- Snapshots at ~1h, 6h, 24h, 72h, 7d, 30d after publish, then weekly.
CREATE TABLE post_metric_snapshots (
  post_id              uuid NOT NULL REFERENCES posts(id) ON DELETE CASCADE,
  captured_at          timestamptz NOT NULL,
  hours_since_publish  numeric(8,2) NOT NULL,
  views                bigint,
  reach                bigint,
  impressions          bigint,
  likes                bigint,
  comments             bigint,
  shares               bigint,
  saves                bigint,
  follows_gained       bigint,
  profile_visits       bigint,
  link_clicks          bigint,
  watch_time_s         numeric(14,2),
  avg_view_duration_s  numeric(8,2),
  completion_rate      numeric(5,4),  -- 0..1
  retention_curve      jsonb,         -- [[0,1.0],[1,0.82],...] when platform exposes it
  raw                  jsonb,         -- full API payload, for metrics we didn't model yet
  PRIMARY KEY (post_id, captured_at)
);
-- At scale: convert to a TimescaleDB hypertable or partition by month.

CREATE TABLE account_metric_daily (
  social_account_id  uuid NOT NULL REFERENCES social_accounts(id) ON DELETE CASCADE,
  day                date NOT NULL,
  followers          bigint,
  followers_delta    bigint,
  reach              bigint,
  impressions        bigint,
  profile_visits     bigint,
  audience           jsonb,   -- demographics / top countries when available
  PRIMARY KEY (social_account_id, day)
);

-- Latest snapshot per post + normalised scores. Refresh after each metrics sync:
--   REFRESH MATERIALIZED VIEW CONCURRENTLY post_performance;
CREATE MATERIALIZED VIEW post_performance AS
WITH latest AS (
  SELECT DISTINCT ON (s.post_id) s.*
  FROM post_metric_snapshots s
  ORDER BY s.post_id, s.captured_at DESC
),
base AS (
  SELECT p.id AS post_id, p.user_id, p.social_account_id, p.platform, p.format, p.published_at,
         l.hours_since_publish, COALESCE(l.views, l.reach) AS views, l.likes, l.comments, l.shares, l.saves,
         l.follows_gained, l.completion_rate, l.avg_view_duration_s,
         -- engagement per view: weights shares/saves higher (strong distribution signals)
         CASE WHEN COALESCE(l.views, l.reach, 0) = 0 THEN NULL
              ELSE (COALESCE(l.likes,0) + 2*COALESCE(l.comments,0)
                    + 3*COALESCE(l.shares,0) + 3*COALESCE(l.saves,0))::numeric / COALESCE(l.views, l.reach) END
           AS weighted_engagement_rate
  FROM posts p
  JOIN latest l ON l.post_id = p.id
  WHERE p.status = 'published'
),
ranked AS (
  -- percentile vs. YOUR OWN posts on the same account+format (not vs. the internet)
  SELECT b.*,
         percent_rank() OVER (PARTITION BY social_account_id, format ORDER BY views NULLS FIRST)                    AS views_pctl,
         percent_rank() OVER (PARTITION BY social_account_id, format ORDER BY weighted_engagement_rate NULLS FIRST) AS engagement_pctl,
         percent_rank() OVER (PARTITION BY social_account_id, format ORDER BY completion_rate NULLS FIRST)          AS completion_pctl
  FROM base b
),
composite AS (
  SELECT r.*, (0.4*views_pctl + 0.35*engagement_pctl + 0.25*completion_pctl) AS composite_raw
  FROM ranked r
),
scored AS (
  -- Re-rank the blended score so 0.5 = your typical post and "winner" = your top 15%
  -- (averaging three percentiles otherwise squeezes everything toward the middle).
  SELECT c.*,
         round(percent_rank() OVER (PARTITION BY social_account_id, format ORDER BY composite_raw)::numeric, 3)
           AS performance_score
  FROM composite c
)
SELECT s.*,
       CASE
         WHEN hours_since_publish < 48 THEN 'too_early'::verdict_t
         WHEN performance_score >= 0.85 THEN 'winner'
         WHEN performance_score >= 0.65 THEN 'above_avg'
         WHEN performance_score >= 0.35 THEN 'average'
         WHEN performance_score >= 0.15 THEN 'below_avg'
         ELSE 'underperformer'
       END AS verdict
FROM scored s;
CREATE UNIQUE INDEX ON post_performance (post_id);
CREATE INDEX ON post_performance (user_id, platform, verdict);

-- ---------------------------------------------------------------------
-- LEARNING LOOP
-- ---------------------------------------------------------------------
-- Analyst agent writes findings; Strategist / Creative Director / Copywriter read them.
CREATE TABLE insights (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id       uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  platform      platform_t,                -- NULL = cross-platform
  dimension     text NOT NULL,             -- 'hook_type' | 'editing_style' | 'duration' | 'topic' | 'post_time' ...
  finding       text NOT NULL,             -- "Contrarian hooks get 2.3x median views on TikTok"
  effect_size   numeric(8,3),              -- e.g. lift vs. baseline (2.3)
  sample_size   int NOT NULL,
  confidence    numeric(4,3),              -- 0..1; don't act on n<5
  evidence      jsonb,                     -- {"post_ids":[...],"query":"..."}
  recommendation text,
  status        text NOT NULL DEFAULT 'active',  -- active | superseded | dismissed
  valid_from    timestamptz NOT NULL DEFAULT now(),
  superseded_by uuid REFERENCES insights(id),
  created_at    timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX ON insights (user_id, status, platform);

-- Weekly report the dashboard shows at the top
CREATE TABLE performance_reports (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id      uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  period_start date NOT NULL,
  period_end   date NOT NULL,
  summary_md   text NOT NULL,
  kpis         jsonb NOT NULL,
  insight_ids  uuid[] DEFAULT '{}',
  created_at   timestamptz NOT NULL DEFAULT now()
);

-- ---------------------------------------------------------------------
-- AGENT OBSERVABILITY & HUMAN DECISIONS
-- ---------------------------------------------------------------------
CREATE TABLE agent_runs (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  parent_run_id   uuid REFERENCES agent_runs(id),
  project_id      uuid REFERENCES content_projects(id) ON DELETE CASCADE,
  agent           agent_name_t NOT NULL,
  model           text NOT NULL,           -- e.g. claude-opus-5-5
  prompt_version  text,                    -- git sha / semver of the agent prompt
  input           jsonb,
  output          jsonb,
  status          job_status_t NOT NULL DEFAULT 'running',
  input_tokens    int,
  output_tokens   int,
  cache_read_tokens int,
  cost_usd        numeric(10,5),
  error           text,
  started_at      timestamptz NOT NULL DEFAULT now(),
  finished_at     timestamptz
);
CREATE INDEX ON agent_runs (project_id, agent);

-- Every human choice/rejection: audit trail AND training signal for better options next time.
CREATE TABLE decisions (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id  uuid NOT NULL REFERENCES content_projects(id) ON DELETE CASCADE,
  gate        text NOT NULL,            -- 'concept' | 'style' | 'caption' | 'final_approval'
  chosen_id   uuid,
  rejected_ids uuid[] DEFAULT '{}',
  feedback    text,                     -- "less corporate", "captions too big"
  decided_at  timestamptz NOT NULL DEFAULT now()
);

-- Generic background job ledger (renders, metric syncs, publishes) if you don't use a hosted queue UI.
CREATE TABLE jobs (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  type         text NOT NULL,            -- 'sync_metrics' | 'render' | 'publish' | 'analyze_asset'
  payload      jsonb NOT NULL,
  status       job_status_t NOT NULL DEFAULT 'queued',
  attempts     int NOT NULL DEFAULT 0,
  run_after    timestamptz NOT NULL DEFAULT now(),
  last_error   text,
  created_at   timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX ON jobs (status, run_after);


-- 007: rendered episode videos (animated Uco & Ocu over the recorded voices)
CREATE TABLE IF NOT EXISTS episode_videos (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id    uuid NOT NULL REFERENCES content_projects(id) ON DELETE CASCADE,
  script_id     uuid NOT NULL REFERENCES scripts(id) ON DELETE CASCADE,
  storage_path  text NOT NULL,                -- path in the private 'recordings' bucket
  size_bytes    int,
  duration_ms   int,
  renderer      text NOT NULL DEFAULT 'remotion',
  created_at    timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS episode_videos_project_idx ON episode_videos (project_id, created_at DESC);

DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'studio_app') THEN
    ALTER TABLE episode_videos OWNER TO studio_app;
  END IF;
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon') THEN
    ALTER TABLE episode_videos ENABLE ROW LEVEL SECURITY;
    REVOKE ALL ON episode_videos FROM anon, authenticated;
  END IF;
END $$;
