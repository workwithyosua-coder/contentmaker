import "server-only";
import { z } from "zod";
import { db } from "../db";
import { CAMERA_SHOTS, EMOTIONS, PROP_TAGS, clampCue } from "../../../video/src/beats";
import { PNG_PROPS } from "../../../video/src/props/library";
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
// On-screen cue per line for the cue-based video styles (Koran Kinetik, Diagram Taktis): the only text they show.
export const ImportantMessageSchema = z.object({
  kicker: z.string().describe("Label above the headline, uppercase Indonesian, at most 2 words (e.g. 'BIAYA LAYANAN')"),
  headline: z
    .string()
    .describe("The one thing to remember from this line, uppercase Indonesian, at most 5 words, numbers as digits (e.g. '85RB X 12 = 1,02 JUTA'); never the full sentence"),
  stamp: z.string().nullable().describe("Optional red stamp, at most 3 words (e.g. 'MINUS 520RB'), or null"),
});
export const CUE_RULES = `important_message (the only text the Koran Kinetik and Diagram Taktis styles show; no subtitles there):
  - kicker: at most 2 words. headline: at most 5 words, the high-signal point of the line (a number, a verdict, the twist), not a paraphrase of the whole sentence. stamp: at most 3 words or null.
  - Uppercase Indonesian, no em dashes, no trailing punctuation. Numbers as digits (65RB, 12X, 1,02 JUTA).`;

// Director fields: how the Koran Kinetik / Diagram Taktis cameras shoot each line.
export const DIRECTOR_FIELDS = {
  camera_shot: z
    .enum(CAMERA_SHOTS.filter((c) => c !== "cta-stinger") as [string, ...string[]])
    .describe("solo-uco / solo-ocu for a line one character says (the speaker's own solo), closeup-punch for punchlines and big reveals, two-shot when both react or for inner thoughts"),
  emotion: z
    .enum(EMOTIONS.filter((e) => e !== "cta") as [string, ...string[]])
    .describe("How the speaker plays it: triumphant, defensive, shocked, phone (holding a phone), deadpan, explaining, inspecting (Ocu with a magnifier)"),
  prop_tag: z
    .string()
    .describe(
      `Topic prop on the visual stage. Illustrated props: ${PNG_PROPS.map((p) => p.name).join(", ")}. Coded props: ${PROP_TAGS.filter((t) => t !== "none").join(", ")}. Nasi padang lines use nasi-padang-blender; bubur lines use the bubur props. If the line is about an object none of these show, a new kebab-case name for it (e.g. es-kopi-susu); it gets drawn later. none when nothing fits.`,
    ),
};
export const DIRECTOR_RULES = `camera_shot / emotion / prop_tag (the director for the Koran Kinetik and Diagram Taktis styles):
  - A line one character says defaults to that speaker's solo shot (solo-uco or solo-ocu); use closeup-punch for punchlines and the button; two-shot when both react. Inner thoughts use the thinker's solo (it renders as a thought bubble). Vary shots so no more than 3 lines in a row share one.
  - emotion fits the speaker: Uco is usually triumphant, defensive, shocked or on his phone; Ocu deadpan, explaining or inspecting.
  - prop_tag is the object the line is about. Prefer an illustrated prop when one fits; name a new one only for an object the episode really turns on; none when nothing fits.`;

const ScriptSchema = z.object({
  title: z.string(),
  target_duration_s: z.number().int().describe("Estimated spoken length, 50–60"),
  lines: z.array(
    z.object({
      beat: z.enum(BEATS),
      speaker: z.enum(["uco", "ocu"]),
      text: z.string().describe("Spoken line in casual Jakarta Indonesian, punchy, 2–3 seconds (about 5–10 words); one longer line allowed for the key fact"),
      subtitle: z.string().describe("Natural English subtitle for the line (not word-for-word)"),
      expression: z.enum(EXPRESSIONS),
      thought_bubble: z.boolean().describe("true = an inner thought (not said out loud), used for the unspoken concession"),
      visual: z.string().describe("What's on screen: background, prop, graphic, gesture (short)"),
      on_screen_text: z.string().nullable().describe("Big on-screen text if any (numbers, key fact, punchline)"),
      delivery: z
        .string()
        .nullable()
        .describe("How to say it, for the voice actor or AI voice: emotion, pace, emphasis (e.g. 'fast, indignant, hit 65 ribu')"),
      important_message: ImportantMessageSchema,
      ...DIRECTOR_FIELDS,
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
- ${CUE_RULES}
- ${DIRECTOR_RULES}
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
      important_message: cleanCue(l.important_message, l),
    })),
  };
}

/** Word limits enforced in code (kicker ≤ 2, headline ≤ 5, stamp ≤ 3), whatever the model returned. */
export function cleanCue(m: z.infer<typeof ImportantMessageSchema> | null | undefined, l: { beat: string; text: string; on_screen_text?: string | null }) {
  const c = clampCue(
    m ? { kicker: stripEmDashes(m.kicker), headline: stripEmDashes(m.headline), stamp: m.stamp ? stripEmDashes(m.stamp) : null } : null,
    { kicker: l.beat, headline: l.on_screen_text || l.text },
  );
  return { kicker: c.kicker, headline: c.headline, stamp: c.stamp ?? null };
}

/**
 * Adds important_message cues to an existing script version in place (scripts written before cues existed), so it
 * can be shown in Koran Kinetik / Diagram Taktis. The spoken lines are not changed.
 */
export async function writeImportantMessages(p: { userId: string; projectId: string; scriptId: string }) {
  const sql = db();
  const [row] = await sql<{ lines: Script["lines"] }[]>`SELECT lines FROM scripts WHERE id = ${p.scriptId} AND project_id = ${p.projectId}`;
  if (!row) throw new Error("Script not found.");
  if (row.lines.every((l) => l.important_message?.headline && l.camera_shot)) return 0;
  const brand = await brandGuide(p.userId);
  const out = await structured({
    agent: "strategist",
    projectId: p.projectId,
    promptVersion: "cues-v2",
    effort: "low",
    system: systemFor("the on-screen text editor", brand),
    schema: z.object({ cues: z.array(ImportantMessageSchema.extend(DIRECTOR_FIELDS)) }),
    prompt: `Write one on-screen cue and one camera direction per line of this Uco & Ocu script, in the same order (${row.lines.length} entries).

${row.lines.map((l, i) => `${i + 1}. [${l.beat}] ${l.speaker.toUpperCase()}${l.thought_bubble ? " (thought)" : ""}: ${l.text}${l.on_screen_text ? `  (on-screen text: ${l.on_screen_text})` : ""}`).join("\n")}

${CUE_RULES}

${DIRECTOR_RULES}`,
  });
  if (out.cues.length !== row.lines.length) throw new Error(`Got ${out.cues.length} cues for ${row.lines.length} lines. Try again.`);
  const lines = row.lines.map((l, i) => ({
    ...l,
    important_message: l.important_message?.headline ? l.important_message : cleanCue(out.cues[i], l),
    camera_shot: l.camera_shot ?? out.cues[i].camera_shot,
    emotion: l.emotion ?? out.cues[i].emotion,
    prop_tag: l.prop_tag ?? out.cues[i].prop_tag,
  }));
  await sql`UPDATE scripts SET lines = ${sql.json(lines as never)} WHERE id = ${p.scriptId}`;
  return lines.length;
}

// ---------- 4. Captions ----------
// Platform-native publishing metadata for Indonesian audiences. Saved to content_projects.platform_captions (used by the
// publisher) and mirrored into caption_options (shown on the episode page).
const CaptionsSchema = z.object({
  youtube: z.object({
    title: z.string().describe("Punchy Indonesian hook title, max 80 characters, WITHOUT #Shorts (added automatically)"),
    description: z.string().describe("SEO-friendly Indonesian description: 1–2 line episode summary, a comment CTA, and 'Sumber:' URLs if any"),
    tags: z.array(z.string()).describe("8–12 search tags, Indonesian and English, no # symbol"),
  }),
  tiktok: z.object({
    caption: z.string().describe("Conversational Jakarta-Indonesian hook caption, 1–2 short lines"),
    hashtags: z.array(z.string()).describe("4–6 hashtags: niche + Indonesian, no # symbol"),
  }),
  instagram: z.object({
    hook: z.string().describe("One engaging hook line"),
    context: z.string().describe("Short context paragraph, 1–3 sentences"),
    comment_prompt: z.string().describe("A question that invites comments, e.g. Tim Uco atau Tim Ocu?"),
    hashtags: z.array(z.string()).describe("6–10 hashtags, Indonesian and English mix, no # symbol"),
  }),
  facebook: z.object({
    title: z.string().describe("Short Reel title, max 60 characters"),
    description: z.string().describe("Conversational 2–3 line description that invites shares and comments"),
  }),
});

export async function writeCaptions(p: { userId: string; projectId: string; script: Script }) {
  const brand = await brandGuide(p.userId);
  const c = await structured({
    agent: "copywriter",
    projectId: p.projectId,
    promptVersion: "captions-v3",
    effort: "medium",
    system: systemFor("the Copywriter", brand),
    schema: CaptionsSchema,
    prompt: `Write publishing metadata for this finished Uco & Ocu episode, one set per platform, each native to that platform.

Title: ${p.script.title}
Script:
${p.script.lines.map((l) => `${l.speaker.toUpperCase()}: ${l.text}`).join("\n")}
Sources: ${p.script.sources.map((s) => s.url).join(", ") || "none"}

Rules:
- Written for Indonesian audiences in casual Jakarta Indonesian; the opening hook works without watching (a question or a provocative claim).
- Frame the debate so people pick a side ("Tim Uco atau Tim Ocu?") somewhere in each platform's text.
- YouTube Shorts: title max 80 characters (no #Shorts, it is added), description with summary + comment CTA + "Sumber:" URLs when there are sources, tags for search.
- TikTok: short hook caption + 4–6 hashtags. Instagram Reels: hook line, short context paragraph, comment prompt, clean hashtags.
- Facebook Reels: short title + conversational description made for shares and comments.
- Hashtags and tags without the # symbol; no banned or spammy tags; never invent facts or numbers.`,
  });
  const clean = (s: string) => stripEmDashes(s, ". ");
  const captions = {
    youtube: { title: clean(c.youtube.title), description: clean(c.youtube.description), tags: c.youtube.tags.map((t) => t.replace(/^#/, "")) },
    tiktok: { caption: clean(c.tiktok.caption), hashtags: c.tiktok.hashtags.map((h) => h.replace(/^#/, "")) },
    instagram: {
      hook: clean(c.instagram.hook),
      context: clean(c.instagram.context),
      comment_prompt: clean(c.instagram.comment_prompt),
      hashtags: c.instagram.hashtags.map((h) => h.replace(/^#/, "")),
    },
    facebook: { title: clean(c.facebook.title), description: clean(c.facebook.description) },
  };
  const sql = db();
  await sql`UPDATE content_projects SET platform_captions = ${sql.json(captions)} WHERE id = ${p.projectId}`;
  await sql`DELETE FROM caption_options WHERE project_id = ${p.projectId}`;
  const rows: { platform: string; caption: string; hashtags: string[]; title: string | null }[] = [
    { platform: "tiktok", caption: captions.tiktok.caption, hashtags: captions.tiktok.hashtags, title: null },
    {
      platform: "instagram",
      caption: `${captions.instagram.hook}\n\n${captions.instagram.context}\n\n${captions.instagram.comment_prompt}`,
      hashtags: captions.instagram.hashtags,
      title: null,
    },
    { platform: "facebook", caption: captions.facebook.description, hashtags: [], title: captions.facebook.title },
    { platform: "youtube", caption: captions.youtube.description, hashtags: captions.youtube.tags, title: `${captions.youtube.title} #Shorts` },
  ];
  for (const r of rows) {
    await sql`
      INSERT INTO caption_options (project_id, platform, caption, hashtags, title, is_selected, rank)
      VALUES (${p.projectId}, ${r.platform}, ${r.caption}, ${r.hashtags}, ${r.title}, true, 1)`;
  }
}
