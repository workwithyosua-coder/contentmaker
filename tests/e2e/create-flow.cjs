// Browser test of the Create flow against the fake Claude server (tests/e2e/claude-mock.cjs, started with FAIL_SCRIPT=1).
// Needs the app running on PORT (default 3006) with ANTHROPIC_BASE_URL=http://localhost:4010 and APP_PASSWORD=local-test-pw.
const { chromium, devices } = require('playwright');
const PORT = process.env.PORT || '3006';
const PASSWORD = process.env.APP_PASSWORD || PASSWORD;
(async () => {
  const S = require('path').join(__dirname, 'output'); require('fs').mkdirSync(S, { recursive: true }); const b = await chromium.launch(); const c = await b.newContext({ ...devices['iPhone 14'] }); const p = await c.newPage();
  const errors = []; p.on('console', m => m.type() === 'error' && errors.push(m.text())); p.on('pageerror', e => errors.push(String(e)));
  const step = (s) => console.log(`[${((Date.now() - t0) / 1000).toFixed(1)}s] ${s}`); const t0 = Date.now();
  await p.goto(`http://localhost:${PORT}/login`); await p.fill('#password', PASSWORD); await p.click('button[type=submit]'); await p.waitForURL(`http://localhost:${PORT}/`);
  await p.goto(`http://localhost:${PORT}/create`); await p.fill('#direction', 'Antre roti viral'); await p.click('text=Pitch me 5 ideas');
  await p.waitForURL(/\/create\/[0-9a-f-]+$/); step('redirected to episode page right away');
  await p.waitForSelector('text=Brainstorming ideas'); step('progress shown: brainstorming');
  await p.screenshot({ path: `${S}/1-progress.png` });
  await p.waitForSelector('text=Write this one', { timeout: 30000 }); step('ideas appeared by themselves (auto-refresh)');
  await p.locator('text=Write this one').first().click();
  await p.waitForSelector('text=Fact-checking with web search'); step('progress shown: writing');
  await p.waitForSelector('text=The last step didn', { timeout: 40000 }); step('simulated failure shown, message: "' + (await p.locator('[role=alert] p').nth(1).innerText()) + '"');
  await p.screenshot({ path: `${S}/2-error.png` });
  await p.click('text=Try writing again'); step('clicked Try writing again');
  await p.waitForSelector('text=Approve script', { timeout: 40000 }); step('script appeared by itself');
  await p.click('text=Approve script & write captions');
  await p.waitForSelector('text=Writing captions for TikTok'); step('progress shown: captions');
  await p.getByRole('heading', { name: 'Captions', exact: true }).waitFor({ timeout: 30000 }); step('captions appeared by themselves: ' + await p.locator('li:has(button:text("Copy"))').count() + ' platforms');
  await p.screenshot({ path: `${S}/3-done.png`, fullPage: true });
  await p.goto(`http://localhost:${PORT}/create`); step('list status: ' + await p.locator('.ticket .stamp').first().innerText());
  console.log('console errors:', errors.length, errors.slice(0, 3)); await b.close();
})().catch(e => { console.error('FLOW FAILED:', e.message); process.exit(1); });
