// Browser test: approve, edit captions, post and schedule with a $0 Anthropic balance, on a 390 px phone.
// Starts its own fake Anthropic API on :4011 that answers every request with the real "credit balance is too low"
// error and counts the requests. Needs:
//   node tests/e2e/tiktok-mock.cjs                     (TikTok Content Posting API on :4020)
//   the app on PORT (default 3007), started with ANTHROPIC_API_KEY=x ANTHROPIC_BASE_URL=http://localhost:4011
//   TIKTOK_API_BASE=http://localhost:4020 TOKEN_ENCRYPTION_KEY=<32 bytes b64> APP_PASSWORD=... DATABASE_URL=...
const http = require('http');
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const postgres = require('postgres').default ?? require('postgres');
const { chromium } = require('playwright');

const base = `http://localhost:${process.env.PORT || 3007}`;
const OUT = process.env.OUT || path.join(__dirname, 'output');
fs.mkdirSync(OUT, { recursive: true });
const sql = postgres(process.env.DATABASE_URL, { onnotice: () => {} });
const enc = (plain) => {
  const key = Buffer.from(process.env.TOKEN_ENCRYPTION_KEY, 'base64');
  const iv = crypto.randomBytes(12);
  const c = crypto.createCipheriv('aes-256-gcm', key, iv);
  const body = Buffer.concat([c.update(plain, 'utf8'), c.final()]);
  return Buffer.concat([iv, c.getAuthTag(), body]);
};

let anthropicCalls = 0;
const mock = http
  .createServer((req, res) => {
    anthropicCalls++;
    req.resume();
    res.writeHead(400, { 'content-type': 'application/json' });
    res.end(JSON.stringify({ type: 'error', error: { type: 'invalid_request_error', message: 'Your credit balance is too low to access the Anthropic API. Please go to Plans & Billing to upgrade or purchase credits.' } }));
  })
  .listen(4011);

const LINES = [
  { beat: 'hook', speaker: 'uco', text: 'Mie pedas level 10 itu kemenangan, bukan siksaan!', subtitle: 'Level 10 noodles are a victory!', expression: 'excited' },
  { beat: 'counter', speaker: 'ocu', text: 'Itu namanya benign masochism.', subtitle: "That's benign masochism.", expression: 'deadpan' },
];

async function seed(userId, title, custom) {
  const [p] = await sql`
    INSERT INTO content_projects (user_id, title, format, target_platforms, status)
    VALUES (${userId}, ${title}, 'short_video', '{tiktok,instagram,youtube,facebook}', 'awaiting_script_approval') RETURNING id`;
  const [s] = await sql`
    INSERT INTO scripts (project_id, version, title, target_duration_s, lines, sources, custom)
    VALUES (${p.id}, 1, ${title}, 20, ${sql.json(LINES)}, '[]', ${custom}) RETURNING id`;
  await sql`INSERT INTO episode_videos (project_id, script_id, storage_path, duration_ms) VALUES (${p.id}, ${s.id}, ${`${p.id}/video/test.mp4`}, 20000)`;
  return p.id;
}

(async () => {
  const [u] = await sql`SELECT id FROM users ORDER BY created_at LIMIT 1`;
  await sql`DELETE FROM social_accounts WHERE external_account_id LIKE 'zeroai-%'`;
  const scopes = { tiktok: ['video.publish'], instagram: ['instagram_content_publish'], youtube: ['https://www.googleapis.com/auth/youtube.upload'], facebook: ['pages_manage_posts'] };
  for (const [platform, sc] of Object.entries(scopes)) {
    await sql`
      INSERT INTO social_accounts (user_id, platform, handle, external_account_id, scopes, display_name, access_token_enc, refresh_token_enc, token_expires_at)
      VALUES (${u.id}, ${platform}, 'ucoocu', ${`zeroai-${platform}`}, ${sc}, 'Uco & Ocu',
              ${platform === 'tiktok' ? enc('tt-access') : null}, ${platform === 'tiktok' ? enc('tt-refresh') : null}, now() + interval '1 day')`;
  }
  const epA = await seed(u.id, 'Mie Pedas Level 10 (AI fails)', false);
  const epB = await seed(u.id, 'Mie Pedas Level 10', false);

  const b = await chromium.launch();
  const ctx = await b.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 1, hasTouch: true, isMobile: true });
  const p = await ctx.newPage();
  const errors = [];
  p.on('pageerror', (e) => errors.push(String(e)));
  const results = [];
  const check = (name, ok, detail = '') => {
    results.push({ name, ok });
    console.log(`${ok ? 'PASS' : 'FAIL'} ${name}${detail ? ` (${detail})` : ''}`);
  };
  const overflow = () => p.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);

  await p.goto(`${base}/login`);
  await p.fill('#password', process.env.APP_PASSWORD);
  await p.click('button[type=submit]');
  await p.waitForURL(`${base}/`);

  // ---- 1. AI captions with a $0 balance: clear error, inline "Continue without AI captions"
  await p.goto(`${base}/create/${epA}`);
  await p.locator('button:text-is("Approve script & write captions")').first().click();
  await p.waitForSelector('text=Continue without AI captions', { timeout: 60000 });
  check('low balance: clear error title', (await p.locator('text=/credit balance is too low/i').count()) > 0);
  check('low balance: AI path did call Anthropic (the mock works)', anthropicCalls > 0, `${anthropicCalls} call(s)`);
  await p.locator('[role=alert]').first().scrollIntoViewIfNeeded();
  await p.screenshot({ path: `${OUT}/zero-ai-1-credit-error.png`, fullPage: false });
  const before = anthropicCalls;
  check('before approval: no shared caption box', (await p.locator('#shared-caption').count()) === 0);
  await p.click('button:text-is("Continue without AI captions")');
  await p.waitForSelector('#shared-caption', { timeout: 20000 });
  await p.waitForFunction(() => document.querySelector('textarea[name="tiktok.text"]')?.value.length > 0, null, { timeout: 20000 });
  check('recovery: captions filled, no Anthropic call', anthropicCalls === before);
  check('recovery: error card gone', (await p.locator('text=Continue without AI captions').count()) === 0);

  // ---- 2. Approve without AI, edit captions, validate, schedule, post: zero Anthropic calls
  anthropicCalls = 0;
  await p.goto(`${base}/create/${epB}`);
  const approve = p.locator('button:text-is("Approve without AI (write captions myself)")').last();
  await approve.scrollIntoViewIfNeeded();
  const box = await approve.boundingBox();
  check('approve-without-AI button: full width, ≥ 44 px tall', box.height >= 44 && box.width > 300, `${Math.round(box.width)}×${Math.round(box.height)}`);
  const style = await approve.evaluate((el) => {
    const s = getComputedStyle(el);
    return { cursor: s.cursor, border: s.borderTopColor, shadow: s.boxShadow, color: s.color };
  });
  check('approve-without-AI button: pointer cursor, no glow', style.cursor === 'pointer' && style.shadow === 'none', JSON.stringify(style));
  // keyboard: Tab reaches it and shows the focus ring
  await approve.focus();
  await p.keyboard.press('Shift+Tab');
  await p.keyboard.press('Tab');
  const ring = await p.evaluate(() => {
    const el = document.activeElement;
    const s = getComputedStyle(el);
    return { text: el.textContent, outline: `${s.outlineStyle} ${s.outlineWidth}` };
  });
  check('keyboard focus ring on approve-without-AI', /Approve without AI/.test(ring.text) && ring.outline.startsWith('solid'), ring.outline);
  await p.screenshot({ path: `${OUT}/zero-ai-2-approve-buttons.png` });
  check('no horizontal overflow before approval', (await overflow()) <= 0);
  await p.keyboard.press('Enter');
  await p.waitForFunction(() => document.querySelector('textarea[name="instagram.text"]')?.value.length > 0, null, { timeout: 20000 });
  const tt = await p.locator('textarea[name="tiktok.text"]').inputValue();
  const ytTitle = await p.locator('input[name="youtube.title"]').inputValue();
  check('default TikTok caption from title + hook', tt.startsWith('Mie Pedas Level 10: Mie pedas level 10 itu kemenangan'), tt.split('\n')[0]);
  check('default YouTube title ≤ 100 with #Shorts', ytTitle.length <= 100 && ytTitle.endsWith('#Shorts'), ytTitle);
  check('post / schedule unlocked', !(await p.locator('button:text-is("Post now to selected")').isDisabled()) || (await p.locator('text=TikTok: choose who can watch').count()) > 0);

  // open every drawer, then measure the phone layout
  for (const d of await p.locator('details:has(summary:text("Caption and settings"))').all()) await d.evaluate((el) => (el.open = true));
  check('no horizontal overflow with every drawer open', (await overflow()) <= 0, `${await overflow()} px`);
  const labels = await p.locator('label[for$="-text"], label[for$="-title"]').allInnerTexts();
  check('every caption field has a label', labels.length >= 6, labels.join(' | '));
  const small = await p.evaluate(() => {
    const card = document.querySelector('#shared-caption').closest('form').parentElement;
    return [...card.querySelectorAll('button, summary, select, input[type=datetime-local]')]
      .filter((el) => el.offsetParent)
      .map((el) => ({ t: (el.textContent || el.getAttribute('name') || el.tagName).trim().slice(0, 30), h: el.getBoundingClientRect().height }))
      .filter((x) => x.h < 44);
  });
  const counted = await p.evaluate(() => document.querySelector('#shared-caption').closest('form').parentElement.querySelectorAll('button, summary, select').length);
  check('tap targets ≥ 44 px in the publish card', small.length === 0 && counted >= 8, `${counted} controls; too small: ${JSON.stringify(small)}`);

  // shared caption → every selected platform
  await p.fill('#shared-caption', 'Tim Uco atau Tim Ocu? Mie pedas level 10 menurut sains.');
  await p.click('button:text-is("Apply to selected platforms")');
  const applied = await Promise.all(['tiktok', 'instagram', 'facebook', 'youtube'].map((x) => p.locator(`textarea[name="${x}.text"]`).inputValue()));
  check('shared caption applied to all four platforms', applied.every((v) => v.startsWith('Tim Uco atau Tim Ocu?')));
  await p.fill('textarea[name="instagram.text"]', 'Override khusus Instagram.');
  check('per-platform override kept', (await p.locator('textarea[name="tiktok.text"]').inputValue()).startsWith('Tim Uco') && (await p.locator('textarea[name="instagram.text"]').inputValue()) === 'Override khusus Instagram.');
  check('character count shown', (await p.locator('text=/^26 \\/ 2,200$/').count()) === 1);

  // empty state: blank required fields block posting with inline errors
  await p.fill('input[name="youtube.title"]', '');
  await p.locator('input[name="youtube.title"]').blur();
  check('inline error on a cleared YouTube title', (await p.locator('text=YouTube Shorts: write a title.').count()) > 0);
  await p.fill('textarea[name="tiktok.text"]', '');
  await p.selectOption('select[name="tiktok.privacy"]', 'MUTUAL_FOLLOW_FRIENDS');
  await p.click('button:text-is("Post now to selected")');
  await p.waitForSelector('text=/Fix these 2 captions before posting/');
  check('post blocked with a summary of blank captions', true);
  const focused = await p.evaluate(() => document.activeElement?.getAttribute('name'));
  check('focus moved to the first blank field', focused === 'tiktok.text', focused);
  await p.screenshot({ path: `${OUT}/zero-ai-3-validation.png` });
  await p.fill('input[name="youtube.title"]', 'Mie Pedas Level 10 #Shorts');
  await p.fill('textarea[name="tiktok.text"]', 'Mie pedas level 10: menang atau siksa?');

  // schedule, cancel, post now
  const t = new Date(Date.now() + 26 * 3600_000 + 7 * 3600_000).toISOString().slice(0, 16); // tomorrow, WIB
  await p.fill('input[name="at"]', t);
  await p.click('button:text-is("Schedule post")');
  await p.waitForSelector('text=/Scheduled for .* WIB/', { timeout: 20000 });
  check('schedule post works', true);
  await p.click('button:text-is("Cancel schedule")');
  await p.waitForSelector('text=Scheduled post cancelled.', { timeout: 20000 });
  // hold the server action for 2 s so the loading state can be seen
  await p.route('**/create/**', async (route) => {
    if (route.request().method() === 'POST') await new Promise((r) => setTimeout(r, 2000));
    await route.continue();
  });
  const post = p.locator('button:has-text("Post now to selected"), button:has-text("Working…")').first();
  await post.click();
  await p.waitForSelector('button:text-is("Working…")', { timeout: 3000 });
  const busy = await p.locator('button:text-is("Working…")').first().evaluate((el) => ({ disabled: el.disabled, cursor: getComputedStyle(el).cursor }));
  check('loading: post button disabled with not-allowed cursor', busy.disabled && busy.cursor === 'not-allowed', JSON.stringify(busy));
  await p.waitForSelector('text=/Publishing to /', { timeout: 30000 });
  check('post now works', true);
  await p.unroute('**/create/**');
  await p.screenshot({ path: `${OUT}/zero-ai-4-posted.png`, fullPage: true });
  check('ZERO Anthropic calls: approve without AI, edit, validate, schedule, post', anthropicCalls === 0, `${anthropicCalls} call(s)`);

  // dark mode: the approve-without-AI button on the navy card
  const dark = await b.newContext({ viewport: { width: 390, height: 844 }, colorScheme: 'dark', isMobile: true, hasTouch: true });
  await dark.addCookies(await ctx.cookies());
  const dp = await dark.newPage();
  await dp.goto(`${base}/create/${epA}`);
  await sql`UPDATE content_projects SET platform_captions = NULL WHERE id = ${epA}`;
  await sql`UPDATE scripts SET approved_at = NULL WHERE project_id = ${epA}`;
  await dp.reload();
  const db2 = dp.locator('button:text-is("Approve without AI (write captions myself)")').last();
  await db2.scrollIntoViewIfNeeded();
  const ds = await db2.evaluate((el) => {
    const s = getComputedStyle(el);
    let n = el.parentElement;
    while (n && getComputedStyle(n).backgroundColor === 'rgba(0, 0, 0, 0)') n = n.parentElement;
    return { color: s.color, border: s.borderTopColor, bg: n ? getComputedStyle(n).backgroundColor : null };
  });
  const lum = (c) => {
    const [r, g, b] = c.match(/\d+/g).slice(0, 3).map((v) => {
      const x = Number(v) / 255;
      return x <= 0.03928 ? x / 12.92 : ((x + 0.055) / 1.055) ** 2.4;
    });
    return 0.2126 * r + 0.7152 * g + 0.0722 * b;
  };
  const ratio = (a, c) => (Math.max(lum(a), lum(c)) + 0.05) / (Math.min(lum(a), lum(c)) + 0.05);
  check('dark mode: button text contrast ≥ 4.5:1 (WCAG AA)', ratio(ds.color, ds.bg) >= 4.5, `${ratio(ds.color, ds.bg).toFixed(1)}:1 ${JSON.stringify(ds)}`);
  check('dark mode: border contrast ≥ 3:1', ratio(ds.border, ds.bg) >= 3, `${ratio(ds.border, ds.bg).toFixed(1)}:1`);
  await dp.screenshot({ path: `${OUT}/zero-ai-5-dark.png` });
  await dark.close();

  // ---- 3. Manual / Exact Import: saved pre-approved with editable captions, no Anthropic calls
  anthropicCalls = 0;
  await p.goto(`${base}/create`);
  await p.click('text=Use my own script (No AI)');
  await p.fill('#mc-title', 'Bubur diaduk vs nggak diaduk');
  await p.fill('#mc-script', '1. UCO: "Bubur itu harus diaduk!"\n2. OCU: "Itu namanya kehilangan tekstur."');
  await p.click('button:text("Parse & preview beats")');
  await p.click('button:text("Save episode (No AI)")');
  await p.waitForURL(/\/create\/[0-9a-f-]+$/, { timeout: 30000 });
  await p.waitForSelector('#shared-caption');
  const manualCaption = await p.locator('textarea[name="tiktok.text"]').inputValue();
  check('manual episode: pre-approved with default captions', manualCaption.startsWith('Bubur diaduk vs nggak diaduk'), manualCaption.split('\n')[0]);
  check('manual episode: no approve step left', (await p.locator('button:text-is("Approve script & write captions")').count()) === 0);
  check('manual episode: zero Anthropic calls', anthropicCalls === 0);
  const manualId = p.url().split('/').pop();

  console.log('page errors:', errors.length, errors.slice(0, 3));
  await b.close();
  await sql`DELETE FROM content_projects WHERE id IN (${epA}, ${epB}, ${manualId})`;
  await sql`DELETE FROM social_accounts WHERE external_account_id LIKE 'zeroai-%'`;
  await sql.end();
  mock.close();
  const failed = results.filter((r) => !r.ok);
  console.log(`\n${results.length - failed.length}/${results.length} checks passed`);
  process.exit(failed.length ? 1 : 0);
})().catch(async (e) => {
  console.error('FAILED:', e.message);
  mock.close();
  process.exit(1);
});
