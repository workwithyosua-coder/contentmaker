// The autonomous scheduler: schedule rules, slot generation in WIB, queue status transitions, the Reusable Prop Bank
// and the checks that keep unattended scripts on existing props. Pure code (no database, no network, no AI), shared by
// the app, the API routes, the GitHub Actions step script and the tests.
//
// One slot = one episode: queued → scripting → voicing → rendering → ready_to_post → published (any step → failed;
// a failed slot goes back to queued on retry).
import { CAMERA_SHOTS, clampCue, parseStat } from "../../video/src/beats";
import { isPropName } from "../../video/src/props/library";
import { POSES, type ManualLine } from "./manualScriptParser";
import { BEATS, EXPRESSIONS } from "./script-parse";

// ------------------------------------------------------------------ time (WIB = UTC+7, no daylight saving)
export const TIME_ZONE = "Asia/Jakarta";
const WIB_OFFSET_MIN = 7 * 60;
export const DEFAULT_SLOT_TIMES = ["11:00", "19:00"] as const;
export const MIN_SLOTS_PER_DAY = 2;
export const MAX_SLOTS_PER_DAY = 6;
/** How far ahead the queue is kept filled. */
export const QUEUE_DAYS = 3;
/** A slot is produced this long before its time, so the video is ready (and posted) at the slot. */
export const LEAD_MINUTES = 90;
/** A queued slot this far past its time is marked missed instead of produced late. */
export const MISSED_AFTER_HOURS = 12;
/** An active slot not updated for this long is treated as failed (the workflow times out sooner). */
export const STALE_HOURS = 2;

const HHMM = /^([01]?\d|2[0-3]):([0-5]\d)$/;
export const isSlotTime = (t: string) => HHMM.test(t.trim());
const pad = (n: number) => String(n).padStart(2, "0");

/** A WIB wall-clock date ("2026-11-27") and time ("11:00") as the UTC instant. */
export function wibToUtc(date: string, time: string): Date {
  const [y, m, d] = date.split("-").map(Number);
  const t = HHMM.exec(time.trim());
  if (!t || !y || !m || !d) throw new Error(`Bad WIB date/time: ${date} ${time}`);
  return new Date(Date.UTC(y, m - 1, d, Number(t[1]), Number(t[2])) - WIB_OFFSET_MIN * 60_000);
}

/** The WIB calendar date and clock time of an instant. */
export function utcToWib(at: Date): { date: string; time: string; weekday: number; day: number } {
  const w = new Date(at.getTime() + WIB_OFFSET_MIN * 60_000);
  return {
    date: `${w.getUTCFullYear()}-${pad(w.getUTCMonth() + 1)}-${pad(w.getUTCDate())}`,
    time: `${pad(w.getUTCHours())}:${pad(w.getUTCMinutes())}`,
    weekday: w.getUTCDay(),
    day: w.getUTCDate(),
  };
}

/** "Thu 27 Nov, 11:00 WIB" */
export function formatWib(at: Date): string {
  const w = new Date(at.getTime() + WIB_OFFSET_MIN * 60_000);
  const wd = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"][w.getUTCDay()];
  const mo = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"][w.getUTCMonth()];
  return `${wd} ${w.getUTCDate()} ${mo}, ${pad(w.getUTCHours())}:${pad(w.getUTCMinutes())} WIB`;
}

/** Default slot times for n slots: 11:00 and 19:00, with any extra slots spread between them (on the half hour). */
export function defaultSlotTimes(n: number): string[] {
  const count = Math.max(MIN_SLOTS_PER_DAY, Math.min(MAX_SLOTS_PER_DAY, Math.round(n) || MIN_SLOTS_PER_DAY));
  const start = 11 * 60;
  const span = 8 * 60;
  return Array.from({ length: count }, (_, i) => {
    const m = Math.round((start + (span * i) / (count - 1)) / 30) * 30;
    return `${pad(Math.floor(m / 60))}:${pad(m % 60)}`;
  });
}

// ------------------------------------------------------------------ formats
export const FORMATS = {
  comedy_debate: { label: "Comedy Debate", brief: "Uco and Ocu argue a topic from opposite worldviews; real facts, neither one wins." },
  affiliate: {
    label: "Affiliate (Yellow Basket)",
    brief: "Uco and Ocu debate whether an everyday product is worth buying; honest pros and cons, no fake claims, ends by pointing to the yellow basket.",
  },
  koran_kinetik: { label: "Koran Kinetik", brief: "A news-explainer episode built on short on-screen headlines; the key number gets an Evidence Takeover stat card." },
  diagram_taktis: { label: "Diagram Taktis", brief: "A tactical breakdown: Ocu explains how something really works step by step while Uco reacts." },
} as const;
export type EpisodeFormat = keyof typeof FORMATS;

/**
 * The visual styles a schedule can render in. Every scheduled episode, whatever its format, uses the schedule's style:
 * Koran Kinetik by default (illustrated PNG cast, generated props, callouts, stat / explainer cards, safe-zone
 * subtitles). The legacy "2D Vertical Comic" (procedural SVG) and Classic are never offered here.
 */
export const SCHEDULE_STYLES = [
  { id: "editorial-paper-cutout", label: "Koran Kinetik" },
  { id: "tactical-vector-hud", label: "Diagram Taktis" },
] as const;
export type ScheduleStyle = (typeof SCHEDULE_STYLES)[number]["id"];
export const DEFAULT_VISUAL_STYLE: ScheduleStyle = "editorial-paper-cutout";
export const asScheduleStyle = (v: unknown): ScheduleStyle => (SCHEDULE_STYLES.some((x) => x.id === v) ? (v as ScheduleStyle) : DEFAULT_VISUAL_STYLE);
export const FORMAT_IDS = Object.keys(FORMATS) as EpisodeFormat[];
export const asFormat = (v: unknown): EpisodeFormat => (FORMAT_IDS.includes(v as EpisodeFormat) ? (v as EpisodeFormat) : "comedy_debate");

// ------------------------------------------------------------------ rules
export const CADENCES = ["daily", "weekly", "monthly"] as const;
export type Cadence = (typeof CADENCES)[number];
export const SCHEDULE_VOICES = ["gemini_tts", "gemini_tts_rvc"] as const;
export type ScheduleVoice = (typeof SCHEDULE_VOICES)[number];
export const TARGETS = ["youtube", "instagram", "facebook", "tiktok_drafts"] as const;
export type Target = (typeof TARGETS)[number];
export const TARGET_LABEL: Record<Target, string> = { youtube: "YouTube Shorts", instagram: "Instagram Reels", facebook: "Facebook Reels", tiktok_drafts: "TikTok (hand-off)" };
/** Targets the app posts by itself; tiktok_drafts is a hand-off (caption + download), posted by hand. */
export const AUTO_TARGETS = ["youtube", "instagram", "facebook"] as const;

export type ScheduleRule = {
  cadence: Cadence;
  days_of_week: number[];
  days_of_month: number[];
  slots_per_day: number;
  slot_times: string[];
  format_mix: EpisodeFormat[];
  voice_provider: ScheduleVoice;
  visual_style: ScheduleStyle;
  target_platforms: Target[];
  topic_hint: string | null;
  auto_execute: boolean;
  is_active: boolean;
};

export const DEFAULT_RULE: ScheduleRule = {
  cadence: "daily",
  days_of_week: [1, 2, 3, 4, 5],
  days_of_month: [1, 8, 15, 22],
  slots_per_day: 2,
  slot_times: [...DEFAULT_SLOT_TIMES],
  format_mix: ["comedy_debate", "koran_kinetik"],
  voice_provider: "gemini_tts",
  visual_style: DEFAULT_VISUAL_STYLE,
  target_platforms: ["youtube", "instagram", "facebook", "tiktok_drafts"],
  topic_hint: null,
  auto_execute: false,
  is_active: true,
};

const ints = (v: unknown, lo: number, hi: number) =>
  [...new Set((Array.isArray(v) ? v : []).map(Number).filter((n) => Number.isInteger(n) && n >= lo && n <= hi))].sort((a, b) => a - b);

/**
 * Any rule input → a valid rule: at least 2 slots a day (never fewer), one valid HH:MM per slot (sorted, no
 * duplicates; missing ones filled from the defaults), one format per slot (cycled), known voices and targets only.
 */
export function normalizeRule(input: Partial<Record<keyof ScheduleRule, unknown>>): ScheduleRule {
  const cadence = (CADENCES as readonly string[]).includes(String(input.cadence)) ? (input.cadence as Cadence) : DEFAULT_RULE.cadence;
  const slots = Math.max(MIN_SLOTS_PER_DAY, Math.min(MAX_SLOTS_PER_DAY, Math.round(Number(input.slots_per_day)) || MIN_SLOTS_PER_DAY));
  const given = [...new Set((Array.isArray(input.slot_times) ? input.slot_times : []).map((t) => String(t).trim()).filter(isSlotTime).map((t) => {
    const [h, m] = t.split(":");
    return `${pad(Number(h))}:${m}`;
  }))];
  const times = given.slice(0, slots);
  for (const t of defaultSlotTimes(slots)) if (times.length < slots && !times.includes(t)) times.push(t);
  for (let h = 0; times.length < slots && h < 24; h++) if (!times.includes(`${pad(h)}:00`)) times.push(`${pad(h)}:00`);
  times.sort();
  const mix = (Array.isArray(input.format_mix) ? input.format_mix : []).filter((f) => FORMAT_IDS.includes(f as EpisodeFormat)) as EpisodeFormat[];
  const base = mix.length ? mix : DEFAULT_RULE.format_mix;
  const voice = (SCHEDULE_VOICES as readonly string[]).includes(String(input.voice_provider)) ? (input.voice_provider as ScheduleVoice) : DEFAULT_RULE.voice_provider;
  const targets = (TARGETS as readonly string[]).filter((t) => Array.isArray(input.target_platforms) && input.target_platforms.includes(t)) as Target[];
  const dow = ints(input.days_of_week, 0, 6);
  const dom = ints(input.days_of_month, 1, 31);
  const hint = typeof input.topic_hint === "string" ? input.topic_hint.trim().slice(0, 300) : "";
  return {
    cadence,
    days_of_week: dow.length ? dow : DEFAULT_RULE.days_of_week,
    days_of_month: dom.length ? dom : DEFAULT_RULE.days_of_month,
    slots_per_day: slots,
    slot_times: times,
    format_mix: Array.from({ length: slots }, (_, i) => base[i % base.length]),
    voice_provider: voice,
    visual_style: asScheduleStyle(input.visual_style),
    target_platforms: Array.isArray(input.target_platforms) ? targets : DEFAULT_RULE.target_platforms,
    topic_hint: hint || null,
    auto_execute: input.auto_execute === true || input.auto_execute === "true" || input.auto_execute === "on",
    is_active: input.is_active === undefined ? true : input.is_active === true || input.is_active === "true" || input.is_active === "on",
  };
}

/** Whether the rule posts on this WIB calendar day. */
export function isActiveDay(rule: Pick<ScheduleRule, "cadence" | "days_of_week" | "days_of_month">, wib: { weekday: number; day: number }): boolean {
  if (rule.cadence === "weekly") return rule.days_of_week.includes(wib.weekday);
  if (rule.cadence === "monthly") return rule.days_of_month.includes(wib.day);
  return true;
}

export type PlannedSlot = { scheduledFor: Date; slotIndex: number; format: EpisodeFormat };

/**
 * Every slot of the rule from `from` (inclusive) over the next `days` WIB calendar days, oldest first. Every active day
 * gets all of its slots (at least 2). Slots already in the past are left out.
 */
export function plannedSlots(input: Partial<Record<keyof ScheduleRule, unknown>>, from: Date, days = QUEUE_DAYS): PlannedSlot[] {
  const rule = normalizeRule(input);
  const out: PlannedSlot[] = [];
  const today = utcToWib(from).date;
  const noon = wibToUtc(today, "12:00").getTime();
  for (let d = 0; d < days; d++) {
    const wib = utcToWib(new Date(noon + d * 86_400_000));
    if (!isActiveDay(rule, wib)) continue;
    rule.slot_times.forEach((t, i) => {
      const at = wibToUtc(wib.date, t);
      if (at.getTime() >= from.getTime()) out.push({ scheduledFor: at, slotIndex: i, format: rule.format_mix[i] });
    });
  }
  return out;
}

/** Slots per active day in a plan (for the ">= 2 a day" guarantee). */
export function slotsPerDay(plan: PlannedSlot[]): Map<string, number> {
  const m = new Map<string, number>();
  for (const s of plan) m.set(utcToWib(s.scheduledFor).date, (m.get(utcToWib(s.scheduledFor).date) ?? 0) + 1);
  return m;
}

// ------------------------------------------------------------------ queue status
export const QUEUE_STATUSES = ["queued", "scripting", "voicing", "rendering", "ready_to_post", "published", "failed"] as const;
export type QueueStatus = (typeof QUEUE_STATUSES)[number];
const QUEUE_NEXT: Record<QueueStatus, readonly QueueStatus[]> = {
  queued: ["scripting", "failed"],
  scripting: ["voicing", "failed"],
  voicing: ["rendering", "failed"],
  rendering: ["ready_to_post", "published", "failed"],
  ready_to_post: ["published", "failed"],
  published: [],
  failed: ["queued", "ready_to_post"],
};
export const asQueueStatus = (s: string): QueueStatus | null => ((QUEUE_STATUSES as readonly string[]).includes(s) ? (s as QueueStatus) : null);
/** Whether a slot may move from one status to another (published is final; failed only goes back via retry). */
export function canAdvance(from: string, to: string): boolean {
  const f = asQueueStatus(from);
  const t = asQueueStatus(to);
  return Boolean(f && t && QUEUE_NEXT[f].includes(t));
}
export const isWorking = (s: string) => s === "scripting" || s === "voicing" || s === "rendering";
export const QUEUE_LABEL: Record<QueueStatus, string> = {
  queued: "Queued",
  scripting: "Scripting",
  voicing: "Voicing",
  rendering: "Rendering",
  ready_to_post: "Ready to post",
  published: "Published",
  failed: "Failed",
};

/** What the cron should do with a queued slot now: produce it, leave it for later, or mark it missed. */
export function slotDue(s: { status: string; scheduled_for: Date }, now: Date): "produce" | "later" | "missed" | "skip" {
  if (s.status !== "queued") return "skip";
  const t = s.scheduled_for.getTime();
  if (t < now.getTime() - MISSED_AFTER_HOURS * 3600_000) return "missed";
  return t <= now.getTime() + LEAD_MINUTES * 60_000 ? "produce" : "later";
}

/** After the render: published when every auto target that was queued is live and nothing waits for a hand-off. */
export function statusAfterPublishing(p: { targets: Target[]; queued: string[]; published: string[]; failed: string[] }): QueueStatus {
  if (p.failed.length) return "failed";
  const handoff = p.targets.includes("tiktok_drafts");
  const allLive = p.queued.length > 0 && p.queued.every((x) => p.published.includes(x));
  return allLive && !handoff ? "published" : "ready_to_post";
}

/** Manual topic seeds for the next open slots, in order: one per line, blanks dropped, slots with a manual seed kept. */
export function assignSeeds<S extends { id: string; topic_source: string | null; status: string }>(slots: S[], text: string): { id: string; seed: string }[] {
  const seeds = text.split(/\r?\n/).map((s) => s.trim().slice(0, 300)).filter(Boolean);
  const open = slots.filter((s) => s.status === "queued" && s.topic_source !== "manual");
  return open.slice(0, seeds.length).map((s, i) => ({ id: s.id, seed: seeds[i] }));
}

// ------------------------------------------------------------------ Reusable Prop Bank
export type BankProp = { name: string; keywords: string[]; category: string | null; vetted: boolean; available: boolean };

/** Keyword tags as typed ("kopi, es kopi; latte") → clean lowercase list (≤ 20 tags, ≤ 40 chars each). */
export function parseKeywords(text: string): string[] {
  return [...new Set(text.split(/[,;\n]/).map((k) => k.trim().toLowerCase().replace(/\s+/g, " ").slice(0, 40)).filter(Boolean))].slice(0, 20);
}

/** Props an unattended script may use: vetted and with a file that exists (repo PNG or upload). */
export const usableProps = (bank: BankProp[]) => bank.filter((p) => p.vetted && p.available && isPropName(p.name));

/**
 * The prop a line may show: exactly the tag it asks for when that is one of the episode's own freshly generated props,
 * or a vetted, existing Prop Bank prop named exactly; anything else is "none". There is no keyword matching: an
 * unrelated leftover prop (a calculator on a skincare episode) is never attached.
 */
export function resolveProp(requested: string | null | undefined, fresh: string[], bank: BankProp[]): string {
  const tag = String(requested ?? "").trim().toLowerCase();
  if (!tag || tag === "none") return "none";
  if (fresh.includes(tag)) return tag;
  return usableProps(bank).some((p) => p.name === tag) ? tag : "none";
}

/** Props a script names that the bank can't serve (should always be empty for scheduler scripts). */
export function missingProps(lines: { prop_tag?: string | null }[], bank: BankProp[], fresh: string[] = []): string[] {
  const ok = new Set([...usableProps(bank).map((p) => p.name), ...fresh]);
  return [...new Set(lines.map((l) => String(l.prop_tag ?? "none").trim()).filter((t) => t && t !== "none" && !ok.has(t)))];
}

/** The prop list Gemini is given. */
export function propMenu(bank: BankProp[]): string {
  const usable = usableProps(bank);
  if (!usable.length) return "(no props in the bank: use prop_tag none, and layout takeover with a stat for key numbers)";
  return usable.map((p) => `- ${p.name}${p.keywords.length ? `: ${p.keywords.join(", ")}` : ""}`).join("\n");
}

// ------------------------------------------------------------------ the unattended script
export type DraftLine = {
  beat?: string;
  speaker?: string;
  text?: string;
  subtitle?: string;
  emotion?: string | null;
  camera_shot?: string | null;
  prop_tag?: string | null;
  layout?: string | null;
  stat?: string | null;
  on_screen_text?: string | null;
  kicker?: string | null;
  headline?: string | null;
  stamp?: string | null;
  thought_bubble?: boolean;
  delivery?: string | null;
  // Show Bible names (scheduler scripts): pose (incl. thought / cta), shot, callout, statCard, explainerCard, sfx, prop
  pose?: string | null;
  shot?: string | null;
  callout?: string | null;
  statCard?: string | null;
  explainerCard?: string | null;
  sfx?: string[] | null;
  prop?: string | null;
  thought?: boolean;
};
export type DraftScript = { title?: string; lines?: DraftLine[]; propSpecs?: unknown };

/** Sound effects a script may ask for (files in public/sfx). */
export const SFX_NAMES = ["whoosh", "pop", "stamp", "record-scratch", "ding"] as const;
const EXPLAINERS = ["brain-badge", "wave-graph"] as const;
const words = (s: string) => s.trim().split(/\s+/).filter(Boolean);
/** A 2–4 word callout (cut to 4 words, uppercase), or null. */
export function cleanCalloutText(s: string | null | undefined): string | null {
  const w = words(noEmDash(String(s ?? "")).replace(/["“”]/g, ""));
  return w.length ? w.slice(0, 4).join(" ").toUpperCase() : null;
}

/** "Co" as a nickname for Uco is pronounced like "cok": always the full name. (Only the standalone word.) */
export const noUcoShortening = (s: string) => s.replace(/(^|[^\p{L}\p{N}-])Co(?=$|[^\p{L}\p{N}-])/gu, "$1Uco");

/** antislop: no em dashes in anything the episode shows or says. */
export const noEmDash = (s: string) => s.replace(/\s*[—–]\s*/g, ", ").replace(/,\s*,/g, ",").trim();
const oneOf = <T extends string>(list: readonly T[], v: unknown): T | null => ((list as readonly string[]).includes(String(v)) ? (v as T) : null);

/** clampCue, with an explicit null stamp (the stored line shape has no undefined). */
function cue(m: Parameters<typeof clampCue>[0], fallback: Parameters<typeof clampCue>[1]) {
  const c = clampCue(m, fallback);
  return { kicker: c.kicker, headline: c.headline, stamp: c.stamp ?? null };
}

const EXPRESSION_FOR: Record<string, (typeof EXPRESSIONS)[number]> = {
  triumphant: "excited",
  defensive: "worried",
  shocked: "shocked",
  phone: "calm",
  angry: "angry",
  deadpan: "deadpan",
  explaining: "calm",
  inspecting: "deadpan",
};

/**
 * Gemini's draft → the episode's lines (the Manual / Exact Import line shape, saved verbatim from here on): known
 * speakers / beats / poses / shots only, props only from `props.fresh` (the episode's own generated props) or an
 * exact vetted Prop Bank name, takeover only with a real stat, explainer cards and SFX from the known sets, cue word
 * limits enforced, no em dashes. Visual fields are never left blank: a missing pose or shot gets the speaker's own,
 * emphasis beats without a callout get one from their headline, and the hook / takeovers get an SFX.
 * Throws when fewer than `min` usable lines come back.
 */
export function sanitizeScript(draft: DraftScript, props: { fresh: string[]; bank: BankProp[] }, fallbackTitle: string, min = 4): { title: string; lines: ManualLine[] } {
  const lines: ManualLine[] = [];
  for (const d of (draft.lines ?? []).slice(0, 20)) {
    const speaker = d.speaker === "ocu" ? "ocu" : d.speaker === "uco" ? "uco" : null;
    const text = noUcoShortening(noEmDash(String(d.text ?? ""))).slice(0, 400);
    if (!speaker || !text) continue;
    const rawPose = String(d.pose ?? d.emotion ?? "").toLowerCase();
    const thought = d.thought === true || d.thought_bubble === true || rawPose === "thought";
    const emotion = POSES[speaker].includes(rawPose) ? rawPose : speaker === "uco" ? (thought ? "defensive" : "triumphant") : "deadpan";
    const stat = parseStat(d.statCard ?? d.stat ?? null);
    const statText = stat ? `${stat.headline}${stat.subline ? ` | ${stat.subline}` : ""}` : null;
    const beat = oneOf(BEATS, d.beat) ?? (lines.length === 0 ? "hook" : "escalation");
    const onScreen = d.on_screen_text ? noEmDash(d.on_screen_text).slice(0, 80) : null;
    const message = cue(
      { kicker: d.kicker ? noEmDash(d.kicker).toUpperCase() : undefined, headline: d.headline ? noEmDash(d.headline).toUpperCase() : undefined, stamp: d.stamp ? noEmDash(d.stamp).toUpperCase() : null },
      { kicker: beat.toUpperCase(), headline: (onScreen ?? text).toUpperCase() },
    );
    const layout = (d.layout === "takeover" || Boolean(d.statCard)) && statText ? "takeover" : "standard";
    const emphasis = beat === "hook" || beat === "insight" || beat === "button" || layout === "takeover";
    const callout = thought ? null : (cleanCalloutText(d.callout) ?? (emphasis ? cleanCalloutText(message.headline) : null));
    let sfx = [...new Set((Array.isArray(d.sfx) ? d.sfx : []).map((x) => String(x).trim().toLowerCase()).filter((x) => (SFX_NAMES as readonly string[]).includes(x)))].slice(0, 3);
    if (!sfx.length && lines.length === 0) sfx = ["whoosh"];
    if (!sfx.length && layout === "takeover") sfx = ["stamp"];
    const explainer = oneOf(EXPLAINERS, d.explainerCard);
    lines.push({
      beat,
      speaker,
      text,
      subtitle: noUcoShortening(noEmDash(String(d.subtitle ?? ""))).slice(0, 300),
      expression: EXPRESSION_FOR[emotion] ?? (speaker === "uco" ? "excited" : "deadpan"),
      thought_bubble: thought,
      visual: "",
      on_screen_text: onScreen,
      kinetic_text: callout,
      delivery: d.delivery ? noEmDash(d.delivery).slice(0, 160) : null,
      important_message: message,
      camera_shot: oneOf(CAMERA_SHOTS.filter((c) => c !== "cta-stinger"), d.shot ?? d.camera_shot) ?? (thought ? "two-shot" : speaker === "uco" ? "solo-uco" : "solo-ocu"),
      emotion,
      prop_tag: resolveProp(d.prop ?? d.prop_tag, props.fresh, props.bank),
      start_s: null,
      end_s: null,
      sfx,
      overlay: explainer,
      callouts: null,
      layout,
      stat: statText,
    });
  }
  if (lines.length < min) throw new Error(`Gemini's script had only ${lines.length} usable line(s). Retry the slot.`);
  return { title: noEmDash(String(draft.title ?? "").trim()).slice(0, 120) || fallbackTitle, lines: fillDeadAir(lines, props.fresh) };
}

/** Whether a line puts something on the stage besides the speaker: a prop, a callout, a takeover or a card. */
export const hasVisual = (l: Pick<ManualLine, "prop_tag" | "kinetic_text" | "layout" | "overlay" | "thought_bubble">) =>
  Boolean((l.prop_tag && l.prop_tag !== "none") || l.kinetic_text || l.layout === "takeover" || l.overlay || l.thought_bubble);

/**
 * No dead air: never two lines in a row with nothing on the stage (a 5–7 s blank stretch). The second gets a callout
 * from its own cue headline. And an Ocu "inspecting" line (magnifier in hand) never examines empty air when the
 * episode has a prop of its own: it holds the most recent one (only the episode's fresh props, never a leftover).
 */
export function fillDeadAir(lines: ManualLine[], fresh: string[] = []): ManualLine[] {
  const firstFresh = lines.map((x) => x.prop_tag).find((t): t is string => Boolean(t && fresh.includes(t))) ?? null;
  let lastProp: string | null = null;
  const out: ManualLine[] = [];
  for (const l of lines) {
    let line = l;
    if (l.prop_tag && fresh.includes(l.prop_tag)) lastProp = l.prop_tag;
    const held = lastProp ?? firstFresh;
    if (l.emotion === "inspecting" && (!l.prop_tag || l.prop_tag === "none") && held) line = { ...line, prop_tag: held };
    const prev = out.at(-1);
    if (prev && !hasVisual(prev) && !hasVisual(line)) line = { ...line, kinetic_text: cleanCalloutText(line.important_message?.headline ?? line.text) };
    out.push(line);
  }
  return out;
}

/** The episode's captions for TikTok / Shopee hand-off: caption text plus the yellow-basket note for affiliate slots. */
export function handoffCaption(text: string, format: EpisodeFormat): string {
  return format === "affiliate" ? `${text}\n\nCek keranjang kuning 🛒` : text;
}
