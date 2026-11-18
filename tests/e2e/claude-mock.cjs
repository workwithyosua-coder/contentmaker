// Fake Anthropic Messages API for local UI tests. FAIL_SCRIPT=1 makes the script step fail once.
const http = require('http');
let failScriptOnce = process.env.FAIL_SCRIPT === '1';
const msg = (text, stop = 'end_turn') => JSON.stringify({ id: 'm', type: 'message', role: 'assistant', model: 'claude-opus-5-5', content: [{ type: 'text', text }], stop_reason: stop, usage: { input_tokens: 900, output_tokens: 400 } });
http.createServer((req, res) => {
  let body = ''; req.on('data', c => body += c); req.on('end', () => {
    const b = JSON.parse(body || '{}'); const prompt = (b.messages?.[0]?.content) || '';
    const send = (s, status = 200) => setTimeout(() => { res.writeHead(status, { 'content-type': 'application/json' }); res.end(s); }, 3000);
    if (b.tools) return send(msg('- Fact: social proof is a documented bias (source: https://example.org/social-proof)'));
    if (prompt.startsWith('Direction from the creator')) return send(msg(JSON.stringify({ ideas: [0,1,2,3,4].map(i => ({ title: `Ide ${i+1}: Antre roti viral`, pillar: 'food', topic: 'Viral queues', hook_line: 'Antre tiga jam demi roti?', hook_speaker: 'uco', uco_take: 'Ekonomi bangkit!', ocu_take: 'Kita cuma dapat maag.', enlightening_fact: 'Social proof', why_it_works: 'relatable', needs_fact_check: true })) })));
    if (prompt.startsWith('Write the full dialogue')) {
      if (failScriptOnce) { failScriptOnce = false; return send(JSON.stringify({ type: 'error', error: { type: 'invalid_request_error', message: 'Simulated failure for testing' } }), 400); }
      return send(msg(JSON.stringify({ title: 'Antre 3 Jam Demi Roti', target_duration_s: 40, lines: [{ beat: 'hook', speaker: 'uco', text: 'Antre tiga jam demi roti?', subtitle: 'Three hours for bread?', expression: 'excited', thought_bubble: false, visual: 'queue', on_screen_text: '3 JAM', delivery: 'fast, amazed' }, { beat: 'counter', speaker: 'ocu', text: 'Atau kita nggak punya kegiatan lain.', subtitle: 'Or we have nothing better to do.', expression: 'deadpan', thought_bubble: false, visual: 'coffee', on_screen_text: null, delivery: null }], sources: [{ claim: 'social proof', url: 'https://example.org/social-proof' }] })));
    }
    if (prompt.startsWith('These ')) { // script import: deliberately rewrites the Indonesian, so tests prove exact mode keeps the pasted lines
      const n = Number(/^These (\d+) spoken lines/.exec(prompt)[1]); const beats = ['hook', 'counter', 'escalation', 'escalation', 'concession', 'button'];
      return send(msg(JSON.stringify({ title: 'Ngaku Bokek, Kafe Penuh', lines: Array.from({ length: n }, (_, i) => ({ beat: beats[Math.min(i, 5)], speaker: i % 2 ? 'ocu' : 'uco', text: 'MOCK REWRITE', subtitle: 'mock EN', expression: i % 2 ? 'deadpan' : 'angry', thought_bubble: false, visual: 'mock visual', on_screen_text: null, delivery: 'fast' })) })));
    }
    if (prompt.startsWith('Write publishing metadata')) return send(msg(JSON.stringify({ youtube: { title: 'Antre roti?', description: 'Sumber: example.org', tags: ['shorts'] }, tiktok: { caption: 'Tim Uco atau Tim Ocu?', hashtags: ['ucoocu', 'roti', 'fyp', 'komedi'] }, instagram: { hook: 'Antre roti viral', context: 'Uco vs Ocu.', comment_prompt: 'Kalian tim mana?', hashtags: ['roti'] }, facebook: { title: 'Antre roti?', description: 'Kalian tim mana?' } })));
    send(JSON.stringify({ type: 'error', error: { type: 'invalid_request_error', message: 'unknown prompt' } }), 400);
  });
}).listen(4010, () => console.log('mock on 4010'));
