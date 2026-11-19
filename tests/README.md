# Tests

## Unit (no database, no network, no AI)
The Manual / Exact Import parser (`src/lib/manualScriptParser.ts`): full scripts with metadata, timestamps, `[EN]`,
`(thought)` and line-by-line cues; minimal `UCO:` / `OCU:` scripts; exact text; per-character poses; direction notes.

```bash
npm run test:unit
```

## Integration (no API cost)
Real database, simulated platform and Claude APIs. Needs a local Postgres with `db/schema.sql` + `db/migrations/*`
applied and at least one user (run `npm run db:seed` once).

```bash
DATABASE_URL=postgres://postgres@localhost:5432/studio npm run test:integration
```

Covers: TikTok, Instagram/Facebook and YouTube imports (paging, token refresh, encryption, renamed or missing
metrics, Shorts detection), and the writers' room (ideas, fact check with pause_turn, script, revision, captions,
em-dash safety net, cost logging).

## Browser end-to-end (no API cost)
The whole Create flow on a phone-sized browser against a fake Claude server, including a failure and a retry.

```bash
FAIL_SCRIPT=1 node tests/e2e/claude-mock.cjs &
npm run build && ANTHROPIC_BASE_URL=http://localhost:4010 ANTHROPIC_API_KEY=test-key APP_PASSWORD=local-test-pw PORT=3006 npm start &
node tests/e2e/create-flow.cjs
```

## Live self-test (real Claude API, about US$0.40)
Runs one full episode on production and deletes it afterwards:

```bash
curl -H "Authorization: Bearer $CRON_SECRET" https://contentmaker-lime.vercel.app/api/cron/selftest
```
