"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { claudeConfigured } from "@/lib/agents/claude";
import { factCheck, generateIdeas, writeCaptions, writeScript, type ConceptOutline, type Script } from "@/lib/agents/writers-room";
import { db } from "@/lib/db";
import { getOwner } from "@/lib/queries";

export type StepResult = { ok: boolean; message: string } | null;
const ALL_PLATFORMS = ["tiktok", "instagram", "youtube", "facebook"];

async function owner() {
  const o = await getOwner();
  if (!o) throw new Error("No user found.");
  if (!claudeConfigured()) throw new Error("ANTHROPIC_API_KEY is not set in Vercel.");
  return o;
}

async function setStatus(projectId: string, status: string) {
  await db()`UPDATE content_projects SET status = ${status}::project_status_t, updated_at = now() WHERE id = ${projectId}`;
}

/** New episode: save the direction, then the Strategist pitches 5 ideas. */
export async function createEpisodeAction(_prev: StepResult, form: FormData): Promise<StepResult> {
  const direction = String(form.get("direction") ?? "").trim();
  if (direction.length < 3) return { ok: false, message: "Write a topic or direction first." };
  let projectId: string;
  try {
    const o = await owner();
    const sql = db();
    const [brand] = await sql<{ id: string }[]>`SELECT id FROM brand_kits WHERE user_id = ${o.id} ORDER BY is_default DESC LIMIT 1`;
    const [d] = await sql<{ id: string }[]>`
      INSERT INTO content_directions (user_id, brand_kit_id, title, prompt, platforms, formats)
      VALUES (${o.id}, ${brand?.id ?? null}, ${direction.slice(0, 80)}, ${direction}, ${ALL_PLATFORMS}::platform_t[], '{short_video}')
      RETURNING id`;
    const [p] = await sql<{ id: string }[]>`
      INSERT INTO content_projects (user_id, direction_id, title, format, target_platforms, status)
      VALUES (${o.id}, ${d.id}, ${direction.slice(0, 80)}, 'short_video', ${ALL_PLATFORMS}::platform_t[], 'ideating')
      RETURNING id`;
    projectId = p.id;
    await generateIdeas({ userId: o.id, projectId, direction });
    await setStatus(projectId, "awaiting_concept");
  } catch (err) {
    return { ok: false, message: err instanceof Error ? err.message : String(err) };
  }
  revalidatePath("/create");
  redirect(`/create/${projectId}`);
}

export async function moreIdeasAction(projectId: string): Promise<StepResult> {
  try {
    const o = await owner();
    const [d] = await db()<{ prompt: string }[]>`
      SELECT d.prompt FROM content_projects p JOIN content_directions d ON d.id = p.direction_id WHERE p.id = ${projectId}`;
    await generateIdeas({ userId: o.id, projectId, direction: `${d?.prompt ?? ""}\n(Give completely different ideas from before.)` });
    revalidatePath(`/create/${projectId}`);
    return { ok: true, message: "New ideas ready." };
  } catch (err) {
    return { ok: false, message: err instanceof Error ? err.message : String(err) };
  }
}

async function loadConcept(projectId: string) {
  const [c] = await db()<{ id: string; title: string; outline: ConceptOutline }[]>`
    SELECT id, title, outline FROM concepts WHERE project_id = ${projectId} AND is_selected LIMIT 1`;
  if (!c) throw new Error("Pick an idea first.");
  return c;
}

async function saveScript(projectId: string, conceptId: string, script: Script, factSheet: string, feedback: string | null) {
  const sql = db();
  const [{ v }] = await sql<{ v: number }[]>`SELECT COALESCE(max(version), 0) + 1 AS v FROM scripts WHERE project_id = ${projectId}`;
  await sql`
    INSERT INTO scripts (project_id, concept_id, version, title, target_duration_s, lines, fact_sheet, sources, feedback)
    VALUES (${projectId}, ${conceptId}, ${v}, ${script.title}, ${script.target_duration_s}, ${sql.json(script.lines)},
            ${factSheet}, ${sql.json(script.sources)}, ${feedback})`;
  await sql`UPDATE content_projects SET title = ${script.title} WHERE id = ${projectId}`;
}

/** Pick an idea → fact check (web search) → first script draft. */
export async function pickIdeaAction(projectId: string, conceptId: string): Promise<StepResult> {
  try {
    const o = await owner();
    const sql = db();
    await sql`UPDATE concepts SET is_selected = (id = ${conceptId}) WHERE project_id = ${projectId}`;
    await sql`UPDATE content_projects SET selected_concept_id = ${conceptId} WHERE id = ${projectId}`;
    await setStatus(projectId, "scripting");
    const c = await loadConcept(projectId);
    const facts = await factCheck({ userId: o.id, projectId, title: c.title, outline: c.outline });
    const script = await writeScript({ userId: o.id, projectId, title: c.title, outline: c.outline, factSheet: facts });
    await saveScript(projectId, c.id, script, facts, null);
    await setStatus(projectId, "awaiting_script_approval");
    revalidatePath(`/create/${projectId}`);
    return { ok: true, message: "Script ready." };
  } catch (err) {
    await setStatus(projectId, "awaiting_concept").catch(() => {});
    revalidatePath(`/create/${projectId}`);
    return { ok: false, message: err instanceof Error ? err.message : String(err) };
  }
}

/** Revise the script with the owner's notes (keeps the same fact sheet). */
export async function reviseScriptAction(projectId: string, _prev: StepResult, form: FormData): Promise<StepResult> {
  const feedback = String(form.get("feedback") ?? "").trim();
  if (!feedback) return { ok: false, message: "Write what you'd like changed." };
  try {
    const o = await owner();
    const c = await loadConcept(projectId);
    const [prev] = await db()<(Script & { fact_sheet: string })[]>`
      SELECT title, target_duration_s, lines, sources, fact_sheet FROM scripts WHERE project_id = ${projectId}
      ORDER BY version DESC LIMIT 1`;
    const script = await writeScript({
      userId: o.id, projectId, title: c.title, outline: c.outline, factSheet: prev?.fact_sheet ?? "", feedback, previous: prev,
    });
    await saveScript(projectId, c.id, script, prev?.fact_sheet ?? "", feedback);
    await setStatus(projectId, "awaiting_script_approval");
    revalidatePath(`/create/${projectId}`);
    return { ok: true, message: "New version ready." };
  } catch (err) {
    return { ok: false, message: err instanceof Error ? err.message : String(err) };
  }
}

/** Approve the latest script → the Copywriter writes captions for all 4 platforms. */
export async function approveScriptAction(projectId: string): Promise<StepResult> {
  try {
    const o = await owner();
    const sql = db();
    const [s] = await sql<(Script & { id: string })[]>`
      SELECT id, title, target_duration_s, lines, sources FROM scripts WHERE project_id = ${projectId} ORDER BY version DESC LIMIT 1`;
    if (!s) throw new Error("No script yet.");
    await sql`UPDATE scripts SET approved_at = now() WHERE id = ${s.id}`;
    await writeCaptions({ userId: o.id, projectId, script: s });
    await setStatus(projectId, "awaiting_recording");
    revalidatePath(`/create/${projectId}`);
    revalidatePath("/create");
    return { ok: true, message: "Approved. Captions ready." };
  } catch (err) {
    return { ok: false, message: err instanceof Error ? err.message : String(err) };
  }
}

export async function deleteEpisodeAction(projectId: string): Promise<StepResult> {
  const o = await getOwner();
  if (!o) return { ok: false, message: "No user found." };
  await db()`DELETE FROM content_projects WHERE id = ${projectId} AND user_id = ${o.id}`;
  revalidatePath("/create");
  redirect("/create");
}
