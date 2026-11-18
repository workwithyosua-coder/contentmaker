// Fake TikTok Content Posting API for local tests (TIKTOK_API_BASE=http://localhost:4020). Logs what was posted.
const http = require('http');
const posted = [];
http.createServer((req, res) => {
  let body = []; req.on('data', (c) => body.push(c)); req.on('end', () => {
    const buf = Buffer.concat(body); const json = (o) => { res.writeHead(200, { 'content-type': 'application/json' }); res.end(JSON.stringify(o)); };
    if (req.url === '/v2/post/publish/creator_info/query/') return json({ data: { creator_nickname: 'Uco & Ocu', creator_avatar_url: '', privacy_level_options: ['PUBLIC_TO_EVERYONE', 'MUTUAL_FOLLOW_FRIENDS', 'SELF_ONLY'], comment_disabled: false, duet_disabled: true, stitch_disabled: false, max_video_post_duration_sec: 600 }, error: { code: 'ok' } });
    if (req.url === '/v2/post/publish/video/init/') { posted.push(JSON.parse(buf.toString()).post_info); return json({ data: { publish_id: 'pub_1', upload_url: 'http://localhost:4020/upload' }, error: { code: 'ok' } }); }
    if (req.url === '/upload') { res.writeHead(201); return res.end(); }
    if (req.url === '/v2/post/publish/status/fetch/') return json({ data: { status: 'PUBLISH_COMPLETE', publicaly_available_post_id: [7300000000000000001] }, error: { code: 'ok' } });
    if (req.url === '/posted') return json(posted);
    res.writeHead(404); res.end();
  });
}).listen(4020, () => console.log('tiktok mock on 4020'));
