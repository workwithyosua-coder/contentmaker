# Studio: personal content platform

Multi-agent content studio: analytics dashboard → ideas → editing styles → captions → auto-edit → publish → learn.
See [ARCHITECTURE.md](./ARCHITECTURE.md) for the full design and [db/schema.sql](./db/schema.sql) for the database.

**Status: Phase 1 (analytics + Analyst agent).** Runs on demo data until real accounts are connected.

## Run it

```bash
npm install
cp .env.example .env.local      # set DATABASE_URL (Postgres with pgvector) and ANTHROPIC_API_KEY
npm run db:setup                # applies db/schema.sql
npm run db:seed                 # 90 days of demo posts (npm run db:seed -- --reset to redo)
npm run dev                     # http://localhost:3000
```

## Install as an app (phone + desktop)

The app is a Progressive Web App, so the same codebase installs everywhere once it's deployed (e.g. on Vercel):

- **iPhone**: open in Safari → Share → *Add to Home Screen*
- **Android**: open in Chrome → menu → *Install app*
- **Mac / Windows**: open in Chrome or Edge → install icon in the address bar

If you later need App Store / Play Store listings, wrap this app with Capacitor (mobile) or Tauri (desktop);
the backend and agents stay the same.

## What's here

| Path | What |
|---|---|
| `src/app/page.tsx` | Dashboard: KPIs, weekly views, what's working by hook / style / length / time, recent posts with verdicts |
| `src/app/insights` | Analyst agent output + "Run Analyst" button |
| `src/lib/agents/analyst.ts` | Analyst agent (Claude Opus 5.5, structured output) → `insights`, `performance_reports`, `agent_runs` |
| `src/lib/queries.ts` | Dashboard SQL |
| `scripts/` | DB setup and demo seed |
