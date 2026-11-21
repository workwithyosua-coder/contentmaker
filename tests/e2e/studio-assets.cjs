// Browser test of Accounts → Studio Assets and the "Global studio asset" rows in Asset readiness, on a 390 px phone.
// Needs the app on PORT (default 3007) with STORAGE_DRIVER=local APP_PASSWORD=… DATABASE_URL=…, and
// args: <photo.jpg> <track.mp3>. Uploads go to ./.local-storage/studio-assets (the local Storage driver).
const fs = require('fs');
const path = require('path');
const postgres = require('postgres').default ?? require('postgres');
const { chromium } = require('playwright');

const base = `http://localhost:${process.env.PORT || 3007}`;
const [photo, track] = process.argv.slice(2);
const OUT = process.env.OUT || path.join(__dirname, 'output');
fs.mkdirSync(OUT, { recursive: true });
const sql = postgres(process.env.DATABASE_URL, { onnotice: () => {} });

(async () => {
  const b = await chromium.launch();
  const ctx = await b.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 1, isMobile: true, hasTouch: true, colorScheme: 'dark' });
  const p = await ctx.newPage();
  const errors = [];
  p.on('pageerror', (e) => errors.push(String(e)));
  const results = [];
  const check = (name, ok, detail = '') => {
    results.push({ name, ok });
    console.log(`${ok ? 'PASS' : 'FAIL'} ${name}${detail ? ` (${detail})` : ''}`);
  };
  const overflow = () => p.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
  const slot = (file) => p.locator('li', { has: p.locator(`code:text-is("${file}")`) }).first();

  await p.goto(`${base}/login`);
  await p.fill('#password', process.env.APP_PASSWORD);
  await p.click('button[type=submit]');
  await p.waitForURL(`${base}/`);

  // ---- Accounts → Studio Assets
  await p.goto(`${base}/accounts`);
  const card = p.locator('section', { has: p.locator('h2:text-is("Studio Assets"), h3:text-is("Studio Assets")') }).first();
  await p.getByText('Upload character sprites and default audio once from your phone. Reused across all episodes.').scrollIntoViewIfNeeded();
  check('helper text shown', true);
  for (const g of ['Uco (Angry)', 'Ocu (Angry)', 'Urgent BGM']) check(`group ${g}`, (await p.locator(`h3:text-is("${g}")`).count()) === 1);
  check('all five slots start Missing', (await p.locator('.stamp:text-is("Missing")').count()) === 5);
  check('no horizontal overflow (Accounts)', (await overflow()) <= 0, `${await overflow()} px`);
  const small = await p.evaluate(() => {
    const host = [...document.querySelectorAll('h3')].find((h) => h.textContent === 'Uco (Angry)').closest('div.min-w-0');
    return [...host.querySelectorAll('button, label:has(input[type=checkbox])')].filter((el) => el.offsetParent).map((el) => ({ t: el.textContent.trim().slice(0, 24), h: Math.round(el.getBoundingClientRect().height) })).filter((x) => x.h < 44);
  });
  check('tap targets ≥ 44 px', small.length === 0, JSON.stringify(small));

  // keyboard: Tab reaches the first Upload button, focus ring visible, cursor pointer
  const first = p.getByRole('button', { name: 'Upload image for Uco angry, mouth closed' });
  await first.focus();
  await p.keyboard.press('Shift+Tab');
  await p.keyboard.press('Tab');
  const focus = await p.evaluate(() => {
    const el = document.activeElement;
    const s = getComputedStyle(el);
    return { label: el.getAttribute('aria-label'), outline: `${s.outlineStyle} ${s.outlineWidth}`, cursor: s.cursor };
  });
  check('keyboard focus on Upload image, ring visible, pointer cursor', focus.label === 'Upload image for Uco angry, mouth closed' && focus.outline.startsWith('solid') && focus.cursor === 'pointer', JSON.stringify(focus));

  // upload a phone JPEG into uco-angry-closed: Processing image… → Uploading… → Ready with a cut-out preview
  const ucoClosed = slot('sprites/uco-angry-closed.png');
  await ucoClosed.locator('input[type=file]').setInputFiles(photo);
  const seen = [];
  for (let i = 0; i < 60 && !(await ucoClosed.locator('.stamp:text-is("Ready")').count()); i++) {
    const t = await ucoClosed.locator('button').first().innerText().catch(() => '');
    const d = await ucoClosed.locator('button').first().isDisabled().catch(() => false);
    const c = await ucoClosed.locator('button').first().evaluate((el) => getComputedStyle(el).cursor).catch(() => '');
    if (/Processing|Uploading/.test(t) && !seen.some((s) => s.t === t)) seen.push({ t, d, c });
    await p.waitForTimeout(50);
  }
  check('loading states shown, disabled, not-allowed cursor', seen.length >= 1 && seen.every((s) => s.d && s.c === 'not-allowed'), JSON.stringify(seen));
  check('slot Ready after upload', (await ucoClosed.locator('.stamp:text-is("Ready")').count()) === 1);
  const img = ucoClosed.locator('img');
  const thumb = await img.evaluate((el) => ({ w: el.getAttribute('width'), h: el.getAttribute('height'), alt: el.alt }));
  check('48×48 thumbnail with a descriptive alt', thumb.w === '48' && thumb.h === '48' && /transparent cut-out/.test(thumb.alt), JSON.stringify(thumb));
  const stored = path.join(process.cwd(), '.local-storage/studio-assets/sprites/uco-angry-closed.png');
  check('stored under the slot key, not the phone file name', fs.existsSync(stored) && !fs.existsSync(path.join(process.cwd(), '.local-storage/studio-assets/sprites', path.basename(photo))));
  const png = fs.readFileSync(stored);
  check('stored file is a PNG', png.slice(1, 4).toString() === 'PNG');
  const sharp = require('sharp');
  const meta = await sharp(stored).metadata();
  const { data, info } = await sharp(stored).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  const alpha = (x, y) => data[(y * info.width + x) * 4 + 3];
  check('≤ 1024 px, aspect kept, transparent corners (white background removed)', Math.max(meta.width, meta.height) <= 1024 && Math.abs(meta.width / meta.height - 1080 / 2040) < 0.01 && alpha(2, 2) === 0, `${meta.width}×${meta.height}`);
  await ucoClosed.screenshot({ path: `${OUT}/studio-1-ready.png` });

  // persists across reload (public URL with ?v=)
  await p.reload();
  const after = slot('sprites/uco-angry-closed.png');
  check('still Ready after reload', (await after.locator('.stamp:text-is("Ready")').count()) === 1);
  const src = await after.locator('img').getAttribute('src');
  const loaded = await after.locator('img').evaluate((el) => el.complete && el.naturalWidth > 0);
  check('preview loads from the stored file, cache-busted', /studio-assets\/sprites\/uco-angry-closed\.png/.test(src) && /[?&]v=\d+/.test(src) && loaded, src.slice(0, 90));

  // Remove white background off: re-processed from the stored original and re-uploaded
  const before = fs.statSync(stored).mtimeMs;
  await after.getByLabel('Remove white background').uncheck();
  for (let i = 0; i < 60 && fs.statSync(stored).mtimeMs === before; i++) await p.waitForTimeout(100);
  await after.locator('.stamp:text-is("Ready")').waitFor();
  const { data: d2, info: i2 } = await sharp(stored).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  check('switch off re-uploads with the white background kept', d2[3] === 255 && fs.statSync(stored).mtimeMs !== before, `${i2.width}×${i2.height}`);
  check('the switch position is remembered (original kept as .keep)', fs.readdirSync(path.join(process.cwd(), '.local-storage/studio-assets/originals')).some((n) => n === 'uco-angry-closed.keep.jpg'));
  await after.getByLabel('Remove white background').check();
  for (let i = 0; i < 60 && !fs.readdirSync(path.join(process.cwd(), '.local-storage/studio-assets/originals')).includes('uco-angry-closed.cut.jpg'); i++) await p.waitForTimeout(100);
  await after.locator('.stamp:text-is("Ready")').waitFor();
  check('switch back on re-cuts it', (await sharp(stored).ensureAlpha().raw().toBuffer())[3] === 0);

  // urgent BGM: upload audio → <audio controls>, then Remove
  const bgm = slot('sfx/bgm-urgent.mp3');
  await bgm.locator('input[type=file]').setInputFiles(track);
  await bgm.locator('.stamp:text-is("Ready")').waitFor({ timeout: 20000 });
  check('audio slot Ready with an <audio controls> preview', (await bgm.locator('audio[controls]').count()) === 1);
  check('no horizontal overflow with previews', (await overflow()) <= 0);
  await p.screenshot({ path: `${OUT}/studio-2-accounts.png`, fullPage: true });
  p.once('dialog', (d) => d.accept());
  await bgm.getByRole('button', { name: 'Remove Urgent background track' }).click();
  await bgm.locator('.stamp:text-is("Missing")').waitFor({ timeout: 20000 });
  check('Remove empties the slot', !fs.existsSync(path.join(process.cwd(), '.local-storage/studio-assets/sfx/bgm-urgent.mp3')));

  // error state: a non-audio file in the audio slot
  await bgm.locator('input[type=file]').setInputFiles({ name: 'notes.txt', mimeType: 'text/plain', buffer: Buffer.from('hello') });
  await bgm.locator('[role=alert]').waitFor({ timeout: 5000 });
  check('error shown inline with a retry', /MP3, WAV, M4A or OGG/.test(await bgm.locator('[role=alert]').innerText()) && (await bgm.getByRole('button', { name: 'Pick another file' }).count()) === 1);

  // ---- Asset readiness on an episode with an angry line: the missing global slots, uploadable in place
  const [u] = await sql`SELECT id FROM users ORDER BY created_at LIMIT 1`;
  const [proj] = await sql`
    INSERT INTO content_projects (user_id, title, format, target_platforms, status, video_style)
    VALUES (${u.id}, 'Banjir 20 KM', 'short_video', '{tiktok}', 'awaiting_recording', 'editorial-paper-cutout') RETURNING id`;
  await sql`
    INSERT INTO scripts (project_id, version, title, target_duration_s, lines, sources, custom, approved_at)
    VALUES (${proj.id}, 1, 'Banjir 20 KM', 8, ${sql.json([
      { beat: 'hook', speaker: 'uco', text: 'Banjirnya 20 kilometer!', subtitle: 'The flood is 20 km!', expression: 'angry', emotion: 'angry', thought_bubble: false, visual: '', sfx: [] },
      { beat: 'counter', speaker: 'ocu', text: 'Tenang dulu.', subtitle: 'Calm down.', expression: 'deadpan', emotion: null, thought_bubble: false, visual: '', sfx: [] },
    ])}, '[]', true, now())`;
  await p.goto(`${base}/create/${proj.id}`);
  const rows = p.locator('ul[aria-label="Global studio assets"] > li');
  await rows.first().waitFor({ timeout: 20000 });
  const listed = await rows.locator('code').allInnerTexts();
  check('readiness lists the missing global slots (labelled Global studio asset)', listed.length === 4 && !listed.includes('sprites/uco-angry-closed.png') && (await p.locator('text=Global studio asset').count()) === 4, listed.join(', '));
  const ocuRow = rows.filter({ has: p.locator('code:text-is("sprites/ocu-angry-closed.png")') });
  await ocuRow.locator('input[type=file]').setInputFiles(photo);
  await ocuRow.locator('img').waitFor({ timeout: 30000 });
  check('one-tap upload from Asset readiness', fs.existsSync(path.join(process.cwd(), '.local-storage/studio-assets/sprites/ocu-angry-closed.png')));
  check('no horizontal overflow (episode page)', (await overflow()) <= 0, `${await overflow()} px`);
  await ocuRow.screenshot({ path: `${OUT}/studio-3-readiness.png` });
  const html = await p.content();
  check('the preview gets the studio sprite URL', /studio-assets\/sprites\/uco-angry-closed\.png/.test(html));

  console.log('page errors:', errors.length, errors.slice(0, 3));
  await sql`DELETE FROM content_projects WHERE id = ${proj.id}`;
  await sql.end();
  await b.close();
  const failed = results.filter((r) => !r.ok);
  console.log(`\n${results.length - failed.length}/${results.length} checks passed`);
  process.exit(failed.length ? 1 : 0);
})().catch((e) => {
  console.error('FAILED:', e.message);
  process.exit(1);
});
