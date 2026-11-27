import "server-only";
import { randomUUID } from "node:crypto";
import type { ManualLine } from "./manualScriptParser";
import type { ProgressUpdate } from "./slotProgress";
import { LEGACY_SHOW_DIRECTION, MIN_LINES, PROP_STYLE, SHOW_SCHEMA, showDirection, dropProp, betterAttempt, episodePropName, mapPropSlugs, parsePropSpecs, showBibleProblems, showBiblePrompt, withCta, type PropSpec } from "./showBible";
import manifest from "../../video/src/assets/assetManifest.json";
import { PNG_PROPS } from "../../video/src/props/library";
import { db } from "./db";
import { parseSeeds } from "./gemini-core";
import { geminiImage, geminiJson, geminiText } from "./gemini-text";
import { hookLine, manualCaptions } from "./publish/manualCaptions";
import { saveCaptions } from "./publish/approval";
import {
  AUTO_TARGETS,
  DEFAULT_RULE,
  FORMATS,
  LEAD_MINUTES,
  QUEUE_DAYS,
  STALE_HOURS,
  assignSeeds,
  asFormat,
  canAdvance,
  handoffCaption,
  missingProps,
  normalizeRule,
  plannedSlots,
  usableProps,
  fillDeadAir,
  sanitizeScript,
  slotDue,
  statusAfterPublishing,
  type BankProp,
  type DraftScript,
  type EpisodeFormat,
  type QueueStatus,
  type ScheduleRule,
  type Target,
} from "./scheduler";

// The autonomous scheduler's server side: schedule rules, the episode queue, the Prop Bank, and each production step
// the GitHub Actions cron (.github/workflows/autonomous-scheduler.yml) calls through /api/scheduler/*. Scripts and
// topic seeds come from Gemini (free tier); voices from the episode's provider (Gemini TTS, or Gemini + RVC). Nothing
// here reaches the Anthropic API.

export type ScheduleRow = ScheduleRule & {
  id: string;
  user_id: string;
  updated_at: Date;
};
export type QueueRow = {
  id: string;
  schedule_id: string;
  scheduled_for: Date;
  slot_index: number;
  format: EpisodeFormat;
  topic_seed: string | null;
  topic_source: string | null;
  status: QueueStatus;
  episode_id: string | null;
  render_job_id: string | null;
  error_message: string | null;
  run_url: string | null;
  handoff: Handoff | null;
  attempts: number;
  updated_at: Date;
  episode_title?: string | null;
  progress_percent: number | null;
  progress_stage: string | null;
  progress_detail: string | null;
  progress_updated_at: Date | null;
};
export type Handoff = {
  tiktokCaption: string | null;
  queued: string[];
  postAt: string;
  notConnected: string[];
  /** the episode's freshly generated props (set when the script is written, kept through the finish) */
  props?: FreshProp[];
  /** why some of them failed, in short (the card shows it; the render still finishes) */
  propWarning?: string | null;
};
/** "2 of 3 props failed: Gemini 400 (gemini-nano-banana-2.1): …" (null when none failed). */
export function propWarningFor(props: FreshProp[]): string | null {
  const failed = props.filter((p) => p.status === "failed");
  if (!failed.length) return null;
  return `${failed.length} of ${props.length} prop${props.length > 1 ? "s" : ""} failed: ${(failed[0].error ?? "unknown error").slice(0, 200)}`;
}

export type FreshProp = { slug: string; name: string; prompt: string; status: "pending" | "done" | "failed"; error?: string };

/** A step called on a slot in another state (a late or duplicate worker call): refused, the slot is left alone. */
export class SlotStateError extends Error {
  name = "SlotStateError";
}

const SLOT_COLS =
  "q.id, q.schedule_id, q.scheduled_for, q.slot_index, q.format, q.topic_seed, q.topic_source, q.status, q.episode_id, q.render_job_id, q.error_message, q.run_url, q.handoff, q.attempts, q.updated_at, q.progress_percent, q.progress_stage, q.progress_detail, q.progress_updated_at";

// ------------------------------------------------------------------ schedule rules
export async function getSchedule(userId: string): Promise<ScheduleRow | null> {
  const [s] = await db()<
    ScheduleRow[]
  >`SELECT * FROM content_schedules WHERE user_id = ${userId} ORDER BY created_at LIMIT 1`;
  return s ? { ...s, ...normalizeRule(s) } : null;
}

/** Saves the rule (creating it the first time), drops open slots the new rule no longer has, and refills 3 days. */
export async function saveSchedule(
  userId: string,
  input: Partial<Record<keyof ScheduleRule, unknown>>,
): Promise<ScheduleRow> {
  const r = normalizeRule(input);
  const sql = db();
  const cur = await getSchedule(userId);
  const vals = sql`${r.cadence}, ${r.days_of_week}, ${r.days_of_month}, ${r.slots_per_day}, ${r.slot_times}, ${r.format_mix}, ${r.voice_provider}, ${r.target_platforms}, ${r.topic_hint}, ${r.auto_execute}, ${r.is_active}`;
  const [row] = cur
    ? await sql<ScheduleRow[]>`
        UPDATE content_schedules SET (cadence, days_of_week, days_of_month, slots_per_day, slot_times, format_mix, voice_provider, target_platforms, topic_hint, auto_execute, is_active, updated_at)
          = (${vals}, now()) WHERE id = ${cur.id} RETURNING *`
    : await sql<ScheduleRow[]>`
        INSERT INTO content_schedules (user_id, cadence, days_of_week, days_of_month, slots_per_day, slot_times, format_mix, voice_provider, target_platforms, topic_hint, auto_execute, is_active)
        VALUES (${userId}, ${vals}) RETURNING *`;
  // the visual style (migration 020): saved on its own, so a missing column is a clear message, not a broken save
  await sql`UPDATE content_schedules SET visual_style = ${r.visual_style} WHERE id = ${row.id}`.catch((e) => {
    throw new Error(/visual_style/.test(String(e)) ? "The visual style needs database migration 020 (schedule visual style). Apply it, then save again." : String(e));
  });
  const plan = r.is_active ? plannedSlots(r, new Date()) : [];
  const keep = plan.map((p) => p.scheduledFor.toISOString());
  // open (queued, nothing made yet) future slots that the new rule doesn't have; manual seeds move to the new slots
  const dropped = await sql<
    { topic_seed: string | null; topic_source: string | null }[]
  >`
    DELETE FROM episode_queue WHERE schedule_id = ${row.id} AND status = 'queued' AND episode_id IS NULL AND scheduled_for > now()
      AND NOT (scheduled_for = ANY(${keep}::timestamptz[])) RETURNING topic_seed, topic_source`;
  await topUp({ ...row, ...r });
  // the format of an open slot follows the rule's mix
  for (const p of plan) {
    await sql`UPDATE episode_queue SET format = ${p.format}, slot_index = ${p.slotIndex}, updated_at = now()
              WHERE schedule_id = ${row.id} AND scheduled_for = ${p.scheduledFor} AND status = 'queued' AND episode_id IS NULL AND format <> ${p.format}`;
  }
  const manual = dropped
    .filter((d) => d.topic_source === "manual" && d.topic_seed)
    .map((d) => d.topic_seed!);
  if (manual.length) await setSeeds(userId, manual.join("\n"));
  return { ...row, ...r };
}

/** Inserts every planned slot of the next 3 days that isn't queued yet. Returns how many were added. */
export async function topUp(
  s: Pick<ScheduleRow, "id" | "user_id"> & ScheduleRule,
  now = new Date(),
): Promise<number> {
  if (!s.is_active) return 0;
  const plan = plannedSlots(s, now, QUEUE_DAYS + 1);
  let added = 0;
  for (const p of plan) {
    const r = await db()`
      INSERT INTO episode_queue (schedule_id, user_id, scheduled_for, slot_index, format)
      VALUES (${s.id}, ${s.user_id}, ${p.scheduledFor}, ${p.slotIndex}, ${p.format})
      ON CONFLICT (schedule_id, scheduled_for) DO NOTHING`;
    added += r.count;
  }
  return added;
}

// ------------------------------------------------------------------ the queue
export async function listQueue(userId: string): Promise<QueueRow[]> {
  await refreshStatuses(userId);
  return db().unsafe<QueueRow[]>(
    `SELECT ${SLOT_COLS}, p.title AS episode_title FROM episode_queue q LEFT JOIN content_projects p ON p.id = q.episode_id
     WHERE q.user_id = $1 AND (q.scheduled_for > now() - interval '2 days' OR q.status NOT IN ('published', 'failed'))
     ORDER BY q.scheduled_for LIMIT 60`,
    [userId],
  );
}

async function slot(
  id: string,
): Promise<QueueRow & { user_id: string; started_at: Date | null }> {
  if (!/^[0-9a-f-]{36}$/.test(id)) throw new Error("Bad slot id.");
  const [s] = await db().unsafe<
    (QueueRow & { user_id: string; started_at: Date | null })[]
  >(
    `SELECT ${SLOT_COLS}, q.user_id, q.started_at FROM episode_queue q WHERE q.id = $1`,
    [id],
  );
  if (!s) throw new Error("Unknown slot.");
  return s;
}

async function move(
  id: string,
  from: QueueStatus,
  to: QueueStatus,
  extra: { error?: string | null; runUrl?: string | null } = {},
) {
  if (!canAdvance(from, to))
    throw new Error(`A ${from} slot can't become ${to}.`);
  const final = to === "published" || to === "failed" || to === "ready_to_post";
  const r = await db()`
    UPDATE episode_queue SET status = ${to}, error_message = ${to === "failed" ? (extra.error ?? "Failed.").slice(0, 1000) : null},
      run_url = COALESCE(${extra.runUrl ?? null}, run_url), finished_at = CASE WHEN ${final} THEN now() ELSE finished_at END, updated_at = now()
    WHERE id = ${id} AND status = ${from}`;
  if (!r.count) throw new SlotStateError(`The slot is no longer ${from}.`);
}

/** Stale active slots become failed; ready_to_post slots whose posts all went live become published. */
export async function refreshStatuses(userId?: string) {
  const sql = db();
  const who = userId ? sql`AND user_id = ${userId}` : sql``;
  await sql`
    UPDATE episode_queue SET status = 'failed', error_message = COALESCE(error_message, 'The worker stopped without reporting back. Retry the slot.'), updated_at = now()
    WHERE status IN ('scripting', 'voicing', 'rendering') AND updated_at < now() - make_interval(hours => ${STALE_HOURS}) ${who}`;
  const ready = await sql<
    {
      id: string;
      episode_id: string;
      targets: Target[];
      handoff: Handoff | null;
    }[]
  >`
    SELECT q.id, q.episode_id, s.target_platforms AS targets, q.handoff FROM episode_queue q JOIN content_schedules s ON s.id = q.schedule_id
    WHERE q.status = 'ready_to_post' AND q.episode_id IS NOT NULL ${userId ? sql`AND q.user_id = ${userId}` : sql``}`;
  for (const r of ready) {
    const pubs = await sql<
      { platform: string; status: string; error: string | null }[]
    >`
      SELECT DISTINCT ON (platform) platform, status, error FROM episode_publications WHERE project_id = ${r.episode_id} ORDER BY platform, created_at DESC`;
    const queued = r.handoff?.queued ?? [];
    const next = statusAfterPublishing({
      targets: r.targets,
      queued,
      published: pubs
        .filter((p) => p.status === "published")
        .map((p) => p.platform),
      failed: pubs
        .filter((p) => p.status === "failed" && queued.includes(p.platform))
        .map((p) => p.platform),
    });
    if (next === "published")
      await sql`UPDATE episode_queue SET status = 'published', updated_at = now() WHERE id = ${r.id} AND status = 'ready_to_post'`;
    if (next === "failed") {
      const f = pubs.find((p) => p.status === "failed");
      await sql`UPDATE episode_queue SET status = 'failed', error_message = ${`${f?.platform ?? "A platform"}: ${f?.error ?? "posting failed"}`.slice(0, 1000)}, updated_at = now()
                WHERE id = ${r.id} AND status = 'ready_to_post'`;
    }
  }
}

/** Manual topic seeds, one per line, for the next open slots (slots with a manual seed keep theirs). */
export async function setSeeds(userId: string, text: string): Promise<number> {
  const open = await db()<
    { id: string; topic_source: string | null; status: string }[]
  >`
    SELECT id, topic_source, status FROM episode_queue WHERE user_id = ${userId} AND status = 'queued' AND scheduled_for > now() ORDER BY scheduled_for`;
  const pairs = assignSeeds(open, text);
  for (const p of pairs)
    await db()`UPDATE episode_queue SET topic_seed = ${p.seed}, topic_source = 'manual', updated_at = now() WHERE id = ${p.id} AND status = 'queued'`;
  return pairs.length;
}

export async function setSeed(userId: string, id: string, seed: string) {
  const s = seed.trim().slice(0, 300);
  await db()`UPDATE episode_queue SET topic_seed = ${s || null}, topic_source = ${s ? "manual" : null}, updated_at = now()
             WHERE id = ${id} AND user_id = ${userId} AND status = 'queued'`;
}

/** Retry a failed slot: posting again when its video exists, otherwise the whole slot from where it stopped. */
export async function retrySlot(
  userId: string,
  id: string,
): Promise<"posting" | "queued"> {
  const s = await slot(id);
  if (s.user_id !== userId) throw new Error("Unknown slot.");
  if (s.status !== "failed")
    throw new Error("Only a failed slot can be retried.");
  const [video] = s.episode_id
    ? await db()<
        { id: string }[]
      >`SELECT id FROM episode_videos WHERE project_id = ${s.episode_id} LIMIT 1`
    : [];
  if (video && s.handoff?.queued) {
    const { queuePublish, drain } = await import("./publish/engine");
    await queuePublish({ userId, projectId: s.episode_id!, onlyFailed: true });
    await move(id, "failed", "ready_to_post");
    const { after } = await import("next/server");
    after(() => drain().catch(() => {}));
    return "posting";
  }
  await db()`UPDATE episode_queue SET status = 'queued', error_message = NULL, progress_percent = NULL, progress_stage = NULL, progress_detail = NULL, progress_updated_at = NULL, updated_at = now() WHERE id = ${id} AND status = 'failed'`;
  return "queued";
}

/**
 * "Regenerate script & run": throws the slot's draft episode away (script, takes, render; the cascade removes them) and
 * puts the slot back in the queue with its topic, so the next run writes a fresh Show Bible script. Only for a slot that
 * isn't being made or posted right now.
 */
export async function regenerateSlot(userId: string, id: string): Promise<void> {
  const s = await slot(id);
  if (s.user_id !== userId) throw new Error("Unknown slot.");
  if (s.status !== "queued" && s.status !== "failed") throw new Error("Only a queued or failed slot can be regenerated.");
  const sql = db();
  await sql.begin(async (tx) => {
    await tx`UPDATE episode_queue SET status = 'queued', episode_id = NULL, render_job_id = NULL, handoff = NULL, error_message = NULL, run_url = NULL, progress_percent = NULL, progress_stage = NULL, progress_detail = NULL, progress_updated_at = NULL, updated_at = now()
             WHERE id = ${id} AND status IN ('queued', 'failed')`;
    if (s.episode_id) await tx`DELETE FROM content_projects WHERE id = ${s.episode_id} AND user_id = ${userId}`;
  });
}

// ------------------------------------------------------------------ Gemini topic seeds
const SEED_SCHEMA = {
  type: "OBJECT",
  properties: { seeds: { type: "ARRAY", items: { type: "STRING" } } },
  required: ["seeds"],
};

/**
 * Gemini topics, one per format given (same order). Throws with the real reason (HTTP status, model, Gemini's message,
 * or what came back when nothing usable did); the answer is parsed tolerantly (JSON, fenced JSON or plain lines).
 */
export async function suggestTopics(s: Pick<ScheduleRow, "user_id" | "topic_hint">, formats: EpisodeFormat[]): Promise<string[]> {
  const recent = await db()<{ t: string }[]>`
    SELECT topic_seed AS t FROM episode_queue WHERE user_id = ${s.user_id} AND topic_seed IS NOT NULL ORDER BY scheduled_for DESC LIMIT 30`;
  const { text, model } = await geminiText(
    `Kamu penulis ide untuk "Uco & Ocu", serial komedi pendek berbahasa Indonesia (Uco: heboh, optimis; Ocu: kalem, sinis).
Tulis ${formats.length} topik episode yang segar, satu per format di bawah (urutannya sama). Tiap topik satu kalimat pendek
(maks 20 kata), spesifik, relevan untuk anak muda Indonesia, bisa dicek faktanya. Tanpa em dash, tanpa angka karangan.
${s.topic_hint ? `Arah dari kreator: ${s.topic_hint}\n` : ""}Format:
${formats.map((f, i) => `${i + 1}. ${FORMATS[f].label}: ${FORMATS[f].brief}`).join("\n")}
Jangan ulangi topik ini:
${recent.map((r) => `- ${r.t}`).join("\n") || "- (belum ada)"}`,
    { schema: SEED_SCHEMA },
  );
  const seeds = parseSeeds(text, formats.length);
  if (!seeds.length) throw new Error(`Gemini (${model}) returned no usable topic: "${text.replace(/\s+/g, " ").slice(0, 160)}"`);
  return seeds;
}

/** Gemini topic seeds for queued slots of the next 3 days that have none. Best effort: a failure is reported, not thrown. */
export async function fillSeeds(s: ScheduleRow): Promise<{ filled: number; error: string | null }> {
  const sql = db();
  const open = await sql<{ id: string; format: EpisodeFormat }[]>`
    SELECT id, format FROM episode_queue WHERE schedule_id = ${s.id} AND status = 'queued' AND topic_seed IS NULL
      AND scheduled_for < now() + make_interval(days => ${QUEUE_DAYS + 1}) ORDER BY scheduled_for LIMIT 12`;
  if (!open.length) return { filled: 0, error: null };
  try {
    const seeds = await suggestTopics(s, open.map((o) => o.format));
    let filled = 0;
    for (const [i, o] of open.entries()) {
      if (!seeds[i]) break;
      const r = await sql`UPDATE episode_queue SET topic_seed = ${seeds[i]}, topic_source = 'gemini', updated_at = now() WHERE id = ${o.id} AND topic_seed IS NULL`;
      filled += r.count;
    }
    return { filled, error: null };
  } catch (e) {
    const error = e instanceof Error ? e.message : String(e);
    console.error(`[scheduler] topic seeds failed: ${error}`);
    return { filled: 0, error };
  }
}

// ------------------------------------------------------------------ the cron's tick
/**
 * One cron run: refill every active schedule's queue, give open slots Gemini topic seeds, mark long-missed slots, and
 * claim the slots to produce now (only for schedules with auto_execute on). `slotId` (Run slot now) claims that slot
 * whatever the schedule says. Returns the claimed slot ids.
 */
export async function tick(
  p: { slotId?: string | null; runUrl?: string | null; now?: Date } = {},
): Promise<{ slots: string[]; notes: string[] }> {
  const now = p.now ?? new Date();
  const sql = db();
  const notes: string[] = [];
  await refreshStatuses();
  const schedules = (
    await sql<ScheduleRow[]>`SELECT * FROM content_schedules WHERE is_active`
  ).map((s) => ({ ...s, ...normalizeRule(s) }));
  for (const s of schedules) {
    const added = await topUp(s, now);
    if (added) notes.push(`${added} slot(s) added`);
    const seeds = await fillSeeds(s);
    if (seeds.filled) notes.push(`${seeds.filled} topic seed(s) from Gemini`);
    if (seeds.error) notes.push(`topic seeds: ${seeds.error}`);
  }
  if (p.slotId) {
    const [c] = await sql<{ id: string }[]>`
      UPDATE episode_queue SET status = 'scripting', attempts = attempts + 1, started_at = now(), error_message = NULL, progress_percent = NULL, progress_stage = 'starting', progress_detail = 'Starting GitHub worker...', progress_updated_at = now(),
        run_url = ${p.runUrl ?? null}, updated_at = now()
      WHERE id = ${p.slotId} AND status = 'queued' RETURNING id`;
    if (!c)
      throw new Error("That slot isn't queued (it may be running already).");
    return { slots: [c.id], notes };
  }
  const queued = await sql<
    { id: string; status: string; scheduled_for: Date; auto: boolean }[]
  >`
    SELECT q.id, q.status, q.scheduled_for, s.auto_execute AS auto FROM episode_queue q JOIN content_schedules s ON s.id = q.schedule_id
    WHERE q.status = 'queued' AND s.is_active AND q.scheduled_for < ${new Date(now.getTime() + LEAD_MINUTES * 60_000)} ORDER BY q.scheduled_for`;
  const claimed: string[] = [];
  for (const q of queued) {
    const due = slotDue(q, now);
    if (due === "missed") {
      await sql`UPDATE episode_queue SET status = 'failed', error_message = 'Missed: the worker didn''t run in time. Retry to make it now.', updated_at = now()
                WHERE id = ${q.id} AND status = 'queued'`;
    } else if (due === "produce" && q.auto && claimed.length < 4) {
      const [c] = await sql<{ id: string }[]>`
        UPDATE episode_queue SET status = 'scripting', attempts = attempts + 1, started_at = now(), run_url = ${p.runUrl ?? null}, progress_percent = NULL, progress_stage = 'starting', progress_detail = 'Starting GitHub worker...', progress_updated_at = now(), updated_at = now()
        WHERE id = ${q.id} AND status = 'queued' RETURNING id`;
      if (c) claimed.push(c.id);
    }
  }
  return { slots: claimed, notes };
}

// ------------------------------------------------------------------ step 1: the script (Gemini, the Uco & Ocu Show Bible)
/** Step 1: Gemini writes the script; the episode is created with it (approved, default captions, the schedule's voice). */
export async function scriptSlot(
  id: string,
  runUrl?: string | null,
): Promise<{ episodeId: string; title: string; reused: boolean; lines: number }> {
  const s = await slot(id);
  if (s.status !== "scripting")
    throw new SlotStateError(`The slot is ${s.status}, not scripting.`);
  const sql = db();
  if (runUrl)
    await sql`UPDATE episode_queue SET run_url = ${runUrl}, updated_at = now() WHERE id = ${id}`;
  // a retried slot whose episode already has a script: keep it (and its takes)
  if (s.episode_id) {
    const [has] = await sql<{ title: string; n: number }[]>`
      SELECT title, jsonb_array_length(lines) AS n FROM scripts WHERE project_id = ${s.episode_id} ORDER BY version DESC LIMIT 1`;
    if (has) {
      await move(id, "scripting", "voicing");
      return { episodeId: s.episode_id, title: has.title, reused: true, lines: has.n };
    }
  }
  const [rule] = await sql<
    ScheduleRow[]
  >`SELECT * FROM content_schedules WHERE id = ${s.schedule_id}`;
  const r = normalizeRule(rule ?? DEFAULT_RULE);
  const format = asFormat(s.format);
  let seed = s.topic_seed;
  if (!seed) {
    // this slot is already claimed (scripting), so ask Gemini for its own topic; a failure names the real cause
    try {
      [seed] = await suggestTopics({ user_id: s.user_id, topic_hint: r.topic_hint }, [format]);
    } catch (e) {
      throw new Error(`No topic seed for this slot, and topic suggestion failed: ${(e instanceof Error ? e.message : String(e)).replace(/\.+$/, "")}. Add a topic to the slot, or fix the cause, then retry.`);
    }
    await sql`UPDATE episode_queue SET topic_seed = ${seed}, topic_source = 'gemini', updated_at = now() WHERE id = ${id}`;
  }
  const bank = await propBank(s.user_id);
  const episodeId = randomUUID();
  // the Show Bible script; a short or flat one is retried once with the problems spelled out, then the better kept
  type Attempt = { title: string; lines: ManualLine[]; problems: string[]; props: PropSpec[]; names: Record<string, string> };
  let best: Attempt | null = null;
  let lastError = "";
  for (const strict of [false, true]) {
    if (strict && best && !best.problems.length) break;
    try {
      const draft = await geminiJson<DraftScript>(
        showBiblePrompt({
          format,
          label: FORMATS[format].label,
          brief: FORMATS[format].brief,
          seed,
          bankProps: usableProps(bank).map((b) => b.name).join(", "),
          strict: strict ? (best?.problems ?? [lastError || "the script was unusable"]) : undefined,
        }),
        SHOW_SCHEMA,
        { temperature: strict ? 0.6 : 0.85 },
      );
      const props = parsePropSpecs(draft.propSpecs);
      const names = Object.fromEntries(props.map((p) => [p.slug, episodePropName(p.slug, episodeId)]));
      const clean = sanitizeScript({ ...draft, lines: mapPropSlugs(draft.lines ?? [], names) }, { fresh: Object.values(names), bank }, seed.slice(0, 80), 1);
      const lines = withCta(clean.lines);
      const used = props.filter((p) => lines.some((l) => l.prop_tag === names[p.slug]));
      best = betterAttempt(best, { title: clean.title, lines, problems: showBibleProblems(lines, format), props: used, names });
      console.log(`[scheduler] slot ${id} script attempt ${strict ? 2 : 1}: ${lines.length} lines${best.problems.length ? `, problems: ${best.problems.join("; ")}` : ", accepted"}`);
    } catch (e) {
      lastError = e instanceof Error ? e.message : String(e);
      console.error(`[scheduler] slot ${id} script attempt ${strict ? 2 : 1} failed: ${lastError}`);
    }
  }
  if (!best) throw new Error(lastError || "Gemini returned no script.");
  if (best.lines.length < MIN_LINES) throw new Error(`Gemini wrote only ${best.lines.length} lines twice (a scheduled episode needs at least ${MIN_LINES}). Retry or regenerate the slot.`);
  const script = { title: best.title, lines: best.lines };
  const missing = missingProps(script.lines, bank, Object.values(best.names));
  if (missing.length) throw new Error(`The script names props that don't exist: ${missing.join(", ")}.`); // never happens: sanitizeScript resolves every tag
  const title = script.title;
  const [d] = await sql<{ id: string }[]>`
    INSERT INTO content_directions (user_id, title, prompt, platforms, formats)
    VALUES (${s.user_id}, ${title.slice(0, 80)}, ${seed}, '{tiktok,instagram,youtube,facebook}'::platform_t[], '{short_video}') RETURNING id`;
  const settings = {
    tiktok: { enabled: false }, // TikTok is a hand-off (caption + download): the app doesn't post it unattended
    youtube: {
      enabled: r.target_platforms.includes("youtube"),
      privacy: "public",
    },
    instagram: { enabled: r.target_platforms.includes("instagram") },
    facebook: { enabled: r.target_platforms.includes("facebook") },
  };
  const [p] = await sql<{ id: string }[]>`
    INSERT INTO content_projects (id, user_id, direction_id, title, format, target_platforms, status, video_style, voice_provider, publish_settings)
    VALUES (${episodeId}, ${s.user_id}, ${d.id}, ${title.slice(0, 80)}, 'short_video', '{tiktok,instagram,youtube,facebook}'::platform_t[], 'awaiting_recording',
            ${r.visual_style}, ${r.voice_provider}, ${sql.json(settings as never)}) RETURNING id`;
  const seconds = Math.max(20, Math.min(95, Math.round(script.lines.reduce((n, l) => n + l.text.split(/\s+/).length, 0) / 2.6)));
  await sql`
    INSERT INTO scripts (project_id, version, title, target_duration_s, lines, sources, feedback, direction, custom, approved_at)
    VALUES (${p.id}, 1, ${title}, ${seconds}, ${sql.json(script.lines as never)}, '[]',
            ${`Autonomous scheduler: ${FORMATS[format].label}, Uco & Ocu Show Bible, written by Gemini from the topic seed "${seed}".${best.problems.length ? ` Still short of the Show Bible after one retry: ${best.problems.join("; ")}.` : ""}`},
            ${showDirection(r.visual_style)}, true, now())`;
  await saveCaptions(
    p.id,
    manualCaptions({ title, hook: hookLine(script.lines) }),
  );
  // the episode's fresh props, generated by the worker next (prop-plan / prop-generate / prop-finish)
  const freshProps = best.props.map((x) => ({ slug: x.slug, name: best!.names[x.slug], prompt: x.prompt, status: "pending" }));
  await sql`UPDATE episode_queue SET episode_id = ${p.id}, handoff = ${sql.json({ props: freshProps } as never)}, updated_at = now() WHERE id = ${id}`;
  await move(id, "scripting", "voicing");
  return { episodeId: p.id, title, reused: false, lines: script.lines.length };
}

// ------------------------------------------------------------------ step 2: voices (a few lines per call)
/**
 * Step 2, voices. Own Voice slots never call Gemini TTS: the answer is engine "edge" and the worker makes every
 * missing base take with Edge TTS (then RVC converts them). Gemini TTS slots voice up to `max` lines with Gemini; on a
 * 429 / quota error the rest goes to the worker's Edge TTS instead of failing the slot. Lines that already have a
 * take are never voiced again.
 */
export async function voiceSlot(id: string, max = 6): Promise<{ voiced: number; remaining: number; total: number; rvc: boolean; engine: "gemini" | "edge"; note: string | null }> {
  const s = await slot(id);
  if (s.status !== "voicing" || !s.episode_id) throw new SlotStateError(`The slot is ${s.status}, not voicing.`);
  const { getBooth } = await import("./recordings");
  const { linesToVoice } = await import("./voice/acting");
  const { getEpisodeVoice } = await import("./voice/settings");
  const { isQuotaError, schedulerVoiceEngine } = await import("./voice/edge");
  const booth = await getBooth(s.user_id, s.episode_id);
  if (!booth?.script) throw new Error("The slot's episode has no script.");
  const todo = linesToVoice(booth.lines, (i) => Boolean(booth.recorded[i]), "missing");
  const v = await getEpisodeVoice(s.episode_id);
  // for the progress bar: every line of the episode, and whether RVC (Own Voice) follows
  const total = booth.lines.length;
  const rvc = v.provider === "gemini_tts_rvc";
  await db()`UPDATE episode_queue SET updated_at = now() WHERE id = ${id}`;
  if (!todo.length) {
    await db()`UPDATE content_projects SET status = 'recorded', updated_at = now() WHERE id = ${s.episode_id}`;
    return { voiced: 0, remaining: 0, total, rvc, engine: schedulerVoiceEngine(v.provider), note: null };
  }
  // Own Voice (Edge TTS base takes, then RVC) and any provider the scheduler doesn't offer: the worker's Edge TTS
  if (schedulerVoiceEngine(v.provider) === "edge") {
    return { voiced: 0, remaining: todo.length, total, rvc, engine: "edge", note: `Edge TTS makes the ${todo.length} take(s) in the worker.` };
  }
  const { voiceTake } = await import("./voice/providers");
  let voiced = 0;
  for (let i = 0; i < Math.min(max, todo.length); i += 3) {
    const batch = todo.slice(i, Math.min(i + 3, max));
    const results = await Promise.all(
      batch.map((l) =>
        voiceTake({ userId: s.user_id, projectId: s.episode_id!, scriptId: booth.script!.id, lineIndex: l.index, line: l, provider: v.provider, preset: v.preset }).catch(
          (e: Error) => ({ ok: false as const, message: e.message }),
        ),
      ),
    );
    voiced += results.filter((r) => r.ok).length;
    const bad = results.find((r) => !r.ok) as { message: string } | undefined;
    if (bad && isQuotaError(bad.message)) {
      const note = `Gemini TTS quota hit (${bad.message.slice(0, 200)}). Edge TTS fallback used for the remaining ${todo.length - voiced} line(s).`;
      console.warn(`[scheduler] slot ${id}: ${note}`);
      return { voiced, remaining: todo.length - voiced, total, rvc, engine: "edge", note };
    }
    if (bad) throw new Error(`Voicing line failed: ${bad.message}`);
  }
  const remaining = todo.length - voiced;
  if (!remaining) await db()`UPDATE content_projects SET status = 'recorded', updated_at = now() WHERE id = ${s.episode_id}`;
  return { voiced, remaining, total, rvc, engine: "gemini", note: null };
}

// ------------------------------------------------------------------ step 2b: Edge TTS in the worker
async function edgeContext(id: string) {
  const s = await slot(id);
  if (s.status !== "voicing" || !s.episode_id) throw new SlotStateError(`The slot is ${s.status}, not voicing.`);
  const { getBooth } = await import("./recordings");
  const { getEpisodeVoice } = await import("./voice/settings");
  const booth = await getBooth(s.user_id, s.episode_id);
  if (!booth?.script) throw new Error("The slot's episode has no script.");
  return { s, booth, script: booth.script, voice: await getEpisodeVoice(s.episode_id) };
}

/** The Edge TTS jobs for the slot's lines that still have no take (text with the phonetic fixes, rate, pitch). */
export async function edgePlan(id: string) {
  const { booth } = await edgeContext(id);
  const { EDGE_VOICE, edgeJobs } = await import("./voice/edge");
  return { voice: EDGE_VOICE, lines: edgeJobs(booth.lines as never, (i) => Boolean(booth.recorded[i])) };
}

const linePrefix = (episodeId: string, scriptId: string, lineIndex: number, speaker: string) =>
  `${episodeId}/${scriptId}/line-${String(lineIndex + 1).padStart(2, "0")}-${speaker}-edge-`;

/** A one-time upload URL for one line's Edge TTS take (WAV), or skip when the line got a take meanwhile. */
export async function edgeUpload(id: string, lineIndex: number): Promise<{ skip: true } | { skip: false; url: string; path: string }> {
  const { s, booth, script } = await edgeContext(id);
  const line = booth.lines[lineIndex];
  if (!line || !Number.isInteger(lineIndex)) throw new Error("Unknown line.");
  if (booth.recorded[lineIndex]) return { skip: true };
  const { signedUploadUrl } = await import("./storage");
  const path = `${linePrefix(s.episode_id!, script.id, lineIndex, line.speaker)}${Date.now()}.wav`;
  return { skip: false, url: await signedUploadUrl(path), path };
}

/**
 * Registers an uploaded Edge TTS take as the line's selected take. The mark (and the prosody in it) is worked out
 * here from the line and the episode's provider, never taken from the worker. A line that got a take meanwhile keeps it.
 */
export async function edgeFinish(id: string, b: { lineIndex: number; path: string; durationMs: number | null }): Promise<{ stored: boolean; remaining: number }> {
  const { s, booth, script, voice } = await edgeContext(id);
  const line = booth.lines[b.lineIndex];
  if (!line || !Number.isInteger(b.lineIndex)) throw new Error("Unknown line.");
  const prefix = linePrefix(s.episode_id!, script.id, b.lineIndex, line.speaker);
  if (typeof b.path !== "string" || !b.path.startsWith(prefix) || !/^\d+\.wav$/.test(b.path.slice(prefix.length))) throw new Error("Unknown upload.");
  const { objectSize } = await import("./storage");
  const size = await objectSize(b.path);
  if (!size) throw new Error(`The Edge TTS take for line ${b.lineIndex + 1} didn't arrive.`);
  const { edgeMark, edgeProsody } = await import("./voice/edge");
  const mark = edgeMark(voice.provider, edgeProsody(line));
  const durationMs = Number.isFinite(b.durationMs) ? Math.round(b.durationMs!) : null;
  let stored = false;
  await db().begin(async (tx) => {
    const [has] = await tx<{ n: number }[]>`SELECT count(*)::int AS n FROM recordings WHERE script_id = ${script.id} AND line_index = ${b.lineIndex} AND is_selected`;
    if (has.n) return; // cached audio wins
    const [{ take }] = await tx<{ take: number }[]>`SELECT COALESCE(max(take), 0) + 1 AS take FROM recordings WHERE script_id = ${script.id} AND line_index = ${b.lineIndex}`;
    await tx`
      INSERT INTO recordings (project_id, script_id, line_index, speaker, take, storage_path, mime_type, size_bytes, duration_ms, source, ai_prompt, is_selected)
      VALUES (${s.episode_id!}, ${script.id}, ${b.lineIndex}, ${line.speaker}, ${take}, ${b.path}, 'audio/wav', ${size}, ${durationMs}, 'ai', ${mark}, true)`;
    stored = true;
  });
  // lines still without a take after this one
  const remaining = booth.lines.filter((l) => !booth.recorded[l.index] && l.index !== b.lineIndex).length;
  await db()`UPDATE episode_queue SET updated_at = now() WHERE id = ${id}`;
  return { stored, remaining };
}

// ------------------------------------------------------------------ step 1b: the episode's fresh props
/** A PNG file (its 8-byte signature), not an HTML page or an error body. */
export const isPng = (b: Buffer | Uint8Array) => b.length > 8 && b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4e && b[3] === 0x47 && b[4] === 0x0d && b[5] === 0x0a && b[6] === 0x1a && b[7] === 0x0a;

async function propContext(id: string) {
  const s = await slot(id);
  if (s.status !== "voicing" || !s.episode_id) throw new SlotStateError(`The slot is ${s.status}, not voicing.`);
  return { s, episodeId: s.episode_id, props: (s.handoff?.props ?? []) as FreshProp[] };
}

async function setProp(id: string, name: string, patch: Partial<FreshProp>) {
  const s = await slot(id);
  const props = ((s.handoff?.props ?? []) as FreshProp[]).map((p) => (p.name === name ? { ...p, ...patch } : p));
  // never silent: a failed prop leaves a short warning on the slot (shown on its card), the render still finishes
  const propWarning = propWarningFor(props);
  await db()`UPDATE episode_queue SET handoff = ${db().json({ ...(s.handoff ?? {}), props, propWarning } as never)}, updated_at = now() WHERE id = ${id}`;
}

/**
 * A failed prop: its lines show no prop ("none") instead, never an unrelated stand-in, and the no-dead-air rule runs
 * again so the lines it left empty get a callout. The takes are untouched (only visual fields change).
 */
async function dropPropFromScript(episodeId: string, name: string, keep: string[]) {
  const sql = db();
  const [sc] = await sql<{ id: string; lines: ManualLine[] }[]>`SELECT id, lines FROM scripts WHERE project_id = ${episodeId} ORDER BY version DESC LIMIT 1`;
  if (!sc) return;
  await sql`UPDATE scripts SET lines = ${sql.json(fillDeadAir(dropProp(sc.lines, name), keep) as never)} WHERE id = ${sc.id}`;
}
/** The episode's props that are still usable once `name` failed. */
const stillUsable = (props: FreshProp[], name: string) => props.filter((p) => p.name !== name && p.status !== "failed").map((p) => p.name);

/** The props still to make: name (the stored prop name, also on the beats) and the full image prompt. */
export async function propPlan(id: string) {
  const { props } = await propContext(id);
  return { props: props.filter((p) => p.status === "pending").map((p) => ({ name: p.name, slug: p.slug, prompt: p.prompt })) };
}

/**
 * Generates one prop with the image model (the app holds GEMINI_API_KEY; the worker never does), passing two of the
 * repo's own props as style references, and returns a short-lived URL to the raw image for the worker's cut-out.
 * A failure doesn't fail the slot: the prop is dropped (its beats show none) and the reason is returned.
 */
export async function propGenerate(id: string, name: string, origin: string): Promise<{ ok: true; data: string; mime: string; model: string } | { ok: false; error: string }> {
  const { episodeId, props } = await propContext(id);
  const prop = props.find((p) => p.name === name && p.status === "pending");
  if (!prop) return { ok: false, error: "Unknown or finished prop." };
  try {
    // two of the repo's own props as style references (public files, fetched from this app). Only real PNGs are
    // sent: a login page or an error page sent as an image is what made every prop fail with "Unable to process input
    // image" on the first live run
    const refs: { mime: string; data: Buffer }[] = [];
    for (const file of (manifest.props as string[]).filter((f) => f.endsWith(".png")).slice(0, 2)) {
      const r = await fetch(new URL(`/props/${file}`, origin), { signal: AbortSignal.timeout(15_000), redirect: "manual" }).catch(() => null);
      const data = r?.ok ? Buffer.from(await r.arrayBuffer()) : null;
      if (data && isPng(data)) refs.push({ mime: "image/png", data });
      else console.warn(`[scheduler] prop ${name}: style reference ${file} skipped (${r ? `${r.status} ${r.headers.get("content-type") ?? ""}` : "unreachable"})`);
    }
    let img;
    try {
      img = await geminiImage(`${prop.prompt}. ${PROP_STYLE}`, refs);
    } catch (e) {
      // the model refused a reference image: once more without references (style from the prompt alone)
      if (!refs.length || !/input image|INVALID_ARGUMENT/i.test(String(e))) throw e;
      console.warn(`[scheduler] prop ${name}: ${e instanceof Error ? e.message : e}; retrying without style references`);
      img = await geminiImage(`${prop.prompt}. ${PROP_STYLE}`, []);
    }
    // straight back to the worker (base64), no storage step: the first live run lost every prop when the private
    // bucket refused Gemini's JPEG ("mime type image/jpeg is not supported"); the worker's cut-out makes the PNG
    if (img.data.byteLength > 3_000_000) throw new Error(`the generated image is ${(img.data.byteLength / 1e6).toFixed(1)} MB, too big to hand over`);
    console.log(`[scheduler] slot ${id} prop ${name}: ${img.model} returned ${img.mime}, ${(img.data.byteLength / 1024).toFixed(0)} KB, ${refs.length} style reference(s)`);
    return { ok: true, data: img.data.toString("base64"), mime: img.mime, model: img.model };
  } catch (e) {
    const error = e instanceof Error ? e.message : String(e);
    console.error(`[scheduler] slot ${id} prop ${name} failed: ${error}`);
    await setProp(id, name, { status: "failed", error: error.slice(0, 300) });
    await dropPropFromScript(episodeId, name, stillUsable(props, name));
    return { ok: false, error };
  }
}

/** A one-time upload URL for the cut-out PNG, in the public custom-assets bucket the renderer loads props from. */
export async function propUpload(id: string, name: string): Promise<{ url: string; path: string }> {
  const { props } = await propContext(id);
  if (!props.some((p) => p.name === name)) throw new Error("Unknown prop.");
  const { ASSET_BUCKET, ensureAssetBucket } = await import("./attached-assets");
  const { signedUploadUrl } = await import("./storage");
  await ensureAssetBucket();
  const path = `props/${name}.png`;
  return { url: await signedUploadUrl(path, ASSET_BUCKET, true), path };
}

/** The worker is done with one prop: kept when the PNG arrived, otherwise dropped to none (with the reason). */
export async function propFinish(id: string, name: string, ok: boolean, error?: string): Promise<{ status: "done" | "failed" }> {
  const { episodeId, props } = await propContext(id);
  if (!props.some((p) => p.name === name)) throw new Error("Unknown prop.");
  if (ok) {
    const { listAttachedAssets } = await import("./attached-assets");
    if ((await listAttachedAssets()).props.includes(`${name}.png`)) {
      await setProp(id, name, { status: "done" });
      return { status: "done" };
    }
    error = "the cut-out PNG didn't arrive";
  }
  await setProp(id, name, { status: "failed", error: (error ?? "failed").slice(0, 300) });
  await dropPropFromScript(episodeId, name, stillUsable(props, name));
  return { status: "failed" };
}

// ------------------------------------------------------------------ step 3: render (in the same workflow run)
/** Opens a render job for the worker's render.mts (and rvc-stage.mts when the voice is Own Voice). */
export async function startSlotRender(
  id: string,
): Promise<{ episodeId: string; jobId: string; voice: "rvc" | "none" }> {
  const s = await slot(id);
  if (s.status !== "voicing" || !s.episode_id)
    throw new SlotStateError(`The slot is ${s.status}, not voicing.`);
  const { ownVoicePlan } = await import("./render-jobs");
  const { missingModelMessage } = await import("./renderWorker");
  const plan = await ownVoicePlan(s.episode_id);
  if (plan.missing.length) throw new Error(missingModelMessage(plan.missing));
  // the schedule's visual style goes through to the render (also for older drafts made as 2D Vertical Comic)
  const [rule] = await db()<ScheduleRow[]>`SELECT * FROM content_schedules WHERE id = ${s.schedule_id}`;
  const style = normalizeRule(rule ?? DEFAULT_RULE).visual_style;
  await db()`UPDATE content_projects SET video_style = ${style}, updated_at = now() WHERE id = ${s.episode_id}`;
  // drafts scripted with an earlier scheduler direction get the current one (BGM, natural pacing); only the
  // scheduler's own direction (it starts with the outro line), never one a person wrote
  await db()`UPDATE scripts SET direction = ${showDirection(style)} WHERE project_id = ${s.episode_id} AND custom AND (direction IS NULL OR direction LIKE ${LEGACY_SHOW_DIRECTION + "%"})`;
  const [job] = await db()<
    { id: string }[]
  >`INSERT INTO render_jobs (project_id) VALUES (${s.episode_id}) RETURNING id`;
  await db()`UPDATE episode_queue SET render_job_id = ${job.id}, updated_at = now() WHERE id = ${id}`;
  await move(id, "voicing", "rendering");
  return {
    episodeId: s.episode_id,
    jobId: job.id,
    voice: plan.convert.length ? "rvc" : "none",
  };
}

// ------------------------------------------------------------------ step 4: distribution
/**
 * The video is uploaded: queue YouTube / Instagram / Facebook (whichever the schedule targets and has connected) at the
 * slot time, and keep the TikTok hand-off (caption + download on the Schedule page). → ready_to_post (or published).
 */
export async function finishSlot(
  id: string,
): Promise<{ status: QueueStatus; handoff: Handoff }> {
  const s = await slot(id);
  if (s.status !== "rendering" || !s.episode_id)
    throw new SlotStateError(`The slot is ${s.status}, not rendering.`);
  const sql = db();
  const [video] = await sql<{ id: string }[]>`
    SELECT id FROM episode_videos WHERE project_id = ${s.episode_id} AND created_at >= ${s.started_at ?? new Date(0)} ORDER BY created_at DESC LIMIT 1`;
  if (!video)
    throw new Error(
      "The render finished but no video arrived. Retry the slot.",
    );
  if (s.render_job_id)
    await sql`UPDATE render_jobs SET status = 'done', progress = 100, stage = NULL, updated_at = now() WHERE id = ${s.render_job_id} AND status NOT IN ('done', 'failed')`;
  const [rule] = await sql<
    ScheduleRow[]
  >`SELECT * FROM content_schedules WHERE id = ${s.schedule_id}`;
  const targets = normalizeRule(rule ?? DEFAULT_RULE).target_platforms;
  const wanted = AUTO_TARGETS.filter((t) => targets.includes(t));
  const connected = await sql<{ platform: string }[]>`
    SELECT DISTINCT platform FROM social_accounts WHERE user_id = ${s.user_id} AND is_active AND external_account_id NOT LIKE 'demo-%'`;
  const have = new Set(connected.map((c) => c.platform));
  const postAt = new Date(Math.max(Date.now(), s.scheduled_for.getTime()));
  const { queuePublish, drain } = await import("./publish/engine");
  const queued = wanted.some((t) => have.has(t))
    ? await queuePublish({
        userId: s.user_id,
        projectId: s.episode_id,
        at: postAt.getTime() > Date.now() + 60_000 ? postAt : null,
      })
    : [];
  const [proj] = await sql<
    {
      platform_captions: {
        tiktok: { caption: string; hashtags: string[] };
      } | null;
    }[]
  >`SELECT platform_captions FROM content_projects WHERE id = ${s.episode_id}`;
  const { defaultText } = await import("./publish/captions");
  const tiktokText =
    targets.includes("tiktok_drafts") && proj?.platform_captions
      ? handoffCaption(
          defaultText("tiktok", proj.platform_captions as never).text,
          asFormat(s.format),
        )
      : null;
  const handoff: Handoff = {
    tiktokCaption: tiktokText,
    queued,
    postAt: postAt.toISOString(),
    notConnected: wanted.filter((t) => !have.has(t)),
    ...(s.handoff?.props ? { props: s.handoff.props, propWarning: s.handoff.propWarning ?? null } : {}),
  };
  await sql`UPDATE episode_queue SET handoff = ${sql.json(handoff as never)}, updated_at = now() WHERE id = ${id}`;
  const next = statusAfterPublishing({
    targets,
    queued,
    published: [],
    failed: [],
  });
  await move(id, "rendering", next);
  await db()`UPDATE episode_queue SET progress_stage = 'done', progress_percent = 100, progress_detail = ${next === "published" ? "Published" : "Ready to post"}, progress_updated_at = now() WHERE id = ${id}`;
  if (queued.length && postAt.getTime() <= Date.now() + 60_000) {
    const { after } = await import("next/server");
    after(() => drain().catch(() => {}));
  }
  return { status: next, handoff };
}

/** The worker failed somewhere: the slot (and an open render job) become failed with the reason. */
export async function failSlot(
  id: string,
  error: string,
  runUrl?: string | null,
) {
  const s = await slot(id);
  if (s.status === "published" || s.status === "failed") return;
  if (s.render_job_id)
    await db()`UPDATE render_jobs SET status = 'failed', error = ${error.slice(0, 500)}, updated_at = now() WHERE id = ${s.render_job_id} AND status NOT IN ('done', 'failed')`;
  await move(id, s.status, "failed", { error, runUrl });
}

/** "Run slot now": starts the scheduler workflow for one slot (GITHUB_DISPATCH_TOKEN, the same token as Render video). */
export async function dispatchSlot(userId: string, id: string) {
  const s = await slot(id);
  if (s.user_id !== userId) throw new Error("Unknown slot.");
  if (s.status !== "queued")
    throw new Error(
      s.status === "failed"
        ? "Retry the slot first."
        : "That slot is already running or done.",
    );
  const token = process.env.GITHUB_DISPATCH_TOKEN?.trim();
  if (!token) throw new Error("GITHUB_DISPATCH_TOKEN isn't set in Vercel yet.");
  // the card shows its "Starting GitHub worker..." bar (and the page starts polling) from this click, before GitHub
  // answers; if GitHub refuses, the bar is cleared again and the reason is shown
  await db()`UPDATE episode_queue SET progress_percent = NULL, progress_stage = 'starting', progress_detail = 'Starting GitHub worker...', progress_updated_at = now() WHERE id = ${id} AND status = 'queued'`;
  const repo = process.env.GITHUB_REPO?.trim() || "workwithyosua-coder/contentmaker";
  const api = process.env.GITHUB_API_BASE?.trim() || "https://api.github.com"; // override only for tests
  const res = await fetch(`${api}/repos/${repo}/actions/workflows/autonomous-scheduler.yml/dispatches`, {
    method: "POST",
    headers: { Authorization: `Bearer ${token}`, Accept: "application/vnd.github+json", "X-GitHub-Api-Version": "2022-11-28" },
    body: JSON.stringify({ ref: "main", inputs: { slot_id: id } }),
  }).catch((e: Error) => ({ ok: false, status: 0, statusText: e.message }) as Response);
  if (!res.ok) {
    await db()`UPDATE episode_queue SET progress_percent = NULL, progress_stage = NULL, progress_detail = NULL, progress_updated_at = NULL WHERE id = ${id} AND status = 'queued' AND progress_stage = 'starting'`;
    throw new Error(
      res.status === 401 || res.status === 403 || res.status === 404
        ? "GitHub rejected the token. Check GITHUB_DISPATCH_TOKEN (Actions: read and write)."
        : `GitHub refused to start the run (${res.status || res.statusText}).`,
    );
  }
}

/**
 * A progress report from the worker (validated by normalizeProgress). Applied only while the slot is being made (or
 * starting): a late report never moves a finished or failed slot, so a failed card keeps the point where it stopped.
 */
export async function setProgress(id: string, u: ProgressUpdate): Promise<{ applied: boolean }> {
  const r = await db()`
    UPDATE episode_queue SET progress_stage = ${u.stage}, progress_percent = ${u.percent}, progress_detail = COALESCE(${u.detail}, progress_detail),
      progress_updated_at = now(), updated_at = now()
    WHERE id = ${id} AND (status IN ('scripting', 'voicing', 'rendering') OR (status = 'queued' AND progress_stage = 'starting'))`;
  return { applied: r.count > 0 };
}

// ------------------------------------------------------------------ Reusable Prop Bank
/** Default keywords for the repo's illustrated props: the labels of their parts. */
function repoKeywords(name: string): string[] {
  const p = PNG_PROPS.find((x) => x.name === name);
  return p ? [...new Set(p.parts.map((x) => x.label.toLowerCase()))] : [];
}

/** Every existing prop (repo PNGs and uploads) with its bank tags; a prop without a bank row is vetted with defaults. */
export async function propBank(
  userId: string,
): Promise<
  (BankProp & { source: "repo" | "upload"; file: string; saved: boolean })[]
> {
  const { listAttachedAssets } = await import("./attached-assets");
  const files = (
    await listAttachedAssets().catch(() => ({ props: [] as string[] }))
  ).props;
  const uploads = files.map((f) => f.replace(/\.(png|webp)$/, ""));
  const repo = (manifest.props as string[])
    .filter((f) => f.endsWith(".png"))
    .map((f) => f.replace(/\.png$/, ""));
  const rows = await db()<
    {
      name: string;
      keywords: string[];
      category: string | null;
      vetted: boolean;
    }[]
  >`
    SELECT name, keywords, category, vetted FROM prop_bank WHERE user_id = ${userId}`.catch(
    () => [],
  );
  const names = [...new Set([...repo, ...uploads])].sort();
  return names.map((name) => {
    const r = rows.find((x) => x.name === name);
    return {
      name,
      keywords: r?.keywords ?? repoKeywords(name),
      category: r?.category ?? null,
      vetted: r?.vetted ?? true,
      available: true,
      source: uploads.includes(name) ? ("upload" as const) : ("repo" as const),
      file:
        files.find((f) => f.replace(/\.(png|webp)$/, "") === name) ??
        `${name}.png`,
      saved: Boolean(r),
    };
  });
}

export async function savePropTags(
  userId: string,
  name: string,
  keywords: string[],
  vetted: boolean,
  category: string | null,
) {
  await db()`
    INSERT INTO prop_bank (user_id, name, keywords, category, vetted) VALUES (${userId}, ${name}, ${keywords}, ${category}, ${vetted})
    ON CONFLICT (user_id, name) DO UPDATE SET keywords = EXCLUDED.keywords, category = EXCLUDED.category, vetted = EXCLUDED.vetted, updated_at = now()`;
}
