"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";
import { ASSET_MAX_BYTES, ASSET_TYPES, assetPath, isAssetName, isAttachedAssetPath, type AssetKind } from "@/lib/attached-assets";
import { parseCustomScript, spokenSeconds } from "@/lib/custom-script";
import { db } from "@/lib/db";
import { getOwner } from "@/lib/queries";
import { CAMERA_SHOTS, EMOTIONS, OVERLAYS } from "../../../video/src/beats";
import { styleById } from "../../../video/src/styles/registry";
import type { StepResult } from "./actions";

// No-AI script studio: every action here is plain code and SQL. Nothing imports the writers' room or any AI SDK, so
// creating, editing and rendering a custom episode never uses the Anthropic API.

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

const lengthOf = (lines: { text: string; start_s: number | null; end_s: number | null }[]) =>
  Math.round(lines.reduce((s, l) => s + (l.start_s !== null && l.end_s !== null ? l.end_s - l.start_s : spokenSeconds(l.text)), 0));

/** New episode from the user's own topic, script and direction notes, parsed by rules (no AI). */
export async function createCustomEpisodeAction(_prev: StepResult, form: FormData): Promise<StepResult> {
  const topic = String(form.get("topic") ?? "").trim();
  const script = String(form.get("script") ?? "");
  const direction = String(form.get("direction") ?? "").slice(0, 4000);
  const style = String(form.get("style") ?? "");
  if (topic.length < 3) return { ok: false, message: "Give the episode a topic or title." };
  if (script.length > 30000) return { ok: false, message: "That script is over 30,000 characters. Paste one episode at a time." };
  const parsed = parseCustomScript({ topic, script, direction });
  if (!parsed.lines.length) return { ok: false, message: parsed.warnings[0] ?? "No lines found." };
  if (!CUE_STYLES.has(style)) return { ok: false, message: "Pick Koran Kinetik or Diagram Taktis." };
  let projectId: string;
  try {
    const o = await account();
    const sql = db();
    const [d] = await sql<{ id: string }[]>`
      INSERT INTO content_directions (user_id, title, prompt, platforms, formats)
      VALUES (${o.id}, ${parsed.title.slice(0, 80)}, ${topic}, ${ALL_PLATFORMS}::platform_t[], '{short_video}')
      RETURNING id`;
    const [p] = await sql<{ id: string }[]>`
      INSERT INTO content_projects (user_id, direction_id, title, format, target_platforms, status, video_style)
      VALUES (${o.id}, ${d.id}, ${parsed.title.slice(0, 80)}, 'short_video', ${ALL_PLATFORMS}::platform_t[], 'awaiting_recording', ${styleById(style).id})
      RETURNING id`;
    await sql`
      INSERT INTO scripts (project_id, version, title, target_duration_s, lines, sources, feedback, direction, custom)
      VALUES (${p.id}, 1, ${parsed.title}, ${lengthOf(parsed.lines)}, ${sql.json(parsed.lines as never)}, '[]',
              ${"Written by hand in the script studio (no AI)."}, ${direction || null}, true)`;
    projectId = p.id;
  } catch (err) {
    return { ok: false, message: message(err) };
  }
  revalidatePath("/create");
  redirect(`/create/${projectId}`);
}

/** A new pasted version of a custom script (takes recorded for the old version stay with it). */
export async function replaceCustomScriptAction(projectId: string, _prev: StepResult, form: FormData): Promise<StepResult> {
  try {
    const o = await account();
    await ownProject(o.id, projectId);
    const script = String(form.get("script") ?? "");
    const direction = String(form.get("direction") ?? "").slice(0, 4000);
    const sql = db();
    const [cur] = await sql<{ title: string }[]>`SELECT title FROM scripts WHERE project_id = ${projectId} ORDER BY version DESC LIMIT 1`;
    const parsed = parseCustomScript({ topic: cur?.title ?? "", script, direction });
    if (!parsed.lines.length) return { ok: false, message: parsed.warnings[0] ?? "No lines found." };
    const [{ v }] = await sql<{ v: number }[]>`SELECT COALESCE(max(version), 0) + 1 AS v FROM scripts WHERE project_id = ${projectId}`;
    await sql`
      INSERT INTO scripts (project_id, version, title, target_duration_s, lines, sources, feedback, direction, custom)
      VALUES (${projectId}, ${v}, ${parsed.title}, ${lengthOf(parsed.lines)}, ${sql.json(parsed.lines as never)}, '[]',
              ${"Pasted again in the script studio (no AI)."}, ${direction || null}, true)`;
    await sql`UPDATE content_projects SET status = 'awaiting_recording', updated_at = now() WHERE id = ${projectId}`;
    revalidatePath(`/create/${projectId}`);
    const warn = parsed.warnings.length ? ` ${parsed.warnings.length} note${parsed.warnings.length > 1 ? "s" : ""} below.` : "";
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

const slug = z
  .string()
  .trim()
  .toLowerCase()
  .regex(/^[a-z0-9]+(-[a-z0-9]+)*$/, "use lowercase-with-dashes names");
const seconds = z.number().min(0).max(600).nullable();
const BeatEdit = z.object({
  index: z.number().int().min(0),
  speaker: z.enum(["uco", "ocu"]),
  text: z.string().trim().min(1, "a line's Indonesian text can't be empty").max(600),
  subtitle: z.string().trim().max(600),
  thought_bubble: z.boolean(),
  start_s: seconds,
  end_s: seconds,
  emotion: z.enum(EMOTIONS.filter((e) => e !== "cta") as [string, ...string[]]).nullable(),
  camera_shot: z.enum(CAMERA_SHOTS.filter((c) => c !== "cta-stinger") as [string, ...string[]]).nullable(),
  prop_tag: z.union([slug, z.literal("none")]).nullable(),
  overlay: z.enum([...OVERLAYS, "none"] as [string, ...string[]]).nullable(),
  callouts: z.array(slug).max(3).nullable(),
  sfx: z.array(slug).max(4),
});

/** Beat Inspector: saves edited lines in place (same version, so recorded takes stay attached). */
export async function saveBeatsAction(projectId: string, scriptId: string, payload: string): Promise<StepResult> {
  try {
    const o = await account();
    await ownProject(o.id, projectId);
    let edits: z.infer<typeof BeatEdit>[];
    try {
      edits = z.array(BeatEdit).max(80).parse(JSON.parse(payload));
    } catch (e) {
      const issue = e instanceof z.ZodError ? e.issues[0] : null;
      return { ok: false, message: issue ? `Line ${Number(issue.path[0]) + 1}, ${String(issue.path[1] ?? "")}: ${issue.message}` : "Couldn't read the beat table." };
    }
    const sql = db();
    const [row] = await sql<{ lines: Record<string, unknown>[] }[]>`SELECT lines FROM scripts WHERE id = ${scriptId} AND project_id = ${projectId}`;
    if (!row) return { ok: false, message: "That script version is gone. Reload the page." };
    if (edits.length !== row.lines.length) return { ok: false, message: "The script changed since you opened it. Reload the page." };
    for (const e of edits) {
      if (e.start_s !== null && e.end_s !== null && e.end_s <= e.start_s) return { ok: false, message: `Line ${e.index + 1}: the end time must be after the start.` };
    }
    const lines = row.lines.map((l, i) => {
      const e = edits.find((x) => x.index === i);
      if (!e) return l;
      const { index: _i, ...patch } = e;
      void _i;
      return { ...l, ...patch };
    });
    const total = lengthOf(lines as { text: string; start_s: number | null; end_s: number | null }[]);
    await sql`UPDATE scripts SET lines = ${sql.json(lines as never)}, target_duration_s = ${total} WHERE id = ${scriptId}`;
    revalidatePath(`/create/${projectId}`);
    return { ok: true, message: "Beats saved." };
  } catch (err) {
    return { ok: false, message: message(err) };
  }
}

/** Attach a missing prop or SFX, step 1: a one-time upload URL for assets/{props|sfx}/{name}.{ext}. */
export async function startAssetUploadAction(
  projectId: string,
  kind: AssetKind,
  name: string,
  type: string,
  size: number,
): Promise<{ ok: true; url: string; path: string } | { ok: false; message: string }> {
  try {
    const o = await account();
    await ownProject(o.id, projectId);
    if (kind !== "props" && kind !== "sfx") return { ok: false, message: "Unknown asset type." };
    if (!isAssetName(name)) return { ok: false, message: "Asset names are lowercase words joined by dashes." };
    const ext = ASSET_TYPES[kind][type];
    if (!ext) return { ok: false, message: kind === "props" ? "Props must be PNG images (transparent background)." : "Sound effects must be MP3 or WAV." };
    if (size <= 0 || size > ASSET_MAX_BYTES) return { ok: false, message: "Files can be up to 8 MB." };
    const path = assetPath(kind, name, ext);
    const { signedUploadUrl } = await import("@/lib/storage");
    return { ok: true, url: await signedUploadUrl(path), path };
  } catch (err) {
    return { ok: false, message: message(err) };
  }
}

/** Attach, step 2: check the file arrived (and is what it says), then refresh the checklist. */
export async function finishAssetUploadAction(projectId: string, path: string): Promise<StepResult> {
  try {
    const o = await account();
    await ownProject(o.id, projectId);
    if (!isAttachedAssetPath(path)) return { ok: false, message: "Unknown upload." };
    const { deleteObjects, getObject } = await import("@/lib/storage");
    const data = await getObject(path);
    if (!data || !data.byteLength) return { ok: false, message: "The upload didn't arrive. Try again." };
    const head = new Uint8Array(data.slice(0, 12));
    const ascii = (a: number, b: number) => String.fromCharCode(...head.slice(a, b));
    const ok = path.endsWith(".png")
      ? head[0] === 0x89 && ascii(1, 4) === "PNG"
      : path.endsWith(".wav")
        ? ascii(0, 4) === "RIFF" && ascii(8, 12) === "WAVE"
        : ascii(0, 3) === "ID3" || (head[0] === 0xff && (head[1] & 0xe0) === 0xe0);
    if (!ok) {
      await deleteObjects([path]);
      return { ok: false, message: "That file isn't a real PNG / MP3 / WAV. Export it again and retry." };
    }
    revalidatePath(`/create/${projectId}`);
    return { ok: true, message: `Attached ${path.replace(/^assets\//, "")}.` };
  } catch (err) {
    return { ok: false, message: message(err) };
  }
}
