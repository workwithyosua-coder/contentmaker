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
let scriptCalls = 0;
// a Show Bible draft: n lines (the last one the FOLLOW @UCO.OCU outro), 2 fresh prop specs, one exact bank prop,
// takeover stat cards, a thought twist, an explainer card, callouts and SFX
const SHOW = (n) => ({
  title: 'Rendang diblender — inovasi atau dosa?',
  propSpecs: [
    { slug: 'jus-rendang', prompt: 'a tall glass of brown rendang smoothie with a striped straw' },
    { slug: 'sendok-raksasa', prompt: 'a giant silver spoon' },
  ],
  lines: Array.from({ length: n }, (_, i) => {
    const last = i === n - 1;
    const uco = i % 2 === 0 && !last;
    return {
      beat: i === 0 ? 'hook' : last ? 'button' : i === 8 ? 'insight' : i === 11 ? 'concession' : 'escalation',
      speaker: uco ? 'uco' : 'ocu',
      text: last ? 'Follow @uco.ocu biar nggak ketipu lagi!' : i === 0 ? 'Rendang diblender jadi jus, gue bilang ini inovasi!' : `Baris ${i + 1}: lo serius mau minum rendang?`,
      subtitle: last ? "Follow @uco.ocu so you don't get fooled again!" : `Line ${i + 1}: blended rendang talk.`,
      pose: last ? 'cta' : i === 11 ? 'thought' : uco ? (i === 2 ? 'angry' : 'triumphant') : i === 8 ? 'explaining' : 'deadpan',
      shot: uco ? 'solo-uco' : 'solo-ocu',
      callout: [0, 4, 8, 10].includes(i) ? 'JUS RENDANG 35 RIBU' : '',
      layout: [4, 10].includes(i) ? 'takeover' : 'standard',
      statCard: [4, 10].includes(i) ? '35 RIBU | SEGELAS JUS RENDANG' : '',
      explainerCard: i === 8 ? 'brain-badge' : 'none',
      sfx: [0, 4, 8, 10, 12].includes(i) ? ['pop'] : [],
      prop: i === 0 ? 'jus-rendang' : i === 1 ? 'bubur-kerupuk' : i === 3 ? 'sendok-raksasa' : i === 5 ? 'kalkulator-9-juta' : 'none',
      kicker: 'FAKTA',
      headline: 'JUS RENDANG',
      thought_bubble: false,
    };
  }),
});
// a white-background "generated prop" (an orange disc with a black outline and a white highlight inside)
const PROP_PNG = (() => {
  const f = path.join(OUT, 'fake-prop.png');
  require('child_process').execFileSync('ffmpeg', ['-nostdin', '-loglevel', 'error', '-y', '-f', 'lavfi', '-i', 'color=white:s=512x512', '-vf', 'drawbox=x=150:y=150:w=212:h=212:color=black:t=fill,drawbox=x=160:y=160:w=192:h=192:color=0xEB6E28:t=fill,drawbox=x=220:y=210:w=40:h=40:color=white:t=fill', '-frames:v', '1', f]);
  return fs.readFileSync(f).toString('base64');
})();
const mock = http
  .createServer((req, res) => {
    let body = '';
    req.on('data', (c) => (body += c));
    req.on('end', () => {
      const b = JSON.parse(body || '{}');
      const parts = b.contents?.[0]?.parts ?? [];
      const text = parts.map((p) => p.text ?? '').join('');
      const tts = /tts/.test(req.url);
      const image = /nano-banana/.test(req.url);
      requests.push({ url: req.url, tts, image, text, refs: parts.filter((p) => p.inlineData).length });
      const ok = () => res.writeHead(200, { 'content-type': 'application/json' });
      const fail = (code, status, message) => (res.writeHead(code, { 'content-type': 'application/json' }), res.end(JSON.stringify({ error: { code, message, status } })));
      // gemini-3.8-flash-tts isn't served here: the app must fall back to gemini-3.8-flash-lite-tts
      if (/gemini-3\.8-flash-tts:/.test(req.url)) return fail(404, 'NOT_FOUND', 'models/gemini-3.8-flash-tts is not found for API version v1beta');
      if (tts) return ok(), res.end(JSON.stringify({ candidates: [{ content: { parts: [{ inlineData: { mimeType: 'audio/L16;codec=pcm;rate=24000', data: PCM } }] } }] }));
      if (image) {
        if (/giant silver spoon/.test(text)) return fail(500, 'INTERNAL', 'image generation failed');
        return ok(), res.end(JSON.stringify({ candidates: [{ content: { parts: [{ inlineData: { mimeType: 'image/png', data: PROP_PNG } }] } }] }));
      }
      // the first text request finds gemini-3.8-flash "retired": the app falls back to gemini-3.5-flash-lite once
      if (/gemini-3\.8-flash:/.test(req.url) && !requests.some((r) => r.fallbackDone)) {
        requests.at(-1).fallbackDone = true;
        return fail(404, 'NOT_FOUND', 'models/gemini-3.8-flash is not found for API version v1beta');
      }
      if (scriptMode === 'quota') return fail(429, 'RESOURCE_EXHAUSTED', 'Quota exceeded for generate_content_free_tier_requests');
      ok();
      let out;
      if (/topik episode/.test(text)) {
        const n = Number(/Tulis (\d+) topik/.exec(text)?.[1] ?? 1);
        out = { seeds: Array.from({ length: n }, (_, i) => `Topik Gemini ${i + 1}: kenapa harga cabai naik tiap Lebaran`) };
      } else if (scriptMode === 'good') {
        // the first attempt comes back short (9 lines): the Show Bible retry asks again, strictly
        out = SHOW(scriptCalls++ === 0 ? 9 : 15);
      } else out = { title: 'x', lines: [{ speaker: 'uco', text: 'cuma satu baris' }] };
      // topics come back in a ```json fence, as models sometimes answer
      const answer = /topik episode/.test(text) ? '```json\n' + JSON.stringify(out, null, 2) + '\n```' : JSON.stringify(out);
      res.end(JSON.stringify({ candidates: [{ content: { parts: [{ text: answer }] }, finishReason: 'STOP' }] }));
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
  const scriptReqs = requests.filter((r) => !r.tts && !r.image).slice(textBefore).filter((r) => /Show Bible|head writer "Uco & Ocu"/.test(r.text));
  check('script: Show Bible prompt; the 9-line draft is retried once, strictly', scriptReqs.length === 2 && /1[46]-1[68] baris/.test(scriptReqs[0].text) && /PERCOBAAN SEBELUMNYA DITOLAK karena: only 9 lines \(needs 1[46]-1[68]\)/.test(scriptReqs[1].text), `${scriptReqs.length} script requests`);
  const [s] = await sql`SELECT lines, custom, approved_at, direction FROM scripts WHERE project_id = ${slot.episode_id}`;
  const ep6 = slot.episode_id.replace(/-/g, '').slice(0, 6);
  const tags = s.lines.map((l) => l.prop_tag);
  check('props: fresh prop on its beat, exact bank prop kept, unrelated leftover and failed image → none', tags[0] === `jus-rendang-${ep6}` && tags[1] === 'bubur-kerupuk' && tags[3] === 'none' && tags[5] === 'none' && !tags.includes('kalkulator-9-juta') && !tags.includes('nasi-padang-blender'), JSON.stringify(tags.slice(0, 6)));
  const png = path.join(ROOT, `.local-storage/custom-assets/props/jus-rendang-${ep6}.png`);
  const alpha = fs.existsSync(png) ? require('child_process').execFileSync('python3', ['-c', `from PIL import Image\nim = Image.open(${JSON.stringify(png)}); w, h = im.size\nprint(im.mode, im.getpixel((1, 1))[3], im.getpixel((w // 2 - 20, h // 2 - 25))[3])`]).toString().trim() : 'missing';
  check('props: generated with 2 style references, cut out (transparent background, interior white kept), uploaded', /^RGBA 0 255$/.test(alpha) && requests.filter((r) => r.image).every((r) => r.refs === 2), alpha);
  const [hand] = await sql`SELECT handoff FROM episode_queue WHERE id = ${target}`;
  check('props: statuses (one done, the spoon dropped with its reason)', JSON.stringify(hand.handoff.props.map((x) => x.status)) === '["done","failed"]' && /500/.test(hand.handoff.props[1].error ?? ''), JSON.stringify(hand.handoff.props.map((x) => [x.name, x.status])));
  const takeovers = s.lines.filter((l) => l.layout === 'takeover' && l.stat);
  check('script: 15 lines, takeovers, thought, explainer, callouts, SFX, FOLLOW @UCO.OCU outro, approved', s.lines.length === 15 && takeovers.length === 2 && s.lines.some((l) => l.thought_bubble) && s.lines.some((l) => l.overlay === 'brain-badge') && s.lines.filter((l) => l.kinetic_text).length >= 5 && s.lines.at(-1).emotion === 'cta' && s.direction === 'CTA: FOLLOW @UCO.OCU' && s.custom && s.approved_at && !JSON.stringify(s.lines).includes('—'));
  const [p] = await sql`SELECT title, video_style, voice_provider, status, platform_captions IS NOT NULL AS caps FROM content_projects WHERE id = ${slot.episode_id}`;
  const [{ format }] = await sql`SELECT format FROM episode_queue WHERE id = ${target}`;
  const style = { comedy_debate: 'uco-ocu-2d-comic', affiliate: 'uco-ocu-2d-comic', koran_kinetik: 'editorial-paper-cutout', diagram_taktis: 'tactical-vector-hud' }[format];
  check(`episode: ${format} → ${style}, Gemini TTS, recorded, captions`, p.video_style === style && p.voice_provider === 'gemini_tts' && p.status === 'recorded' && p.caps && !p.title.includes('—'), JSON.stringify(p));
  const takes = await sql`SELECT count(*)::int AS n FROM recordings WHERE project_id = ${slot.episode_id} AND is_selected AND source = 'ai'`;
  const lite = requests.filter((r) => /gemini-3\.8-flash-lite-tts:/.test(r.url)).length;
  check('voices: one take per line; gemini-3.8-flash-tts 404 → gemini-3.8-flash-lite-tts', takes[0].n === 15 && lite === 15 && requests.some((r) => /gemini-3\.8-flash-tts:/.test(r.url)), `${takes[0].n} takes, ${lite} lite-tts calls`);
  const outputs = fs.readFileSync(path.join(OUT, 'gh-output.txt'), 'utf8');
  check('prepare: workflow outputs episode_id, job_id, voice=none', outputs.includes(`episode_id=${slot.episode_id}`) && outputs.includes(`job_id=${slot.render_job_id}`) && outputs.includes('voice=none'));

  const [pv] = await sql`SELECT progress_stage, progress_percent, progress_detail FROM episode_queue WHERE id = ${target}`;
  check('progress: the worker reported real voicing (no RVC: 30-75 %), last line at 75%', pv.progress_stage === 'voicing' && pv.progress_percent === 75 && pv.progress_detail === 'Voicing line 15 of 15', JSON.stringify(pv));
  check('progress: every report on the way was accepted (no "progress report skipped" warning)', !/progress report skipped/.test(prep), prep.split('\n').find((l) => /skipped/.test(l)));
  if (process.env.RENDER === '1') {
    const r = await run('npx', ['tsx', 'render.mts', slot.episode_id, '--base', base], { cwd: path.join(ROOT, 'video'), env: { ...process.env, JOB_ID: slot.render_job_id, SLOT_ID: target, APP_URL: base }, maxBuffer: 64 * 1024 * 1024 });
    console.log(r.stdout.split('\n').filter((l) => !/frame/i.test(l)).slice(-8).join('\n'));
  } else {
    // stand-in for render.mts's upload: a stored MP4 row
    await sql`INSERT INTO episode_videos (project_id, script_id, storage_path, size_bytes, duration_ms) SELECT ${slot.episode_id}, id, ${`${slot.episode_id}/test.mp4`}, 10, 7000 FROM scripts WHERE project_id = ${slot.episode_id}`;
  }
  if (process.env.RENDER === '1') {
    const [pr] = await sql`SELECT progress_stage, progress_percent, progress_detail FROM episode_queue WHERE id = ${target}`;
    check('progress: render.mts reported Remotion progress, then the upload at 95%', pr.progress_stage === 'uploading' && pr.progress_percent === 95 && pr.progress_detail === 'Uploading MP4 & queueing posts...', JSON.stringify(pr));
  }
  const v = await sql`SELECT count(*)::int AS n FROM episode_videos WHERE project_id = ${slot.episode_id}`;
  check('render: a video landed', v[0].n === 1);
  await step('finish', target);
  const [done] = await sql`SELECT status, handoff FROM episode_queue WHERE id = ${target}`;
  check('finish: ready_to_post with the TikTok hand-off (no account connected)', done.status === 'ready_to_post' && /Cek keranjang kuning|#/.test(done.handoff.tiktokCaption ?? '') && done.handoff.notConnected.length === 3, JSON.stringify(done));
  const [job] = await sql`SELECT status FROM render_jobs WHERE id = ${slot.render_job_id}`;
  check('finish: the render job is done', job.status === 'done');
  const [pd] = await sql`SELECT progress_stage, progress_percent, progress_detail FROM episode_queue WHERE id = ${target}`;
  check('progress: 100% "Ready to post" when finished', pd.progress_stage === 'done' && pd.progress_percent === 100 && pd.progress_detail === 'Ready to post', JSON.stringify(pd));

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
  check('failure: a thin script twice fails the slot with a reason', failed && bad.status === 'failed' && /Gemini wrote only \d+ lines twice/.test(bad.error_message), JSON.stringify(bad));
  check('fallback: gemini-3.8-flash 404 → gemini-3.5-flash-lite answered', requests.some((r) => r.fallbackDone) && requests.some((r) => /gemini-3\.5-flash-lite:/.test(r.url)));

  // ---- a slot with no topic while Gemini is out of quota: the real error (status, model, message) reaches the slot
  scriptMode = 'quota';
  const bare = (await sql`SELECT id FROM episode_queue WHERE user_id = ${u.id} AND status = 'queued' AND id <> ${other} ORDER BY scheduled_for LIMIT 1`)[0].id;
  await sql`UPDATE episode_queue SET topic_seed = NULL, topic_source = NULL WHERE id = ${bare}`;
  await step('plan', bare);
  let quotaOut = '';
  try {
    await step('prepare', bare);
  } catch (e) {
    quotaOut = `${e.stdout ?? ''}${e.stderr ?? ''}`;
  }
  const [q429] = await sql`SELECT status, error_message FROM episode_queue WHERE id = ${bare}`;
  check('no topic + 429: slot error names status, model and Gemini message', q429.status === 'failed' && /Gemini 429 \(gemini-3\.8-flash\): RESOURCE_EXHAUSTED: Quota exceeded/.test(q429.error_message) && !/couldn't suggest/.test(q429.error_message), q429.error_message);
  check('no topic + 429: the same detail is in the worker log (GitHub Actions)', /422: .*Gemini 429 \(gemini-3\.8-flash\)/.test(quotaOut), quotaOut.trim().split('\n').pop());
  scriptMode = 'good';

  await page.reload();
  const readyRow = page.locator('li', { hasText: 'TikTok / Shopee hand-off' });
  await readyRow.getByRole('link', { name: 'Download video' }).waitFor();
  check('queue: hand-off shows Copy caption and Download', (await readyRow.getByRole('button', { name: 'Copy caption' }).count()) === 1 && (await readyRow.getByRole('link', { name: 'Download video' }).count()) === 1);
  const failedRow = page.locator('li', { hasText: 'lines twice' });
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

  // ---- Regenerate script & run: a weak 9-line draft is thrown away and the slot is made fresh
  const [weak] = await sql`
    INSERT INTO content_projects (user_id, title, format, target_platforms, status, video_style) VALUES (${u.id}, 'Skincare Mahal Investasi Wajah', 'short_video', '{tiktok}', 'recorded', 'uco-ocu-2d-comic') RETURNING id`;
  await sql`INSERT INTO scripts (project_id, version, title, target_duration_s, lines, sources, custom, approved_at) VALUES (${weak.id}, 1, 'Skincare Mahal Investasi Wajah', 30, ${sql.json(SHOW(9).lines)}, '[]', true, now())`;
  await sql`UPDATE episode_queue SET status = 'failed', episode_id = ${weak.id}, error_message = 'weak draft' WHERE id = ${other}`;
  await page.reload();
  const weakRow = page.locator('li', { hasText: 'Skincare Mahal Investasi Wajah' });
  page.once('dialog', (d) => d.accept());
  await weakRow.getByRole('button', { name: 'Regenerate script & run' }).click();
  await page.getByText(/Draft deleted, slot back in the queue/).waitFor();
  const [regen] = await sql`SELECT status, episode_id, handoff, error_message FROM episode_queue WHERE id = ${other}`;
  const gone = (await sql`SELECT count(*)::int AS n FROM content_projects WHERE id = ${weak.id}`)[0].n === 0;
  check('regenerate: the weak draft is deleted, the slot is queued again', gone && regen.status === 'queued' && regen.episode_id === null && regen.handoff === null && regen.error_message === null, JSON.stringify(regen));
  await step('plan', other);
  await step('prepare', other);
  const [fresh] = await sql`SELECT q.episode_id, jsonb_array_length(s.lines) AS n FROM episode_queue q JOIN scripts s ON s.project_id = q.episode_id WHERE q.id = ${other}`;
  check('regenerate: the run writes a fresh Show Bible script', fresh && fresh.episode_id !== weak.id && fresh.n === 15, JSON.stringify(fresh));
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
