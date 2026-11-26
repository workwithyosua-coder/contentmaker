// Browser test of the voice provider pickers, Gemini TTS takes and the Own-Voice model slots, on a 390 px phone.
// Starts a fake Gemini TTS API on :4012 (returns 1 s of PCM and logs each request). Needs the app on PORT (default
// 3007) with GEMINI_API_BASE=http://localhost:4012 GEMINI_API_KEY=test STORAGE_DRIVER=local APP_PASSWORD=… DATABASE_URL=…
// args: <model.pth> <model.index>
const http = require('http');
const fs = require('fs');
const path = require('path');
const postgres = require('postgres').default ?? require('postgres');
const { chromium } = require('playwright');

const base = `http://localhost:${process.env.PORT || 3007}`;
const [pth, index] = process.argv.slice(2);
const OUT = process.env.OUT || path.join(__dirname, 'output');
fs.mkdirSync(OUT, { recursive: true });
const sql = postgres(process.env.DATABASE_URL, { onnotice: () => {} });

const requests = [];
const mock = http
  .createServer((req, res) => {
    let body = '';
    req.on('data', (c) => (body += c));
    req.on('end', () => {
      const b = JSON.parse(body || '{}');
      requests.push({ url: req.url, key: req.headers['x-goog-api-key'], voice: b.generationConfig?.speechConfig?.voiceConfig?.prebuiltVoiceConfig?.voiceName, text: b.contents?.[0]?.parts?.[0]?.text, style: b.contents?.[0]?.parts?.[0]?.speechMetadata?.style, url: req.url });
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ candidates: [{ content: { parts: [{ inlineData: { mimeType: 'audio/L16;codec=pcm;rate=24000', data: Buffer.alloc(48000).toString('base64') } }] } }] }));
    });
  })
  .listen(4012);

(async () => {
  const [u] = await sql`SELECT id FROM users ORDER BY created_at LIMIT 1`;
  const lines = [
    { beat: 'hook', speaker: 'uco', text: 'Badak Jawa mau dipindah ke Alas Purwo?!', subtitle: 'Move the rhino?!', expression: 'angry', emotion: 'angry', thought_bubble: false, visual: '', sfx: [] },
    { beat: 'counter', speaker: 'ocu', text: 'Tenang. Itu namanya populasi kedua.', subtitle: 'Relax.', expression: 'deadpan', emotion: 'deadpan', thought_bubble: false, visual: '', sfx: [] },
    { beat: 'button', speaker: 'ocu', text: 'Satu tsunami, habis semua.', subtitle: 'One tsunami.', expression: 'deadpan', emotion: 'inspecting', thought_bubble: false, visual: '', sfx: [] },
  ];
  const [p] = await sql`INSERT INTO content_projects (user_id, title, format, target_platforms, status, video_style) VALUES (${u.id}, 'Voice test', 'short_video', '{tiktok}', 'awaiting_recording', 'editorial-paper-cutout') RETURNING id`;
  const [s] = await sql`INSERT INTO scripts (project_id, version, title, target_duration_s, lines, sources, custom, approved_at) VALUES (${p.id}, 1, 'Voice test', 10, ${sql.json(lines)}, '[]', true, now()) RETURNING id`;
  // line 2 already has a (booth) take: it must never be sent to the provider
  await sql`INSERT INTO recordings (project_id, script_id, line_index, speaker, take, storage_path, mime_type, size_bytes, duration_ms, source) VALUES (${p.id}, ${s.id}, 1, 'ocu', 1, ${`${p.id}/${s.id}/line-02-ocu-take-1.webm`}, 'audio/webm', 10, 1000, 'booth')`;

  const b = await chromium.launch();
  const page = await (await b.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, colorScheme: 'dark' })).newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(String(e)));
  const results = [];
  const check = (name, ok, detail = '') => {
    results.push({ name, ok });
    console.log(`${ok ? 'PASS' : 'FAIL'} ${name}${detail ? ` (${detail})` : ''}`);
  };
  const overflow = () => page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);

  await page.goto(`${base}/login`);
  await page.fill('#password', process.env.APP_PASSWORD);
  await page.click('button[type=submit]');
  await page.waitForURL(`${base}/`);

  // ---- Episode screen: picker defaults to Gemini TTS (Free), saves a change
  await page.goto(`${base}/create/${p.id}`);
  check('episode: Gemini TTS (Free) selected by default', await page.getByLabel('Gemini TTS (Free)').isChecked());
  await page.getByLabel('Angry / Urgent').check();
  await page.waitForSelector('text=/Saved: Gemini TTS \\(Free\\), Angry \\/ Urgent/');
  const [row] = await sql`SELECT voice_provider, delivery_preset FROM content_projects WHERE id = ${p.id}`;
  check('episode: delivery preset saved', row.delivery_preset === 'angry' && row.voice_provider === 'gemini_tts', JSON.stringify(row));
  check('episode: no horizontal overflow', (await overflow()) <= 0);

  // ---- Booth: voice the missing lines with Gemini (mock): lines 1 and 3 only
  await page.goto(`${base}/create/${p.id}/record`);
  check('booth: picker shown, Gemini selected', await page.getByLabel('Gemini TTS (Free)').isChecked());
  const small = await page.evaluate(() => [...document.querySelectorAll('fieldset label')].filter((el) => el.offsetParent).map((el) => Math.round(el.getBoundingClientRect().height)).filter((h) => h < 44));
  check('booth: provider / delivery options ≥ 44 px', small.length === 0, JSON.stringify(small));
  await page.click('button:text("Voice the 2 missing lines with AI")');
  await page.waitForSelector('text=/2 line\\(s\\) voiced with Gemini TTS/', { timeout: 30000 });
  check('booth: 2 Gemini requests, the cached line skipped', requests.length === 2, `${requests.length}`);
  check('booth: Uco → Puck, Ocu → Charon', requests[0]?.voice === 'Puck' && requests[1]?.voice === 'Charon', requests.map((r) => r.voice).join(','));
  check('booth: parts[0].text is the script line only (no acting instruction read aloud)', requests[0]?.text === 'Badak Jawa mau dipindah ke Alas Purwo?!' && requests[1]?.text === 'Satu tsunami, habis semua.' && requests.every((r) => !/Bacakan|Ucapkan persis|tanpa menambah|style:/i.test(r.text)), JSON.stringify(requests.map((r) => r.text)));
  check('booth: pose + preset acting cue only in speechMetadata.style, on /v1beta', /Outraged/.test(requests[0]?.style) && /urgent/.test(requests[0]?.style) && /probing/.test(requests[1]?.style) && requests.every((r) => /^\/models\/[^/]+:generateContent$/.test(r.url)), JSON.stringify(requests.map((r) => r.style)));
  const takes = await sql`SELECT line_index, mime_type, source, duration_ms FROM recordings WHERE script_id = ${s.id} AND is_selected ORDER BY line_index`;
  check('booth: takes stored as WAV AI takes, 1 s long', takes.length === 3 && takes.filter((t) => t.source === 'ai').every((t) => t.mime_type === 'audio/wav' && t.duration_ms === 1000), JSON.stringify(takes));
  // again: nothing left to voice
  await page.reload();
  check('booth: everything cached, nothing to generate', await page.locator('button:text("All lines have a take")').isDisabled());
  check('booth: no horizontal overflow', (await overflow()) <= 0);
  await page.screenshot({ path: `${OUT}/voice-1-booth.png` });

  // ---- missing key: a clear message, no crash (simulated by switching to ElevenLabs without its key)
  await page.getByLabel('ElevenLabs').check();
  await page.waitForSelector('text=/Saved: ElevenLabs/');
  await page.reload();
  check('booth: ElevenLabs without a key explains instead of crashing', (await page.locator('text=/ELEVENLABS_API_KEY isn.t set/').count()) > 0);

  // ---- Accounts: Own-Voice Models (RVC)
  await page.goto(`${base}/accounts`);
  await page.getByText('Upload trained RVC voice models once. Used automatically by the Own-Voice render worker.').scrollIntoViewIfNeeded();
  check('accounts: RVC helper note', true);
  const slot = (file) => page.locator('li', { has: page.locator(`code:text-is("${file}")`) }).first();
  const ucoPth = slot('studio-assets/voices/uco-voice.pth');
  check('accounts: four model slots, Missing', (await page.locator('code:text-matches("studio-assets/voices/")').count()) === 4 && (await ucoPth.locator('.stamp:text-is("Missing")').count()) === 1);
  check('accounts: .pth slot accepts only .pth', (await ucoPth.locator('input[type=file]').getAttribute('accept')) === '.pth');
  // wrong file → inline error
  await ucoPth.locator('input[type=file]').setInputFiles(index);
  await ucoPth.locator('[role=alert]').waitFor();
  check('accounts: a .index in the .pth slot is refused inline', /Pick a \.pth file/.test(await ucoPth.locator('[role=alert]').innerText()));
  await ucoPth.locator('input[type=file]').setInputFiles(pth);
  await ucoPth.locator('.stamp:text-is("Ready")').waitFor({ timeout: 30000 });
  const stored = path.join(process.cwd(), '.local-storage/studio-assets/voices/uco-voice.pth');
  check('accounts: stored privately at studio-assets/voices/uco-voice.pth', fs.existsSync(stored) && fs.statSync(stored).size === fs.statSync(pth).size);
  check('accounts: Ready shows size and "private"', /Uploaded · [\d.]+ MB · private/.test(await ucoPth.innerText()));
  await page.reload();
  check('accounts: still Ready after reload', (await slot('studio-assets/voices/uco-voice.pth').locator('.stamp:text-is("Ready")').count()) === 1);
  check('accounts: no horizontal overflow', (await overflow()) <= 0);
  await slot('studio-assets/voices/uco-voice.pth').screenshot({ path: `${OUT}/voice-2-rvc.png` });
  page.once('dialog', (d) => d.accept());
  await slot('studio-assets/voices/uco-voice.pth').getByRole('button', { name: /Remove/ }).click();
  await slot('studio-assets/voices/uco-voice.pth').locator('.stamp:text-is("Missing")').waitFor();
  check('accounts: Remove deletes the model', !fs.existsSync(stored));

  console.log('page errors:', errors.length, errors.slice(0, 3));
  await sql`DELETE FROM content_projects WHERE id = ${p.id}`;
  await sql.end();
  await b.close();
  mock.close();
  const failed = results.filter((r) => !r.ok);
  console.log(`\n${results.length - failed.length}/${results.length} checks passed`);
  process.exit(failed.length ? 1 : 0);
})().catch((e) => {
  console.error('FAILED:', e.message);
  mock.close();
  process.exit(1);
});
