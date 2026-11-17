import { safeEqual } from "@/lib/auth";
import { factCheck, generateIdeas, writeCaptions, writeScript, type ConceptOutline } from "@/lib/agents/writers-room";
import { db } from "@/lib/db";
import { getOwner } from "@/lib/queries";

export const maxDuration = 300;

/**
 * End-to-end self-test of the writers' room with the real Claude API (costs a few cents).
 * GET /api/cron/selftest with `Authorization: Bearer <CRON_SECRET>`. Runs ideas → fact check → script → captions on a
 * temporary episode, reports timings/cost/output, then deletes the episode. Optional ?topic=...
 */
export async function GET(request: Request) {
  const secret = process.env.CRON_SECRET;
  if (!secret || !safeEqual(request.headers.get("authorization") ?? "", `Bearer ${secret}`)) {
    return new Response("Unauthorized", { status: 401 });
  }
  const topic = new URL(request.url).searchParams.get("topic") ?? "Is drinking coffee every day actually bad for you?";
  const sql = db();
  const owner = await getOwner();
  if (!owner) return Response.json({ ok: false, error: "no owner" }, { status: 500 });

  const [p] = await sql<{ id: string }[]>`
    INSERT INTO content_projects (user_id, title, format, target_platforms, status)
    VALUES (${owner.id}, '[selftest]', 'short_video', '{tiktok,instagram,youtube,facebook}', 'ideating') RETURNING id`;
  const steps: Record<string, unknown> = {};
  const time = async <T,>(name: string, fn: () => Promise<T>) => {
    const t = Date.now();
    try {
      const v = await fn();
      steps[name] = { ok: true, secs: Math.round((Date.now() - t) / 100) / 10 };
      return v;
    } catch (err) {
      steps[name] = { ok: false, secs: Math.round((Date.now() - t) / 100) / 10, error: err instanceof Error ? err.message : String(err) };
      throw err;
    }
  };
  let sample: unknown = null;
  try {
    await time("ideas", () => generateIdeas({ userId: owner.id, projectId: p.id, direction: topic, count: 3 }));
    const [c] = await sql<{ title: string; hook: string; outline: ConceptOutline }[]>`
      SELECT title, hook, outline FROM concepts WHERE project_id = ${p.id} ORDER BY rank LIMIT 1`;
    const outline = { ...c.outline, needs_fact_check: true }; // always exercise web search in the self-test
    const facts = await time("fact_check", () => factCheck({ userId: owner.id, projectId: p.id, title: c.title, outline }));
    const script = await time("script", () => writeScript({ userId: owner.id, projectId: p.id, title: c.title, outline, factSheet: facts }));
    await time("captions", () => writeCaptions({ userId: owner.id, projectId: p.id, script }));
    const captions = await sql`SELECT platform, title, caption, hashtags FROM caption_options WHERE project_id = ${p.id}`;
    const all = [script.title, ...script.lines.flatMap((l) => [l.text, l.subtitle, l.on_screen_text ?? ""]), ...captions.map((x) => `${x.title ?? ""} ${x.caption}`)].join(" ");
    sample = {
      idea: { title: c.title, hook: c.hook },
      fact_sheet_chars: facts.length,
      fact_sheet_has_urls: /https?:\/\//.test(facts),
      script: {
        title: script.title,
        target_duration_s: script.target_duration_s,
        lines: script.lines.length,
        beats: [...new Set(script.lines.map((l) => l.beat))],
        speakers: [...new Set(script.lines.map((l) => l.speaker))],
        thought_bubbles: script.lines.filter((l) => l.thought_bubble).length,
        sources: script.sources.length,
        first_lines: script.lines.slice(0, 3).map((l) => `${l.speaker}: ${l.text} [${l.subtitle}]`),
      },
      captions: captions.map((x) => ({ platform: x.platform, title: x.title, caption: x.caption, hashtags: x.hashtags })),
      em_dashes_left: (all.match(/—/g) ?? []).length,
    };
  } catch {
    // step error already recorded
  }
  const runs = await sql<{ prompt_version: string; status: string; cost_usd: string | null; input_tokens: number | null; output_tokens: number | null; error: string | null }[]>`
    SELECT prompt_version, status, cost_usd, input_tokens, output_tokens, error FROM agent_runs WHERE project_id = ${p.id} ORDER BY started_at`;
  await sql`DELETE FROM content_projects WHERE id = ${p.id}`;
  const cost = runs.reduce((a, r) => a + Number(r.cost_usd ?? 0), 0);
  return Response.json({
    ok: Object.values(steps).every((s) => (s as { ok: boolean }).ok) && Object.keys(steps).length === 4,
    steps,
    cost_usd: Math.round(cost * 10000) / 10000,
    runs,
    sample,
  });
}
