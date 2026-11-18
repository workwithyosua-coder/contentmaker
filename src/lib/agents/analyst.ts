import "server-only";
import Anthropic from "@anthropic-ai/sdk";
import { betaZodOutputFormat } from "@anthropic-ai/sdk/helpers/beta/zod";
import { z } from "zod";
import { db } from "../db";
import { DIMENSIONS, getBreakdown, getConnectedPlatforms, type Dimension, type Platform } from "../queries";

const MODEL = "claude-opus-5-5";
const PROMPT_VERSION = "analyst-v1";
// USD per 1M tokens (Claude Opus 5.5) — used only for the cost column in agent_runs.
const PRICE = { input: 4, output: 20, cacheRead: 0.2 };

const SYSTEM = `You are the Analyst agent in a creator's personal content platform.
You receive aggregated performance data from the creator's OWN social accounts. Every post has a
performance_score in 0..1 that is a percentile against the creator's own history on the same account
(0.5 = typical post). "lift" = segment average score / overall average score.

Your job: find what is genuinely working and what is not, so the other agents (Strategist,
Creative Director, Copywriter) can make better content.

Rules:
- Only report patterns supported by the data you were given. Quote the numbers.
- Treat segments with fewer than 5 posts as low confidence (confidence <= 0.4). Prefer findings with
  larger samples and larger lifts.
- Platform-specific findings beat blended ones when the platforms disagree.
- Each recommendation must be a concrete instruction for the next piece of content.
- 4 to 8 insights. No generic social-media advice that isn't backed by this data.
- weekly_summary_md: 4-8 short markdown bullet points for the creator, plain language.`;

const InsightSchema = z.object({
  platform: z.enum(["instagram", "tiktok", "youtube", "linkedin", "x", "facebook", "threads"]).nullable(),
  dimension: z.string().describe("hook_type | style | duration | pillar | posting_time | face"),
  finding: z.string(),
  recommendation: z.string(),
  effect_size: z.number().describe("lift vs. baseline, e.g. 1.8 means 1.8x"),
  sample_size: z.number().int(),
  confidence: z.number().describe("0..1"),
  evidence_post_ids: z.array(z.string()),
});
const AnalystOutput = z.object({
  insights: z.array(InsightSchema),
  weekly_summary_md: z.string(),
});

async function buildContext(userId: string, days: number) {
  const sql = db();
  const platforms = await getConnectedPlatforms(userId);
  const breakdowns: Record<string, Record<string, unknown>> = {};
  for (const scope of [undefined, ...platforms] as (Platform | undefined)[]) {
    const key = scope ?? "all_platforms";
    breakdowns[key] = {};
    for (const dim of Object.keys(DIMENSIONS) as Dimension[]) {
      const rows = await getBreakdown(userId, dim, days, scope);
      breakdowns[key][dim] = rows.map((r) => ({
        value: r.label,
        posts: r.posts,
        avg_score: +r.avg_score.toFixed(3),
        lift: +r.lift.toFixed(2),
        median_views: Math.round(r.median_views),
        avg_completion: r.avg_completion === null ? null : +r.avg_completion.toFixed(3),
      }));
    }
  }
  const extremes = await sql`
    (SELECT 'top' AS bucket, pp.post_id, pp.platform, pp.performance_score, pp.views, p.caption_text,
            f.hook_type, s.name AS style, f.duration_bucket, f.has_face_in_first_2s, f.posted_hour
     FROM post_performance pp JOIN posts p ON p.id = pp.post_id JOIN post_features f ON f.post_id = pp.post_id
     LEFT JOIN editing_styles s ON s.id = f.editing_style_id
     WHERE pp.user_id = ${userId} AND pp.verdict NOT IN ('too_early', 'not_enough') AND pp.published_at >= now() - make_interval(days => ${days})
     ORDER BY pp.performance_score DESC LIMIT 8)
    UNION ALL
    (SELECT 'bottom', pp.post_id, pp.platform, pp.performance_score, pp.views, p.caption_text,
            f.hook_type, s.name, f.duration_bucket, f.has_face_in_first_2s, f.posted_hour
     FROM post_performance pp JOIN posts p ON p.id = pp.post_id JOIN post_features f ON f.post_id = pp.post_id
     LEFT JOIN editing_styles s ON s.id = f.editing_style_id
     WHERE pp.user_id = ${userId} AND pp.verdict NOT IN ('too_early', 'not_enough') AND pp.published_at >= now() - make_interval(days => ${days})
     ORDER BY pp.performance_score ASC LIMIT 8)`;
  return { window_days: days, platforms, breakdowns, top_and_bottom_posts: extremes };
}

export type AnalystResult =
  | { ok: true; insights: number; costUsd: number }
  | { ok: false; error: string };

export async function runAnalyst(userId: string, days = 90): Promise<AnalystResult> {
  if (!process.env.ANTHROPIC_API_KEY && !process.env.ANTHROPIC_AUTH_TOKEN) {
    return { ok: false, error: "ANTHROPIC_API_KEY is not set. Add it to .env.local to run the Analyst." };
  }
  const sql = db();
  const context = await buildContext(userId, days);
  const [run] = await sql<{ id: string }[]>`
    INSERT INTO agent_runs (agent, model, prompt_version, input)
    VALUES ('analyst', ${MODEL}, ${PROMPT_VERSION}, ${sql.json({ days })}) RETURNING id`;

  const client = new Anthropic();
  try {
    const response = await client.beta.messages.parse({
      model: MODEL,
      max_tokens: 16000,
      // Server-side fallback: if the model declines for policy reasons, the API retries on a default fallback model.
      betas: ["server-side-fallback-2026-07-01"],
      fallbacks: "default",
      output_config: { effort: "high", format: betaZodOutputFormat(AnalystOutput) },
      system: [{ type: "text", text: SYSTEM, cache_control: { type: "ephemeral" } }],
      messages: [{ role: "user", content: `Performance data (JSON):\n${JSON.stringify(context)}` }],
    });

    if (response.stop_reason === "refusal") throw new Error("The model declined this request.");
    if (response.stop_reason === "max_tokens") throw new Error("Output was cut off (max_tokens).");
    const out = response.parsed_output;
    if (!out) throw new Error("Could not parse the Analyst output.");

    const u = response.usage;
    const costUsd =
      ((u.input_tokens ?? 0) * PRICE.input +
        (u.output_tokens ?? 0) * PRICE.output +
        (u.cache_read_input_tokens ?? 0) * PRICE.cacheRead) /
      1_000_000;

    await sql.begin(async (tx) => {
      await tx`UPDATE insights SET status = 'superseded' WHERE user_id = ${userId} AND status = 'active'`;
      const ids: string[] = [];
      for (const i of out.insights) {
        const [row] = await tx<{ id: string }[]>`
          INSERT INTO insights (user_id, platform, dimension, finding, effect_size, sample_size, confidence,
                                evidence, recommendation)
          VALUES (${userId}, ${i.platform}, ${i.dimension}, ${i.finding}, ${i.effect_size}, ${i.sample_size},
                  ${Math.max(0, Math.min(1, i.confidence))}, ${tx.json({ post_ids: i.evidence_post_ids })},
                  ${i.recommendation})
          RETURNING id`;
        ids.push(row.id);
      }
      await tx`
        INSERT INTO performance_reports (user_id, period_start, period_end, summary_md, kpis, insight_ids)
        VALUES (${userId}, current_date - ${days}::int, current_date, ${out.weekly_summary_md},
                ${tx.json({ window_days: days })}, ${ids}::uuid[])`;
      await tx`
        UPDATE agent_runs SET status = 'succeeded', output = ${tx.json(out)}, finished_at = now(),
               input_tokens = ${u.input_tokens}, output_tokens = ${u.output_tokens},
               cache_read_tokens = ${u.cache_read_input_tokens ?? 0}, cost_usd = ${costUsd}
        WHERE id = ${run.id}`;
    });
    return { ok: true, insights: out.insights.length, costUsd };
  } catch (err) {
    const message =
      err instanceof Anthropic.AuthenticationError
        ? "Invalid Anthropic API key."
        : err instanceof Anthropic.RateLimitError
          ? "Rate limited by the Claude API — try again in a minute."
          : err instanceof Anthropic.APIError
            ? `Claude API error ${err.status}: ${err.message}`
            : err instanceof Error
              ? err.message
              : String(err);
    await sql`UPDATE agent_runs SET status = 'failed', error = ${message}, finished_at = now() WHERE id = ${run.id}`;
    return { ok: false, error: message };
  }
}
