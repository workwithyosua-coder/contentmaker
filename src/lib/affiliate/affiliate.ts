// The affiliate engine's pure parts: which product an Affiliate Debate slot sells (the least recently used active
// product, unless the slot names one), the Affiliate Debate's own QA checks (no pitch on lines 1-2, a real problem
// setup, a direct basket CTA at the end), the ready-to-paste pinned comment and the TikTok Shop / Shopee posting
// checklist (real links only, an explicit placeholder otherwise: never an invented URL), and the conversion log's
// validation and totals. No network, no database, no AI.

export type ProductStatus = "active" | "paused" | "out_of_stock";
export const PRODUCT_STATUSES: readonly ProductStatus[] = ["active", "paused", "out_of_stock"];
export const STATUS_LABEL: Record<ProductStatus, string> = { active: "Active", paused: "Paused", out_of_stock: "Out of stock" };
export const PRODUCT_CATEGORIES = ["Rumah Tangga", "Gadget", "F&B", "Kesehatan", "Lifestyle"] as const;

export type AffiliateProduct = {
  id: string;
  name: string;
  category: string;
  problem_angle: string;
  price_idr: number;
  commission_pct: number | null;
  tiktok_shop_url: string | null;
  shopee_url: string | null;
  prop_slug: string | null;
  status: ProductStatus;
  times_used: number;
  last_used_at: Date | string | null;
  created_at: Date | string;
};

/** The slot log line when an Affiliate Debate slot has no product to sell. */
export const NO_PRODUCT_NOTE = "No active affiliate products; ran standard Comedy Debate";

const time = (d: Date | string | null) => (d == null ? -Infinity : new Date(d).getTime());

/**
 * The product an Affiliate Debate slot sells: the slot's own linked product when it's active, else the least recently
 * used active product (never used first, then the longest unused, then the oldest). Paused and out-of-stock products
 * are skipped. Null when nothing is active: the slot then runs as a regular Comedy Debate (NO_PRODUCT_NOTE).
 */
export function pickProduct(products: AffiliateProduct[], linkedId?: string | null): AffiliateProduct | null {
  const active = products.filter((p) => p.status === "active");
  const linked = linkedId ? active.find((p) => p.id === linkedId) : undefined;
  if (linked) return linked;
  return [...active].sort((a, b) => time(a.last_used_at) - time(b.last_used_at) || time(a.created_at) - time(b.created_at))[0] ?? null;
}

/** "Rp 149.000" (Indonesian thousands separator). */
export function formatRp(n: number): string {
  return `Rp ${Math.round(n).toLocaleString("id-ID")}`;
}

/** A clean https:// URL or null (anything else is treated as missing, never shown as a link). */
export function cleanUrl(raw: unknown): string | null {
  const s = String(raw ?? "").trim();
  if (!s) return null;
  try {
    const u = new URL(s);
    return u.protocol === "https:" ? u.toString() : null;
  } catch {
    return null;
  }
}

// ------------------------------------------------------------------ the script's affiliate rules (QA gate)
type QaLine = { speaker: string; text: string; emotion?: string | null; layout?: string | null; thought_bubble?: boolean };

/** Selling words and prices that must never open an Affiliate Debate (lines 1 and 2). */
export const PITCH_WORDS =
  /\b(keranjang|checkout|check ?out|beli(in)?|belanja|order|diskon|promo|voucher|gratis ongkir|link|cek bio|tiktok ?shop|shopee|harga(nya)?|murah|cuma \d|rp\.?|rupiah|\d+ ?(rb|ribu|k|jt|juta))\b/i;

const STOP = new Set(["yang", "dan", "atau", "untuk", "dengan", "karena", "tapi", "juga", "lagi", "sama", "kalau", "biar", "bikin", "jadi", "udah", "sudah", "belum", "banget", "setiap", "tiap", "terus", "padahal", "nggak", "gak", "tidak"]);
const words = (s: string) => new Set(s.toLowerCase().replace(/[^\p{L}\p{N}\s]/gu, " ").split(/\s+/).filter((w) => w.length >= 4 && !STOP.has(w)));

/** The product's own name words (≥ 3 letters), so "Blender Mini X200" catches "blender" and "x200" in an opening line. */
const nameWords = (name: string) => [...new Set(name.toLowerCase().replace(/[^\p{L}\p{N}\s]/gu, " ").split(/\s+/).filter((w) => w.length >= 3))];

/** A direct conversion action for the final CTA: tap the yellow / orange basket (not a vague "cek bio"). */
export const BASKET_CTA = /\b(ketuk|klik|tap|cek|buka)\b[^.!?]{0,30}\bkeranjang (kuning|oranye|orange)\b|\bkeranjang (kuning|oranye|orange)\b/i;

/**
 * The Affiliate Debate's own QA problems (empty = pass), on top of the general gate:
 *   - no pitch in lines 1-2: no product name, brand, price, or buying / CTA word
 *   - the natural problem setup: lines 1-2 are about the product's problem angle (share a word with it)
 *   - a takeover stat card (the comparison) and a silent thought before the closing beats
 *   - the final line is a direct basket CTA ("ketuk keranjang kuning di bawah"), not "cek bio"
 */
export function affiliateQaProblems(lines: QaLine[], product: Pick<AffiliateProduct, "name" | "problem_angle">): string[] {
  const out: string[] = [];
  const names = nameWords(product.name);
  lines.slice(0, 2).forEach((l, i) => {
    const t = l.text.toLowerCase();
    const named = names.find((w) => new RegExp(`(^|[^\\p{L}\\p{N}])${w.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}($|[^\\p{L}\\p{N}])`, "u").test(t));
    if (named) out.push(`line ${i + 1} names the product ("${named}"): open on the problem, not the product`);
    const pitch = PITCH_WORDS.exec(l.text);
    if (pitch) out.push(`line ${i + 1} pitches ("${pitch[0]}"): no price, buying word or CTA in lines 1-2`);
  });
  const angle = words(product.problem_angle);
  const opening = words(lines.slice(0, 2).map((l) => l.text).join(" "));
  if (angle.size && ![...angle].some((w) => opening.has(w))) out.push(`lines 1-2 skip the problem setup: open on "${product.problem_angle}"`);
  if (!lines.some((l) => l.layout === "takeover")) out.push("no takeover stat card comparing the everyday fix with the product");
  const last = lines.at(-1);
  const closing = lines.slice(Math.floor(lines.length / 2), -1);
  if (!closing.some((l) => l.thought_bubble)) out.push("no silent thought (hypocrisy reset) before the closing beat");
  if (!last || !BASKET_CTA.test(last.text)) out.push('the final CTA line has no direct basket action (e.g. "ketuk keranjang kuning di bawah")');
  else if (/cek bio/i.test(last.text)) out.push('the final CTA says "cek bio": point at the basket instead');
  return out;
}

// ------------------------------------------------------------------ distribution copy (never an invented link)
export const SHOPEE_PLACEHOLDER = "[TEMPEL LINK SHOPEE]";
export const TIKTOK_PLACEHOLDER = "[TEMPEL LINK TIKTOK SHOP]";

/**
 * The pinned comment for Instagram Reels and YouTube Shorts (Indonesian, ready to paste): the product, its price and
 * the Shopee link when there is one, else the explicit SHOPEE_PLACEHOLDER. Never a made-up URL.
 */
export function pinnedComment(p: Pick<AffiliateProduct, "name" | "price_idr" | "shopee_url">, problem: string): string {
  const link = cleanUrl(p.shopee_url) ?? SHOPEE_PLACEHOLDER;
  return [`Yang nanya ${p.name} di video tadi: ini link-nya ya 👇`, link, `Harga sekitar ${formatRp(p.price_idr)} (cek harga terbaru di link). Solusi buat ${problem.replace(/\s+/g, " ").trim().replace(/[.!]+$/, "")}.`, "#affiliate #ucoocu"].join("\n");
}

/**
 * The TikTok Shop / Shopee Video posting checklist: the product, both links (or explicit placeholders), the AI-generated
 * content disclosure and attaching the basket.
 */
export function handoffNote(p: Pick<AffiliateProduct, "name" | "price_idr" | "tiktok_shop_url" | "shopee_url">): string {
  return [
    `Produk: ${p.name} (${formatRp(p.price_idr)})`,
    `TikTok Shop: ${cleanUrl(p.tiktok_shop_url) ?? TIKTOK_PLACEHOLDER}`,
    `Shopee: ${cleanUrl(p.shopee_url) ?? SHOPEE_PLACEHOLDER}`,
    "1. TikTok: turn ON the AI-generated content disclosure before posting.",
    "2. TikTok: attach the product to the Yellow Basket (Keranjang Kuning).",
    "3. Shopee Video: attach the product to the Orange Basket (Keranjang Oranye).",
    "4. Instagram / YouTube: paste the pinned comment and pin it.",
  ].join("\n");
}

// ------------------------------------------------------------------ conversions
export const CONVERSION_PLATFORMS = ["tiktok_shop", "shopee_video", "instagram_bio", "youtube_pinned"] as const;
export type ConversionPlatform = (typeof CONVERSION_PLATFORMS)[number];
export const PLATFORM_LABEL: Record<ConversionPlatform, string> = {
  tiktok_shop: "TikTok Shop",
  shopee_video: "Shopee Video",
  instagram_bio: "Instagram bio",
  youtube_pinned: "YouTube pinned comment",
};
export type ConversionInput = { episodeId: string; platform: ConversionPlatform; clicks: number; orders: number; commissionIdr: number };

const count = (raw: unknown, field: string, max: number): number => {
  const s = String(raw ?? "").trim().replace(/[.\s]/g, "");
  if (s === "") return 0;
  if (!/^\d+$/.test(s)) throw new Error(`${field} must be a whole number of 0 or more.`);
  const n = Number(s);
  if (n > max) throw new Error(`${field} looks too large (max ${max.toLocaleString("en-US")}).`);
  return n;
};

/** A conversion log entry, validated (whole numbers ≥ 0, a known platform, an episode id, something logged). */
export function parseConversion(raw: Record<string, unknown>): ConversionInput {
  const episodeId = String(raw.episodeId ?? "").trim();
  if (!/^[0-9a-f-]{36}$/i.test(episodeId)) throw new Error("Pick the episode these orders came from.");
  const platform = String(raw.platform ?? "") as ConversionPlatform;
  if (!CONVERSION_PLATFORMS.includes(platform)) throw new Error("Pick the platform.");
  const clicks = count(raw.clicks, "Clicks", 10_000_000);
  const orders = count(raw.orders, "Orders", 1_000_000);
  const commissionIdr = count(raw.commissionIdr, "Commission (IDR)", 2_000_000_000);
  if (orders > clicks && clicks > 0) throw new Error("Orders can't be more than clicks.");
  if (!clicks && !orders && !commissionIdr) throw new Error("Enter at least one number to log.");
  return { episodeId, platform, clicks, orders, commissionIdr };
}

export type ConversionRow = { episode_id: string; title: string; platform: string; clicks: number; orders: number; commission_idr: number };
export type ConversionTotals = { clicks: number; orders: number; commissionIdr: number; episodes: { episodeId: string; title: string; clicks: number; orders: number; commissionIdr: number }[] };

/** Totals and a per-episode breakdown (most commission first) of the logged rows. */
export function conversionTotals(rows: ConversionRow[]): ConversionTotals {
  const by = new Map<string, { episodeId: string; title: string; clicks: number; orders: number; commissionIdr: number }>();
  for (const r of rows) {
    const e = by.get(r.episode_id) ?? { episodeId: r.episode_id, title: r.title, clicks: 0, orders: 0, commissionIdr: 0 };
    e.clicks += Number(r.clicks) || 0;
    e.orders += Number(r.orders) || 0;
    e.commissionIdr += Number(r.commission_idr) || 0;
    by.set(r.episode_id, e);
  }
  const episodes = [...by.values()].sort((a, b) => b.commissionIdr - a.commissionIdr || b.orders - a.orders);
  return {
    clicks: episodes.reduce((n, e) => n + e.clicks, 0),
    orders: episodes.reduce((n, e) => n + e.orders, 0),
    commissionIdr: episodes.reduce((n, e) => n + e.commissionIdr, 0),
    episodes,
  };
}

/** A product form, validated. */
export function parseProduct(raw: Record<string, unknown>) {
  const str = (k: string, max: number) => String(raw[k] ?? "").replace(/\s+/g, " ").trim().slice(0, max);
  const name = str("name", 120);
  const category = str("category", 40);
  const problem_angle = str("problem_angle", 300);
  if (!name) throw new Error("Product name is required.");
  if (!category) throw new Error("Category is required.");
  if (problem_angle.length < 3) throw new Error("Problem angle is required (the everyday pain point Uco complains about).");
  const price = Number(String(raw.price_idr ?? "").replace(/[.\s]/g, ""));
  if (!Number.isInteger(price) || price <= 0) throw new Error("Price (IDR) must be a whole number above 0.");
  const pctRaw = String(raw.commission_pct ?? "").trim().replace(",", ".");
  const commission_pct = pctRaw === "" ? null : Number(pctRaw);
  if (commission_pct !== null && (!Number.isFinite(commission_pct) || commission_pct < 0 || commission_pct > 100)) throw new Error("Commission (%) must be between 0 and 100.");
  const urls: Record<string, string | null> = {};
  for (const [k, label] of [["tiktok_shop_url", "TikTok Shop URL"], ["shopee_url", "Shopee URL"]] as const) {
    const v = String(raw[k] ?? "").trim();
    urls[k] = v ? cleanUrl(v) : null;
    if (v && !urls[k]) throw new Error(`${label} must be a full https:// link.`);
  }
  return { name, category, problem_angle, price_idr: price, commission_pct: commission_pct === null ? null : Math.round(commission_pct * 100) / 100, tiktok_shop_url: urls.tiktok_shop_url, shopee_url: urls.shopee_url };
}
