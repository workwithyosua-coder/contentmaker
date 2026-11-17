"use server";

import { revalidatePath } from "next/cache";
import { db } from "@/lib/db";
import { getOwner } from "@/lib/queries";
import { syncAllAccounts } from "@/lib/sync";

export type ActionResult = { ok: boolean; message: string } | null;

export async function syncNowAction(): Promise<ActionResult> {
  const owner = await getOwner();
  if (!owner) return { ok: false, message: "No user found." };
  const results = Object.values(await syncAllAccounts(owner.id)) as { ok: boolean; videos?: number; error?: string }[];
  revalidatePath("/", "layout");
  if (!results.length) return { ok: false, message: "No connected accounts to sync yet." };
  const failed = results.filter((r) => !r.ok);
  if (failed.length) return { ok: false, message: `Sync failed: ${failed[0].error}` };
  return { ok: true, message: `Synced ${results.reduce((a, r) => a + (r.videos ?? 0), 0)} posts.` };
}

/** Deletes the seeded demo accounts, their posts/metrics, demo styles, and insights based on them. */
export async function removeDemoDataAction(): Promise<ActionResult> {
  const owner = await getOwner();
  if (!owner) return { ok: false, message: "No user found." };
  const sql = db();
  await sql.begin(async (tx) => {
    await tx`DELETE FROM social_accounts WHERE user_id = ${owner.id} AND external_account_id LIKE 'demo-%'`;
    await tx`DELETE FROM editing_styles WHERE user_id IS NULL AND slug LIKE 'demo-%'
             AND NOT EXISTS (SELECT 1 FROM post_features f WHERE f.editing_style_id = editing_styles.id)`;
    await tx`DELETE FROM performance_reports WHERE user_id = ${owner.id}`;
    await tx`DELETE FROM insights WHERE user_id = ${owner.id}`;
  });
  await sql`REFRESH MATERIALIZED VIEW post_performance`;
  revalidatePath("/", "layout");
  return { ok: true, message: "Demo data removed." };
}

/** Disconnects one account: deletes its stored login (tokens), posts and metrics. */
export async function removeAccountAction(accountId: string): Promise<ActionResult> {
  const owner = await getOwner();
  if (!owner) return { ok: false, message: "No user found." };
  const sql = db();
  const rows = await sql`DELETE FROM social_accounts WHERE id = ${accountId} AND user_id = ${owner.id} RETURNING id`;
  if (!rows.length) return { ok: false, message: "Account not found." };
  await sql`REFRESH MATERIALIZED VIEW post_performance`;
  revalidatePath("/", "layout");
  return { ok: true, message: "Account removed." };
}

/** Makes an ElevenLabs instant clone of one character's voice from the owner's recorded booth takes. */
export async function cloneVoiceAction(speaker: "uco" | "ocu"): Promise<ActionResult> {
  try {
    const owner = await getOwner();
    if (!owner) return { ok: false, message: "No user found." };
    const { cloneFromTakes } = await import("@/lib/voice/profiles");
    const r = await cloneFromTakes(owner.id, speaker);
    revalidatePath("/accounts");
    return { ok: true, message: `${speaker === "uco" ? "Uco" : "Ocu"}'s voice cloned from ${r.samples} takes (${r.seconds} s).` };
  } catch (err) {
    return { ok: false, message: err instanceof Error ? err.message : String(err) };
  }
}

/** Uses a voice made on the ElevenLabs website instead (e.g. a Professional Voice Clone). */
export async function setVoiceIdAction(speaker: "uco" | "ocu", _prev: ActionResult, form: FormData): Promise<ActionResult> {
  try {
    const owner = await getOwner();
    if (!owner) return { ok: false, message: "No user found." };
    const voiceId = String(form.get("voiceId") ?? "").trim();
    if (!/^[A-Za-z0-9]{10,40}$/.test(voiceId)) return { ok: false, message: "That doesn't look like an ElevenLabs voice ID." };
    const { voiceExists } = await import("@/lib/voice/elevenlabs");
    if (!(await voiceExists(voiceId))) return { ok: false, message: "ElevenLabs doesn't know that voice ID on your account." };
    const { setVoiceProfile } = await import("@/lib/voice/profiles");
    const { listVoices } = await import("@/lib/voice/elevenlabs");
    const known = (await listVoices().catch(() => [])).find((v) => v.voice_id === voiceId);
    await setVoiceProfile(owner.id, speaker, voiceId, known ? `${known.name} (ElevenLabs)` : `${speaker === "uco" ? "Uco" : "Ocu"} (voice ID)`);
    revalidatePath("/accounts");
    return { ok: true, message: "Voice saved." };
  } catch (err) {
    return { ok: false, message: err instanceof Error ? err.message : String(err) };
  }
}
