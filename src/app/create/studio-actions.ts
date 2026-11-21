"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";
import { headers } from "next/headers";
import { ASSET_BUCKET, ASSET_MAX_BYTES, ASSET_TYPES, assetPath, ensureAssetBucket, isAssetName, isAttachedAssetPath, type AssetKind } from "@/lib/attached-assets";
import { db } from "@/lib/db";
import { POSES, parseManualScript, spokenSeconds } from "@/lib/manualScriptParser";
import { BEATS, EXPRESSIONS } from "@/lib/script-parse";
import { saveCaptions } from "@/lib/publish/approval";
import { hookLine, manualCaptions } from "@/lib/publish/manualCaptions";
import { getOwner } from "@/lib/queries";
import { CAMERA_SHOTS, OVERLAYS, wantedPropImage } from "../../../video/src/beats";
import { styleById } from "../../../video/src/styles/registry";
import type { StepResult } from "./actions";

// Manual / Exact Import (zero AI): every action here is plain code and SQL. Nothing imports the writers' room, the
// Claude client or any AI SDK, so parsing, saving, asset uploads and rendering a manual episode never call an LLM.

const ALL_PLATFORMS = ["tiktok", "instagram", "youtube", "facebook"];
const CUE_STYLES = new Set(["editorial-paper-cutout", "tactical-vector-hud"]);
const message = (err: unknown) => (err instanceof Error ? err.message : String(err));

async function account() {
  const o = await getOwner();
  if (!o) throw new Error("No user found.");
  return o;
}

async function ownProject(userId: string, projectId: string) {
  const [p] = await db()<{ id: string }[]>`SELECT id FROM content_projects WHERE id = ${projectId} AND user_id = ${userId}`;
  if (!p) throw new Error("Episode not found.");
}

const lengthOf = (lines: { text: string; start_s?: number | null; end_s?: number | null }[]) =>
  Math.round(lines.reduce((s, l) => s + (l.start_s != null && l.end_s != null ? l.end_s - l.start_s : spokenSeconds(l.text)), 0));

// ------------------------------------------------------------------ the beat table's line shape (validated)
const slug = z
  .string()
  .trim()
  .toLowerCase()
  .regex(/^[a-z0-9]+(-[a-z0-9]+)*$/, "use lowercase-with-dashes names");
const seconds = z.number().min(0).max(600).nullable();
const assetUrl = z.string().max(500).regex(/^(https:\/\/|http:\/\/localhost[:/]|\/api\/media\/)/, "asset links must be https");
const BeatLine = z
  .object({
    speaker: z.enum(["uco", "ocu"]),
    text: z.string().min(1, "a line's Indonesian text can't be empty").max(600),
    subtitle: z.string().max(600),
    thought_bubble: z.boolean(),
    start_s: seconds,
    end_s: seconds,
    emotion: z.string().nullable(),
    camera_shot: z.enum(CAMERA_SHOTS.filter((c) => c !== "cta-stinger") as [string, ...string[]]).nullable(),
    prop_tag: z.union([slug, z.literal("none")]).nullable(),
    overlay: z.enum([...OVERLAYS, "none"] as [string, ...string[]]).nullable(),
    callouts: z.array(slug).max(3).nullable(),
    sfx: z.array(slug).max(4),
    kinetic_text: z.string().trim().max(48).nullable(),
    // Evidence Takeover (optional: older lines and the AI path have neither)
    layout: z.enum(["standard", "takeover"]).nullable().optional(),
    stat: z.string().trim().max(90).nullable().optional(),
    // carried over from the parser as they are
    beat: z.enum(BEATS),
    expression: z.enum(EXPRESSIONS),
    visual: z.string().max(1000),
    on_screen_text: z.string().max(200).nullable(),
    delivery: z.string().max(400).nullable(),
    important_message: z.object({ kicker: z.string(), headline: z.string(), stamp: z.string().nullable() }).nullable(),
    // public URLs of uploaded custom props / SFX this line uses (https, or the local driver's /api/media in dev)
    asset_urls: z
      .object({ props: z.record(z.string(), assetUrl).optional(), sfx: z.record(z.string(), assetUrl).optional() })
      .nullable()
      .optional(),
  })
  .superRefine((l, ctx) => {
    if (l.emotion && !POSES[l.speaker].includes(l.emotion)) ctx.addIssue({ code: "custom", path: ["emotion"], message: `${l.speaker === "uco" ? "Uco" : "Ocu"} has no "${l.emotion}" pose` });
    if (l.start_s !== null && l.end_s !== null && l.end_s <= l.start_s) ctx.addIssue({ code: "custom", path: ["end_s"], message: "the end time must be after the start" });
  });
export type BeatLineInput = z.infer<typeof BeatLine>;

function readLines(payload: string): { ok: true; lines: BeatLineInput[] } | { ok: false; message: string } {
  try {
    const lines = z.array(BeatLine).min(1, "add at least one line").max(80).parse(JSON.parse(payload));
    // text is saved exactly as typed (no trimming inside, no rewriting)
    return { ok: true, lines };
  } catch (e) {
    const issue = e instanceof z.ZodError ? e.issues[0] : null;
    if (!issue) return { ok: false, message: "Couldn't read the beat table." };
    const [row, field] = issue.path;
    return { ok: false, message: typeof row === "number" ? `Line ${row + 1}${field ? `, ${String(field)}` : ""}: ${issue.message}` : issue.message };
  }
}

/** Manual / Exact Import: creates the episode from the parsed-and-edited beat table (no AI, text saved verbatim). */
export async function createManualEpisodeAction(topic: string, style: string, direction: string, payload: string): Promise<StepResult> {
  const t = topic.trim();
  if (t.length < 3) return { ok: false, message: "Give the episode a topic or title." };
  if (!CUE_STYLES.has(style)) return { ok: false, message: "Pick Koran Kinetik or Diagram Taktis." };
  const read = readLines(payload);
  if (!read.ok) return read;
  let projectId: string;
  try {
    const o = await account();
    const sql = db();
    const dir = direction.slice(0, 4000).trim();
    const [d] = await sql<{ id: string }[]>`
      INSERT INTO content_directions (user_id, title, prompt, platforms, formats)
      VALUES (${o.id}, ${t.slice(0, 80)}, ${t}, ${ALL_PLATFORMS}::platform_t[], '{short_video}')
      RETURNING id`;
    const [p] = await sql<{ id: string }[]>`
      INSERT INTO content_projects (user_id, direction_id, title, format, target_platforms, status, video_style)
      VALUES (${o.id}, ${d.id}, ${t.slice(0, 80)}, 'short_video', ${ALL_PLATFORMS}::platform_t[], 'awaiting_recording', ${styleById(style).id})
      RETURNING id`;
    // the user wrote this script, so it starts approved, with editable default captions for every platform (no AI)
    await sql`
      INSERT INTO scripts (project_id, version, title, target_duration_s, lines, sources, feedback, direction, custom, approved_at)
      VALUES (${p.id}, 1, ${t.slice(0, 120)}, ${lengthOf(read.lines)}, ${sql.json(read.lines as never)}, '[]',
              ${"Manual / Exact Import (no AI)."}, ${dir || null}, true, now())`;
    await saveCaptions(p.id, manualCaptions({ title: t, hook: hookLine(read.lines) }));
    projectId = p.id;
  } catch (err) {
    return { ok: false, message: message(err) };
  }
  revalidatePath("/create");
  redirect(`/create/${projectId}`);
}

/** A new pasted version of a manual script (takes recorded for the old version stay with it). */
export async function replaceCustomScriptAction(projectId: string, _prev: StepResult, form: FormData): Promise<StepResult> {
  try {
    const o = await account();
    await ownProject(o.id, projectId);
    const script = String(form.get("script") ?? "");
    const direction = String(form.get("direction") ?? "").slice(0, 4000);
    if (script.length > 30000) return { ok: false, message: "That script is over 30,000 characters. Paste one episode at a time." };
    const sql = db();
    const [cur] = await sql<{ title: string }[]>`SELECT title FROM scripts WHERE project_id = ${projectId} ORDER BY version DESC LIMIT 1`;
    const parsed = parseManualScript({ topic: cur?.title ?? "", script, direction });
    if (!parsed.lines.length) return { ok: false, message: parsed.warnings[0] ?? "No lines found." };
    const dir = [parsed.directionText].filter(Boolean).join("\n");
    const [{ v }] = await sql<{ v: number }[]>`SELECT COALESCE(max(version), 0) + 1 AS v FROM scripts WHERE project_id = ${projectId}`;
    await sql`
      INSERT INTO scripts (project_id, version, title, target_duration_s, lines, sources, feedback, direction, custom, approved_at)
      VALUES (${projectId}, ${v}, ${parsed.title}, ${lengthOf(parsed.lines)}, ${sql.json(parsed.lines as never)}, '[]',
              ${"Pasted again (Manual / Exact Import, no AI)."}, ${dir || null}, true, now())`;
    // captions the user already has (edited or AI-written) stay; an episode without any gets editable defaults
    const [{ has }] = await sql<{ has: boolean }[]>`SELECT platform_captions IS NOT NULL AS has FROM content_projects WHERE id = ${projectId}`;
    if (!has) await saveCaptions(projectId, manualCaptions({ title: parsed.title, hook: hookLine(parsed.lines) }));
    await sql`UPDATE content_projects SET status = 'awaiting_recording', updated_at = now() WHERE id = ${projectId}`;
    revalidatePath(`/create/${projectId}`);
    const warn = parsed.warnings.length ? ` ${parsed.warnings.length} note${parsed.warnings.length > 1 ? "s" : ""}: ${parsed.warnings[0]}` : "";
    return { ok: true, message: `Saved as version ${v}: ${parsed.lines.length} lines.${warn}` };
  } catch (err) {
    return { ok: false, message: message(err) };
  }
}

/** Direction / pacing notes for the current script version (parsed at render time). */
export async function saveDirectionAction(projectId: string, scriptId: string, _prev: StepResult, form: FormData): Promise<StepResult> {
  try {
    const o = await account();
    await ownProject(o.id, projectId);
    const direction = String(form.get("direction") ?? "").slice(0, 4000).trim();
    await db()`UPDATE scripts SET direction = ${direction || null} WHERE id = ${scriptId} AND project_id = ${projectId}`;
    revalidatePath(`/create/${projectId}`);
    return { ok: true, message: "Direction saved." };
  } catch (err) {
    return { ok: false, message: message(err) };
  }
}

/** Beat table on the episode page: saves the edited lines in place (same version, so recorded takes stay). */
export async function saveBeatsAction(projectId: string, scriptId: string, payload: string): Promise<StepResult> {
  try {
    const o = await account();
    await ownProject(o.id, projectId);
    const read = readLines(payload);
    if (!read.ok) return read;
    const sql = db();
    const [row] = await sql<{ lines: Record<string, unknown>[] }[]>`SELECT lines FROM scripts WHERE id = ${scriptId} AND project_id = ${projectId}`;
    if (!row) return { ok: false, message: "That script version is gone. Reload the page." };
    if (read.lines.length !== row.lines.length) return { ok: false, message: "The script changed since you opened it. Reload the page." };
    const lines = row.lines.map((l, i) => ({ ...l, ...read.lines[i] }));
    await sql`UPDATE scripts SET lines = ${sql.json(lines as never)}, target_duration_s = ${lengthOf(read.lines)} WHERE id = ${scriptId}`;
    revalidatePath(`/create/${projectId}`);
    return { ok: true, message: "Beats saved." };
  } catch (err) {
    return { ok: false, message: message(err) };
  }
}

/**
 * Asset readiness "Skip": render without a missing prop or sound. Props: the lines that ask for it get no prop;
 * SFX: the name is dropped from those lines; bgm: the music bed is turned off in the direction notes.
 */
export async function skipAssetAction(projectId: string, kind: AssetKind, name: string): Promise<StepResult> {
  try {
    const o = await account();
    await ownProject(o.id, projectId);
    if (!isAssetName(name)) return { ok: false, message: "Unknown asset." };
    const sql = db();
    const [s] = await sql<{ id: string; lines: Record<string, unknown>[]; direction: string | null }[]>`
      SELECT id, lines, direction FROM scripts WHERE project_id = ${projectId} ORDER BY version DESC LIMIT 1`;
    if (!s) return { ok: false, message: "No script yet." };
    if (kind === "sfx" && name === "bgm") {
      await sql`UPDATE scripts SET direction = ${`${s.direction ?? ""}\nBGM off`.trim()} WHERE id = ${s.id}`;
    } else {
      const lines = s.lines.map((l) => {
        if (kind === "sfx") return Array.isArray(l.sfx) ? { ...l, sfx: (l.sfx as string[]).filter((x) => x !== name) } : l;
        const want = wantedPropImage(l as never);
        return want?.name === name ? { ...l, prop_tag: "none" } : l;
      });
      await sql`UPDATE scripts SET lines = ${sql.json(lines as never)} WHERE id = ${s.id}`;
    }
    revalidatePath(`/create/${projectId}`);
    return { ok: true, message: `Skipped ${name}: the video renders without it.` };
  } catch (err) {
    return { ok: false, message: message(err) };
  }
}

/**
 * Upload a missing / custom prop or SFX, step 1: a one-time URL to PUT {props|sfx}/{name}.{ext} in the public
 * `custom-assets` bucket (created on first use). Works before an episode exists (the composer uploads before saving).
 */
export async function startAssetUploadAction(
  kind: AssetKind,
  name: string,
  type: string,
  size: number,
): Promise<{ ok: true; url: string; path: string } | { ok: false; message: string }> {
  try {
    await account();
    if (kind !== "props" && kind !== "sfx") return { ok: false, message: "Unknown asset type." };
    if (!isAssetName(name)) return { ok: false, message: "Asset names are lowercase words joined by dashes." };
    const ext = ASSET_TYPES[kind][type];
    // props are converted to PNG in the browser (any image the user picks); audio keeps its own format
    if (!ext) return { ok: false, message: kind === "props" ? "That image couldn't be converted. Try another picture." : "Pick an MP3, WAV, M4A or OGG sound." };
    if (size <= 0 || size > ASSET_MAX_BYTES) return { ok: false, message: "Files can be up to 10 MB." };
    await ensureAssetBucket();
    const path = assetPath(kind, name, ext);
    const { deleteObjects, listObjects, signedUploadUrl } = await import("@/lib/storage");
    // one file per name: replacing a .png with a .webp (or .mp3 with .wav) removes the other
    const others = (await listObjects(kind, ASSET_BUCKET).catch(() => [])).filter((f) => f.replace(/\.[a-z0-9]+$/, "") === name && f !== `${name}.${ext}`);
    if (others.length) await deleteObjects(others.map((f) => `${kind}/${f}`), ASSET_BUCKET);
    return { ok: true, url: await signedUploadUrl(path, ASSET_BUCKET, true), path };
  } catch (err) {
    return { ok: false, message: message(err) };
  }
}

/** Upload, step 2: check the file arrived and is what it says (by its first bytes); returns its public URL. */
export async function finishAssetUploadAction(path: string): Promise<{ ok: true; message: string; url: string } | { ok: false; message: string }> {
  try {
    await account();
    if (!isAttachedAssetPath(path)) return { ok: false, message: "Unknown upload." };
    const { deleteObjects, getObject, publicObjectUrl } = await import("@/lib/storage");
    const data = await getObject(path, ASSET_BUCKET);
    if (!data || !data.byteLength) return { ok: false, message: "The upload didn't arrive. Try again." };
    const head = new Uint8Array(data.slice(0, 12));
    const ascii = (a: number, b: number) => String.fromCharCode(...head.slice(a, b));
    const ok = path.endsWith(".png")
      ? head[0] === 0x89 && ascii(1, 4) === "PNG"
      : path.endsWith(".webp")
        ? ascii(0, 4) === "RIFF" && ascii(8, 12) === "WEBP"
        : path.endsWith(".wav")
          ? ascii(0, 4) === "RIFF" && ascii(8, 12) === "WAVE"
          : path.endsWith(".m4a")
            ? ascii(4, 8) === "ftyp"
            : path.endsWith(".ogg")
              ? ascii(0, 4) === "OggS"
              : ascii(0, 3) === "ID3" || (head[0] === 0xff && (head[1] & 0xe0) === 0xe0);
    if (!ok) {
      await deleteObjects([path], ASSET_BUCKET);
      return { ok: false, message: "That file isn't a readable image or sound. Try another file." };
    }
    const h = await headers();
    const origin = `${h.get("x-forwarded-proto") ?? "https"}://${h.get("x-forwarded-host") ?? h.get("host")}`;
    revalidatePath("/create", "layout");
    return { ok: true, message: `Uploaded ${path}.`, url: publicObjectUrl(path, ASSET_BUCKET, origin) };
  } catch (err) {
    return { ok: false, message: message(err) };
  }
}
