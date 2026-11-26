// Browser + worker test of the autonomous scheduler on a 390 px phone. Starts a fake Gemini API on :4012 (text: topic
// seeds and scripts; TTS: 1 s of PCM) and drives the GitHub worker's steps (video/scheduler-step.mts) against the app.
// Needs the app on PORT (default 3007) with GEMINI_API_BASE=http://localhost:4012 GEMINI_API_KEY=test STORAGE_DRIVER=local
// RENDER_TOKEN=… APP_PASSWORD=… DATABASE_URL=…   Optional: RENDER=1 also renders the MP4 with video/render.mts.
const http = require('http');
const fs = require('fs');
const path = require('path');
const { execFile } = require('child_process');
const { promisify } = require('util');
const run = promisify(execFile);
const postgres = require('postgres').default ?? require('postgres');
const { chromium } = require('playwright');

const base = `http://localhost:${process.env.PORT || 3007}`;
const OUT = process.env.OUT || path.join(__dirname, 'output');
fs.mkdirSync(OUT, { recursive: true });
const sql = postgres(process.env.DATABASE_URL, { onnotice: () => {} });
const ROOT = path.resolve(__dirname, '../..');

const requests = [];
// 1 s of 24 kHz 16-bit "speech": a tone with a syllable-like envelope (pure silence would be trimmed to nothing)
const PCM = (() => {
  const b = Buffer.alloc(48000);
  for (let i = 0; i < 24000; i++) b.writeInt16LE(Math.round(9000 * Math.sin((2 * Math.PI * 180 * i) / 24000) * (0.5 + 0.5 * Math.sin((2 * Math.PI * 4 * i) / 24000))), i * 2);
  return b.toString('base64');
})();
let scriptMode = 'good';
const SCRIPT = {
  title: 'Rendang diblender — inovasi atau dosa?',
  lines: [
    { beat: 'hook', speaker: 'uco', text: 'Rendang diblender jadi jus, ini inovasi!', subtitle: 'Blended rendang juice!', emotion: 'triumphant', camera_shot: 'solo-uco', prop_tag: 'jus-rendang-baru', layout: 'standard', kicker: 'VIRAL', headline: 'JUS RENDANG', thought_bubble: false },
    { beat: 'counter', speaker: 'ocu', text: 'Itu namanya nasi padang yang menyerah.', subtitle: 'That is nasi padang giving up.', emotion: 'deadpan', camera_shot: 'solo-ocu', prop_tag: 'none', layout: 'standard', kicker: 'FAKTA', headline: 'NASI PADANG MENYERAH', thought_bubble: false },
    { beat: 'escalation', speaker: 'uco', text: 'Tambah kerupuk biar ada teksturnya!', subtitle: 'Add crackers for texture!', emotion: 'shocked', camera_shot: 'closeup-punch', prop_tag: 'kerupuk-raksasa', layout: 'standard', kicker: 'IDE', headline: 'TAMBAH KERUPUK', thought_bubble: false },
    { beat: 'insight', speaker: 'ocu', text: 'Santan yang dipanaskan terus jadi berminyak.', subtitle: 'Coconut milk turns oily when reheated.', emotion: 'explaining', camera_shot: 'solo-ocu', prop_tag: 'none', layout: 'takeover', stat: 'SANTAN | MAKIN BERMINYAK', kicker: 'FAKTA', headline: 'SANTAN BERMINYAK', thought_bubble: false },
    { beat: 'concession', speaker: 'uco', text: 'Hmm, dia ada benarnya juga.', subtitle: 'He has a point.', emotion: 'defensive', camera_shot: 'two-shot', prop_tag: 'none', layout: 'standard', kicker: 'DALAM HATI', headline: 'ADA BENARNYA', thought_bubble: true },
    { beat: 'button', speaker: 'ocu', text: 'Makan pakai sendok aja, Co.', subtitle: 'Just use a spoon.', emotion: 'inspecting', camera_shot: 'solo-ocu', prop_tag: 'none', layout: 'standard', kicker: 'INTINYA', headline: 'PAKAI SENDOK', thought_bubble: false },
  ],
};
const mock = http
  .createServer((req, res) => {
    let body = '';
    req.on('data', (c) => (body += c));
    req.on('end', () => {
      const b = JSON.parse(body || '{}');
      const text = b.contents?.[0]?.parts?.[0]?.text ?? '';
      const tts = /tts/.test(req.url);
      requests.push({ url: req.url, tts, text });
      res.writeHead(200, { 'content-type': 'application/json' });
      if (tts) return res.end(JSON.stringify({ candidates: [{ content: { parts: [{ inlineData: { mimeType: 'audio/L16;codec=pcm;rate=24000', data: PCM } }] } }] }));
      let out;
      if (/topik episode/.test(text)) {
        const n = Number(/Tulis (\d+) topik/.exec(text)?.[1] ?? 1);
        out = { seeds: Array.from({ length: n }, (_, i) => `Topik Gemini ${i + 1}: kenapa harga cabai naik tiap Lebaran`) };
      } else out = scriptMode === 'good' ? SCRIPT : { title: 'x', lines: [{ speaker: 'uco', text: 'cuma satu baris' }] };
      res.end(JSON.stringify({ candidates: [{ content: { parts: [{ text: JSON.stringify(out) }] }, finishReason: 'STOP' }] }));
    });
  })
  .listen(4012);

// async: the fake Gemini server lives in this process and must keep answering while a step runs
const step = async (...args) =>
  (
    await run('npx', ['tsx', 'scheduler-step.mts', ...args], {
      cwd: path.join(ROOT, 'video'),
      env: { ...process.env, APP_URL: base, RUN_URL: 'https://github.com/x/y/actions/runs/1', GITHUB_OUTPUT: path.join(OUT, 'gh-output.txt') },
      encoding: 'utf8',
    })
  ).stdout;

(async () => {
  const [u] = await sql`SELECT id FROM users ORDER BY created_at LIMIT 1`;
  await sql`DELETE FROM content_schedules WHERE user_id = ${u.id}`;
  await sql`DELETE FROM prop_bank WHERE user_id = ${u.id}`;
  fs.rmSync(path.join(OUT, 'gh-output.txt'), { force: true });

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
  const smallTargets = () =>
    page.evaluate(() =>
      [...document.querySelectorAll('main button, main a.btn, main select, main input:not([type=radio]):not([type=checkbox]), main label:has(input[type=radio]), main label:has(input[type=checkbox])')]
        .filter((el) => el.offsetParent)
        .map((el) => [el.textContent.trim().slice(0, 20) || el.getAttribute('aria-label') || el.tagName, Math.round(el.getBoundingClientRect().height)])
        .filter(([, h]) => h < 44),
    );

  await page.goto(`${base}/login`);
  await page.fill('#password', process.env.APP_PASSWORD);
  await page.click('button[type=submit]');
  await page.waitForURL(`${base}/`);

  // ---- the rule: defaults, then save with auto-execute
  await page.goto(`${base}/schedule`);
  await page.getByText('Schedule rule (not saved yet)').waitFor();
  check('nav: Schedule tab in the phone bar', await page.locator('nav.fixed a[href="/schedule"][aria-current=page]').isVisible());
  check('rule: daily, 2 slots at 11:00 and 19:00', (await page.getByLabel('Daily').isChecked()) && (await page.getByLabel('Slot 1 time (WIB)').inputValue()) === '11:00' && (await page.getByLabel('Slot 2 time (WIB)').inputValue()) === '19:00');
  check('rule: slot formats Comedy Debate + Koran Kinetik', (await page.getByLabel('Slot 1 format').inputValue()) === 'comedy_debate' && (await page.getByLabel('Slot 2 format').inputValue()) === 'koran_kinetik');
  check('rule: Gemini TTS, auto-execute off by default', (await page.getByLabel('Gemini TTS (Free)').isChecked()) && !(await page.getByRole('switch').isChecked()));
  await page.getByLabel('Own Voice (Gemini + RVC)').check();
  check('rule: Own Voice without models warns with a Studio Assets link', (await page.getByRole('link', { name: 'Open Studio Assets' }).getAttribute('href')) === '/accounts#studio-assets');
  await page.getByLabel('Gemini TTS (Free)').check();
  await page.getByRole('switch').check();
  check('rule: no element under 44 px', (await smallTargets()).length === 0, JSON.stringify(await smallTargets()));
  check('rule: no horizontal overflow', (await overflow()) <= 0, `${await overflow()}`);
  await page.getByRole('button', { name: 'Save schedule' }).click();
  await page.getByText(/Saved: 2 episodes a day at 11:00 and 19:00 WIB, auto-execute on/).waitFor();
  const [rule] = await sql`SELECT cadence, slots_per_day, slot_times, format_mix, auto_execute FROM content_schedules WHERE user_id = ${u.id}`;
  check('rule: saved', rule.auto_execute && rule.slots_per_day === 2 && rule.slot_times.join() === '11:00,19:00', JSON.stringify(rule));
  const q = await sql`SELECT id, scheduled_for, format, status FROM episode_queue WHERE user_id = ${u.id} ORDER BY scheduled_for`;
  const perDay = {};
  for (const s of q) {
    const d = new Date(s.scheduled_for.getTime() + 7 * 3600e3).toISOString().slice(0, 10);
    perDay[d] = (perDay[d] ?? 0) + 1;
  }
  const wibTimes = new Set(q.map((s) => new Date(s.scheduled_for.getTime() + 7 * 3600e3).toISOString().slice(11, 16)));
  check('queue: 3+ days filled, only 11:00 / 19:00 WIB', q.length >= 6 && [...wibTimes].every((t) => t === '11:00' || t === '19:00'), `${q.length} slots, ${[...wibTimes]}`);
  check('queue: full days have 2 slots', Object.values(perDay).slice(1, -1).every((n) => n === 2), JSON.stringify(perDay));

  // ---- bulk topics, then one slot's topic by hand
  await page.reload();
  await page.getByLabel('Topics for the next open slots').fill('Paylater buat beli kopi: pintar atau bahaya?\nRendang diblender jadi jus');
  await page.getByRole('button', { name: 'Add topics' }).click();
  await page.getByText('2 topics added to the next open slots.').waitFor();
  const seeded = await sql`SELECT topic_seed, topic_source FROM episode_queue WHERE user_id = ${u.id} AND topic_source = 'manual' ORDER BY scheduled_for`;
  check('queue: bulk topics fill the next 2 slots', seeded.length === 2 && seeded[0].topic_seed.startsWith('Paylater'), JSON.stringify(seeded));
  await page.reload();
  check('queue: Run slot now disabled without GITHUB_DISPATCH_TOKEN', await page.getByRole('button', { name: 'Run slot now' }).first().isDisabled());
  check('queue: no horizontal overflow', (await overflow()) <= 0);
  await page.locator('section', { hasText: 'Upcoming queue' }).screenshot({ path: `${OUT}/sched-2-queue.png` });

  // ---- Prop Bank: tag a prop, switch one off
  const row = (name) => page.locator('li', { has: page.locator(`code:text-is("${name}")`) });
  check('props: the repo props are listed', (await row('nasi-padang-blender').count()) === 1 && (await row('bubur-kerupuk').count()) === 1);
  await row('bubur-kerupuk').getByLabel('Keywords').fill('kerupuk, krupuk, crackers');
  await row('bubur-kerupuk').getByRole('button', { name: 'Save tags' }).click();
  await row('bubur-kerupuk').getByText('Saved 3 tags.').waitFor();
  await row('bubur-mixed').getByLabel('Use in unattended episodes').uncheck();
  await row('bubur-mixed').getByRole('button', { name: 'Save tags' }).click();
  await row('bubur-mixed').getByText(/won't use this prop/).waitFor();
  const bank = await sql`SELECT name, keywords, vetted FROM prop_bank WHERE user_id = ${u.id} ORDER BY name`;
  check('props: tags and the vetted switch saved', bank.find((r) => r.name === 'bubur-kerupuk')?.keywords.join() === 'kerupuk,krupuk,crackers' && bank.find((r) => r.name === 'bubur-mixed')?.vetted === false, JSON.stringify(bank));
  await page.locator('section', { hasText: 'Prop Bank' }).last().screenshot({ path: `${OUT}/sched-3-props.png` });

  // ---- the worker: plan (tick) claims the second topic's slot by id, then prepare → render → finish
  const target = (await sql`SELECT id FROM episode_queue WHERE user_id = ${u.id} AND topic_seed = 'Rendang diblender jadi jus'`)[0].id;
  const plan = await step('plan', target);
  const gemSeeds = await sql`SELECT count(*)::int AS n FROM episode_queue WHERE user_id = ${u.id} AND topic_source = 'gemini'`;
  check('tick: Gemini seeds for slots without a topic', gemSeeds[0].n > 0 && /topic seed\(s\) from Gemini/.test(plan), `${gemSeeds[0].n}`);
  check('tick: claims the slot (scripting)', plan.includes(`slots=["${target}"]`), plan.trim().split('\n').pop());
  const textBefore = requests.filter((r) => !r.tts).length;
  const prep = await step('prepare', target);
  const [slot] = await sql`SELECT status, episode_id, render_job_id FROM episode_queue WHERE id = ${target}`;
  check('prepare: rendering, with an episode and a render job', slot.status === 'rendering' && slot.episode_id && slot.render_job_id, JSON.stringify(slot));
  const scriptReq = requests.filter((r) => !r.tts).slice(textBefore).find((r) => /Tulis naskah/.test(r.text));
  check('script: Gemini told the Prop Bank (vetted only)', /nasi-padang-blender/.test(scriptReq?.text) && /bubur-kerupuk: kerupuk, krupuk, crackers/.test(scriptReq?.text) && !/bubur-mixed/.test(scriptReq?.text));
  const [s] = await sql`SELECT lines, custom, approved_at FROM scripts WHERE project_id = ${slot.episode_id}`;
  const tags = s.lines.map((l) => l.prop_tag);
  check('script: invented props replaced by bank props or none', JSON.stringify(tags) === JSON.stringify(['nasi-padang-blender', 'nasi-padang-blender', 'bubur-kerupuk', 'none', 'none', 'none']), JSON.stringify(tags));
  check('script: takeover stat card kept, no em dash, approved', s.lines[3].layout === 'takeover' && s.lines[3].stat === 'SANTAN | MAKIN BERMINYAK' && s.custom && s.approved_at && !JSON.stringify(s.lines).includes('—'));
  const [p] = await sql`SELECT title, video_style, voice_provider, status, platform_captions IS NOT NULL AS caps FROM content_projects WHERE id = ${slot.episode_id}`;
  const [{ format }] = await sql`SELECT format FROM episode_queue WHERE id = ${target}`;
  const style = { comedy_debate: 'uco-ocu-2d-comic', affiliate: 'uco-ocu-2d-comic', koran_kinetik: 'editorial-paper-cutout', diagram_taktis: 'tactical-vector-hud' }[format];
  check(`episode: ${format} → ${style}, Gemini TTS, recorded, captions`, p.video_style === style && p.voice_provider === 'gemini_tts' && p.status === 'recorded' && p.caps && !p.title.includes('—'), JSON.stringify(p));
  const takes = await sql`SELECT count(*)::int AS n FROM recordings WHERE project_id = ${slot.episode_id} AND is_selected AND source = 'ai'`;
  check('voices: one Gemini TTS take per line', takes[0].n === 6 && requests.filter((r) => r.tts).length === 6, `${takes[0].n} takes, ${requests.filter((r) => r.tts).length} TTS calls`);
  const outputs = fs.readFileSync(path.join(OUT, 'gh-output.txt'), 'utf8');
  check('prepare: workflow outputs episode_id, job_id, voice=none', outputs.includes(`episode_id=${slot.episode_id}`) && outputs.includes(`job_id=${slot.render_job_id}`) && outputs.includes('voice=none'));

  if (process.env.RENDER === '1') {
    const r = await run('npx', ['tsx', 'render.mts', slot.episode_id, '--base', base], { cwd: path.join(ROOT, 'video'), env: { ...process.env, JOB_ID: slot.render_job_id }, maxBuffer: 64 * 1024 * 1024 });
    console.log(r.stdout.split('\n').filter((l) => !/frame/i.test(l)).slice(-8).join('\n'));
  } else {
    // stand-in for render.mts's upload: a stored MP4 row
    await sql`INSERT INTO episode_videos (project_id, script_id, storage_path, size_bytes, duration_ms) SELECT ${slot.episode_id}, id, ${`${slot.episode_id}/test.mp4`}, 10, 7000 FROM scripts WHERE project_id = ${slot.episode_id}`;
  }
  const v = await sql`SELECT count(*)::int AS n FROM episode_videos WHERE project_id = ${slot.episode_id}`;
  check('render: a video landed', v[0].n === 1);
  await step('finish', target);
  const [done] = await sql`SELECT status, handoff FROM episode_queue WHERE id = ${target}`;
  check('finish: ready_to_post with the TikTok hand-off (no account connected)', done.status === 'ready_to_post' && /Cek keranjang kuning|#/.test(done.handoff.tiktokCaption ?? '') && done.handoff.notConnected.length === 3, JSON.stringify(done));
  const [job] = await sql`SELECT status FROM render_jobs WHERE id = ${slot.render_job_id}`;
  check('finish: the render job is done', job.status === 'done');

  // ---- a bad script: the slot fails with the reason, retry puts it back
  scriptMode = 'bad';
  const other = (await sql`SELECT id FROM episode_queue WHERE user_id = ${u.id} AND status = 'queued' ORDER BY scheduled_for LIMIT 1`)[0].id;
  await step('plan', other);
  let failed = false;
  try {
    await step('prepare', other);
  } catch {
    failed = true;
  }
  const [bad] = await sql`SELECT status, error_message FROM episode_queue WHERE id = ${other}`;
  check('failure: a thin script fails the slot with a reason', failed && bad.status === 'failed' && /only 1 usable line/.test(bad.error_message), JSON.stringify(bad));

  await page.reload();
  const readyRow = page.locator('li', { hasText: 'TikTok / Shopee hand-off' });
  await readyRow.getByRole('link', { name: 'Download video' }).waitFor();
  check('queue: hand-off shows Copy caption and Download', (await readyRow.getByRole('button', { name: 'Copy caption' }).count()) === 1 && (await readyRow.getByRole('link', { name: 'Download video' }).count()) === 1);
  const failedRow = page.locator('li', { hasText: 'only 1 usable line' });
  await failedRow.getByRole('link', { name: 'Run log' }).waitFor();
  check('queue: failed slot shows the reason and the run log', (await failedRow.getByRole('link', { name: 'Run log' }).count()) === 1);
  check('queue: no element under 44 px', (await smallTargets()).length === 0, JSON.stringify(await smallTargets()));
  check('page: no horizontal overflow', (await overflow()) <= 0);
  await readyRow.screenshot({ path: `${OUT}/sched-4-ready.png` });
  await failedRow.screenshot({ path: `${OUT}/sched-5-failed.png` });
  await failedRow.getByRole('button', { name: 'Retry' }).click();
  await page.getByText(/Back in the queue/).waitFor();
  const [again] = await sql`SELECT status, error_message FROM episode_queue WHERE id = ${other}`;
  check('retry: back to queued', again.status === 'queued' && again.error_message === null);
  await page.goto(`${base}/schedule`);
  await page.getByText('Schedule rule').first().waitFor();
  await page.screenshot({ path: `${OUT}/sched-1-rule.png`, fullPage: false });
  check('no Anthropic request (only Gemini on the mock)', requests.every((r) => /gemini/.test(r.url)));

  console.log('page errors:', errors.length, errors.slice(0, 3));
  // cleanup
  const eps = await sql`SELECT episode_id FROM episode_queue WHERE user_id = ${u.id} AND episode_id IS NOT NULL`;
  await sql`DELETE FROM content_schedules WHERE user_id = ${u.id}`;
  await sql`DELETE FROM prop_bank WHERE user_id = ${u.id}`;
  for (const e of eps) await sql`DELETE FROM content_projects WHERE id = ${e.episode_id}`;
  await sql.end();
  await b.close();
  mock.close();
  const failedChecks = results.filter((r) => !r.ok);
  console.log(`\n${results.length - failedChecks.length}/${results.length} checks passed`);
  process.exit(failedChecks.length ? 1 : 0);
})().catch(async (e) => {
  console.error('FAILED:', e.message);
  mock.close();
  process.exit(1);
});
