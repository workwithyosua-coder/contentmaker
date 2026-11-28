// The real scriptSlot on an Affiliate Debate slot, against Postgres with migration 022 applied and Gemini faked at
// fetch(): (1) an empty product bank runs the slot as a regular Comedy Debate and logs why; (2) with products, the
// least recently used active one is sold, the episode gets its pinned comment and hand-off note, the product is marked
// used; (3) a draft that pitches on line 1 is regenerated once. Run:
//   DATABASE_URL=… tsx --conditions=react-server --tsconfig tsconfig.json tests/integration/affiliate-slot.test.mts
import assert from "node:assert/strict";
Object.assign(process.env, { GEMINI_API_KEY: "test", GEMINI_API_BASE: "http://gemini.test" });

const prompts: string[] = [];
let pitchFirst = false;
const line = (o: Record<string, unknown>) => ({ beat: "escalation", subtitle: "A line", pose: "deadpan", shot: "solo-ocu", layout: "standard", explainerCard: "none", sfx: [], prop: "none", kicker: "FAKTA", headline: "POIN", ...o });
const script = (affiliate: boolean, pitch: boolean) => ({
  title: affiliate ? "Es batu bau bawang" : "Kopi mahal tiap hari",
  propSpecs: [{ slug: "ice-tray", prompt: "a silicone ice tray with a lid" }],
  lines: [
    line({ beat: "hook", speaker: "uco", text: pitch ? "Beli Ice Tray FreshBox cuma 89 ribu di keranjang kuning!" : "Kenapa es batu di freezer gue bau bawang terus?!", pose: "angry", shot: "solo-uco", callout: "ES BAU BAWANG" }),
    line({ speaker: "ocu", text: "Hah, serius lo nanya?", callout: "SERIUS" }),
    line({ speaker: "uco", text: "Serius, es teh gue jadi rasa sambal semalam.", pose: "defensive", shot: "solo-uco" }),
    line({ beat: "insight", speaker: "ocu", text: "Itu migrasi aroma, molekul bau nempel ke air yang dingin.", pose: "explaining", explainerCard: "brain-badge", callout: "MIGRASI AROMA" }),
    line({ speaker: "uco", text: "Bentar, bentar dulu!", pose: "shocked", shot: "solo-uco" }),
    line({ speaker: "ocu", text: "Cetakan terbuka nyerap bau dua kali lebih cepat.", layout: "takeover", statCard: "2X | BAU NEMPEL DI CETAKAN TERBUKA", prop: "ice-tray" }),
    line({ speaker: "uco", text: "Terus gue harus gimana dong sekarang?", pose: "defensive", shot: "solo-uco" }),
    line({ speaker: "ocu", text: "Ice tray silikon bertutup, rapat dan gampang dicopot.", prop: "ice-tray", callout: "TRAY BERTUTUP" }),
    line({ speaker: "uco", text: "Gue udah beli tiga cetakan plastik minggu lalu.", pose: "thought", shot: "solo-uco", callout: "TIGA CETAKAN SIA-SIA" }),
    line({ speaker: "ocu", text: "Dan lo masih minum es rasa bawang tiap hari.", pose: "deadpan" }),
    line({ speaker: "uco", text: "Ya udah, gue tetap pakai yang lama aja!", pose: "triumphant", shot: "closeup-punch", callout: "KERAS KEPALA" }),
    line({ speaker: "ocu", text: "Hidup lo emang penuh rasa bawang, Uco.", pose: "deadpan" }),
    line({ beat: "button", speaker: "ocu", text: affiliate ? "Ketuk keranjang kuning di bawah, terus follow @uco.ocu!" : "Follow @uco.ocu biar nggak ketipu lagi!", pose: "cta", callout: "KERANJANG KUNING" }),
  ],
});
globalThis.fetch = (async (input: string | URL, init?: RequestInit) => {
  const u = new URL(String(input));
  if (u.hostname !== "gemini.test") throw new Error(`unexpected ${u}`);
  const prompt = JSON.parse(String(init?.body)).contents[0].parts[0].text as string;
  prompts.push(prompt);
  const affiliate = /PRODUK AFFILIATE/.test(prompt);
  const retry = /QA: /.test(prompt);
  const body = script(affiliate, affiliate && pitchFirst && !retry);
  return new Response(JSON.stringify({ candidates: [{ content: { parts: [{ text: JSON.stringify(body) }] } }] }), { status: 200 });
}) as typeof fetch;

const { db } = await import("../../src/lib/db.ts");
const { scriptSlot } = await import("../../src/lib/scheduler-server.ts");
const { NO_PRODUCT_NOTE } = await import("../../src/lib/affiliate/affiliate.ts");
const sql = db();
const [owner] = await sql`SELECT id FROM users ORDER BY created_at LIMIT 1`;
await sql`DELETE FROM content_schedules`;
await sql`DELETE FROM affiliate_products`;
await sql`DELETE FROM studio_lessons`; // no playbook rules: no Gemini audit call
const [sc] = await sql`INSERT INTO content_schedules (user_id) VALUES (${owner.id}) RETURNING id`;
const slotAt = async (minutes: number) =>
  (await sql`INSERT INTO episode_queue (schedule_id, user_id, scheduled_for, format, status, topic_seed) VALUES (${sc.id}, ${owner.id}, now() + make_interval(mins => ${minutes}), 'affiliate', 'scripting', NULL) RETURNING id`)[0].id as string;

// (1) empty bank: a regular Comedy Debate, logged
prompts.length = 0;
const s1 = await slotAt(10);
await sql`UPDATE episode_queue SET topic_seed = 'kopi mahal tiap hari' WHERE id = ${s1}`;
const r1 = await scriptSlot(s1);
assert.ok(r1.qa.includes(NO_PRODUCT_NOTE), r1.qa.join(" | "));
assert.equal((await sql`SELECT format FROM episode_queue WHERE id = ${s1}`)[0].format, "comedy_debate");
assert.ok(!prompts.some((p) => /PRODUK AFFILIATE/.test(p)), "no product block in a fallback prompt");
assert.equal((await sql`SELECT affiliate_product_id FROM content_projects WHERE id = ${r1.episodeId}`)[0].affiliate_product_id, null);
console.log("(1) empty bank →", r1.qa.join(" | "));

// (2) products: the least recently used active one is sold; copy saved; marked used
const [recent] = await sql`INSERT INTO affiliate_products (name, category, problem_angle, price_idr, last_used_at, times_used) VALUES ('Blender Mini', 'Gadget', 'jus berampas', 249000, now() - interval '1 day', 3) RETURNING id`;
await sql`INSERT INTO affiliate_products (name, category, problem_angle, price_idr, status) VALUES ('Paused Thing', 'Lifestyle', 'apa saja', 10000, 'paused')`;
const [lru] = await sql`INSERT INTO affiliate_products (name, category, problem_angle, price_idr, shopee_url, last_used_at, times_used) VALUES ('Ice Tray FreshBox', 'Rumah Tangga', 'es batu di freezer selalu bau bawang', 89000, 'https://s.shopee.co.id/abc', now() - interval '20 days', 1) RETURNING id`;
prompts.length = 0;
const s2 = await slotAt(20);
const r2 = await scriptSlot(s2);
assert.ok(r2.qa.some((q) => /selling "Ice Tray FreshBox"/.test(q)), r2.qa.join(" | "));
assert.ok(prompts[0].includes("PRODUK AFFILIATE") && prompts[0].includes("Ice Tray FreshBox"));
const [ep] = await sql`SELECT affiliate_product_id, pinned_comment, affiliate_handoff_note FROM content_projects WHERE id = ${r2.episodeId}`;
assert.equal(ep.affiliate_product_id, lru.id);
assert.ok(ep.pinned_comment.includes("https://s.shopee.co.id/abc"));
assert.ok(ep.affiliate_handoff_note.includes("[TEMPEL LINK TIKTOK SHOP]"), "no TikTok link saved: an explicit placeholder");
const [used] = await sql`SELECT times_used, last_used_at > now() - interval '1 minute' AS just_now FROM affiliate_products WHERE id = ${lru.id}`;
assert.deepEqual([used.times_used, used.just_now], [2, true]);
assert.equal((await sql`SELECT times_used FROM affiliate_products WHERE id = ${recent.id}`)[0].times_used, 3, "the other product is untouched");
const lines = (await sql`SELECT lines FROM scripts WHERE project_id = ${r2.episodeId}`)[0].lines as { text: string }[];
assert.match(lines.at(-1)!.text, /keranjang kuning/);
console.log("(2) product →", r2.qa.join(" | "));

// (3) the slot's own product wins; a pitching first draft is regenerated exactly once
await sql`UPDATE affiliate_products SET name = 'Ice Tray FreshBox', last_used_at = now() WHERE id = ${lru.id}`;
const s3 = await slotAt(30);
await sql`UPDATE episode_queue SET affiliate_product_id = ${lru.id} WHERE id = ${s3}`;
pitchFirst = true;
prompts.length = 0;
const r3 = await scriptSlot(s3);
pitchFirst = false;
assert.match(r3.qa.find((q) => q.startsWith("QA gate pass 1"))!, /FAILED: .*line 1 (names the product|pitches)/);
assert.equal(r3.qa.find((q) => q.startsWith("QA gate pass 2")), "QA gate pass 2 (repair): passed");
assert.equal(prompts.filter((p) => /QA: /.test(p)).length, 1, "exactly one corrective retry");
const l3 = (await sql`SELECT lines FROM scripts WHERE project_id = ${r3.episodeId}`)[0].lines as { text: string }[];
assert.doesNotMatch(l3[0].text, /keranjang|89 ribu|FreshBox/i, "the repaired script opens on the problem");
console.log("(3) pitch repaired →", r3.qa.join(" | "));

await sql`DELETE FROM content_projects WHERE id IN (${r1.episodeId}, ${r2.episodeId}, ${r3.episodeId})`;
await sql`DELETE FROM content_schedules WHERE id = ${sc.id}`;
await sql`DELETE FROM affiliate_products`;
await sql.end();
console.log("affiliate-slot: OK");
