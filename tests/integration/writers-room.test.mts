process.env.ANTHROPIC_API_KEY = "test-key";
const reqs: any[] = [];
const msg = (text: string, extra: object = {}) => new Response(JSON.stringify({ id: "m", type: "message", role: "assistant", model: "claude-opus-5-5", content: [{ type: "text", text }], stop_reason: "end_turn", usage: { input_tokens: 1000, output_tokens: 500, cache_read_input_tokens: 0, server_tool_use: { web_search_requests: 2 } }, ...extra }), { status: 200, headers: { "content-type": "application/json" } });
let paused = false;
globalThis.fetch = (async (input: any, init?: any) => {
  const body = JSON.parse(init.body); reqs.push(body);
  const prompt: string = body.messages[0].content;
  if (body.tools?.[0]?.type === "web_search_20260209") {
    if (!paused) { paused = true; return new Response(JSON.stringify({ id: "m", type: "message", role: "assistant", model: "x", content: [{ type: "text", text: "searching" }], stop_reason: "pause_turn", usage: { input_tokens: 10, output_tokens: 5 } }), { status: 200, headers: { "content-type": "application/json" } }); }
    return msg("- Coffee: up to 400 mg caffeine/day is considered safe for most adults (source: https://www.fda.gov/x)");
  }
  if (prompt.startsWith("Direction from the creator")) return msg(JSON.stringify({ ideas: Array.from({ length: 5 }, (_, i) => ({ title: `Kopi ${i}`, pillar: "science", topic: "Is coffee bad?", hook_line: "Kopi itu racun!", hook_speaker: "ocu", uco_take: "Kopi bikin produktif!", ocu_take: "Jantung kita taruhannya.", enlightening_fact: "400 mg/day is fine", why_it_works: "relatable", needs_fact_check: i === 0 })) }));
  if (prompt.startsWith("Write the full dialogue")) return msg(JSON.stringify({ title: prompt.includes("Previous version") ? "Kopi v2" : "Kopi: Racun atau Bensin?", target_duration_s: 45, lines: [{ beat: "hook", speaker: "ocu", text: "Kopi itu racun — pelan-pelan.", subtitle: "Coffee is poison—slowly.", expression: "deadpan", thought_bubble: false, visual: "Ocu holding a cup", on_screen_text: "RACUN?" }, { beat: "concession", speaker: "uco", text: "Dia ada benarnya sih...", subtitle: "He has a point...", expression: "thinking", thought_bubble: true, visual: "thought bubble", on_screen_text: null }], sources: [{ claim: "400 mg/day", url: "https://www.fda.gov/x" }] }));
  if (prompt.startsWith("Write platform captions")) return msg(JSON.stringify({ tiktok: { caption: "Kopi bikin melek — Tim Uco atau Tim Ocu?", hashtags: ["#kopi", "fyp"] }, instagram: { caption: "Kopi: racun atau bensin?", hashtags: ["kopi"] }, facebook: { caption: "Kalian tim mana?" }, youtube: { title: "Kopi itu racun? #Shorts", description: "Sumber: fda.gov", hashtags: ["shorts"] } }));
  throw new Error("unexpected prompt: " + prompt.slice(0, 60));
}) as typeof fetch;

const { generateIdeas, factCheck, writeScript, writeCaptions } = await import("../../src/lib/agents/writers-room.ts");
const { db } = await import("../../src/lib/db.ts");
const sql = db();
const [owner] = await sql`SELECT id FROM users ORDER BY created_at LIMIT 1`;
await sql`INSERT INTO brand_kits (user_id, name, voice_guide, is_default) VALUES (${owner.id}, 'Uco Ocu test', 'Uco loud, Ocu calm', true)`;
const [p] = await sql`INSERT INTO content_projects (user_id, title, format, target_platforms, status) VALUES (${owner.id}, 'test', 'short_video', '{tiktok,instagram,youtube,facebook}', 'ideating') RETURNING id`;
console.log("ideas:", await generateIdeas({ userId: owner.id, projectId: p.id, direction: "coffee" }));
const [c] = await sql`SELECT id, title, outline FROM concepts WHERE project_id = ${p.id} ORDER BY rank LIMIT 1`;
const facts = await factCheck({ userId: owner.id, projectId: p.id, title: c.title, outline: c.outline });
console.log("fact sheet:", facts.slice(0, 60), "| research requests:", reqs.filter(r => r.tools).length, "(1 pause_turn resume)");
const s1 = await writeScript({ userId: owner.id, projectId: p.id, title: c.title, outline: c.outline, factSheet: facts });
const s2 = await writeScript({ userId: owner.id, projectId: p.id, title: c.title, outline: c.outline, factSheet: facts, feedback: "funnier", previous: s1 });
console.log("em-dash cleaned:", JSON.stringify([s1.lines[0].text, s1.lines[0].subtitle])); console.log("scripts:", s1.title, "→", s2.title, "| lines:", s1.lines.length, "| thought bubble:", s1.lines[1].thought_bubble);
await sql`INSERT INTO scripts (project_id, version, title, lines, sources) VALUES (${p.id}, 1, ${s1.title}, ${sql.json(s1.lines)}, ${sql.json(s1.sources)})`;
await writeCaptions({ userId: owner.id, projectId: p.id, script: s1 });
console.table(await sql`SELECT platform, caption, hashtags FROM caption_options WHERE project_id = ${p.id}`);
console.table(await sql`SELECT agent, prompt_version, status, input_tokens, output_tokens, cost_usd::float FROM agent_runs WHERE project_id = ${p.id} ORDER BY started_at`);
console.log("system prompt cached:", reqs.find(r => r.system?.[0]?.cache_control)?.system[0].cache_control.type, "| fallbacks:", reqs[0].fallbacks, "| effort(script):", reqs.find(r => r.messages[0].content.startsWith("Write the full"))?.output_config.effort);
await sql`DELETE FROM content_projects WHERE id = ${p.id}`; await sql`DELETE FROM brand_kits WHERE name = 'Uco Ocu test'`; await sql.end();
