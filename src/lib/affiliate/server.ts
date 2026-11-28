import "server-only";
import { db } from "../db";
import { conversionTotals, parseConversion, parseProduct, type AffiliateProduct, type ConversionRow, type ConversionTotals, type ProductStatus } from "./affiliate";

// The affiliate engine's database side: the Affiliate Product Bank, a slot's linked product, an episode's affiliate
// fields and the conversion log. Pooler-safe (plain statements). Before migration 022 is applied the tables and
// columns don't exist: every read here then answers "nothing" (so an Affiliate Debate slot falls back to a regular
// Comedy Debate and every page renders), and every write says which migration it needs.

/** undefined_table / undefined_column: migration 022 isn't applied yet. */
export const missingSchema = (e: unknown) => ["42P01", "42703"].includes(String((e as { code?: string })?.code ?? ""));
const NEEDS_022 = "The affiliate engine needs database migration 022 (022_affiliate_engine.sql). Apply it, then try again.";
const write = async <T>(fn: () => Promise<T>): Promise<T> => {
  try {
    return await fn();
  } catch (e) {
    if (missingSchema(e)) throw new Error(NEEDS_022);
    throw e;
  }
};

// ------------------------------------------------------------------ the product bank
export async function listProducts(): Promise<AffiliateProduct[]> {
  try {
    return (await db()<AffiliateProduct[]>`
      SELECT id, name, category, problem_angle, price_idr, commission_pct::float8 AS commission_pct, tiktok_shop_url, shopee_url, prop_slug,
             status, times_used, last_used_at, created_at
      FROM affiliate_products ORDER BY (status = 'active') DESC, created_at DESC`).map((p) => ({ ...p }));
  } catch (e) {
    if (missingSchema(e)) return [];
    throw e;
  }
}

export async function createProduct(raw: Record<string, unknown>): Promise<string> {
  const p = parseProduct(raw);
  return write(async () => {
    const [row] = await db()<{ id: string }[]>`
      INSERT INTO affiliate_products (name, category, problem_angle, price_idr, commission_pct, tiktok_shop_url, shopee_url)
      VALUES (${p.name}, ${p.category}, ${p.problem_angle}, ${p.price_idr}, ${p.commission_pct}, ${p.tiktok_shop_url}, ${p.shopee_url}) RETURNING id`;
    return row.id;
  });
}

export async function updateProduct(id: string, raw: Record<string, unknown>) {
  const p = parseProduct(raw);
  await write(() => db()`
    UPDATE affiliate_products SET name = ${p.name}, category = ${p.category}, problem_angle = ${p.problem_angle}, price_idr = ${p.price_idr},
           commission_pct = ${p.commission_pct}, tiktok_shop_url = ${p.tiktok_shop_url}, shopee_url = ${p.shopee_url}, updated_at = now()
    WHERE id = ${id}`);
}

export async function setProductStatus(id: string, status: ProductStatus) {
  if (!["active", "paused", "out_of_stock"].includes(status)) throw new Error("Unknown status.");
  await write(() => db()`UPDATE affiliate_products SET status = ${status}, updated_at = now() WHERE id = ${id}`);
}

export async function deleteProduct(id: string) {
  await write(() => db()`DELETE FROM affiliate_products WHERE id = ${id}`);
}

// ------------------------------------------------------------------ slots and episodes
/** The product a slot is pinned to (null: the rotation picks; also null before migration 022). */
export async function slotProductId(slotId: string): Promise<string | null> {
  try {
    const [r] = await db()<{ affiliate_product_id: string | null }[]>`SELECT affiliate_product_id FROM episode_queue WHERE id = ${slotId}`;
    return r?.affiliate_product_id ?? null;
  } catch (e) {
    if (missingSchema(e)) return null;
    throw e;
  }
}

/** Every slot's pinned product (for the Schedule page; empty before migration 022). */
export async function slotProducts(slotIds: string[]): Promise<Record<string, string>> {
  if (!slotIds.length) return {};
  try {
    const rows = await db()<{ id: string; affiliate_product_id: string }[]>`
      SELECT id, affiliate_product_id FROM episode_queue WHERE id = ANY(${slotIds}::uuid[]) AND affiliate_product_id IS NOT NULL`;
    return Object.fromEntries(rows.map((r) => [r.id, r.affiliate_product_id]));
  } catch (e) {
    if (missingSchema(e)) return {};
    throw e;
  }
}

export async function setSlotProduct(userId: string, slotId: string, productId: string | null) {
  await write(() => db()`
    UPDATE episode_queue SET affiliate_product_id = ${productId}, updated_at = now()
    WHERE id = ${slotId} AND user_id = ${userId} AND status = 'queued'`);
}

/**
 * The episode's affiliate fields, saved when its Affiliate Debate script is written, and the product marked used once
 * (times_used + 1, last_used_at now). Best effort before migration 022 (nothing to save then).
 */
export async function saveEpisodeAffiliate(episodeId: string, productId: string, pinned: string, note: string) {
  const sql = db();
  try {
    await sql.begin(async (tx) => {
      await tx`UPDATE content_projects SET affiliate_product_id = ${productId}, pinned_comment = ${pinned}, affiliate_handoff_note = ${note} WHERE id = ${episodeId}`;
      await tx`UPDATE affiliate_products SET times_used = times_used + 1, last_used_at = now(), updated_at = now() WHERE id = ${productId}`;
    });
  } catch (e) {
    if (!missingSchema(e)) throw e;
  }
}

export type EpisodeAffiliate = { product: AffiliateProduct; pinnedComment: string | null; handoffNote: string | null };

/** The episode page's Affiliate Hand-Off data (null when the episode sells nothing, or before migration 022). */
export async function episodeAffiliate(episodeId: string): Promise<EpisodeAffiliate | null> {
  try {
    const [r] = await db()<(AffiliateProduct & { pinned_comment: string | null; affiliate_handoff_note: string | null })[]>`
      SELECT a.id, a.name, a.category, a.problem_angle, a.price_idr, a.commission_pct::float8 AS commission_pct, a.tiktok_shop_url, a.shopee_url,
             a.prop_slug, a.status, a.times_used, a.last_used_at, a.created_at, p.pinned_comment, p.affiliate_handoff_note
      FROM content_projects p JOIN affiliate_products a ON a.id = p.affiliate_product_id WHERE p.id = ${episodeId}`;
    if (!r) return null;
    const { pinned_comment, affiliate_handoff_note, ...product } = r;
    return { product, pinnedComment: pinned_comment, handoffNote: affiliate_handoff_note };
  } catch (e) {
    if (missingSchema(e)) return null;
    throw e;
  }
}

// ------------------------------------------------------------------ conversions
export async function logConversion(raw: Record<string, unknown>) {
  const c = parseConversion(raw);
  return write(async () => {
    const sql = db();
    const [ep] = await sql<{ affiliate_product_id: string | null }[]>`SELECT affiliate_product_id FROM content_projects WHERE id = ${c.episodeId}`;
    if (!ep) throw new Error("That episode no longer exists.");
    const [row] = await sql<{ id: string }[]>`
      INSERT INTO affiliate_conversions (episode_id, affiliate_product_id, platform, clicks, orders, commission_idr)
      VALUES (${c.episodeId}, ${ep.affiliate_product_id}, ${c.platform}, ${c.clicks}, ${c.orders}, ${c.commissionIdr}) RETURNING id`;
    return { id: row.id, ...c };
  });
}

/** Real logged totals (and per episode); zeros and no episodes when nothing is logged or before migration 022. */
export async function conversionSummary(): Promise<ConversionTotals> {
  try {
    const rows = await db()<ConversionRow[]>`
      SELECT c.episode_id, p.title, c.platform, c.clicks, c.orders, c.commission_idr
      FROM affiliate_conversions c JOIN content_projects p ON p.id = c.episode_id`;
    return conversionTotals(rows);
  } catch (e) {
    if (missingSchema(e)) return conversionTotals([]);
    throw e;
  }
}

/** Episodes orders can be logged for: affiliate episodes first, then any rendered episode. */
export async function loggableAffiliateEpisodes(): Promise<{ id: string; title: string; affiliate: boolean }[]> {
  const sql = db();
  try {
    return await sql<{ id: string; title: string; affiliate: boolean }[]>`
      SELECT p.id, p.title, (p.affiliate_product_id IS NOT NULL) AS affiliate FROM content_projects p
      WHERE p.affiliate_product_id IS NOT NULL OR EXISTS (SELECT 1 FROM episode_videos v WHERE v.project_id = p.id)
      ORDER BY (p.affiliate_product_id IS NOT NULL) DESC, p.created_at DESC LIMIT 40`;
  } catch (e) {
    if (!missingSchema(e)) throw e;
    return (await sql<{ id: string; title: string }[]>`
      SELECT p.id, p.title FROM content_projects p WHERE EXISTS (SELECT 1 FROM episode_videos v WHERE v.project_id = p.id)
      ORDER BY p.created_at DESC LIMIT 40`).map((r) => ({ ...r, affiliate: false }));
  }
}
