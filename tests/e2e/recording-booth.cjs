// Browser test of the recording booth with a simulated microphone (Chromium fake media devices).
// Run the app with STORAGE_DRIVER=local APP_PASSWORD=local-test-pw PORT=3007, then: node tests/e2e/recording-booth.cjs <episodeId> <dir-with-ocu-line.wav>
// The episode needs an approved script with Uco lines 1 and 3 and an Ocu line 2.
const { chromium, devices } = require('playwright');
(async () => {
  const [ep, S] = process.argv.slice(2); const base = 'http://localhost:3007';
  const b = await chromium.launch({ args: ['--use-fake-ui-for-media-stream', '--use-fake-device-for-media-stream'] });
  const c = await b.newContext({ ...devices['Pixel 7'], permissions: ['microphone'] }); const p = await c.newPage();
  const errors = []; p.on('console', m => m.type() === 'error' && errors.push(m.text())); p.on('pageerror', e => errors.push(String(e)));
  const log = (s) => console.log('·', s);
  await p.goto(base + '/login'); await p.fill('#password', 'local-test-pw'); await p.click('button[type=submit]'); await p.waitForURL(base + '/');
  await p.goto(`${base}/create/${ep}`); log('episode page button: ' + await p.locator('a.btn-primary').first().innerText());
  await p.click('text=Start recording'); await p.waitForURL(/\/record$/); log('opened booth');
  await p.click('text=Uco only'); log('url after choosing Uco: ' + new URL(p.url()).search + ' | ' + await p.locator('[aria-live=polite]').innerText());
  for (let i = 0; i < 2; i++) {
    const who = await p.locator('section[aria-label="Current line"] span.text-lg').innerText();
    await p.click('text=Record this line'); await p.waitForSelector('text=Recording 0:0'); await p.waitForTimeout(1600);
    const meter = await p.locator('div.bg-accent.transition-\\[width\\]').evaluate(e => e.style.width);
    await p.click('button:text("Stop")'); await p.waitForSelector('text=Listen back');
    if (i === 0) await p.screenshot({ path: `${S}/booth-review.png` });
    await p.click('button:text("Keep")'); await p.waitForSelector('text=Uploading…', { state: 'detached' }).catch(() => {});
    await p.waitForFunction((n) => document.querySelector('[aria-live=polite]').textContent.startsWith(String(n)), i + 1);
    log(`recorded ${who} line ${i + 1} (level meter showed ${meter}) → ${await p.locator('[aria-live=polite]').innerText()}`);
  }
  await p.click('text=Both characters'); log('both: ' + await p.locator('[aria-live=polite]').innerText());
  await p.setInputFiles('input[type=file]', `${S}/ocu-line.wav`);
  await p.waitForSelector('text=Every line is recorded.'); log('uploaded the Ocu line from a file → "Every line is recorded."');
  await p.screenshot({ path: `${S}/booth-done.png`, fullPage: true });
  // re-record line 1 → becomes take 2
  await p.locator('ol button').first().click(); await p.click('text=Record again'); await p.waitForTimeout(1200); await p.click('button:text("Stop")'); await p.click('button:text("Keep")');
  await p.waitForSelector('text=take 2'); log('re-recorded line 1 → now take 2');
  const src = await p.locator('audio').first().getAttribute('src'); const r = await p.request.get(base + src); log(`playback URL → ${r.status()} ${r.headers()['content-type']} ${(await r.body()).length} bytes`);
  const sizes = await p.evaluate(() => [...document.querySelectorAll('button, a[href], label.btn')].filter(e => e.offsetParent).map(e => Math.round(e.getBoundingClientRect().height)).filter(h => h < 44).length);
  log('controls under 44px: ' + sizes + ' | console errors: ' + errors.length + ' ' + errors.slice(0, 2).join(' | '));
  await b.close();
})().catch(e => { console.error('BOOTH TEST FAILED:', e.message.split('\n')[0]); process.exit(1); });
