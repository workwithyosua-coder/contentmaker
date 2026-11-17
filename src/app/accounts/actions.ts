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
