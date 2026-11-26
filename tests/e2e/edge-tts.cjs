// End-to-end test of Edge TTS in the scheduler worker, against the app (local storage driver) and a fake Gemini on :4012.
//   A. Own Voice slot: Edge TTS fails once (the slot fails, already scripted) → Retry on the Schedule page → the script
//      is reused, Edge TTS voices every line (no Gemini TTS request), RVC converts them, render.mts renders the MP4
//      (RENDER=1), the posts are queued.
//   B. Gemini TTS slot: Gemini voices 3 lines, then answers 429 → Edge TTS voices only the 3 lines left.
// Edge TTS itself is stood in for by a tone (EDGE_FAKE=1) and RVC by a pitch shift (RVC_FAKE=1).
// Needs the app on PORT (default 3007) with GEMINI_API_BASE=http://localhost:4012 GEMINI_API_KEY=test STORAGE_DRIVER=local
// RENDER_TOKEN=… APP_PASSWORD=… DATABASE_URL=…
const http = require('http');
const fs = require('fs');
const path = require('path');
const { execFile } = require('child_process');
const { promisify } = require('util');
const run = promisify(execFile);
const postgres = require('postgres').default ?? require('postgres');
const { chromium } = require('playwright');

const base = `http://localhost:${process.env.PORT || 3007}`;
const ROOT = path.resolve(__dirname, '../..');
const OUT = process.env.OUT || path.join(__dirname, 'output');
fs.mkdirSync(OUT, { recursive: true });
const sql = postgres(process.env.DATABASE_URL, { onnotice: () => {} });

const L = (beat, speaker, text, emotion, extra = {}) => ({ beat, speaker, text, subtitle: `EN: ${text}`, emotion, camera_shot: speaker === 'uco' ? 'solo-uco' : 'solo-ocu', prop_tag: 'none', layout: 'standard', kicker: 'FAKTA', headline: 'SKINCARE MAHAL', thought_bubble: false, ...extra });
const SCRIPT = {
  title: 'Skincare Mahal Investasi Wajah',
  lines: [
    L('hook', 'uco', 'Uco & Ocu bahas skincare mahal!', 'triumphant'),
    L('counter', 'ocu', 'Mahal belum tentu cocok, Co.', 'deadpan'),
    L('escalation', 'uco', 'Ini investasi wajah, tau!', 'defensive'),
    L('insight', 'ocu', 'Yang penting kandungannya, bukan harganya.', 'explaining'),
    L('concession', 'uco', 'Iya juga sih.', 'shocked', { thought_bubble: true }),
    // 8 more lines of banter (a Show Bible script has at least 12), then the outro CTA
    ...Array.from({ length: 8 }, (_, i) => (i % 2 ? L('escalation', 'ocu', `Gue cek lagi, Co, poin ke ${i + 1}.`, 'inspecting') : L('escalation', 'uco', `Tapi lo liat dulu dong, poin ke ${i + 1}!`, 'phone'))),
    L('button', 'ocu', 'Follow @uco.ocu, cek label dulu sebelum beli.', 'cta'),
  ],
};
const N = SCRIPT.lines.length; // 14
const PCM = (() => {
  const b = Buffer.alloc(48000);
  for (let i = 0; i < 24000; i++) b.writeInt16LE(Math.round(9000 * Math.sin((2 * Math.PI * 180 * i) / 24000) * (0.5 + 0.5 * Math.sin((2 * Math.PI * 4 * i) / 24000))), i * 2);
  return b.toString('base64');
})();
let ttsOk = Infinity; // Gemini TTS answers this many requests, then 429
const tts = [];
const mock = http
  .createServer((req, res) => {
    let body = '';
    req.on('data', (c) => (body += c));
    req.on('end', () => {
      const text = JSON.parse(body || '{}').contents?.[0]?.parts?.[0]?.text ?? '';
      if (/tts/.test(req.url)) {
        tts.push(text);
        if (tts.length > ttsOk) {
          res.writeHead(429, { 'content-type': 'application/json' });
          return res.end(JSON.stringify({ error: { code: 429, message: 'Quota exceeded for metric: generativelanguage.googleapis.com/generate_requests_per_model_per_day, limit: 10', status: 'RESOURCE_EXHAUSTED' } }));
        }
        res.writeHead(200, { 'content-type': 'application/json' });
        return res.end(JSON.stringify({ candidates: [{ content: { parts: [{ inlineData: { mimeType: 'audio/L16;codec=pcm;rate=24000', data: PCM } }] } }] }));
      }
      res.writeHead(200, { 'content-type': 'application/json' });
      const out = /topik episode/.test(text) ? { seeds: ['Topik cadangan'] } : SCRIPT;
      res.end(JSON.stringify({ candidates: [{ content: { parts: [{ text: JSON.stringify(out) }] }, finishReason: 'STOP' }] }));
    });
  })
  .listen(4012);

const env = (extra = {}) => ({ ...process.env, APP_URL: base, RUN_URL: 'https://github.com/x/y/actions/runs/2', GITHUB_OUTPUT: path.join(OUT, 'edge-gh-output.txt'), ...extra });
const step = async (args, extra) => (await run('npx', ['tsx', 'scheduler-step.mts', ...args], { cwd: path.join(ROOT, 'video'), env: env(extra), maxBuffer: 1 << 26 })).stdout;
const tryStep = async (args, extra) => {
  try {
    return { ok: true, out: await step(args, extra) };
  } catch (e) {
    return { ok: false, out: `${e.stdout ?? ''}${e.stderr ?? ''}` };
  }
};
const outputs = () => Object.fromEntries(fs.readFileSync(path.join(OUT, 'edge-gh-output.txt'), 'utf8').trim().split('\n').map((l) => l.split('=')));

(async () => {
  const results = [];
  const check = (name, ok, detail = '') => {
    results.push({ name, ok });
    console.log(`${ok ? 'PASS' : 'FAIL'} ${name}${detail ? ` (${detail})` : ''}`);
  };
  const [u] = await sql`SELECT id FROM users ORDER BY created_at LIMIT 1`;
  await sql`DELETE FROM content_schedules WHERE user_id = ${u.id}`;
  const models = path.join(ROOT, '.local-storage/studio-assets/voices');
  fs.mkdirSync(models, { recursive: true });
  for (const w of ['uco', 'ocu']) fs.writeFileSync(path.join(models, `${w}-voice.pth`), Buffer.alloc(1024, 1));
  const [sch] = await sql`
    INSERT INTO content_schedules (user_id, voice_provider, auto_execute, target_platforms) VALUES (${u.id}, 'gemini_tts_rvc', false, '{youtube,tiktok_drafts}') RETURNING id`;
  const at = (h) => new Date(Date.now() + h * 3600e3);
  const [a] = await sql`INSERT INTO episode_queue (schedule_id, user_id, scheduled_for, format, topic_seed, topic_source) VALUES (${sch.id}, ${u.id}, ${at(30)}, 'comedy_debate', 'Skincare mahal investasi wajah', 'manual') RETURNING id`;
  const [b] = await sql`INSERT INTO episode_queue (schedule_id, user_id, scheduled_for, format, topic_seed, topic_source) VALUES (${sch.id}, ${u.id}, ${at(31)}, 'koran_kinetik', 'Skincare mahal investasi wajah', 'manual') RETURNING id`;

  // ---- A. Own Voice: Edge TTS breaks once → the slot fails, already scripted
  await step(['plan', a.id]);
  const broken = await tryStep(['prepare', a.id], { EDGE_PYTHON: '/bin/false' });
  const [fa] = await sql`SELECT status, episode_id, error_message FROM episode_queue WHERE id = ${a.id}`;
  check('A: Own Voice asks for Edge TTS (no Gemini TTS request)', /Own Voice: Edge TTS makes the 14 base take/.test(broken.out) && tts.length === 0, broken.out.split('\n').find((l) => /Own Voice/.test(l)));
  check('A: Edge TTS failing fails the slot, script kept', !broken.ok && fa.status === 'failed' && fa.episode_id && /Edge TTS failed/.test(fa.error_message), JSON.stringify(fa));

  // Retry on the Schedule page (a 390 px phone)
  const br = await chromium.launch();
  const page = await (await br.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, colorScheme: 'dark' })).newPage();
  await page.goto(`${base}/login`);
  await page.fill('#password', process.env.APP_PASSWORD);
  await page.click('button[type=submit]');
  await page.waitForURL(`${base}/`);
  await page.goto(`${base}/schedule`);
  const row = page.locator('li', { hasText: 'Edge TTS failed' });
  await row.getByRole('button', { name: 'Retry' }).click();
  await page.getByText(/Back in the queue/).waitFor();
  check('A: Retry puts the scripted slot back in the queue', (await sql`SELECT status FROM episode_queue WHERE id = ${a.id}`)[0].status === 'queued');
  await br.close();

  await step(['plan', a.id]);
  const prepA = await step(['prepare', a.id], { EDGE_FAKE: '1' });
  const outA = outputs();
  check('A: the existing script is reused', prepA.includes('kept the script of "Skincare Mahal Investasi Wajah"') && (await sql`SELECT count(*)::int AS n FROM scripts WHERE project_id = ${fa.episode_id}`)[0].n === 1);
  check('A: still zero Gemini TTS requests', tts.length === 0, `${tts.length}`);
  const takesA = await sql`SELECT line_index, ai_prompt, mime_type, duration_ms FROM recordings WHERE project_id = ${fa.episode_id} AND is_selected ORDER BY line_index`;
  check('A: 14 Edge TTS base takes (RVC base mark, WAV)', takesA.length === N && takesA.every((t) => t.ai_prompt.startsWith('[gemini_tts_rvc:base] edge-tts id-ID-ArdiNeural') && t.mime_type === 'audio/wav' && t.duration_ms > 500), JSON.stringify(takesA.map((t) => t.ai_prompt.slice(22))));
  check('A: per-pose prosody (Uco shocked thought, Ocu cta)', /rate=-4% pitch=-2Hz pose=thought/.test(takesA[4].ai_prompt) && /rate=\+8% pitch=-2Hz pose=cta/.test(takesA[13].ai_prompt) && /rate=\+16% pitch=\+8Hz pose=defensive/.test(takesA[2].ai_prompt));
  check('A: speech frames logged per line', (prepA.match(/speech frames \d+–\d+/g) ?? []).length === N);
  check('A: render job with voice=rvc', outA.voice === 'rvc' && outA.episode_id === fa.episode_id, JSON.stringify(outA));
  await run('npx', ['tsx', 'rvc-stage.mts', fa.episode_id, '--base', base], { cwd: path.join(ROOT, 'video'), env: env({ RVC_FAKE: '1', JOB_ID: outA.job_id, SLOT_ID: a.id }) });
  const [pa] = await sql`SELECT progress_stage, progress_percent, progress_detail FROM episode_queue WHERE id = ${a.id}`;
  check('A: RVC reported per line, ending at 75% (Own Voice: voices 30-55, RVC 55-75)', pa.progress_stage === 'converting_voice' && pa.progress_percent === 75 && pa.progress_detail === `Converting voice ${N} of ${N}`, JSON.stringify(pa));
  const conv = await sql`SELECT ai_prompt FROM recordings WHERE project_id = ${fa.episode_id} AND is_selected ORDER BY line_index`;
  check('A: RVC converted every Edge TTS take (origin kept)', conv.length === N && conv.every((t) => /^\[rvc\] converted from .* \(edge-tts\)$/.test(t.ai_prompt)), conv[0]?.ai_prompt);
  const manifest = await (await fetch(`${base}/api/render/${fa.episode_id}`, { headers: { Authorization: `Bearer ${process.env.RENDER_TOKEN}` } })).json();
  check('A: the renderer sees them as ai_edge (no second speed-up)', manifest.lines.every((l) => l.audioSource === 'ai_edge'), manifest.lines.map((l) => l.audioSource).join(','));
  if (process.env.RENDER === '1') {
    const r = await run('npx', ['tsx', 'render.mts', fa.episode_id, '--base', base], { cwd: path.join(ROOT, 'video'), env: env({ JOB_ID: outA.job_id }), maxBuffer: 1 << 26 });
    console.log(r.stdout.split('\n').filter((l) => /done:|line 0\d|uploaded/.test(l)).join('\n'));
  } else {
    await sql`INSERT INTO episode_videos (project_id, script_id, storage_path, size_bytes, duration_ms) SELECT ${fa.episode_id}, id, ${`${fa.episode_id}/t.mp4`}, 10, 7000 FROM scripts WHERE project_id = ${fa.episode_id}`;
  }
  await step(['finish', a.id]);
  const [doneA] = await sql`SELECT status, handoff FROM episode_queue WHERE id = ${a.id}`;
  check('A: finished: ready to post with the TikTok hand-off', doneA.status === 'ready_to_post' && Boolean(doneA.handoff?.tiktokCaption), doneA.status);

  // ---- B. Gemini TTS: 3 lines voiced, then 429 → Edge TTS takes the 3 left
  await sql`UPDATE content_schedules SET voice_provider = 'gemini_tts' WHERE id = ${sch.id}`;
  ttsOk = tts.length + 3;
  await step(['plan', b.id]);
  const prepB = await tryStep(['prepare', b.id], { EDGE_FAKE: '1' });
  const [sb] = await sql`SELECT status, episode_id, error_message FROM episode_queue WHERE id = ${b.id}`;
  check('B: a 429 doesn\'t fail the slot', prepB.ok && sb.status === 'rendering', sb.error_message ?? sb.status);
  check('B: the worker log says Edge TTS fallback was used', /Gemini TTS quota hit \(.*RESOURCE_EXHAUSTED|Gemini TTS quota hit.*Edge TTS fallback used for the remaining 11 line\(s\)/.test(prepB.out), prepB.out.split('\n').find((l) => /quota/.test(l)));
  const takesB = await sql`SELECT line_index, ai_prompt FROM recordings WHERE project_id = ${sb.episode_id} AND is_selected ORDER BY line_index`;
  const gem = takesB.filter((t) => /^\[gemini_tts\]/.test(t.ai_prompt ?? ''));
  const edge = takesB.filter((t) => /^\[edge_tts\] edge-tts/.test(t.ai_prompt ?? ''));
  check('B: Gemini takes kept, Edge TTS only for the 11 lines left', takesB.length === N && gem.length === 3 && edge.length === 11 && edge.every((t) => t.line_index >= 3), takesB.map((t) => (t.ai_prompt ?? '').slice(0, 12)).join(' | '));
  check('B: render without RVC', outputs().voice === 'none');
  // after Edge TTS, the next voice call finds nothing left: no further Gemini TTS request
  check('cached: once voiced, nothing is voiced again (0 left, no extra Gemini call)', /voice: 0 new Gemini TTS take\(s\), 0 line\(s\) without a take/.test(prepB.out) && tts.length === ttsOk + 3, `${tts.length} TTS requests`);
  // a late / duplicate worker call for a slot that moved on is refused (409) and leaves the slot alone
  const stray = await fetch(`${base}/api/scheduler/slots/${b.id}/edge-plan`, { method: 'POST', headers: { Authorization: `Bearer ${process.env.RENDER_TOKEN}` } });
  check('a stray step call → 409, the rendering slot untouched', stray.status === 409 && (await sql`SELECT status FROM episode_queue WHERE id = ${b.id}`)[0].status === 'rendering', `${stray.status}`);

  // cleanup
  for (const id of [fa.episode_id, sb.episode_id]) if (id) await sql`DELETE FROM content_projects WHERE id = ${id}`;
  await sql`DELETE FROM content_schedules WHERE id = ${sch.id}`;
  for (const w of ['uco', 'ocu']) fs.rmSync(path.join(models, `${w}-voice.pth`), { force: true });
  await sql.end();
  mock.close();
  const failed = results.filter((r) => !r.ok);
  console.log(`\n${results.length - failed.length}/${results.length} checks passed`);
  process.exit(failed.length ? 1 : 0);
})().catch((e) => {
  console.error('FAILED:', e.message);
  mock.close();
  process.exit(1);
});
