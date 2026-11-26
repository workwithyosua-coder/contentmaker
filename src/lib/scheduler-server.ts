import "server-only";
import manifest from "../../video/src/assets/assetManifest.json";
import { PNG_PROPS } from "../../video/src/props/library";
import { db } from "./db";
import { parseSeeds } from "./gemini-core";
import { geminiJson, geminiText } from "./gemini-text";
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
  propMenu,
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
};
export type Handoff = {
  tiktokCaption: string | null;
  queued: string[];
  postAt: string;
  notConnected: string[];
};

/** A step called on a slot in another state (a late or duplicate worker call): refused, the slot is left alone. */
export class SlotStateError extends Error {
  name = "SlotStateError";
}

const SLOT_COLS =
  "q.id, q.schedule_id, q.scheduled_for, q.slot_index, q.format, q.topic_seed, q.topic_source, q.status, q.episode_id, q.render_job_id, q.error_message, q.run_url, q.handoff, q.attempts, q.updated_at";

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
  if (video && s.handoff) {
    const { queuePublish, drain } = await import("./publish/engine");
    await queuePublish({ userId, projectId: s.episode_id!, onlyFailed: true });
    await move(id, "failed", "ready_to_post");
    const { after } = await import("next/server");
    after(() => drain().catch(() => {}));
    return "posting";
  }
  await db()`UPDATE episode_queue SET status = 'queued', error_message = NULL, updated_at = now() WHERE id = ${id} AND status = 'failed'`;
  return "queued";
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
      UPDATE episode_queue SET status = 'scripting', attempts = attempts + 1, started_at = now(), error_message = NULL,
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
        UPDATE episode_queue SET status = 'scripting', attempts = attempts + 1, started_at = now(), run_url = ${p.runUrl ?? null}, updated_at = now()
        WHERE id = ${q.id} AND status = 'queued' RETURNING id`;
      if (c) claimed.push(c.id);
    }
  }
  return { slots: claimed, notes };
}

// ------------------------------------------------------------------ step 1: the script (Gemini, constrained to the Prop Bank)
const S = (description: string) => ({ type: "STRING", description });
const SCRIPT_SCHEMA = {
  type: "OBJECT",
  properties: {
    title: S("Judul episode, bahasa Indonesia, maks 8 kata"),
    lines: {
      type: "ARRAY",
      items: {
        type: "OBJECT",
        properties: {
          beat: {
            type: "STRING",
            enum: [
              "hook",
              "counter",
              "escalation",
              "insight",
              "concession",
              "button",
            ],
          },
          speaker: { type: "STRING", enum: ["uco", "ocu"] },
          text: S(
            "Kalimat yang diucapkan, bahasa Indonesia santai Jakarta, 5-12 kata",
          ),
          subtitle: S("Natural English subtitle of the line"),
          emotion: {
            type: "STRING",
            enum: [
              "triumphant",
              "defensive",
              "shocked",
              "phone",
              "angry",
              "deadpan",
              "explaining",
              "inspecting",
            ],
          },
          camera_shot: {
            type: "STRING",
            enum: ["solo-uco", "solo-ocu", "closeup-punch", "two-shot"],
          },
          prop_tag: S("Nama prop PERSIS dari daftar Prop Bank, atau none"),
          layout: { type: "STRING", enum: ["standard", "takeover"] },
          stat: S(
            "Untuk layout takeover: 'HEADLINE | SUBLINE' (angka/fakta kunci), selain itu kosong",
          ),
          kicker: S("Label di atas headline, huruf besar, maks 2 kata"),
          headline: S("Inti kalimat, huruf besar, maks 5 kata"),
          stamp: S("Stempel merah maks 3 kata, atau kosong"),
          thought_bubble: { type: "BOOLEAN" },
          delivery: S("Cara mengucapkan (emosi, tempo)"),
        },
        required: [
          "beat",
          "speaker",
          "text",
          "subtitle",
          "emotion",
          "camera_shot",
          "prop_tag",
          "layout",
          "kicker",
          "headline",
          "thought_bubble",
        ],
      },
    },
  },
  required: ["title", "lines"],
};

function scriptPrompt(format: EpisodeFormat, seed: string, bank: BankProp[]) {
  return `Tulis naskah satu episode "Uco & Ocu" (video vertikal 30-60 detik) dalam format ${FORMATS[format].label}.
${FORMATS[format].brief}
Topik: ${seed}

Karakter: Uco (heboh, optimis, gampang ngegas; emosi: triumphant, defensive, shocked, phone, angry). Ocu (kalem, datar,
sinis, sudut pandang lain; emosi: deadpan, explaining, inspecting, angry).
Aturan:
- 8 sampai 14 baris, urutan beat: hook, counter, escalation (2-3 kali bolak-balik), insight, concession, button.
- Concession: masing-masing mengakui lawannya dalam hati (thought_bubble true), tidak diucapkan.
- Komedi dari benturan cara pandang dan fakta nyata, bukan hinaan. Tidak ada yang menang.
- Jangan pakai em dash. Jangan mengarang angka, kutipan, studi atau testimoni. Kalau tidak yakin faktanya, jangan pakai angka.
- Tanpa kata iklan (revolusioner, terbaik, pasti untung).
- prop_tag HANYA boleh nama dari Prop Bank di bawah, persis, atau none. Jangan pernah menamai prop baru.
- Untuk angka atau fakta kunci yang tidak punya prop: layout takeover dengan stat "HEADLINE | SUBLINE". Maksimal 2 baris takeover.
- camera_shot: solo-uco / solo-ocu untuk pembicara, closeup-punch untuk punchline, two-shot kalau keduanya bereaksi.
Prop Bank (nama: kata kunci):
${propMenu(bank)}`;
}

/** Step 1: Gemini writes the script; the episode is created with it (approved, default captions, the schedule's voice). */
export async function scriptSlot(
  id: string,
  runUrl?: string | null,
): Promise<{ episodeId: string; title: string; reused: boolean }> {
  const s = await slot(id);
  if (s.status !== "scripting")
    throw new SlotStateError(`The slot is ${s.status}, not scripting.`);
  const sql = db();
  if (runUrl)
    await sql`UPDATE episode_queue SET run_url = ${runUrl}, updated_at = now() WHERE id = ${id}`;
  // a retried slot whose episode already has a script: keep it (and its takes)
  if (s.episode_id) {
    const [has] = await sql<
      { title: string }[]
    >`SELECT title FROM scripts WHERE project_id = ${s.episode_id} ORDER BY version DESC LIMIT 1`;
    if (has) {
      await move(id, "scripting", "voicing");
      return { episodeId: s.episode_id, title: has.title, reused: true };
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
  const draft = await geminiJson<DraftScript>(
    scriptPrompt(format, seed, bank),
    SCRIPT_SCHEMA,
    { temperature: 0.8 },
  );
  const script = sanitizeScript(draft, bank, seed.slice(0, 80));
  const missing = missingProps(script.lines, bank);
  if (missing.length)
    throw new Error(
      `The script names props the bank doesn't have: ${missing.join(", ")}.`,
    ); // never happens: sanitizeScript resolves every tag
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
    INSERT INTO content_projects (user_id, direction_id, title, format, target_platforms, status, video_style, voice_provider, publish_settings)
    VALUES (${s.user_id}, ${d.id}, ${title.slice(0, 80)}, 'short_video', '{tiktok,instagram,youtube,facebook}'::platform_t[], 'awaiting_recording',
            ${FORMATS[format].style}, ${r.voice_provider}, ${sql.json(settings as never)}) RETURNING id`;
  const seconds = Math.max(
    20,
    Math.min(
      60,
      Math.round(
        script.lines.reduce((n, l) => n + l.text.split(/\s+/).length, 0) / 2.6,
      ),
    ),
  );
  await sql`
    INSERT INTO scripts (project_id, version, title, target_duration_s, lines, sources, feedback, direction, custom, approved_at)
    VALUES (${p.id}, 1, ${title}, ${seconds}, ${sql.json(script.lines as never)}, '[]',
            ${`Autonomous scheduler: ${FORMATS[format].label}, written by Gemini from the topic seed "${seed}".`}, null, true, now())`;
  await saveCaptions(
    p.id,
    manualCaptions({ title, hook: hookLine(script.lines) }),
  );
  await sql`UPDATE episode_queue SET episode_id = ${p.id}, updated_at = now() WHERE id = ${id}`;
  await move(id, "scripting", "voicing");
  return { episodeId: p.id, title, reused: false };
}

// ------------------------------------------------------------------ step 2: voices (a few lines per call)
/**
 * Step 2, voices. Own Voice slots never call Gemini TTS: the answer is engine "edge" and the worker makes every
 * missing base take with Edge TTS (then RVC converts them). Gemini TTS slots voice up to `max` lines with Gemini; on a
 * 429 / quota error the rest goes to the worker's Edge TTS instead of failing the slot. Lines that already have a
 * take are never voiced again.
 */
export async function voiceSlot(id: string, max = 6): Promise<{ voiced: number; remaining: number; engine: "gemini" | "edge"; note: string | null }> {
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
  await db()`UPDATE episode_queue SET updated_at = now() WHERE id = ${id}`;
  if (!todo.length) {
    await db()`UPDATE content_projects SET status = 'recorded', updated_at = now() WHERE id = ${s.episode_id}`;
    return { voiced: 0, remaining: 0, engine: schedulerVoiceEngine(v.provider), note: null };
  }
  if (schedulerVoiceEngine(v.provider) === "edge") {
    return { voiced: 0, remaining: todo.length, engine: "edge", note: `Own Voice: Edge TTS makes the ${todo.length} base take(s) in the worker, then RVC converts them.` };
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
      return { voiced, remaining: todo.length - voiced, engine: "edge", note };
    }
    if (bad) throw new Error(`Voicing line failed: ${bad.message}`);
  }
  const remaining = todo.length - voiced;
  if (!remaining) await db()`UPDATE content_projects SET status = 'recorded', updated_at = now() WHERE id = ${s.episode_id}`;
  return { voiced, remaining, engine: "gemini", note: null };
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
  };
  await sql`UPDATE episode_queue SET handoff = ${sql.json(handoff as never)}, updated_at = now() WHERE id = ${id}`;
  const next = statusAfterPublishing({
    targets,
    queued,
    published: [],
    failed: [],
  });
  await move(id, "rendering", next);
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
  const repo =
    process.env.GITHUB_REPO?.trim() || "workwithyosua-coder/contentmaker";
  const res = await fetch(
    `https://api.github.com/repos/${repo}/actions/workflows/autonomous-scheduler.yml/dispatches`,
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        Accept: "application/vnd.github+json",
        "X-GitHub-Api-Version": "2022-11-28",
      },
      body: JSON.stringify({ ref: "main", inputs: { slot_id: id } }),
    },
  );
  if (!res.ok)
    throw new Error(
      res.status === 401 || res.status === 403 || res.status === 404
        ? "GitHub rejected the token. Check GITHUB_DISPATCH_TOKEN (Actions: read and write)."
        : `GitHub refused to start the run (${res.status}).`,
    );
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
