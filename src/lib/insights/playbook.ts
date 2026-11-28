// The Showrunner Playbook: at most 12 active atomic rules the writers' room follows, learned from the owner's
// Director's Review notes ("owner_feedback") and from what the best and worst posts have in common
// ("metrics_insight"). This module is pure: the cap, the de-duplication, and the block the scheduler adds to the Show
// Bible prompt. The database side is in insights/server.ts.
import { ISSUE_LABEL, type IssueTag } from "./tunables";

export const LESSON_CAP = 12;
export const LESSON_CATEGORIES = ["topic", "script", "pacing", "voice", "visual"] as const;
export type LessonCategory = (typeof LESSON_CATEGORIES)[number];
export type LessonSource = "owner_feedback" | "metrics_insight";
export type Lesson = { id: string; category: LessonCategory; rule_text: string; source: LessonSource; status: "active" | "paused"; evidence_count: number; updated_at: string | Date };
export const SOURCE_LABEL: Record<LessonSource, string> = { owner_feedback: "Owner", metrics_insight: "Metrics" };
export const asCategory = (raw: unknown): LessonCategory => ((LESSON_CATEGORIES as readonly string[]).includes(String(raw)) ? (raw as LessonCategory) : "script");

/** A rule as one clean line: no line breaks, quotes or markup, no em dashes, at most 200 characters. */
export function cleanRule(text: string): string {
  return String(text ?? "")
    .replace(/[\r\n\t]+/g, " ")
    .replace(/[`"<>{}]/g, "")
    .replace(/\s*[—–]\s*/g, ", ")
    .replace(/\s{2,}/g, " ")
    .trim()
    .slice(0, 200)
    .trim();
}

const STOPWORDS = new Set(["the", "and", "with", "for", "from", "into", "that", "this", "than", "then", "your", "their", "its", "are", "was", "yang", "dan", "untuk", "dengan", "ini", "itu"]);
const tokens = (s: string) => new Set(cleanRule(s).toLowerCase().replace(/[^\p{L}\p{N}\s]/gu, " ").split(/\s+/).filter((w) => w.length >= 3 && !STOPWORDS.has(w)));

/**
 * Two rules say the same thing: the same words, or at least 80% of their content words shared (Jaccard, stopwords
 * left out). One swapped word is a different rule ("Keep the BGM low under Ocu" vs "Keep the motion low under Ocu").
 */
export function sameRule(a: string, b: string): boolean {
  const A = tokens(a);
  const B = tokens(b);
  if (!A.size || !B.size) return cleanRule(a).toLowerCase() === cleanRule(b).toLowerCase();
  let both = 0;
  for (const w of A) if (B.has(w)) both++;
  return both / (A.size + B.size - both) >= 0.8;
}

export type LessonPlan =
  | { kind: "reinforce"; id: string }
  | { kind: "insert"; pause: string | null };

/**
 * Where a new rule goes: an existing rule (active or paused) that says the same thing is reinforced (evidence + 1,
 * text kept); otherwise it's inserted, and when 12 are already active the weakest one is paused first: the fewest
 * pieces of evidence, a metrics rule before an owner rule at a tie, then the oldest. The cap always holds.
 */
export function planLesson(existing: Lesson[], rule: string): LessonPlan {
  const dup = existing.find((l) => sameRule(l.rule_text, rule));
  if (dup) return { kind: "reinforce", id: dup.id };
  const active = existing.filter((l) => l.status === "active");
  if (active.length < LESSON_CAP) return { kind: "insert", pause: null };
  const weakest = [...active].sort(
    (a, b) =>
      a.evidence_count - b.evidence_count ||
      Number(b.source === "metrics_insight") - Number(a.source === "metrics_insight") ||
      new Date(a.updated_at).getTime() - new Date(b.updated_at).getTime(),
  )[0];
  return { kind: "insert", pause: weakest.id };
}

/** Resume is allowed only below the cap. */
export const canActivate = (activeCount: number) => activeCount < LESSON_CAP;

export type PlaybookInput = {
  lessons: Pick<Lesson, "category" | "rule_text">[];
  /** the opening lines of the best-scoring published episodes */
  topHooks: string[];
  /** issue tags from recent "needs work" / "unwatchable" reviews */
  avoidTags: string[];
  targetLines: number;
};

/**
 * The Show Bible prompt's playbook section (Indonesian, like the rest of the prompt): the active rules (12 at most,
 * each flattened to one line, so a stored rule can't break out of its bullet), up to 2 winning hooks as tone anchors
 * (never to copy), recent review complaints to avoid, and the target line count. Empty when there's nothing to say.
 */
export function playbookBlock(p: PlaybookInput): string {
  const rules = p.lessons.map((l) => ({ c: l.category, t: cleanRule(l.rule_text) })).filter((l) => l.t).slice(0, LESSON_CAP);
  const hooks = p.topHooks.map(cleanRule).filter(Boolean).slice(0, 2);
  const avoid = [...new Set(p.avoidTags)].map((t) => ISSUE_LABEL[t as IssueTag]).filter(Boolean);
  const parts: string[] = [];
  parts.push(`\nPLAYBOOK SHOWRUNNER (hasil review pemilik dan performa post; wajib diikuti)`);
  parts.push(`- Target panjang: sekitar ${p.targetLines} baris termasuk outro CTA.`);
  if (rules.length) parts.push(...rules.map((r, i) => `- Aturan ${i + 1} [${r.c}]: ${r.t}`));
  if (hooks.length) parts.push(`- Hook terbaik sejauh ini (contoh energi dan nada, JANGAN disalin): ${hooks.map((h) => `«${h}»`).join(" / ")}`);
  if (avoid.length) parts.push(`- Avoid repeating (keluhan review terakhir): ${avoid.join(", ")}.`);
  return parts.join("\n");
}

/**
 * The Show Bible's hard rules, which no learned rule may contradict: given to the Pattern Analyst in its prompt, and
 * checked again on every rule it writes (showBibleViolation).
 */
export const SHOW_BIBLE_GUARDRAIL = `HARD RULES (never write a rule that contradicts these; leave such a pattern out):
- The characters are always called "Uco" and "Ocu" in full. Never shorten either name (no "Cu", "Co", "U", "O" or any nickname).
- A script is 12 to 16 lines including the outro CTA. Never ask for fewer than 12 or more than 16 lines.
- A thought bubble is a silent inner monologue: nobody hears it, answers it, or reacts to it, and it is never read aloud to the other character.
- Uco and Ocu alternate (never 3 lines in a row by one speaker) and the episode ends with the outro CTA.`;

const NUM = "(\\d+|twelve|thirteen|fourteen|fifteen|sixteen|seventeen|eighteen|nineteen|twenty|thirty)";
const WORD_NUM: Record<string, number> = { twelve: 12, thirteen: 13, fourteen: 14, fifteen: 15, sixteen: 16, seventeen: 17, eighteen: 18, nineteen: 19, twenty: 20, thirty: 30 };
const asNum = (s: string) => (/^\d+$/.test(s) ? Number(s) : WORD_NUM[s.toLowerCase()] ?? NaN);

/** Which Show Bible hard rule a learned rule breaks, or null. */
export function showBibleViolation(rule: string): string | null {
  const r = cleanRule(rule);
  if (/(^|[^\p{L}])(cu|co)([^\p{L}]|$)/iu.test(r) || /\b(nickname|shorten(ed)? (his|their|the) name)/i.test(r)) return "shortens Uco / Ocu";
  for (const m of r.matchAll(new RegExp(`${NUM}(?:\\s*(?:-|to|or)\\s*${NUM})?\\s+(?:rapid[- ]fire\\s+)?(?:dialogue\\s+)?lines?`, "gi"))) {
    const nums = [m[1], m[2]].filter(Boolean).map(asNum).filter((n) => Number.isFinite(n));
    if (nums.some((n) => n < 12 || n > 16)) return "line count outside 12-16";
  }
  if (/thought[- ]?bubble|inner (monologue|thought)|\bthoughts?\b/i.test(r) && /\b(answer|answers|respond|responds|reply|replies|react|reacts|hear|hears|heard|aloud|out loud|overhear)/i.test(r)) return "breaks the silent thought rule";
  return null;
}
