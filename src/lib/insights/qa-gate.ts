// The pre-render QA gate: after the scheduler writes a script and before any voice or render time is spent, the
// script is checked once more. Deterministic checks first (rhythm, interjections, silent thoughts, stat card length),
// then a Gemini audit against the active playbook rules. A failing script is regenerated ONCE with the critique; the
// better of the two goes on, and both passes are written to the slot's run log. Pure apart from the two callbacks.
import { STAT_SUBLINE_MAX } from "../scheduler";
import { cleanRule } from "./playbook";

export type QaLine = {
  speaker: string;
  text: string;
  emotion?: string | null;
  layout?: string | null;
  stat?: string | null;
  thought_bubble?: boolean;
  kinetic_text?: string | null;
};

/** A takeover stat card's big number / headline: short enough to read in one glance. */
export const STAT_HEADLINE_MAX = 18;
export const QA_MIN_INTERJECTIONS = 3;

const words = (s: string | null | undefined) => String(s ?? "").split(/\s+/).filter(Boolean).length;
const isCta = (l: QaLine) => l.emotion === "cta" || /follow\s*@?uco\.?ocu/i.test(l.text);

/** The deterministic checks (problems; empty = pass). */
export function qaProblems(lines: QaLine[]): string[] {
  const out: string[] = [];
  // 1. ping-pong: never 3 beats in a row by one speaker (a silent thought is its character's beat; the CTA isn't)
  const beats = lines.map((l, i) => ({ l, i })).filter(({ l }) => !isCta(l));
  for (let start = 0; start < beats.length; ) {
    let end = start;
    while (end + 1 < beats.length && beats[end + 1].l.speaker === beats[start].l.speaker) end++;
    if (end - start >= 2) out.push(`${end - start + 1} ${beats[start].l.speaker} beats in a row (lines ${beats[start].i + 1}-${beats[end].i + 1})`);
    start = end + 1;
  }
  // 2. at least 3 rapid-fire interjections of 3-7 spoken words
  const quick = beats.filter(({ l }) => !l.thought_bubble && words(l.text) >= 3 && words(l.text) <= 7).length;
  if (quick < QA_MIN_INTERJECTIONS) out.push(`${quick} interjection(s) of 3-7 words (needs ${QA_MIN_INTERJECTIONS})`);
  // 3. silent thoughts: never the hook or the CTA, never a stat card, a 2-5 word bubble caption, not two in a row
  lines.forEach((l, i) => {
    if (!l.thought_bubble) return;
    if (i === 0) out.push(`line 1 is a silent thought (the hook must be spoken)`);
    if (isCta(l)) out.push(`line ${i + 1}: the CTA can't be a silent thought`);
    if (l.layout === "takeover") out.push(`line ${i + 1}: a silent thought can't carry a stat card`);
    const cap = words(l.kinetic_text);
    if (cap < 2 || cap > 5) out.push(`line ${i + 1}: thought bubble caption has ${cap} word(s) (needs 2-5)`);
    if (lines[i - 1]?.thought_bubble) out.push(`lines ${i}-${i + 1}: two silent thoughts in a row`);
  });
  // 4. stat cards: a takeover needs "HEADLINE | SUBLINE" within the limits
  lines.forEach((l, i) => {
    if (l.layout !== "takeover") return;
    if (!l.stat?.trim()) return void out.push(`line ${i + 1}: takeover without a stat card`);
    const [head, sub = ""] = l.stat.split("|").map((s) => s.trim());
    if (head.length > STAT_HEADLINE_MAX) out.push(`line ${i + 1}: stat headline "${head}" is ${head.length} characters (max ${STAT_HEADLINE_MAX})`);
    if (sub.length > STAT_SUBLINE_MAX) out.push(`line ${i + 1}: stat subline is ${sub.length} characters (max ${STAT_SUBLINE_MAX})`);
  });
  return out;
}

export const AUDIT_SCHEMA = {
  type: "object",
  properties: {
    pass: { type: "boolean" },
    violations: { type: "array", items: { type: "string" } },
  },
  required: ["pass", "violations"],
};

/** The Gemini audit: does the script break any active playbook rule? Answers in JSON (AUDIT_SCHEMA). */
export function auditPrompt(lines: QaLine[], rules: string[]): string {
  const script = lines.map((l, i) => `${i + 1}. ${l.speaker.toUpperCase()}${l.thought_bubble ? " (thought)" : ""}: ${cleanRule(l.text)}`).join("\n");
  return `You are the QA editor of "Uco & Ocu", an Indonesian vertical comedy series. Check this script ONLY against the playbook rules below. Flag a rule only when the script clearly breaks it; do not invent new rules and do not judge taste.

PLAYBOOK RULES
${rules.map((r, i) => `${i + 1}. ${cleanRule(r)}`).join("\n")}

SCRIPT
${script}

Answer JSON: {"pass": true|false, "violations": ["rule N: what breaks it, citing the line number", ...]} (at most 4 violations; empty when pass).`;
}

export type QaPass<T> = { draft: T; problems: string[] };
export type QaReport<T> = { final: T; retried: boolean; log: string[] };

/**
 * Runs the gate on `draft`: deterministic problems plus the playbook audit (only when there are rules; an audit that
 * errors is logged and skipped, never blocking). On failure, exactly one `regenerate(critique)`; its result is checked
 * the same way and kept unless it's worse (more problems). `log` holds both passes for the slot run log.
 */
export async function runQaGate<T extends { lines: QaLine[] }>(opts: {
  draft: T;
  rules: string[];
  audit: (lines: QaLine[], rules: string[]) => Promise<{ pass: boolean; violations: string[] }>;
  regenerate: (critique: string[]) => Promise<T>;
}): Promise<QaReport<T>> {
  const log: string[] = [];
  const check = async (d: T, label: string): Promise<string[]> => {
    const problems = qaProblems(d.lines);
    if (opts.rules.length) {
      try {
        const a = await opts.audit(d.lines, opts.rules);
        if (!a.pass) problems.push(...(a.violations.length ? a.violations : ["breaks a playbook rule"]).slice(0, 4).map((v) => `playbook: ${cleanRule(v)}`));
      } catch (e) {
        log.push(`QA ${label}: playbook audit skipped (${(e instanceof Error ? e.message : String(e)).slice(0, 120)})`);
      }
    }
    return problems;
  };
  const first = await check(opts.draft, "pass 1");
  if (!first.length) {
    log.push("QA gate pass 1: passed");
    return { final: opts.draft, retried: false, log };
  }
  log.push(`QA gate pass 1: FAILED: ${first.join("; ")}`);
  let second: QaPass<T>;
  try {
    const d = await opts.regenerate(first);
    second = { draft: d, problems: await check(d, "pass 2") };
  } catch (e) {
    log.push(`QA gate pass 2 (repair): regeneration failed (${(e instanceof Error ? e.message : String(e)).slice(0, 160)}); keeping pass 1`);
    return { final: opts.draft, retried: true, log };
  }
  if (!second.problems.length) log.push("QA gate pass 2 (repair): passed");
  else log.push(`QA gate pass 2 (repair): still ${second.problems.join("; ")}`);
  const keep = second.problems.length <= first.length ? second.draft : opts.draft;
  if (keep === opts.draft) log.push("QA gate: the repair was worse; keeping pass 1");
  return { final: keep, retried: true, log };
}
