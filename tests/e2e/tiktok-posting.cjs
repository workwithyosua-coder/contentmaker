// Browser test of TikTok's posting screen rules + a full post against tests/e2e/tiktok-mock.cjs.
// App on PORT (default 3006) with TIKTOK_API_BASE=http://localhost:4020 and a TikTok account seeded; args: <episodeId>
const { chromium } = require('playwright');
const base = `http://localhost:${process.env.PORT || 3006}`; const ep = process.argv[2];
(async () => {
  const b = await chromium.launch(); const p = await (await b.newContext({ viewport: { width: 430, height: 932 }, deviceScaleFactor: 1 })).newPage();
  const errors = []; p.on('pageerror', (e) => errors.push(String(e)));
  const step = (s) => console.log('·', s);
  await p.goto(`${base}/login`); await p.fill('#password', process.env.APP_PASSWORD); await p.click('button[type=submit]'); await p.waitForURL(`${base}/`);
  await p.goto(`${base}/create/${ep}`); await p.waitForLoadState('networkidle');
  await p.getByText('Publish to social media').scrollIntoViewIfNeeded();
  step('account line: ' + (await p.locator('text=/Posting as /').innerText()));
  const opts = await p.locator('select[name="tiktok.privacy"] option').allInnerTexts(); step('privacy options from TikTok: ' + opts.join(' | '));
  if ((await p.locator('select[name="tiktok.privacy"]').inputValue()) !== '') throw new Error('privacy has a default');
  step('no default privacy; posting blocked: ' + (await p.locator('text=TikTok: choose who can watch before posting.').count() === 1) + ', Post disabled: ' + (await p.locator('button:text("Post now to selected")').isDisabled()));
  const ints = await p.locator('input[name^="tiktok.allow"]').evaluateAll((els) => els.map((e) => `${e.name.split('.')[1]}:${e.checked ? 'on' : 'off'}${e.disabled ? '(disabled)' : ''}`));
  step('interactions start off, Duet greyed out by the account: ' + ints.join(' '));
  step('consent line: ' + (await p.locator('text=/By posting to TikTok/').innerText()));
  await p.selectOption('select[name="tiktok.privacy"]', 'SELF_ONLY');
  await p.check('input[name="tiktok.discloseContent"]');
  step('disclosure on without a choice blocks posting: ' + (await p.locator('text=/choose Your brand, Branded content, or both/').count() === 1));
  await p.check('input[name="tiktok.brandContent"]');
  step('branded content + Only me blocked: ' + (await p.locator("text=TikTok: branded content can't be posted as Only me.").count() === 1) + '; consent now: ' + (await p.locator('text=/By posting to TikTok/').innerText()));
  await p.screenshot({ path: '/tmp/claude-0/tt-ui.png', fullPage: false });
  await p.selectOption('select[name="tiktok.privacy"]', 'MUTUAL_FOLLOW_FRIENDS');
  await p.check('input[name="tiktok.allowComments"]');
  await p.click('button:text("Post now to selected")');
  await p.waitForSelector('text=/Publishing to tiktok/', { timeout: 20000 }); step('posted');
  for (let i = 0; i < 20 && !(await p.locator('text=Open post').count()); i++) { await p.waitForTimeout(2000); await p.reload(); }
  step('status: ' + (await p.locator('.stamp').allInnerTexts()).join(', ') + ' · note: ' + (await p.locator('text=/It can take a few minutes/').count() ? 'shown' : 'missing'));
  const sent = await (await p.request.get('http://127.0.0.1:4020/posted')).json(); const pi = sent[sent.length - 1];
  step(`sent to TikTok: privacy=${pi.privacy_level} comments=${!pi.disable_comment} duet=${!pi.disable_duet} stitch=${!pi.disable_stitch} branded=${pi.brand_content_toggle} organic=${pi.brand_organic_toggle}`);
  console.log('page errors:', errors.length, errors.slice(0, 2)); await b.close();
})().catch((e) => { console.error('FAILED:', e.message); process.exit(1); });
