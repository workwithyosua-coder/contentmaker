// Browser test of Paste / Import script + inline line editing, against the fake Claude server (tests/e2e/claude-mock.cjs).
// App on PORT (default 3006) with ANTHROPIC_BASE_URL=http://localhost:4010 and APP_PASSWORD; args: <episodeId>
const { chromium } = require('playwright');
const PORT = process.env.PORT || '3006'; const base = `http://localhost:${PORT}`; const ep = process.argv[2];
const SCRIPT = `HOOK
1. UCO (0:00–0:06 | Hook, loud, holding phone): "Semua ngaku bokek, tapi kafe penuh!"
[EN] Everyone says they're broke, but cafes are packed!
2. OCU: "Justru itu tanda kita lagi bokek." (flat)
3. **UCO** — Bokek apaan? Antre matcha 65 ribu!
4. OCU (0:12–0:15): Rumah nggak kebeli, ya udah beli yang kecil-kecil.
UCO (thought): Sial, masuk akal. Jangan sampai dia tahu.
OCU — Es batunya yang banyak... Dosisnya harus pas.`;
(async () => {
  const b = await chromium.launch(); const p = await (await b.newContext({ viewport: { width: 430, height: 932 } })).newPage();
  const errors = []; p.on('pageerror', e => errors.push(String(e)));
  const step = (s) => console.log('·', s);
  await p.goto(`${base}/login`); await p.fill('#password', process.env.APP_PASSWORD); await p.click('button[type=submit]'); await p.waitForURL(`${base}/`);
  await p.goto(`${base}/create/${ep}`);
  // 1. a full script in the Revise box is caught
  await p.fill('#feedback', SCRIPT); await p.click('text=Revise script');
  await p.waitForSelector('text=This looks like a full script'); step('pasting a script into Revise points to the Import tab');
  // 2. import, exact mode
  await p.click('role=tab[name="Paste / Import script"]');
  await p.fill('#import-script', SCRIPT); await p.fill('#import-notes', 'Keep my exact Indonesian wording.');
  await p.click('text=Import as new version');
  const saved = await p.waitForSelector('text=/Saved as script v\\d+: 6 lines/', { timeout: 30000 }); step(await saved.innerText());
  await p.reload();
  const header = await p.locator('text=/Script v\\d+ of \\d+ · 6 lines · ~\\d+ s/').first().innerText(); step('header: ' + header);
  await p.waitForSelector('text=/^Imported 6-line script/'); step('clean version note');
  const texts = await p.locator('ol li p.text-sm').allInnerTexts();
  if (texts.join('|') !== ['Semua ngaku bokek, tapi kafe penuh!', 'Justru itu tanda kita lagi bokek.', 'Bokek apaan? Antre matcha 65 ribu!', 'Rumah nggak kebeli, ya udah beli yang kecil-kecil.', 'Sial, masuk akal. Jangan sampai dia tahu.', 'Es batunya yang banyak... Dosisnya harus pas.'].join('|')) throw new Error('exact text not kept: ' + texts.join(' | '));
  step('all 6 Indonesian lines kept word for word (the model tried to rewrite them)');
  const subs = await p.locator('ol li p.italic').allInnerTexts();
  if (subs[0] !== "Everyone says they're broke, but cafes are packed!" || subs[1] !== 'mock EN') throw new Error('subtitles: ' + subs.slice(0, 2).join(' | '));
  step('[EN] used where given, translation elsewhere');
  if (!(await p.locator('ol li .border-dashed').count())) throw new Error('thought line not dashed');
  step('inner thought shown as a dashed card: ' + await p.locator('ol li .border-dashed span.text-muted').first().innerText());
  const prog = await p.locator('text=/\\d+ of 6 lines recorded/').first().innerText(); step('record card: ' + prog);
  // 3. inline edit
  await p.locator('button[aria-label="Edit this line"]').first().click();
  await p.fill('textarea[name=text]', 'Semua ngaku bokek, tapi kafe tetap penuh!'); await p.selectOption('select[name=expression]', 'shocked');
  await p.click('text=Save line'); await p.waitForSelector('text=Semua ngaku bokek, tapi kafe tetap penuh!');
  await p.reload(); await p.waitForSelector('text=Semua ngaku bokek, tapi kafe tetap penuh!'); step('inline edit saved: ' + await p.locator('ol li span.text-muted').first().innerText());
  // 4. older version view
  await p.locator('nav[aria-label="Script versions"] a').first().click(); await p.waitForSelector('text=An older version, view only'); step('older version opens view-only, no edit buttons: ' + await p.locator('button[aria-label="Edit this line"]').count());
  // 5. booth shows the new lines
  await p.goto(`${base}/create/${ep}/record`); await p.waitForSelector('text=Semua ngaku bokek, tapi kafe tetap penuh!'); step('recording booth shows the imported script');
  await p.screenshot({ path: '/tmp/claude-0/import-booth.png' });
  console.log('page errors:', errors.length, errors.slice(0, 2)); await b.close();
})().catch(e => { console.error('FAILED:', e.message); process.exit(1); });
