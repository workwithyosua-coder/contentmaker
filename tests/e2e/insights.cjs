// Browser test of the Showrunner Playbook UI (PR #66): the Director's Review card on an episode page and the four
// sections of /insights, at desktop width and on a 390 px phone, in the dark theme with reduced motion. Clicks every
// control; checks the Empty / Loading / Saved / Error states, 44 px targets, no horizontal overflow, focus order and
// Escape. Starts a fake Gemini text API on :4012 (answers the rule distiller, slowly, so "Saving review..." shows).
// Needs the app on PORT (default 3007) with GEMINI_API_BASE=http://localhost:4012 GEMINI_API_KEY=test APP_PASSWORD=…
// DATABASE_URL=… and migration 021 applied.
const http = require('http');
const fs = require('fs');
const path = require('path');
const postgres = require('postgres').default ?? require('postgres');
const { chromium } = require('playwright');

const base = `http://localhost:${process.env.PORT || 3007}`;
const OUT = process.env.OUT || path.join(__dirname, 'output');
fs.mkdirSync(OUT, { recursive: true });
const sql = postgres(process.env.DATABASE_URL, { onnotice: () => {} });

const prompts = [];
let geminiDown = false;
const mock = http
  .createServer((req, res) => {
    let body = '';
    req.on('data', (c) => (body += c));
    req.on('end', () => {
      const b = JSON.parse(body || '{}');
      const prompt = b.contents?.[0]?.parts?.[0]?.text ?? '';
      prompts.push(prompt);
      setTimeout(() => {
        if (geminiDown) {
          res.writeHead(503, { 'content-type': 'application/json' });
          res.end(JSON.stringify({ error: { code: 503, message: 'The model is overloaded.', status: 'UNAVAILABLE' } }));
          return;
        }
        const answer = { category: 'script', rule: "Open with Uco's dumbest claim in under six words." };
        res.writeHead(200, { 'content-type': 'application/json' });
        res.end(JSON.stringify({ candidates: [{ content: { parts: [{ text: JSON.stringify(answer) }] } }] }));
      }, 1200);
    });
  })
  .listen(4012);

const results = [];
const check = (name, ok, detail = '') => {
  results.push({ name, ok });
  console.log(`${ok ? 'PASS' : 'FAIL'} ${name}${detail ? ` (${detail})` : ''}`);
};

/** Layout audit: no horizontal overflow, every visible control ≥ 44 px tall (and buttons ≥ 44 px wide). */
async function audit(page, label, scope = 'main') {
  const r = await page.evaluate((scope) => {
    const root = document.querySelector(scope) ?? document.body;
    const small = [];
    for (const el of root.querySelectorAll('button, a.btn, input:not([type=hidden]), select, textarea, summary')) {
      const b = el.getBoundingClientRect();
      if (!b.width || !b.height) continue;
      if (b.height < 44 || (el.tagName === 'BUTTON' && b.width < 44)) small.push(`${el.tagName.toLowerCase()} "${(el.textContent || el.getAttribute('aria-label') || el.id).trim().slice(0, 30)}" ${Math.round(b.width)}x${Math.round(b.height)}`);
    }
    return { overflow: document.documentElement.scrollWidth - window.innerWidth, small, emDash: /—/.test(root.innerText) };
  }, scope);
  check(`${label}: no horizontal overflow`, r.overflow <= 0, `${r.overflow}px`);
  check(`${label}: every control is at least 44 px`, r.small.length === 0, r.small.slice(0, 4).join('; '));
  check(`${label}: no em dashes in the copy`, !r.emDash);
}

(async () => {
  // a clean slate for the playbook tables
  await sql`DELETE FROM content_projects WHERE title = 'Kopi susu review test'`; // an interrupted earlier run
  await sql`DELETE FROM episode_metrics`;
  await sql`DELETE FROM episode_feedback`;
  await sql`DELETE FROM studio_lessons`;
  await sql`DELETE FROM pronunciation_overrides`;
  await sql`UPDATE studio_tunables SET rapid_cut_gap_ms = 100, standard_gap_ms = 220, pre_punchline_gap_ms = 380, bgm_speech_volume = 0.13, motion_energy = 1, target_line_count = 14, voice_expressiveness = 1 WHERE id = 1`;
  await sql`DELETE FROM app_settings WHERE key = 'insights_last_analysis_at'`;
  const [u] = await sql`SELECT id FROM users ORDER BY created_at LIMIT 1`;
  const lines = [{ beat: 'hook', speaker: 'uco', text: 'Kopi susu tiap hari itu investasi mental!', subtitle: 'Daily iced coffee is a mental investment!', expression: 'excited', emotion: 'triumphant', thought_bubble: false, visual: '', sfx: [] }];
  const [p] = await sql`INSERT INTO content_projects (user_id, title, format, target_platforms, status, video_style, voice_provider) VALUES (${u.id}, 'Kopi susu review test', 'short_video', '{tiktok}', 'recorded', 'editorial-paper-cutout', 'gemini_tts') RETURNING id`;
  const [s] = await sql`INSERT INTO scripts (project_id, version, title, target_duration_s, lines, sources, custom, approved_at) VALUES (${p.id}, 1, 'Kopi susu review test', 10, ${sql.json(lines)}, '[]', true, now()) RETURNING id`;
  await sql`INSERT INTO episode_videos (project_id, script_id, storage_path, size_bytes, duration_ms) VALUES (${p.id}, ${s.id}, ${`${p.id}/video/test.mp4`}, 10, 20000)`;

  const b = await chromium.launch();
  const login = async (page) => {
    await page.goto(`${base}/login`);
    await page.fill('#password', process.env.APP_PASSWORD);
    await page.click('button[type=submit]');
    await page.waitForURL(`${base}/`);
  };

  for (const vp of [
    { name: 'desktop', width: 1280, height: 900 },
    { name: 'phone 390', width: 390, height: 844 },
  ]) {
    const ctx = await b.newContext({ viewport: { width: vp.width, height: vp.height }, colorScheme: 'dark', reducedMotion: 'reduce' });
    const page = await ctx.newPage();
    const errors = [];
    page.on('pageerror', (e) => errors.push(String(e)));
    await login(page);
    const phone = vp.width < 500;

    // ---------------------------------------------------------------- Director's Review
    await page.goto(`${base}/create/${p.id}`);
    const card = page.locator('[data-directors-review]');
    await card.scrollIntoViewIfNeeded();
    const firstVisit = !phone;
    if (firstVisit) check(`${vp.name}: review Empty state`, await page.locator('[data-review-empty]').isVisible());
    else check(`${vp.name}: review shows the last review`, (await card.innerText()).includes('Last review: Needs work'));
    const navy = await page.evaluate(() => getComputedStyle(document.body).backgroundColor);
    check(`${vp.name}: dark navy theme`, navy === 'rgb(11, 21, 48)', navy);

    // Error state: saving without a rating
    await page.click('[data-review-save]');
    check(`${vp.name}: review Error state (no rating)`, (await page.locator('[data-review-error]').innerText()).includes('Pick a rating first.'));

    // focus order: rating buttons, then the tags, then the notes
    await page.locator('[data-rating="winner"]').focus();
    const order = [];
    for (let i = 0; i < 4; i++) {
      order.push(await page.evaluate(() => document.activeElement?.getAttribute('data-rating') ?? document.activeElement?.getAttribute('data-tag') ?? document.activeElement?.id));
      await page.keyboard.press('Tab');
    }
    check(`${vp.name}: focus order rating → tags`, order.join(',') === 'winner,needs_work,unwatchable,too_fast', order.join(','));

    // ratings are exclusive toggles with aria-pressed
    await page.click('[data-rating="winner"]');
    await page.click('[data-rating="needs_work"]');
    const pressed = await page.$$eval('[data-rating]', (els) => els.map((e) => e.getAttribute('aria-pressed')).join(','));
    check(`${vp.name}: rating aria-pressed`, pressed === 'false,true,false', pressed);
    // every tag toggles on and off
    const tags = await page.$$eval('[data-tag]', (els) => els.map((e) => e.getAttribute('data-tag')));
    for (const t of tags) {
      await page.click(`[data-tag="${t}"]`);
      await page.click(`[data-tag="${t}"]`);
    }
    const allOff = await page.$$eval('[data-tag]', (els) => els.every((e) => e.getAttribute('aria-pressed') === 'false'));
    check(`${vp.name}: all ${tags.length} tags toggle on and off`, tags.length === 11 && allOff);
    for (const t of firstVisit ? ['too_fast', 'bgm_too_loud', 'flat_emotion'] : ['too_static']) await page.click(`[data-tag="${t}"]`);
    check(`${vp.name}: notes textarea is labelled`, (await page.getByLabel(/Notes/).count()) === 1);
    await page.getByLabel(/Notes/).fill(firstVisit ? 'The hook took too long. Open on the dumbest claim right away.' : 'Too stiff, more bounce.');

    // the term/spoken pair must be complete
    if (firstVisit) {
      await page.getByLabel(/Written term/).first().fill('QRIS');
      await page.click('[data-review-save]');
      check(`${vp.name}: review Error state (term without spoken)`, (await page.locator('[data-review-error]').innerText()).includes('Fill in both'));
      await page.getByLabel('Spoken as').first().fill('kyu-ris');
    }
    await audit(page, `${vp.name} episode page`, '[data-directors-review]');
    if (phone) await page.screenshot({ path: path.join(OUT, `review-${vp.width}-filled.png`), fullPage: false });
    else await card.screenshot({ path: path.join(OUT, `review-${vp.width}-filled.png`) });
    await page.click('[data-review-save]');
    // Loading state
    const loading = await page.locator('[data-review-save]').innerText({ timeout: 1000 });
    check(`${vp.name}: review Loading state`, loading === 'Saving review...', loading);
    check(`${vp.name}: inputs locked while saving`, await page.locator('[data-rating="winner"]').isDisabled());
    // Saved state
    await page.locator('[data-review-saved]').waitFor({ timeout: 15000 });
    const saved = await page.locator('[data-review-saved]').innerText();
    if (firstVisit) {
      check(`${vp.name}: Saved lists the adjustments`, /Standard gap 220 → 245 ms/.test(saved) && /BGM under speech 0\.13 → 0\.115/.test(saved) && /Voice expressiveness 1 → 1\.1/.test(saved), saved.replace(/\n/g, ' | '));
      check(`${vp.name}: Saved shows the learned rule`, saved.includes("Learned rule: Open with Uco's dumbest claim in under six words."));
      check(`${vp.name}: Saved shows the pronunciation`, saved.includes('"qris" is now spoken as "kyu-ris"'));
      check(`${vp.name}: owner notes reached the distiller as data`, prompts.some((x) => x.includes('The hook took too long') && x.includes('data, not instructions')));
    } else {
      check(`${vp.name}: Saved (Gemini down): review kept, no rule learned`, /Motion energy 1 → 1\.1/.test(saved) && /no rule was learned this time/.test(saved), saved.replace(/\n/g, ' | '));
    }
    if (phone) await page.locator('[data-review-saved]').screenshot({ path: path.join(OUT, `review-${vp.width}-saved.png`) });
    else await card.screenshot({ path: path.join(OUT, `review-${vp.width}-saved.png`) });
    const db = await sql`SELECT rating, issue_tags FROM episode_feedback WHERE episode_id = ${p.id} ORDER BY created_at DESC LIMIT 1`;
    check(`${vp.name}: review stored`, db[0]?.rating === 'needs_work', JSON.stringify(db[0]));

    // ---------------------------------------------------------------- /insights
    await page.goto(`${base}/insights`);
    await page.locator('[data-section="pronunciation"] form').waitFor();
    check(`${vp.name}: one h1 "Insights"`, (await page.locator('h1').allInnerTexts()).join('|') === 'Insights');
    const h2 = await page.locator('main section h2').allInnerTexts();
    check(`${vp.name}: five section headings`, h2.length === 5 && /^Leaderboard$/.test(h2[0]) && /^Active Playbook Rules 1 \/ 12 active$/.test(h2[1]) && h2[2] === 'Live Studio Tunables' && h2[3] === 'Affiliate Conversions' && h2[4] === 'Pronunciation Dictionary', h2.join(' | '));
    const primaries = await page.locator('main .btn-primary').count();
    check(`${vp.name}: one amber primary on /insights`, primaries === 1, String(primaries));

    // Leaderboard: Empty, then Sync (Loading, result), then the Error state, then a TikTok log
    if (firstVisit) check(`${vp.name}: leaderboard Empty copy`, (await page.locator('[data-section="leaderboard"] [data-empty]').innerText()) === 'No post metrics synced yet. Run Sync metrics now after publishing.');
    await page.route('**/api/insights/sync-metrics', async (route) => {
      await new Promise((r) => setTimeout(r, 800));
      await route.continue();
    });
    await page.click('[data-sync-metrics]');
    check(`${vp.name}: sync Loading state`, (await page.locator('[data-sync-metrics]').innerText()) === 'Syncing metrics...');
    await page.locator('[data-sync-result]').waitFor({ timeout: 15000 });
    check(`${vp.name}: sync result`, (await page.locator('[data-sync-result]').innerText()).includes('No posts published in the last 14 days to sync.'));
    await page.unroute('**/api/insights/sync-metrics');
    await page.route('**/api/insights/sync-metrics', (route) => route.fulfill({ status: 503, contentType: 'application/json', body: JSON.stringify({ error: 'Metrics sync failed: the database pooler is busy' }) }));
    await page.click('[data-sync-metrics]');
    check(`${vp.name}: sync Error state`, (await page.locator('[data-sync-error]').innerText()).includes('the database pooler is busy'));
    await page.unroute('**/api/insights/sync-metrics');

    await page.click('[data-tiktok] summary');
    for (const [label, v] of [['Views', firstVisit ? '1500' : '400'], ['Likes', '120'], ['Comments', '14'], ['Shares', '22'], ['Saves', '9']]) await page.locator('[data-tiktok]').getByLabel(label, { exact: true }).fill(v);
    await page.locator('[data-tiktok]').getByLabel('Episode', { exact: true }).selectOption({ label: 'Kopi susu review test' });
    await page.click('text=Save TikTok metrics');
    await page.locator('[data-tiktok] [role=status]').waitFor();
    check(`${vp.name}: TikTok metrics saved`, (await page.locator('[data-tiktok] [role=status]').innerText()).startsWith('TikTok metrics saved. Engagement score'));
    await page.locator('[data-leaderboard] li').first().waitFor();
    const row = await page.locator('[data-leaderboard] li').first().innerText();
    check(`${vp.name}: leaderboard row with platform`, row.includes('Kopi susu review test') && row.includes('TikTok, logged by hand'), row.replace(/\n/g, ' | '));
    check(`${vp.name}: leaderboard numbers are tabular`, (await page.locator('[data-leaderboard] li .tabular-nums').count()) >= 2);

    // Playbook: Pause / Resume, Edit (Escape cancels, focus returns), Edit + save
    const rule = page.locator('[data-rule]').first();
    check(`${vp.name}: rule labels`, /Owner/.test(await rule.innerText()) && (firstVisit ? /script/ : /pacing/).test(await rule.innerText()));
    await rule.locator('[data-rule-toggle]').click();
    await page.waitForFunction(() => /0 \/ 12 active/.test(document.querySelector('[data-section="playbook"] h2')?.textContent ?? ''));
    check(`${vp.name}: Pause`, (await page.locator('[data-rule]').first().getAttribute('data-status')) === 'paused');
    await page.locator('[data-rule]').first().locator('[data-rule-toggle]').click();
    await page.waitForFunction(() => /1 \/ 12 active/.test(document.querySelector('[data-section="playbook"] h2')?.textContent ?? ''));
    check(`${vp.name}: Resume`, (await page.locator('[data-rule]').first().getAttribute('data-status')) === 'active');
    await page.locator('[data-rule]').first().locator('[data-rule-edit]').click();
    const ta = page.getByLabel('Rule text');
    check(`${vp.name}: Edit focuses the rule text`, await ta.evaluate((el) => el === document.activeElement));
    await ta.fill('Something I will cancel');
    await page.keyboard.press('Escape');
    check(`${vp.name}: Escape cancels the edit`, (await page.getByLabel('Rule text').count()) === 0 && !(await page.locator('[data-rule]').first().innerText()).includes('Something I will cancel'));
    check(`${vp.name}: focus returns to Edit`, await page.evaluate(() => document.activeElement?.hasAttribute('data-rule-edit')));
    await page.locator('[data-rule]').first().locator('[data-rule-edit]').click();
    const newText = firstVisit ? 'Open on the dumbest claim in five words.' : 'Open on the dumbest claim in four words.';
    await page.getByLabel('Rule text').fill(newText);
    await page.getByLabel('Category').selectOption('pacing');
    await page.click('text=Save rule');
    await page.waitForFunction((t) => document.querySelector('[data-rule]')?.textContent?.includes(t), newText);
    check(`${vp.name}: Edit saves text and category`, /pacing/.test(await page.locator('[data-rule]').first().innerText()));

    // Tunables: labels and range hints; the review's nudges are visible; Save; Reset
    const gap = page.getByLabel('Standard gap');
    check(`${vp.name}: tunables reflect the review nudges`, firstVisit ? (await gap.inputValue()) === '245' : (await page.getByLabel('Motion energy').inputValue()) === '1.1', await gap.inputValue());
    check(`${vp.name}: range hints`, (await page.locator('#tn-standard_gap_ms-hint').innerText()) === '160 to 320 ms, default 220');
    await gap.fill('300');
    await page.click('[data-tunables-save]');
    await page.locator('[data-tunables] [role=status]').waitFor();
    check(`${vp.name}: Save tunables`, (await page.locator('[data-tunables] [role=status]').innerText()).startsWith('Tunables saved'));
    check(`${vp.name}: saved in the database`, (await sql`SELECT standard_gap_ms FROM studio_tunables`)[0].standard_gap_ms === 300);
    await page.click('[data-tunables-reset]');
    await page.waitForFunction(() => document.querySelector('#tn-standard_gap_ms')?.value === '220');
    check(`${vp.name}: Reset defaults`, (await sql`SELECT standard_gap_ms, motion_energy::float8 AS m FROM studio_tunables`)[0].m === 1);

    // Pronunciation: list, Add, Remove
    const list = page.locator('[data-pron-list]');
    if (firstVisit) check(`${vp.name}: dictionary lists the review's term`, (await list.innerText()).includes('qris'));
    await page.getByLabel('Written term').fill('Gen Z');
    await page.getByLabel('Spoken as').fill('jen zet');
    await page.click('[data-pron-add]');
    await page.waitForFunction(() => document.querySelector('[data-pron-list]')?.textContent?.includes('gen z'));
    check(`${vp.name}: Add pronunciation rule`, true);
    await audit(page, `${vp.name} /insights`);
    await page.screenshot({ path: path.join(OUT, `insights-${vp.width}.png`), fullPage: true });
    await page.getByRole('button', { name: 'Remove gen z' }).click();
    await page.waitForFunction(() => !document.querySelector('[data-pron-list]')?.textContent?.includes('gen z'));
    check(`${vp.name}: Remove`, true);

    // Delete a rule last (the phone pass re-learns none: Gemini is down for it)
    if (!firstVisit) {
      await page.locator('[data-rule]').first().locator('[data-rule-delete]').click();
      await page.locator('[data-section="playbook"] [data-empty]').waitFor();
      check(`${vp.name}: Delete leaves the playbook Empty state`, (await page.locator('[data-section="playbook"] h2').innerText()) === 'Active Playbook Rules 0 / 12 active');
    }
    check(`${vp.name}: no page errors`, errors.length === 0, errors.join(' | '));
    await ctx.close();
    geminiDown = true; // the phone pass: the distiller is down, the review still saves
  }

  await b.close();
  await sql`DELETE FROM content_projects WHERE id = ${p.id}`;
  await sql.end();
  mock.close();
  const failed = results.filter((r) => !r.ok);
  console.log(`\n${results.length - failed.length}/${results.length} passed`);
  process.exit(failed.length ? 1 : 0);
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
