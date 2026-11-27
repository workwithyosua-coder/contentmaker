// Browser test of "Redo all N lines with AI" in the recording booth, at desktop width and on a 390 px phone.
// Starts a fake Gemini TTS API on :4012 (1 s of PCM; the 2nd request of the first batch fails). Needs the app on PORT
// (default 3007) with GEMINI_API_BASE=http://localhost:4012 GEMINI_API_KEY=test STORAGE_DRIVER=local APP_PASSWORD=…
// DATABASE_URL=…
const http = require('http');
const fs = require('fs');
const path = require('path');
const postgres = require('postgres').default ?? require('postgres');
const { chromium } = require('playwright');

const base = `http://localhost:${process.env.PORT || 3007}`;
const OUT = process.env.OUT || path.join(__dirname, 'output');
fs.mkdirSync(OUT, { recursive: true });
const sql = postgres(process.env.DATABASE_URL, { onnotice: () => {} });

const requests = [];
let failNext = 0; // fail the N-th upcoming request (1-based), once
const PCM = (() => {
  const b = Buffer.alloc(48000);
  for (let i = 0; i < 24000; i++) b.writeInt16LE(Math.round(9000 * Math.sin((2 * Math.PI * 200 * i) / 24000)), i * 2);
  return b.toString('base64');
})();
const mock = http
  .createServer((req, res) => {
    let body = '';
    req.on('data', (c) => (body += c));
    req.on('end', () => {
      const b = JSON.parse(body || '{}');
      requests.push({ text: b.contents?.[0]?.parts?.[0]?.text, style: b.contents?.[0]?.parts?.[0]?.speechMetadata?.style, voice: b.generationConfig?.speechConfig?.voiceConfig?.prebuiltVoiceConfig?.voiceName });
      if (failNext && --failNext === 0) {
        res.writeHead(500, { 'content-type': 'application/json' });
        res.end(JSON.stringify({ error: { code: 500, message: 'Internal error encountered.', status: 'INTERNAL' } }));
        return;
      }
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ candidates: [{ content: { parts: [{ inlineData: { mimeType: 'audio/L16;codec=pcm;rate=24000', data: PCM } }] } }] }));
    });
  })
  .listen(4012);

(async () => {
  const [u] = await sql`SELECT id FROM users ORDER BY created_at LIMIT 1`;
  const lines = [
    { beat: 'hook', speaker: 'uco', text: 'Kopi susu tiap hari itu investasi mental!', subtitle: 'Daily iced coffee is a mental investment!', expression: 'excited', emotion: 'triumphant', thought_bubble: false, visual: '', sfx: [] },
    { beat: 'counter', speaker: 'ocu', text: 'Tiga puluh ribu sehari, sembilan juta setahun.', subtitle: 'Thirty thousand a day.', expression: 'deadpan', emotion: 'deadpan', thought_bubble: false, visual: '', sfx: [] },
    { beat: 'button', speaker: 'uco', text: 'Hah, serius lo?!', subtitle: 'Wait, seriously?!', expression: 'shocked', emotion: 'shocked', thought_bubble: false, visual: '', sfx: [] },
  ];
  const [p] = await sql`INSERT INTO content_projects (user_id, title, format, target_platforms, status, video_style, voice_provider, delivery_preset) VALUES (${u.id}, 'Redo all test', 'short_video', '{tiktok}', 'awaiting_recording', 'editorial-paper-cutout', 'gemini_tts', 'standard') RETURNING id`;
  const [s] = await sql`INSERT INTO scripts (project_id, version, title, target_duration_s, lines, sources, custom, approved_at) VALUES (${p.id}, 1, 'Redo all test', 10, ${sql.json(lines)}, '[]', true, now()) RETURNING id`;
  // every line already voiced (booth takes): "Voice the missing lines" has nothing to do
  for (const [i, l] of lines.entries()) {
    await sql`INSERT INTO recordings (project_id, script_id, line_index, speaker, take, storage_path, mime_type, size_bytes, duration_ms, source) VALUES (${p.id}, ${s.id}, ${i}, ${l.speaker}, 1, ${`${p.id}/${s.id}/line-0${i + 1}-${l.speaker}-take-1.webm`}, 'audio/webm', 10, 1000, 'booth')`;
  }

  const b = await chromium.launch();
  const results = [];
  const check = (name, ok, detail = '') => {
    results.push({ name, ok });
    console.log(`${ok ? 'PASS' : 'FAIL'} ${name}${detail ? ` (${detail})` : ''}`);
  };
  const login = async (page) => {
    await page.goto(`${base}/login`);
    await page.fill('#password', process.env.APP_PASSWORD);
    await page.click('button[type=submit]');
    await page.waitForURL(`${base}/`);
  };
  const selected = async () => (await sql`SELECT line_index, take, source, ai_prompt FROM recordings WHERE script_id = ${s.id} AND is_selected ORDER BY line_index`).map((r) => `${r.line_index}:${r.take}:${r.source}`);

  // ---- desktop
  const desk = await (await b.newContext({ viewport: { width: 1280, height: 900 }, colorScheme: 'dark', reducedMotion: 'reduce' })).newPage();
  const errors = [];
  desk.on('pageerror', (e) => errors.push(String(e)));
  await login(desk);
  await desk.goto(`${base}/create/${p.id}/record`);
  const primary = desk.getByRole('button', { name: 'All lines have a take' });
  const redoAll = desk.getByRole('button', { name: 'Redo all 3 lines with AI' });
  await redoAll.waitFor();
  const before = await desk.locator('.stamp', { hasText: /· take \d/ }).allInnerTexts();
  const [pb, rb] = [await primary.boundingBox(), await redoAll.boundingBox()];
  check('desktop: "Redo all 3 lines with AI" sits beside "All lines have a take" (same row)', Math.abs(pb.y - rb.y) < 2 && rb.x > pb.x + pb.width, JSON.stringify({ pb, rb }));
  const summary = await desk.locator('summary', { hasText: 'Redo one line with AI' }).boundingBox();
  check('desktop: the action row is above "Redo one line with AI"', rb.y + rb.height <= summary.y);
  check('desktop: 44 px tap targets', pb.height >= 44 && rb.height >= 44, `${pb.height} / ${rb.height}`);
  check('desktop: the primary stays disabled (nothing missing): cached takes are never re-voiced by it', await primary.isDisabled());

  // the inline confirmation, Escape cancels and focus returns
  await redoAll.click();
  const panel = desk.locator('[data-redo-confirm]');
  await panel.waitFor();
  check('confirm: inline panel (no window.confirm) with the provider and delivery', /Redo all 3 voiced lines using Gemini TTS \(Free\) \(Standard\)\? New AI takes will be added and set active for each line\./.test(await panel.innerText()));
  const confirmBtn = desk.getByRole('button', { name: 'Confirm redo (3 lines)' });
  check('confirm: Confirm focused, 44 px buttons', (await desk.evaluate(() => document.activeElement?.textContent)) === 'Confirm redo (3 lines)' && (await confirmBtn.boundingBox()).height >= 44 && (await desk.getByRole('button', { name: 'Cancel' }).boundingBox()).height >= 44);
  await desk.keyboard.press('Escape');
  await panel.waitFor({ state: 'detached' });
  check('confirm: Escape closes it and returns focus to "Redo all"', await desk.evaluate(() => document.activeElement?.hasAttribute('data-redo-all')));
  check('nothing was voiced by opening and cancelling', requests.length === 0);

  // switch delivery, then confirm: the batch uses the selected provider + delivery
  await desk.getByLabel('Angry / Urgent').check();
  await desk.waitForSelector('text=/Saved: Gemini TTS \\(Free\\), Angry \\/ Urgent/');
  await redoAll.click();
  check('confirm: the panel shows the new delivery', /using Gemini TTS \(Free\) \(Angry \/ Urgent\)\?/.test(await panel.innerText()));
  failNext = 2; // the 2nd line fails
  await desk.getByRole('button', { name: 'Confirm redo (3 lines)' }).click();
  const status = desk.locator('[data-redo-status] p.tabular-nums');
  await status.waitFor();
  const progressText = await status.innerText();
  check('running: live progress, tabular-nums, in an aria-live region', /^Redoing line [1-3] of 3 with Gemini TTS \(Free\)…$/.test(progressText) && (await status.evaluate((e) => getComputedStyle(e).fontVariantNumeric)) === 'tabular-nums' && (await desk.locator('[data-redo-status]').getAttribute('aria-live')) === 'polite', progressText);
  const radiosLocked = await desk.getByLabel('ElevenLabs').isDisabled();
  const uploadLocked = (await desk.locator('label:has-text("Upload full voice-over")').getAttribute('aria-disabled')) === 'true' && (await desk.locator('label:has-text("Upload full voice-over") input[type=file]').isDisabled());
  const redoOneLocked = await desk.locator('details fieldset').evaluate((f) => f.disabled);
  const cursor = await desk.locator('label:has-text("Upload full voice-over")').evaluate((e) => getComputedStyle(e).cursor);
  check('running: provider / delivery radios, Redo all, Redo one and the upload are locked (cursor not-allowed)', radiosLocked && uploadLocked && redoOneLocked && (await redoAll.isDisabled()) && cursor === 'not-allowed', JSON.stringify({ radiosLocked, uploadLocked, redoOneLocked, cursor }));
  await desk.locator('[data-redo-retry]').waitFor({ timeout: 90_000 });
  const alert = await desk.locator('[data-redo-status] [role=alert]').innerText();
  check('partial error: the failed line number and the reason, retry button with the count', /2 of 3 lines redone/.test(alert) && /Line 2: Gemini TTS 500/.test(alert) && /Retry failed lines \(1\)/.test(alert), alert.replace(/\n/g, ' | '));
  await desk.waitForTimeout(1500);
  check('partial error: the lines that worked keep their new AI take; line 2 keeps its old one', JSON.stringify(await selected()) === JSON.stringify(['0:2:ai', '1:1:booth', '2:2:ai']), JSON.stringify(await selected()));
  // the list below refreshes in place (the test never reloads the page): the open line's stamp moved from its
  // recording to the new AI take
  const after = await desk.locator('.stamp', { hasText: /· take \d/ }).allInnerTexts();
  check('the takes list refreshed in place (the open line now shows its new AI take)', before.includes('Recorded · take 1') && after.includes('AI voice · take 2'), JSON.stringify({ before, after }));
  await desk.locator('[data-redo-retry]').click();
  await desk.waitForSelector('text=Redid 1 line with Gemini TTS (Free) (Angry / Urgent). Ready to render.', { timeout: 60_000 });
  await desk.waitForTimeout(1000);
  check('retry: the failed line is redone; every line now on a new selected AI take', JSON.stringify(await selected()) === JSON.stringify(['0:2:ai', '1:2:ai', '2:2:ai']), JSON.stringify(await selected()));
  const prompts = (await sql`SELECT ai_prompt FROM recordings WHERE script_id = ${s.id} AND is_selected ORDER BY line_index`).map((r) => r.ai_prompt);
  check('every redone take used the selected provider + delivery (Gemini TTS, urgent style), the line text only', prompts.every((x) => /^\[gemini_tts\] style: .*urgent, pressing/.test(x)) && requests.every((r) => !/urgent/.test(r.text ?? '')), prompts[0]);
  check('requests went out one line at a time: 3 + 1 retry', requests.length === 4, `${requests.length}`);
  check('desktop: no horizontal overflow', (await desk.evaluate(() => document.documentElement.scrollWidth - window.innerWidth)) <= 0);
  await desk.screenshot({ path: `${OUT}/redo-all-desktop.png`, fullPage: false });

  // ---- 390 px phone
  const phone = await (await b.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, colorScheme: 'dark' })).newPage();
  phone.on('pageerror', (e) => errors.push(String(e)));
  await login(phone);
  await phone.goto(`${base}/create/${p.id}/record`);
  const mRedo = phone.getByRole('button', { name: 'Redo all 3 lines with AI' });
  await mRedo.waitFor();
  const mPrimary = await phone.getByRole('button', { name: 'All lines have a take' }).boundingBox();
  const mr = await mRedo.boundingBox();
  check('phone: Redo all next to (or wrapped right under) the primary, 44 px, inside the screen', mr.height >= 44 && mr.x >= 0 && mr.x + mr.width <= 390 && mr.y >= mPrimary.y && mr.y <= mPrimary.y + mPrimary.height + 16, JSON.stringify({ mPrimary, mr }));
  await mRedo.tap();
  const mPanel = phone.locator('[data-redo-confirm]');
  await mPanel.waitFor();
  await phone.waitForTimeout(600);
  const btns = await Promise.all(['Confirm redo (3 lines)', 'Cancel'].map(async (n) => (await phone.getByRole('button', { name: n }).boundingBox()).height));
  check('phone: confirm buttons 44 px', btns.every((h) => h >= 44), JSON.stringify(btns));
  // both buttons actually tappable: nothing (the fixed bottom tab bar) covers their centres
  const clear = await phone.evaluate(() =>
    [...document.querySelectorAll('[data-redo-confirm] button')].every((b) => {
      const r = b.getBoundingClientRect();
      return b.contains(document.elementFromPoint(r.x + r.width / 2, r.y + r.height / 2));
    }),
  );
  check('phone: Confirm and Cancel scrolled into view, not under the bottom tab bar', clear);
  check('phone: no horizontal overflow (panel open)', (await phone.evaluate(() => document.documentElement.scrollWidth - window.innerWidth)) <= 0);
  await mPanel.screenshot({ path: `${OUT}/redo-all-phone-confirm.png` });
  await phone.getByRole('button', { name: 'Cancel' }).tap();

  console.log('page errors:', errors.length, errors.slice(0, 3));
  await sql`DELETE FROM content_projects WHERE id = ${p.id}`;
  await sql.end();
  await b.close();
  mock.close();
  const failed = results.filter((r) => !r.ok);
  console.log(`\n${results.length - failed.length}/${results.length} checks passed`);
  process.exit(failed.length || errors.length ? 1 : 0);
})().catch(async (e) => {
  console.error('FAILED:', e.message);
  mock.close();
  await sql.end();
  process.exit(1);
});
