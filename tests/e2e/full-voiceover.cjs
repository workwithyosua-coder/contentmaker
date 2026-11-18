// Browser test of "Full voice-over": upload one recording of the whole episode, check the cuts, save one take per line.
// Run the app with STORAGE_DRIVER=local APP_PASSWORD=local-test-pw PORT=3007, then:
//   node tests/e2e/full-voiceover.cjs <episodeId> <audio file> <screenshot dir>
const { chromium, devices } = require('playwright');
(async () => {
  const [ep, file, out] = process.argv.slice(2); const base = 'http://localhost:3007';
  const b = await chromium.launch(); const c = await b.newContext({ ...devices['Pixel 7'] }); const p = await c.newPage();
  const errors = []; p.on('console', m => m.type() === 'error' && errors.push(m.text())); p.on('pageerror', e => errors.push(String(e)));
  const log = (s) => console.log('·', s);
  await p.goto(base + '/login'); await p.fill('#password', 'local-test-pw'); await p.click('button[type=submit]'); await p.waitForURL(base + '/');
  await p.goto(`${base}/create/${ep}/record`); await p.waitForLoadState('networkidle');
  await p.locator('input[type=file]').first().setInputFiles(file);
  await p.getByRole('button', { name: /^Save \d+ takes$/ }).waitFor();
  const n = await p.locator('button[aria-label^="Play line"]').count();
  const cuts = await p.getByText(/^Cut at/).allInnerTexts();
  log(`lines listed: ${n} | ${cuts.join(' · ')}`);
  const lens = await p.locator('ol li .tabular-nums').allInnerTexts(); log('clip lengths: ' + lens.join(', '));
  await p.locator('button[aria-label="Play line 1"]').click(); await p.waitForSelector('button[aria-label="Stop line 1"]'); log('play line 1 → shows Stop');
  await p.locator('button[aria-label="Stop line 1"]').click();
  const before = (await p.getByText(/^Cut at/).first().innerText());
  await p.locator('button[aria-label="Move the cut after line 1 later"]').click();
  const later = (await p.getByText(/^Cut at/).first().innerText());
  await p.locator('button[aria-label="Move the cut after line 1 earlier"]').click();
  log(`move cut 1: ${before} → ${later} → ${await p.getByText(/^Cut at/).first().innerText()}`);
  await p.screenshot({ path: `${out}/full-vo-review.png`, fullPage: true });
  await p.getByRole('button', { name: /^Save \d+ takes$/ }).click();
  await p.getByText(/All \d+ lines saved/).waitFor({ timeout: 60000 }); log('saved: ' + await p.getByText(/All \d+ lines saved/).innerText());
  await p.waitForTimeout(1500); await p.reload();
  log('booth progress after reload: ' + await p.locator('[aria-live=polite]').first().innerText());
  const small = await p.evaluate(() => [...document.querySelectorAll('button, label.btn')].filter(e => e.offsetParent && e.closest('section,div')).map(e => Math.round(e.getBoundingClientRect().height)).filter(h => h < 44).length);
  log('controls under 44px: ' + small + ' | console errors: ' + errors.length + ' ' + errors.slice(0, 2).join(' | '));
  await b.close();
})().catch(async e => { console.error('FULL VO TEST FAILED:', e.message.split('\n')[0]); process.exit(1); });
