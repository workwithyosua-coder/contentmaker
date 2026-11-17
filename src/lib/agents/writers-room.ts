import "server-only";
import { z } from "zod";
import { db } from "../db";
import { research, structured } from "./claude";

// The writers' room: ideas → fact check → Uco & Ocu dialogue script → platform captions.

export const PILLARS = ["science", "politics_society", "food", "academics", "everyday_absurdities", "trending_news"] as const;
export const BEATS = ["hook", "counter", "escalation", "insight", "concession", "button"] as const;
export const EXPRESSIONS = [
  "neutral", "excited", "angry", "furious", "smug", "calm", "worried", "deadpan", "thinking", "laughing", "shocked",
] as const;

async function brandGuide(userId: string) {
  const [b] = await db()<{ voice_guide: string | null }[]>`
    SELECT voice_guide FROM brand_kits WHERE user_id = ${userId} ORDER BY is_default DESC, created_at LIMIT 1`;
  return b?.voice_guide ?? "No brand kit yet.";
}

async function recentInsights(userId: string) {
  const rows = await db()<{ finding: string; recommendation: string | null }[]>`
    SELECT finding, recommendation FROM insights WHERE user_id = ${userId} AND status = 'active'
    ORDER BY confidence DESC NULLS LAST LIMIT 6`;
  return rows.length ? rows.map((r) => `- ${r.finding} → ${r.recommendation ?? ""}`).join("\n") : "None yet (new brand).";
}

const systemFor = (role: string, brand: string) => `You are ${role} in the writers' room of "Uco Ocu", a short-form video brand.
Everything you write must fit this brand kit exactly:

<brand_kit>
${brand}
</brand_kit>

Language: dialogue in natural, casual spoken Indonesian (how educated young Indonesians actually talk; light slang is fine,
no stiff textbook Indonesian). English is used only for subtitles and where explicitly asked.

Writing rules (antislop), for every text you produce: dialogue, subtitles, on-screen text, captions, titles:
- Never use the em dash character. Use a comma, period, colon or parentheses instead.
- No marketing buzzwords (revolutionary, next-generation, seamless, cutting-edge, ultimate, powerful, effortless,
  "AI-powered"). Say the specific thing.
- No number or statistic unless it comes from the fact sheet you were given. If there's no source, don't use a number.
- No invented quotes, people, studies or testimonials.
- Sound like a person talking, not like an ad.`;

/** Safety net for the antislop rule: swap any em dash that slips through for a comma (or a period in captions). */
export function stripEmDashes(text: string, replacement = ", ") {
  return text.replace(/\s*—\s*/g, replacement).replace(/,\s*,/g, ",");
}

// ---------- 1. Ideas ----------
const IdeasSchema = z.object({
  ideas: z.array(
    z.object({
      title: z.string().describe("Short working title in Indonesian"),
      pillar: z.enum(PILLARS),
      topic: z.string().describe("What the episode is about, one sentence"),
      hook_line: z.string().describe("The first line spoken (Indonesian), the strongest line, max ~15 words"),
      hook_speaker: z.enum(["uco", "ocu"]),
      uco_take: z.string().describe("Uco's position (optimistic, loud, maybe too optimistic)"),
      ocu_take: z.string().describe("Ocu's position (calm, pessimistic, from a completely different angle)"),
      enlightening_fact: z.string().describe("The real, checkable fact or insight viewers learn"),
      why_it_works: z.string().describe("Why this should perform: tension, relatability, timeliness"),
      needs_fact_check: z.boolean().describe("true if it relies on facts, numbers, science or news"),
    }),
  ),
});

export async function generateIdeas(p: { userId: string; projectId: string; direction: string; count?: number }) {
  const brand = await brandGuide(p.userId);
  const out = await structured({
    agent: "strategist",
    projectId: p.projectId,
    promptVersion: "ideas-v2",
    effort: "medium",
    system: systemFor("the Strategist", brand),
    schema: IdeasSchema,
    prompt: `Direction from the creator: """${p.direction}"""

What has worked so far (from the Analyst):
${await recentInsights(p.userId)}

Pitch ${p.count ?? 5} distinct episode ideas. Rules:
- Each idea must create a real clash between Uco's and Ocu's worldviews, not two people agreeing loudly.
- Mix pillars unless the direction asks for one topic.
- The enlightening fact must be true and specific (numbers, names, mechanisms). Don't invent statistics.
- Hooks must work in the first 3 seconds with the sound off too (they'll appear as on-screen text).
- Avoid anything that mocks groups of people; sarcasm targets ideas, logic and situations.`,
  });
  const sql = db();
  await sql`DELETE FROM concepts WHERE project_id = ${p.projectId} AND NOT is_selected`;
  for (const [i, idea] of out.ideas.entries()) {
    await sql`
      INSERT INTO concepts (project_id, title, hook, hook_type, outline, rationale, rank)
      VALUES (${p.projectId}, ${stripEmDashes(idea.title)}, ${stripEmDashes(idea.hook_line)}, ${idea.pillar},
              ${sql.json({
                topic: idea.topic,
                hook_speaker: idea.hook_speaker,
                uco_take: idea.uco_take,
                ocu_take: idea.ocu_take,
                enlightening_fact: idea.enlightening_fact,
                needs_fact_check: idea.needs_fact_check,
              })},
              ${idea.why_it_works}, ${i + 1})`;
  }
  return out.ideas.length;
}

// ---------- 2. Fact check ----------
export type ConceptOutline = {
  topic: string;
  hook_speaker: "uco" | "ocu";
  uco_take: string;
  ocu_take: string;
  enlightening_fact: string;
  needs_fact_check: boolean;
};

export async function factCheck(p: { userId: string; projectId: string; title: string; outline: ConceptOutline }) {
  if (!p.outline.needs_fact_check) return "No fact check needed (opinion/comedy episode). Avoid stating numbers as facts.";
  return research({
    agent: "strategist",
    projectId: p.projectId,
    promptVersion: "factcheck-v1",
    maxSearches: 3,
    system: `You are the fact-checker for a comedy-education video. Be precise and skeptical. Prefer primary or reputable
sources. Today's date matters for news: check the latest information.`,
    prompt: `Episode: ${p.title}
Topic: ${p.outline.topic}
Claimed enlightening fact: ${p.outline.enlightening_fact}
Uco's take: ${p.outline.uco_take}
Ocu's take: ${p.outline.ocu_take}

Search the web and write a short FACT SHEET in English:
1. Is the enlightening fact correct? Correct it if needed (exact numbers, dates, names).
2. 4–8 extra verified facts the characters can use as ammunition, each with its source URL.
3. Anything contested, outdated or commonly misquoted: flag it clearly.
Keep it under 350 words. Format: bullet points, each ending with (source: URL).`,
  });
}

// ---------- 3. Script ----------
const ScriptSchema = z.object({
  title: z.string(),
  target_duration_s: z.number().int().describe("Estimated spoken length, 30–60"),
  lines: z.array(
    z.object({
      beat: z.enum(BEATS),
      speaker: z.enum(["uco", "ocu"]),
      text: z.string().describe("Spoken line in casual Indonesian, max ~22 words"),
      subtitle: z.string().describe("Natural English subtitle for the line (not word-for-word)"),
      expression: z.enum(EXPRESSIONS),
      thought_bubble: z.boolean().describe("true = an inner thought (not said out loud), used for the unspoken concession"),
      visual: z.string().describe("What's on screen: background, prop, graphic, gesture (short)"),
      on_screen_text: z.string().nullable().describe("Big on-screen text if any (numbers, key fact, punchline)"),
    }),
  ),
  sources: z.array(z.object({ claim: z.string(), url: z.string() })),
});
export type Script = z.infer<typeof ScriptSchema>;

export async function writeScript(p: {
  userId: string;
  projectId: string;
  title: string;
  outline: ConceptOutline;
  factSheet: string;
  feedback?: string;
  previous?: Script;
}) {
  const brand = await brandGuide(p.userId);
  const script = await structured({
    agent: "strategist",
    projectId: p.projectId,
    promptVersion: "script-v2",
    effort: "high",
    system: systemFor("the head writer", brand),
    schema: ScriptSchema,
    prompt: `Write the full dialogue script for this episode.

Title: ${p.title}
Topic: ${p.outline.topic}
Opening speaker: ${p.outline.hook_speaker}
Uco's take: ${p.outline.uco_take}
Ocu's take: ${p.outline.ocu_take}
The enlightening fact: ${p.outline.enlightening_fact}

Fact sheet (only state facts that appear here; never invent numbers):
<fact_sheet>
${p.factSheet}
</fact_sheet>
${
  p.previous
    ? `
Previous version (revise it, keep what works):
${p.previous.lines.map((l) => `[${l.beat}] ${l.speaker.toUpperCase()}${l.thought_bubble ? " (thought)" : ""}: ${l.text}`).join("\n")}

The creator's notes for this revision: """${p.feedback ?? ""}"""`
    : ""
}

Rules:
- Follow the 6 beats in order: hook → counter → escalation (2–3 exchanges) → insight → concession → button.
- 10–16 lines total, 30–60 seconds spoken. Short, punchy lines; this will be animated and voiced by the creators.
- Uco: loud, optimistic, rants at stupidity (angry/furious/excited). Ocu: calm, deadpan, worst-case spirals (calm/deadpan/worried).
- The concession beat: each privately acknowledges the other via thought_bubble lines, never out loud.
- Comedy comes from the clash of worldviews and real facts, not insults. Neither one "wins".
- Put key numbers/facts in on_screen_text so the video works with sound off.
- sources: the URLs from the fact sheet that back the facts used.`,
  });
  return {
    ...script,
    title: stripEmDashes(script.title),
    lines: script.lines.map((l) => ({
      ...l,
      text: stripEmDashes(l.text),
      subtitle: stripEmDashes(l.subtitle),
      visual: stripEmDashes(l.visual),
      on_screen_text: l.on_screen_text === null ? null : stripEmDashes(l.on_screen_text),
    })),
  };
}

// ---------- 4. Captions ----------
const CaptionsSchema = z.object({
  tiktok: z.object({ caption: z.string(), hashtags: z.array(z.string()) }),
  instagram: z.object({ caption: z.string(), hashtags: z.array(z.string()) }),
  facebook: z.object({ caption: z.string() }),
  youtube: z.object({ title: z.string(), description: z.string(), hashtags: z.array(z.string()) }),
});

export async function writeCaptions(p: { userId: string; projectId: string; script: Script }) {
  const brand = await brandGuide(p.userId);
  const c = await structured({
    agent: "copywriter",
    projectId: p.projectId,
    promptVersion: "captions-v2",
    effort: "medium",
    system: systemFor("the Copywriter", brand),
    schema: CaptionsSchema,
    prompt: `Write platform captions for this finished episode.

Title: ${p.script.title}
Script:
${p.script.lines.map((l) => `${l.speaker.toUpperCase()}: ${l.text}`).join("\n")}
Sources: ${p.script.sources.map((s) => s.url).join(", ") || "none"}

Rules:
- Indonesian first, with one short English line for international viewers.
- First line = a hook that makes people want to watch (question or provocative claim). Tag the debate: "Tim Uco atau Tim Ocu?"
- TikTok: ≤150 characters + 3–5 hashtags. Instagram: 2–4 short lines + 5–8 hashtags (mix Indonesian/English, niche + broad).
- Facebook: conversational, 2–3 lines, invite comments. YouTube Shorts: title ≤60 characters incl. #Shorts; description 2–3 lines
  + a "Sumber/Sources:" line with the URLs if any.
- Hashtags without the # symbol in the arrays; no banned or spammy tags.`,
  });
  const sql = db();
  await sql`DELETE FROM caption_options WHERE project_id = ${p.projectId}`;
  const rows: { platform: string; caption: string; hashtags: string[]; title: string | null }[] = [
    { platform: "tiktok", caption: c.tiktok.caption, hashtags: c.tiktok.hashtags, title: null },
    { platform: "instagram", caption: c.instagram.caption, hashtags: c.instagram.hashtags, title: null },
    { platform: "facebook", caption: c.facebook.caption, hashtags: [], title: null },
    { platform: "youtube", caption: c.youtube.description, hashtags: c.youtube.hashtags, title: c.youtube.title },
  ];
  for (const r of rows) {
    await sql`
      INSERT INTO caption_options (project_id, platform, caption, hashtags, title, is_selected, rank)
      VALUES (${p.projectId}, ${r.platform}, ${stripEmDashes(r.caption, ". ")}, ${r.hashtags.map((h) => h.replace(/^#/, ""))},
              ${r.title === null ? null : stripEmDashes(r.title)}, true, 1)`;
  }
}
