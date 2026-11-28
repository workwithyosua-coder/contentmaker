"use server";

import { revalidatePath } from "next/cache";
import { createProduct, deleteProduct, setProductStatus, setSlotProduct, updateProduct } from "@/lib/affiliate/server";
import type { ProductStatus } from "@/lib/affiliate/affiliate";
import { db } from "@/lib/db";
import { getOwner } from "@/lib/queries";

// The Affiliate Product Bank (Schedule page), a queued slot's product, and queuing a one-off Affiliate Debate from the
// Create page. Behind the owner password (src/proxy.ts). Plain SQL, no AI.

export type AffiliateResult = { ok: true; message: string } | { ok: false; message: string };
const fail = (e: unknown): AffiliateResult => ({ ok: false, message: e instanceof Error ? e.message : String(e) });
const done = (message: string): AffiliateResult => {
  revalidatePath("/schedule");
  revalidatePath("/create");
  return { ok: true, message };
};

const fields = (form: FormData) => Object.fromEntries(["name", "category", "problem_angle", "price_idr", "commission_pct", "tiktok_shop_url", "shopee_url"].map((k) => [k, form.get(k)]));

export async function saveProductAction(_prev: AffiliateResult | null, form: FormData): Promise<AffiliateResult> {
  try {
    const id = String(form.get("id") ?? "");
    if (id) {
      await updateProduct(id, fields(form));
      return done("Product updated.");
    }
    await createProduct(fields(form));
    return done("Product saved. Affiliate Debate slots can sell it now.");
  } catch (e) {
    return fail(e);
  }
}

export async function setProductStatusAction(id: string, status: ProductStatus): Promise<AffiliateResult> {
  try {
    await setProductStatus(id, status);
    return done(status === "active" ? "Product active." : "Product paused.");
  } catch (e) {
    return fail(e);
  }
}

export async function deleteProductAction(id: string): Promise<AffiliateResult> {
  try {
    await deleteProduct(id);
    return done("Product deleted.");
  } catch (e) {
    return fail(e);
  }
}

export async function setSlotProductAction(slotId: string, productId: string): Promise<AffiliateResult> {
  try {
    const owner = await getOwner();
    if (!owner) throw new Error("Sign in again.");
    await setSlotProduct(owner.id, slotId, productId || null);
    return done(productId ? "This slot sells the chosen product." : "This slot picks the least recently used product.");
  } catch (e) {
    return fail(e);
  }
}

/**
 * Create page: queues a one-off Affiliate Debate slot on the schedule, due now (the GitHub worker writes, voices and
 * renders it with Gemini like every scheduled episode; Run slot now on Schedule starts it at once).
 */
export async function queueAffiliateDebateAction(_prev: AffiliateResult | null, form: FormData): Promise<AffiliateResult> {
  try {
    const owner = await getOwner();
    if (!owner) throw new Error("Sign in again.");
    const sql = db();
    const [schedule] = await sql<{ id: string }[]>`SELECT id FROM content_schedules WHERE user_id = ${owner.id} ORDER BY created_at LIMIT 1`;
    if (!schedule) throw new Error("Save a schedule on the Schedule page first: Affiliate Debate slots run through it.");
    const productId = String(form.get("productId") ?? "") || null;
    const [slot] = await sql<{ id: string }[]>`
      INSERT INTO episode_queue (schedule_id, user_id, scheduled_for, slot_index, format, status)
      VALUES (${schedule.id}, ${owner.id}, now(), 0, 'affiliate', 'queued') RETURNING id`;
    if (productId) await setSlotProduct(owner.id, slot.id, productId);
    return done("Affiliate Debate queued. Open Schedule and tap Run slot now, or let the scheduler pick it up.");
  } catch (e) {
    return fail(e);
  }
}
