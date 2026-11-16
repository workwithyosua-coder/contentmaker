# Auto Content Platform — Architecture

Personal, multi-agent platform that (1) tracks what's working across your social accounts,
(2) turns your direction into concepts, (3) offers editing-style and caption options,
(4) edits the video itself, and (5) learns from results.

Schema: [`schema.sql`](./schema.sql), which has been tested against PostgreSQL 16 + pgvector.

---

## 1. Ground rules

1. **Agents decide, code executes.** Claude makes the creative and analytical calls: which hook, which cuts, which caption. Ordinary code handles anything that has to happen the same way every time: API calls, FFmpeg, rendering, publishing, metric syncs. This keeps the system cheap and keeps it from breaking in strange ways.
2. **Edits are data.** The Editor agent never touches pixels. It writes an **EDL (edit decision list)**, a JSON timeline, and a renderer turns that into an MP4. Re-edits and A/B variants then only need a JSON change.
3. **Human gates.** You approve the concept, style, caption and final cut. Once your choices and the agent's predictions agree often enough, you can switch gates to auto-approve.
4. **Closed loop.** Every post is tagged with its features (hook type, style, length, time…). The Analyst links performance back to those features, and those findings feed the next round of ideas.

---

## 2. System diagram

```
                         ┌────────────────────────── YOU ──────────────────────────┐
                         │  Dashboard · Direction form · Option pickers · Approve  │
                         └──────────────┬─────────────────────────────▲────────────┘
                                        │ Next.js web app (Vercel)    │ realtime status
                                        ▼                             │
┌──────────────────────────────── ORCHESTRATION (durable workflows: Inngest / Trigger.dev) ───────────────────────────────┐
│                                                                                                                          │
│  Direction ─► [Strategist] ─► GATE1 concept ─► upload footage ─► analyze ─► [Creative Director] ─► GATE2 style          │
│                    ▲                                                          │                                          │
│                    │ insights                              [Copywriter] ─► GATE3 caption                                │
│                    │                                                          ▼                                          │
│               [Analyst] ◄── metrics ◄── Publisher ◄── GATE4 approve ◄── [QA] ◄── render ◄── [Editor] (EDL)               │
│                                                                                                                          │
└──────┬───────────────────────┬──────────────────────────┬────────────────────────────┬─────────────────────────────────┘
       │                       │                          │                            │
       ▼                       ▼                          ▼                            ▼
┌──────────────┐   ┌─────────────────────┐   ┌──────────────────────────┐   ┌──────────────────────────────┐
│ Claude API   │   │ Media workers (GPU/ │   │ Social APIs               │   │ Data                          │
│ Opus 5.5     │   │ CPU container)      │   │ IG Graph · TikTok ·       │   │ Postgres + pgvector (schema)  │
│ Sonnet 5.5   │   │ FFmpeg · Whisper/   │   │ YouTube Data+Analytics ·  │   │ Object storage (R2/S3)        │
│ Haiku 5.5    │   │ Deepgram · Scene-   │   │ LinkedIn · X              │   │ Redis (cache/rate limits)     │
│              │   │ Detect · MediaPipe ·│   │ (or Ayrshare as one API)  │   │                               │
│              │   │ Remotion renderer   │   │                           │   │                               │
└──────────────┘   └─────────────────────┘   └──────────────────────────┘   └──────────────────────────────┘
```

---

## 3. How many agents: **6 Claude agents, plus deterministic services**

| # | Agent | Job | Reads | Writes | Model |
|---|---|---|---|---|---|
| 1 | **Orchestrator / Producer** | Turns your direction into a brief, runs the pipeline, handles your feedback ("make it punchier") by sending work back to the right agent | direction, project, decisions | `content_projects`, `agent_runs` | Opus 5.5 (effort medium) |
| 2 | **Analyst** | Imports post history, tags features (vision on keyframes + transcript), finds what's working, writes insights and the weekly report, scores concepts before you pick | `post_performance`, `post_features`, snapshots | `insights`, `post_features`, `performance_reports`, `concepts.predicted_score` | Opus 5.5 (high) for analysis; Haiku 5.5 for bulk tagging |
| 3 | **Strategist** | Direction + insights → 3–5 concepts (hook, outline, shot list, rationale citing insights) | `content_directions`, `insights`, similar winners (pgvector) | `concepts` | Opus 5.5 |
| 4 | **Creative Director** | Picks 2–4 editing styles from the library, tunes their parameters, triggers 5–8 s preview renders | `editing_styles`, `asset_analyses`, insights about styles | `style_options` | Sonnet 5.5 |
| 5 | **Copywriter** | Per-platform captions, on-screen hook text, hashtags, CTA, YT title; checks the brand voice | brand kit, concept, transcript, caption insights | `caption_options` | Sonnet 5.5 |
| 6 | **Editor** | Footage analysis + chosen style → EDL: best takes, removes silences and filler, word-timed captions, zoom punches, b-roll, music ducking, reframe to 9:16 | `asset_analyses`, `style_options`, `caption_options` | `edit_plans` | Opus 5.5 (high) |
| + | **QA** (can be a mode of the Editor) | Looks at sampled frames + the transcript of the render: caption overlap with platform UI, cut-off words, sync, banned phrases, loudness. Fails it back to the Editor with notes (max 2 loops) | `renders` | `renders.qa_report` | Opus 5.5 vision |

**Not agents** (plain code / jobs): metrics collector (cron), publisher/scheduler, renderer, transcription, scene detection, auto-reframe, token refresh.

**Leaner MVP: 3 agents.** (1) Analyst, (2) Creative, which merges Strategist, Creative Director and Copywriter into one agent with structured output, and (3) Editor with built-in QA. Split them out later when a single prompt starts holding back quality.

Each agent is a Claude API call with tools and **structured outputs** (JSON schema), so its results go straight into the tables above. Version every prompt (`agent_runs.prompt_version`) so you can see which prompt change moved your metrics.

---

## 4. End-to-end flow

| Step | What happens | Who | Status |
|---|---|---|---|
| 0 | Connect accounts with OAuth and import the last ~90 days of posts + metrics. The Analyst tags them and writes the first insights | Jobs + Analyst | — |
| 1 | You write a direction: *"3 TikToks/week on productivity for freelancers, contrarian, English captions"* | You | `draft` |
| 2 | The Strategist makes 3–5 concepts and the Analyst scores each against your history | Agents | `ideating` |
| 3 | **Gate 1**: pick a concept (or edit it). You get a shot list to film | You | `awaiting_concept` |
| 4 | Upload raw clips (or let the system use stock/AI b-roll only) | You | `awaiting_footage` |
| 5 | Workers transcribe (word timestamps), detect scenes and silences, track faces and sample keyframes. Claude writes a visual summary and highlights | Workers + Claude | `analyzing` |
| 6 | **Gate 2**: the Creative Director offers 2–4 styles, each with a short preview clip and a reason ("fast-cut gets 1.8× your median completion") | Agent + You | `awaiting_style` |
| 7 | **Gate 3**: the Copywriter offers 3 caption variants per platform | Agent + You | `awaiting_caption` |
| 8 | The Editor writes the EDL, the renderer outputs 9:16 (and other) variants, then QA checks and loops if needed | Agents + Renderer | `editing` → `qa` |
| 9 | **Gate 4**: watch, approve, or give feedback ("cut the intro") → new EDL version | You | `awaiting_approval` |
| 10 | The publisher schedules the post at the best time slot from the insights | Job | `scheduled` → `published` |
| 11 | Metric snapshots at 1h / 6h / 24h / 72h / 7d / 30d. `post_performance` gets refreshed and the Analyst updates insights | Jobs + Analyst | loop → step 2 |

---

## 5. Dashboard: "which one is working"

Raw views are misleading across platforms and account sizes, so the dashboard ranks each post **against your own baseline**
(percentile within the same account and format; see the `post_performance` materialized view):

- **Performance score** = 0.40·views percentile + 0.35·weighted-engagement percentile + 0.25·completion percentile.
  Weighted engagement = (likes + 2·comments + 3·shares + 3·saves) / views. Shares and saves are the strongest distribution signals.
- **Verdict**: winner / above avg / average / below avg / underperformer. Posts under 48 h old show "too early".
- **Views**: KPI tiles (followers Δ, reach, median score) · post grid coloured by verdict · "What's working" cards (from `insights`, with sample size) ·
  breakdowns by hook type, style, duration, topic and posting hour · retention curve per post · platform comparison.
- Insights with fewer than ~5 posts behind them are labelled *low confidence* so you don't over-learn from noise.

---

## 6. Tools you need besides Claude

### Must-have
| Need | Recommended | Alternatives / notes |
|---|---|---|
| App + dashboard | **Next.js** on Vercel, shadcn/ui + Recharts | Any React stack |
| Database | **Postgres + pgvector** (Supabase or Neon) | Supabase also gives auth + storage |
| File storage | **Cloudflare R2** (no egress fees, good for video) | S3, Supabase Storage |
| Durable workflows / queue | **Inngest** or **Trigger.dev** | Temporal (heavier), BullMQ + Redis. Needed because renders and human gates take minutes to days |
| Video rendering | **Remotion** (React templates = your "editing styles"; Remotion Lambda for scale) | **Creatomate** / **Shotstack** if you prefer a hosted JSON-template API and no render infra |
| Low-level video | **FFmpeg** (cuts, silence removal, loudness, transcodes) | — |
| Transcription w/ word timings | **Deepgram** or **AssemblyAI** | Self-host **WhisperX** on a GPU worker |
| Media worker host | **Modal** (GPU on demand) or **Fly.io / Railway** container | Serverless functions can't run long FFmpeg/GPU jobs well |
| Social APIs | **Instagram Graph API** (Business/Creator acct), **TikTok** Content Posting + Display API, **YouTube Data + Analytics API**, LinkedIn, X (paid tier) | **Ayrshare** or similar: one API for posting + analytics, saves weeks of app reviews. Start here |
| Embeddings | **Voyage AI** (1024-dim, matches the schema) | Any embedding model; adjust `vector(…)` |

### Nice-to-have
- **PySceneDetect** (shot boundaries) and **MediaPipe** (face tracking for auto-reframe)
- Stock b-roll: **Pexels / Pixabay API**. Music: **Epidemic Sound** or another licensed library (don't use unlicensed trending audio in automated renders)
- AI b-roll / voice: **Veo / Runway / Kling** for generated shots, **ElevenLabs** for voiceover
- Observability: **Langfuse** or OpenTelemetry for agent traces, **Sentry** for app errors
- Secrets: encrypt OAuth tokens (KMS / Supabase Vault)

### Things to know up front
- **Claude doesn't take video files directly.** The pipeline feeds it the transcript plus sampled keyframes (images), which is enough for editing decisions and QA.
- **Platform API approvals take time.** Instagram and TikTok both need app review for publishing/insights scopes, which is a big reason to start with an aggregator like Ayrshare.
- **Metrics differ per platform.** Retention curves come only from YouTube (and partly IG). Keep the full payload in `raw` and map what's available.

---

## 7. Key schema relationships

```
users ─┬─ social_accounts ── posts ─┬─ post_metric_snapshots   (time series)
       │                           ├─ post_features            (what to attribute performance to)
       │                           └─ post_performance (MV)    (score + verdict)
       ├─ brand_kits
       ├─ content_directions ── content_projects ─┬─ concepts            (Gate 1)
       │                                          ├─ style_options ─ editing_styles  (Gate 2)
       │                                          ├─ caption_options     (Gate 3)
       │                                          ├─ media_assets ─ asset_analyses
       │                                          ├─ edit_plans ─ renders (Gate 4) ─► posts
       │                                          ├─ decisions           (your choices = training signal)
       │                                          └─ agent_runs          (cost, tokens, prompt version)
       └─ insights / performance_reports          (Analyst output → read by all creative agents)
```

---

## 7b. Your design tools: Canva, Figma, CapCut

Each tool gets the job it is best at. The automated video renderer stays Remotion/FFmpeg, because only those can be fully driven by code.

```
 Figma ──(design the look)──► style templates + brand tokens ──► Remotion templates / brand_kits
 Canva ──(autofill + export)─► thumbnails · carousels · covers · overlays ──► external_designs ─► posts
 Platform ──(asset bundle + .srt)──► CapCut (you polish) ──(upload export)──► renders ─► QA ─► posts
```

| Tool | Integration | What it does in the system | Agent that uses it |
|---|---|---|---|
| **Canva** | **Canva Connect API** (OAuth): brand templates, autofill, export, asset upload, brand kits | **Static and design content.** Thumbnails, carousel posts, covers and story frames are made by autofilling *your* Canva brand templates with the hook, caption and keyframe, then exported back as PNG/PDF/MP4. You get an "Open in Canva" link for manual tweaks. Your Canva brand kit can be the source for `brand_kits`. | Creative Director (picks template + fills fields); Copywriter (text fields) |
| **Figma** | **Figma REST API** (read files/nodes, export images); a small Figma plugin if you want push-back | **Design system and style lab.** You design caption styles, lower-thirds, end cards and thumbnail layouts as Figma frames. The platform reads their colors, fonts and positions into `editing_styles.params`, so Remotion renders exactly what you designed. It can also export overlay PNGs/SVGs. Also handy for designing the dashboard UI. | Creative Director (reads style specs); build-time sync job |
| **CapCut** | **No official editing API.** Official path is a file handoff. Unofficial open-source tools can generate CapCut draft files, but they break on app updates and CapCut's terms disallow scripted access, so keep that experimental | **Optional human polish step.** For posts you want to finish by hand (trending templates, effects, CapCut-only features), the Editor exports a *handoff package*: trimmed clips in order, music, overlay PNGs, a word-timed `.srt` and a cut list. You finish in CapCut and upload the export. It then goes through QA and publishing like any other render. | Editor (builds package); QA (checks your export) |

**How it changes the flow**
- **Gate 2 (style):** previews can include a Canva thumbnail option alongside the video style.
- **New optional step after rendering:** "Polish in CapCut?" sets the project to `awaiting_manual_edit` and creates a `handoff_packages` row. When you upload the export, the project moves on to `qa`.
- **Carousels and image posts** skip the video pipeline entirely: concept → Copywriter → Canva autofill → approve → publish.
- **Learning loop:** `post_features.thumbnail_template` and `manually_edited` let the Analyst tell you which Canva thumbnail designs win, and whether your CapCut polish actually beats fully automatic edits (worth knowing before you spend the time).

**Plan limits to check before building**
- **Canva autofill / brand templates:** Canva's docs conflict. Some pages say the user must be on Canva Enterprise, while the newer API reference says Pro, Teams or Enterprise. Test with your own account first. Fallback: create designs from scratch through the API, or use Figma for thumbnails.
- **Figma Variables API** (design tokens) is Enterprise-only. On other plans, read styles and node properties through the standard REST endpoints (available on all plans) or use a plugin.

**Schema additions:** `design_tool_connections` (OAuth per tool), `external_designs` (every Canva/Figma design tied to a project or post), `handoff_packages` (CapCut round trip), plus new columns on `brand_kits`, `editing_styles`, `posts` and `post_features`.

**No new agents needed.** These are tools given to the existing Creative Director, Copywriter and Editor.

---

## 8. Build order

1. **Weeks 1–2, analytics first:** connect accounts, import history, metrics cron, `post_performance`, dashboard, Analyst insights. Useful on its own before any editing exists.
2. **Weeks 3–4, ideation + copy + Canva:** direction form → concepts → captions, with Gates 1 and 3. Add Canva autofill for thumbnails and carousels: the quickest visible win.
3. **Weeks 5–7, editing:** asset analysis, 3–4 Remotion style templates (designed in Figma first), Editor EDL → render → QA, Gates 2 and 4, plus the CapCut handoff export.
4. **Week 8, publishing + loop:** scheduler, auto-tagging of new posts, insights feeding ideation.
5. **Later:** A/B variants (two hooks per concept), auto-approve once your acceptance rate is high, AI b-roll, trend scouting.
