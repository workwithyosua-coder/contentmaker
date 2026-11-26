// Browser test of the Schedule page's live pipeline progress on a 390 px phone. Reports go through the real worker
// endpoint (POST /api/scheduler/slots/:id/progress with RENDER_TOKEN), exactly as the GitHub worker sends them.
// Needs the app on PORT (default 3007) with RENDER_TOKEN=… APP_PASSWORD=… DATABASE_URL=… STORAGE_DRIVER=local
const fs = require('fs');
const path = require('path');
const postgres = require('postgres').default ?? require('postgres');
const { chromium } = require('playwright');

const base = `http://localhost:${process.env.PORT || 3007}`;
const OUT = process.env.OUT || path.join(__dirname, 'output');
fs.mkdirSync(OUT, { recursive: true });
const sql = postgres(process.env.DATABASE_URL, { onnotice: () => {} });
const TOKEN = process.env.RENDER_TOKEN;

const report = (id, body, token = TOKEN) =>
  fetch(`${base}/api/scheduler/slots/${id}/progress`, { method: 'POST', headers: { ...(token ? { Authorization: `Bearer ${token}` } : {}), 'Content-Type': 'application/json' }, body: JSON.stringify(body) });

(async () => {
  const results = [];
  const check = (name, ok, detail = '') => {
    results.push({ name, ok });
    console.log(`${ok ? 'PASS' : 'FAIL'} ${name}${detail ? ` (${detail})` : ''}`);
  };
  const [u] = await sql`SELECT id FROM users ORDER BY created_at LIMIT 1`;
  await sql`DELETE FROM content_schedules WHERE user_id = ${u.id}`;
  const [sch] = await sql`INSERT INTO content_schedules (user_id) VALUES (${u.id}) RETURNING id`;
  const at = (h) => new Date(Date.now() + h * 3600e3);
  const [a] = await sql`INSERT INTO episode_queue (schedule_id, user_id, scheduled_for, format, topic_seed, topic_source) VALUES (${sch.id}, ${u.id}, ${at(2)}, 'comedy_debate', 'Skincare mahal investasi wajah', 'manual') RETURNING id`;
  const [idle] = await sql`INSERT INTO episode_queue (schedule_id, user_id, scheduled_for, format, topic_seed, topic_source) VALUES (${sch.id}, ${u.id}, ${at(10)}, 'koran_kinetik', 'Harga cabai', 'manual') RETURNING id`;

  // ---- the endpoint: RENDER_TOKEN, validation, clamping, only while the slot runs
  check('endpoint: no token → 404', (await report(a.id, { stage: 'voicing', percent: 10 }, null)).status === 404);
  check('endpoint: wrong token → 404', (await report(a.id, { stage: 'voicing', percent: 10 }, 'nope')).status === 404);
  const bad = await report(a.id, { stage: 'flying', percent: 10 });
  check('endpoint: unknown stage → 400 with the allowed list', bad.status === 400 && /stage must be one of: starting, scripting/.test((await bad.json()).error));
  const idleReport = await (await report(a.id, { stage: 'voicing', percent: 50, detail: 'x' })).json();
  check('endpoint: a queued slot that is not starting ignores reports', idleReport.applied === false);
  const [untouched] = await sql`SELECT status, progress_stage FROM episode_queue WHERE id = ${a.id}`;
  check('endpoint: an ignored report never changes the slot', untouched.status === 'queued' && untouched.progress_stage === null);

  // "Run slot now" (what dispatchSlot writes): an indeterminate starting state
  await sql`UPDATE episode_queue SET progress_percent = NULL, progress_stage = 'starting', progress_detail = 'Starting GitHub worker...', progress_updated_at = now() WHERE id = ${a.id}`;

  const b = await chromium.launch();
  const ctx = await b.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, colorScheme: 'dark', reducedMotion: 'reduce' });
  const page = await ctx.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(String(e)));
  let polls = 0;
  page.on('request', (r) => r.url().endsWith('/api/schedule/queue') && polls++);
  await page.goto(`${base}/login`);
  await page.fill('#password', process.env.APP_PASSWORD);
  await page.click('button[type=submit]');
  await page.waitForURL(`${base}/`);
  await page.goto(`${base}/schedule`);
  const card = page.locator('li', { hasText: 'Skincare mahal investasi wajah' });
  const bar = card.getByRole('progressbar');
  await bar.waitFor();
  const attrs = () => bar.evaluate((el) => ({ now: el.getAttribute('aria-valuenow'), min: el.getAttribute('aria-valuemin'), max: el.getAttribute('aria-valuemax'), text: el.getAttribute('aria-valuetext'), label: el.getAttribute('aria-label') }));
  const prog = card.getByTestId('slot-progress');
  let x = await attrs();
  check('waiting: indeterminate (no aria-valuenow), "Waiting", "Starting GitHub worker..."', x.now === null && x.min === '0' && x.max === '100' && /waiting for the worker/.test(x.text) && (await prog.getAttribute('data-state')) === 'waiting' && (await prog.innerText()).includes('Starting GitHub worker...') && (await prog.innerText()).includes('Waiting'), JSON.stringify(x));
  check('waiting: aria-label names the slot', x.label === 'Pipeline progress for Skincare mahal investasi wajah');
  check('waiting: card is aria-busy, polling on', (await card.getAttribute('aria-busy')) === 'true' && (await page.locator('ol[data-polling]').getAttribute('data-polling')) === 'on');
  check('idle slot shows no bar', (await page.locator('li', { hasText: 'Harga cabai' }).getByRole('progressbar').count()) === 0);
  await page.locator('li', { hasText: 'Skincare mahal investasi wajah' }).screenshot({ path: `${OUT}/progress-1-waiting.png` });

  // ---- the worker claims it and reports (exactly what scheduler-step sends)
  await sql`UPDATE episode_queue SET status = 'scripting' WHERE id = ${a.id}`;
  await report(a.id, { stage: 'scripting', percent: 5, detail: 'Writing Show Bible script...' });
  await page.waitForFunction(() => document.querySelector('[data-testid=slot-progress]')?.getAttribute('data-state') === 'running', null, { timeout: 15000 });
  x = await attrs();
  check('running: determinate 5%, script step', x.now === '5' && x.text === 'Writing the script, 5%' && (await prog.innerText()).includes('Writing Show Bible script...'), JSON.stringify(x));
  await sql`UPDATE episode_queue SET status = 'voicing' WHERE id = ${a.id}`;
  await report(a.id, { stage: 'voicing', percent: 42, detail: 'Voicing line 8 of 15' });
  await page.waitForFunction(() => document.querySelector('[role=progressbar]')?.getAttribute('aria-valuenow') === '42', null, { timeout: 15000 });
  x = await attrs();
  const strip = await card.locator('ol[aria-label="Pipeline steps"] li').allInnerTexts();
  check('running: 42%, "Voicing line 8 of 15", amber fill at 42%', x.now === '42' && (await prog.innerText()).includes('Voicing line 8 of 15') && (await prog.innerText()).includes('42%'), JSON.stringify(x));
  const fill = await bar.evaluate((el) => {
    const f = el.firstElementChild;
    const cs = getComputedStyle(f);
    return { width: f.style.width, bg: cs.backgroundColor, h: el.getBoundingClientRect().height, transition: cs.transitionDuration };
  });
  check('running: 8 px track, fill width 42%, no transition under reduced motion', fill.width === '42%' && Math.round(fill.h) === 8 && parseFloat(fill.transition) < 0.01, JSON.stringify(fill));
  check('milestones: Script and Props done, Voice current (text marks, not color alone)', strip.map((t) => t.replace(/\s+/g, ' ')).join('|') === '✓ Script , done|✓ Props , done|● Voice , in progress|○ Render , to do|○ Post , to do', strip.join('|'));
  check('freshness: "Updated …s ago"', /Updated \d+s ago/.test(await prog.innerText()));
  check('live region announces the stage', (await card.locator('[aria-live=polite]').innerText()) === 'Voicing');
  await page.locator('li', { hasText: 'Skincare mahal investasi wajah' }).screenshot({ path: `${OUT}/progress-2-running.png` });
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
  check('390 px: no horizontal overflow while running', overflow <= 0, `${overflow}`);

  // ---- hidden tab pauses polling, visible resumes
  await page.evaluate(() => {
    Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => 'hidden' });
    document.dispatchEvent(new Event('visibilitychange'));
  });
  await page.waitForFunction(() => document.querySelector('ol[data-polling]')?.getAttribute('data-polling') === 'off');
  const p0 = polls;
  await page.waitForTimeout(9000);
  check('hidden tab: polling paused (no requests for 9 s)', polls === p0, `${polls - p0}`);
  await page.evaluate(() => {
    Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => 'visible' });
    document.dispatchEvent(new Event('visibilitychange'));
  });
  await page.waitForFunction(() => document.querySelector('ol[data-polling]')?.getAttribute('data-polling') === 'on');
  const p1 = polls;
  await page.waitForTimeout(9000);
  check('visible again: polling every 4 s', polls - p1 >= 2 && polls - p1 <= 3, `${polls - p1} polls in 9 s`);

  // ---- a stale worker: no report for over 3 minutes
  await sql`UPDATE episode_queue SET progress_updated_at = now() - interval '4 minutes' WHERE id = ${a.id}`;
  await page.waitForFunction(() => /No update for 3m\+, check Run log/.test(document.querySelector('[data-testid=slot-progress]')?.textContent ?? ''), null, { timeout: 15000 });
  check('stale: "No update for 3m+, check Run log"', true);

  // ---- failure while voicing: the bar freezes at 42 % in red, with the reason, run log, retry and regenerate
  const [draft] = await sql`INSERT INTO content_projects (user_id, title, format, target_platforms, status) VALUES (${u.id}, 'Skincare mahal investasi wajah', 'short_video', '{tiktok}', 'awaiting_recording') RETURNING id`;
  await sql`UPDATE episode_queue SET run_url = 'https://github.com/x/y/actions/runs/3', episode_id = ${draft.id} WHERE id = ${a.id}`;
  await fetch(`${base}/api/scheduler/slots/${a.id}/fail`, { method: 'POST', headers: { Authorization: `Bearer ${TOKEN}`, 'Content-Type': 'application/json' }, body: JSON.stringify({ error: 'Edge TTS failed (exit 1). See the log above.' }) });
  const late = await (await report(a.id, { stage: 'rendering', percent: 80 })).json();
  check('failed: a late report is ignored', late.applied === false);
  await page.waitForFunction(() => document.querySelector('[data-testid=slot-progress]')?.getAttribute('data-state') === 'failed', null, { timeout: 15000 });
  x = await attrs();
  const failedFill = await bar.evaluate((el) => ({ width: el.firstElementChild.style.width, cls: el.firstElementChild.className }));
  const failedStrip = await card.locator('ol[aria-label="Pipeline steps"] li').allInnerTexts();
  check('failed: frozen at 42% in red', x.now === '42' && failedFill.width === '42%' && /bg-\[var\(--bad\)\]/.test(failedFill.cls) && /^Failed while voicing, 42%$/.test(x.text), JSON.stringify({ x, failedFill }));
  check('failed: Voice marked where it stopped', /✕ Voice , stopped here/.test(failedStrip.map((t) => t.replace(/\s+/g, ' ')).join('|')), failedStrip.join('|'));
  await card.getByRole('button', { name: 'Retry' }).waitFor();
  const parts = [(await card.innerText()).includes('Edge TTS failed'), await card.getByRole('link', { name: 'Run log' }).count(), await card.getByRole('button', { name: 'Retry' }).count(), await card.getByRole('button', { name: 'Regenerate script & run' }).count()];
  check('failed: reason, Run log, Retry and Regenerate', JSON.stringify(parts) === '[true,1,1,1]', JSON.stringify(parts));
  check('failed: card not busy, polling stopped', (await card.getAttribute('aria-busy')) === null && (await page.locator('ol[data-polling]').getAttribute('data-polling')) === 'off');
  const p2 = polls;
  await page.waitForTimeout(6000);
  check('idle: no more polls', polls === p2, `${polls - p2}`);
  // keyboard: the actions are reachable with Tab and show focus
  await card.getByRole('link', { name: 'Run log' }).focus();
  await page.keyboard.press('Tab');
  const focused = await page.evaluate(() => ({ text: document.activeElement?.textContent?.trim(), visible: getComputedStyle(document.activeElement).outlineStyle !== 'none' || getComputedStyle(document.activeElement).boxShadow !== 'none' }));
  check('keyboard: Tab from Run log reaches Retry, with a visible focus ring', focused.text === 'Retry' && focused.visible, JSON.stringify(focused));
  const small = await page.evaluate(() =>
    [...document.querySelectorAll('main li button, main li a.btn, main li a[href*="github.com"]')]
      .filter((el) => el.offsetParent)
      .map((el) => [el.textContent.trim().slice(0, 24), Math.round(el.getBoundingClientRect().height)])
      .filter(([, h]) => h < 44),
  );
  check('390 px: every button and link in the cards is 44 px or taller', small.length === 0, JSON.stringify(small));
  check('390 px: no horizontal overflow when failed', (await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth)) <= 0);
  await page.locator('li', { hasText: 'Skincare mahal investasi wajah' }).screenshot({ path: `${OUT}/progress-3-failed.png` });

  // ---- retry resets the progress; a finished slot shows 100 %
  await card.getByRole('button', { name: 'Retry' }).click();
  await page.getByText(/Back in the queue/).waitFor();
  const [reset] = await sql`SELECT status, progress_percent, progress_stage, progress_detail, progress_updated_at FROM episode_queue WHERE id = ${a.id}`;
  check('retry: progress cleared', reset.status === 'queued' && reset.progress_stage === null && reset.progress_percent === null && reset.progress_updated_at === null, JSON.stringify(reset));
  await sql`UPDATE episode_queue SET status = 'ready_to_post', progress_stage = 'done', progress_percent = 100, progress_detail = 'Ready to post', progress_updated_at = now(), handoff = NULL WHERE id = ${idle.id}`;
  await page.reload();
  const doneCard = page.locator('li', { hasText: 'Harga cabai' });
  const doneBar = doneCard.getByRole('progressbar');
  await doneBar.waitFor();
  check('done: a clean 100% "Ready to post" before settling', (await doneBar.getAttribute('aria-valuenow')) === '100' && (await doneCard.getByTestId('slot-progress').getAttribute('data-state')) === 'done' && (await doneCard.innerText()).includes('Ready to post'));
  await doneCard.screenshot({ path: `${OUT}/progress-4-done.png` });
  console.log('page errors:', errors.length, errors.slice(0, 3));
  check('no page errors', errors.length === 0);

  await sql`DELETE FROM content_schedules WHERE id = ${sch.id}`;
  await sql`DELETE FROM content_projects WHERE id = ${draft.id}`;
  await sql.end();
  await b.close();
  const failed = results.filter((r) => !r.ok);
  console.log(`\n${results.length - failed.length}/${results.length} checks passed`);
  process.exit(failed.length ? 1 : 0);
})().catch((e) => {
  console.error('FAILED:', e.message);
  process.exit(1);
});
