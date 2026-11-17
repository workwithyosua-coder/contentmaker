import "server-only";
import Anthropic from "@anthropic-ai/sdk";
import { betaZodOutputFormat } from "@anthropic-ai/sdk/helpers/beta/zod";
import type { z } from "zod";
import { db } from "../db";

export const MODEL = "claude-opus-5-5";
// USD per 1M tokens (Claude Opus 5.5) and per web search, for the cost column in agent_runs.
const PRICE = { input: 4, output: 20, cacheRead: 0.2, cacheWrite: 5, webSearch: 0.01 };
const FALLBACK = { betas: ["server-side-fallback-2026-07-01"], fallbacks: "default" as const };

export type AgentName = "orchestrator" | "analyst" | "strategist" | "creative_director" | "copywriter" | "editor" | "qa";
type Effort = "low" | "medium" | "high" | "xhigh" | "max";

let client: Anthropic | null = null;
const anthropic = () => (client ??= new Anthropic());

export function claudeConfigured() {
  return Boolean(process.env.ANTHROPIC_API_KEY || process.env.ANTHROPIC_AUTH_TOKEN);
}

function cost(u: Anthropic.Beta.BetaUsage) {
  return (
    ((u.input_tokens ?? 0) * PRICE.input +
      (u.output_tokens ?? 0) * PRICE.output +
      (u.cache_read_input_tokens ?? 0) * PRICE.cacheRead +
      (u.cache_creation_input_tokens ?? 0) * PRICE.cacheWrite) /
      1_000_000 +
    (u.server_tool_use?.web_search_requests ?? 0) * PRICE.webSearch
  );
}

async function logged<T>(
  meta: { agent: AgentName; projectId?: string | null; promptVersion: string; input: unknown },
  run: () => Promise<{ value: T; usage: Anthropic.Beta.BetaUsage[]; output: unknown }>,
): Promise<T> {
  const sql = db();
  const [row] = await sql<{ id: string }[]>`
    INSERT INTO agent_runs (agent, project_id, model, prompt_version, input)
    VALUES (${meta.agent}, ${meta.projectId ?? null}, ${MODEL}, ${meta.promptVersion}, ${sql.json(meta.input as never)})
    RETURNING id`;
  try {
    const { value, usage, output } = await run();
    const sum = (k: "input_tokens" | "output_tokens" | "cache_read_input_tokens") => usage.reduce((a, u) => a + (u[k] ?? 0), 0);
    await sql`
      UPDATE agent_runs SET status = 'succeeded', output = ${sql.json(output as never)}, finished_at = now(),
             input_tokens = ${sum("input_tokens")}, output_tokens = ${sum("output_tokens")},
             cache_read_tokens = ${sum("cache_read_input_tokens")}, cost_usd = ${usage.reduce((a, u) => a + cost(u), 0)}
      WHERE id = ${row.id}`;
    return value;
  } catch (err) {
    const message = friendlyError(err);
    await sql`UPDATE agent_runs SET status = 'failed', error = ${message}, finished_at = now() WHERE id = ${row.id}`;
    throw new Error(message);
  }
}

export function friendlyError(err: unknown) {
  if (err instanceof Anthropic.AuthenticationError) return "The Claude API key in Vercel is invalid or was revoked.";
  if (err instanceof Anthropic.PermissionDeniedError) return "The Claude API key isn't allowed to do this (check the Anthropic Console).";
  if (err instanceof Anthropic.RateLimitError) return "Claude is rate-limiting requests. Wait a minute and try again.";
  if (err instanceof Anthropic.APIConnectionError) return "Couldn't reach Claude (network problem). Try again.";
  if (err instanceof Anthropic.APIError) {
    // The SDK already retried temporary errors; show the API's own message, not the raw JSON.
    const body = err.error as { error?: { type?: string; message?: string } } | undefined;
    const detail = body?.error?.message ?? err.message;
    if (err.status === 529 || body?.error?.type === "overloaded_error") return "Claude is overloaded right now. Try again in a few minutes.";
    if (/credit balance|billing/i.test(detail)) return "Your Anthropic credit balance is too low. Add credit in the Anthropic Console.";
    if ((err.status ?? 0) >= 500) return "Claude had a temporary problem. Try again.";
    return `Claude couldn't do this: ${detail}`;
  }
  return err instanceof Error ? err.message : String(err);
}

/** One Claude call that must return JSON matching `schema` (structured outputs). Logged to agent_runs. */
export function structured<S extends z.ZodType>(opts: {
  agent: AgentName;
  projectId?: string | null;
  promptVersion: string;
  system: string;
  prompt: string;
  schema: S;
  effort?: Effort;
  maxTokens?: number;
}): Promise<z.infer<S>> {
  return logged({ agent: opts.agent, projectId: opts.projectId, promptVersion: opts.promptVersion, input: { prompt: opts.prompt } }, async () => {
    const res = await anthropic().beta.messages.parse({
      model: MODEL,
      max_tokens: opts.maxTokens ?? 16000,
      ...FALLBACK,
      output_config: { effort: opts.effort ?? "medium", format: betaZodOutputFormat(opts.schema) },
      system: [{ type: "text", text: opts.system, cache_control: { type: "ephemeral" } }],
      messages: [{ role: "user", content: opts.prompt }],
    });
    if (res.stop_reason === "refusal") throw new Error("The model declined this request. Try rephrasing the topic.");
    if (res.stop_reason === "max_tokens") throw new Error("The answer was cut off (too long). Try again.");
    if (!res.parsed_output) throw new Error("Could not read the AI's answer. Try again.");
    return { value: res.parsed_output as z.infer<S>, usage: [res.usage], output: res.parsed_output };
  });
}

/** Free-text research with the web search tool (handles pause_turn). Returns the final text. */
export function research(opts: {
  agent: AgentName;
  projectId?: string | null;
  promptVersion: string;
  system: string;
  prompt: string;
  maxSearches?: number;
}): Promise<string> {
  return logged({ agent: opts.agent, projectId: opts.projectId, promptVersion: opts.promptVersion, input: { prompt: opts.prompt } }, async () => {
    const tools: Anthropic.Beta.BetaToolUnion[] = [{ type: "web_search_20260209", name: "web_search", max_uses: opts.maxSearches ?? 5 }];
    const messages: Anthropic.Beta.BetaMessageParam[] = [{ role: "user", content: opts.prompt }];
    const usage: Anthropic.Beta.BetaUsage[] = [];
    let res: Anthropic.Beta.BetaMessage | undefined;
    for (let i = 0; i < 4; i++) {
      res = await anthropic().beta.messages.create({
        model: MODEL,
        max_tokens: 16000,
        ...FALLBACK,
        output_config: { effort: "medium" },
        system: opts.system,
        tools,
        messages,
      });
      usage.push(res.usage);
      if (res.stop_reason !== "pause_turn") break;
      messages.push({ role: "assistant", content: res.content }); // server resumes the search loop
    }
    if (!res) throw new Error("No response from Claude.");
    if (res.stop_reason === "refusal") throw new Error("The model declined to research this topic.");
    const text = res.content
      .filter((b): b is Anthropic.Beta.BetaTextBlock => b.type === "text")
      .map((b) => b.text)
      .join("")
      .trim();
    return { value: text, usage, output: { text } };
  });
}
