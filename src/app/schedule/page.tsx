import type { Metadata } from "next";
import { connection } from "next/server";
import { Suspense } from "react";
import { PropBankList, QueueList, RuleEditor, SeedsForm, type PropView, type SlotView } from "@/components/scheduler";
import { Card } from "@/components/ui";
import { getOwner } from "@/lib/queries";
import { DEFAULT_RULE, normalizeRule } from "@/lib/scheduler";
import { getSchedule, listQueue, propBank } from "@/lib/scheduler-server";
import { ProductBank, type ProductView } from "@/components/affiliate/product-bank";
import { listProducts, slotProducts } from "@/lib/affiliate/server";
import { deleteProductAction, saveProductAction, setProductStatusAction, setSlotProductAction } from "./affiliate-actions";

export const metadata: Metadata = { title: "Schedule" };

export default function SchedulePage() {
  return (
    <>
      <header className="mb-4">
        <h1 className="text-2xl font-semibold">Schedule</h1>
        <p className="text-sm text-muted">At least two episodes a day, written, voiced, rendered and posted by the GitHub worker.</p>
      </header>
      <Suspense fallback={<div className="h-64 animate-pulse rounded-card bg-surface-2" />}>
        <ScheduleBody />
      </Suspense>
    </>
  );
}

async function ScheduleBody() {
  await connection();
  const owner = await getOwner();
  if (!owner) return <p className="text-sm text-muted">No user found.</p>;
  let schedule, queue, bank;
  try {
    [schedule, queue, bank] = await Promise.all([getSchedule(owner.id), listQueue(owner.id), propBank(owner.id)]);
  } catch (e) {
    if (/does not exist/.test(String(e))) {
      return (
        <Card title="Database update needed">
          <p className="text-sm">The scheduler needs database migration 018 (autonomous scheduler). Apply it, then reload this page.</p>
        </Card>
      );
    }
    throw e;
  }
  const { rvcModelStatus } = await import("@/lib/studio-assets");
  const { latestVideo } = await import("@/lib/render");
  const { publicObjectUrl } = await import("@/lib/storage");
  const { ASSET_BUCKET } = await import("@/lib/attached-assets");
  const rvc = await rvcModelStatus().catch(() => ({ uco: false, ocu: false }));
  // Affiliate Debate slots: each queued slot's pinned product and the bank's active products (empty before migration 022)
  const [pinned, bankProducts] = await Promise.all([slotProducts(queue.map((q) => q.id)).catch(() => ({}) as Record<string, string>), listProducts().catch(() => [])]);
  const activeProducts = bankProducts.filter((p) => p.status === "active").map((p) => ({ id: p.id, name: p.name }));
  const slots: SlotView[] = await Promise.all(
    queue.map(async (q) => ({
      id: q.id,
      scheduledFor: q.scheduled_for.toISOString(),
      format: q.format,
      topic: q.topic_seed,
      topicSource: q.topic_source,
      status: q.status,
      episodeId: q.episode_id,
      episodeTitle: q.episode_title ?? null,
      error: q.error_message,
      runUrl: q.run_url,
      handoff: q.handoff,
      affiliateProductId: (pinned as Record<string, string>)[q.id] ?? null,
      videoUrl: q.handoff?.tiktokCaption && q.episode_id ? ((await latestVideo(q.episode_id).catch(() => null))?.url ?? null) : null,
      progressPercent: q.progress_percent,
      progressStage: q.progress_stage,
      progressDetail: q.progress_detail,
      progressUpdatedAt: q.progress_updated_at ? q.progress_updated_at.toISOString() : null,
    })),
  );
  const props: PropView[] = bank.map((p) => ({
    name: p.name,
    keywords: p.keywords,
    category: p.category,
    vetted: p.vetted,
    source: p.source,
    url: p.source === "repo" ? `/props/${p.name}.png` : publicObjectUrl(`props/${p.file}`, ASSET_BUCKET),
  }));
  const rule = schedule ? normalizeRule(schedule) : DEFAULT_RULE;
  const canRun = Boolean(process.env.GITHUB_DISPATCH_TOKEN?.trim());
  const { geminiConfigured } = await import("@/lib/voice/gemini");
  const geminiReady = geminiConfigured();
  return (
    <div className="grid min-w-0 gap-4 lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
      <Card title={schedule ? "Schedule rule" : "Schedule rule (not saved yet)"} className="min-w-0">
        <RuleEditor initial={rule} rvcReady={{ uco: rvc.uco, ocu: rvc.ocu }} geminiReady={geminiReady} />
      </Card>
      <div className="min-w-0 space-y-4">
        <Card title="Upcoming queue" className="min-w-0">
          <div className="space-y-4">
            <SeedsForm />
            {!canRun && <p className="text-sm text-muted">Run slot now needs GITHUB_DISPATCH_TOKEN in Vercel (the same token as Render video).</p>}
            <QueueList slots={slots} canRun={canRun} products={activeProducts} setSlotProduct={setSlotProductAction} />
          </div>
        </Card>
        <Card title="Affiliate Product Bank" className="min-w-0">
          <p className="mb-3 text-sm text-muted">
            Affiliate Debate slots sell one product from here: the slot&apos;s own pick, else the least recently used active product. With no active product the slot runs as a regular Comedy Debate.
          </p>
          <Suspense
            fallback={
              <p role="status" aria-busy="true" className="text-sm text-muted" data-loading>
                Loading products...
              </p>
            }
          >
            <ProductBankBody />
          </Suspense>
        </Card>
        <Card title="Prop Bank" className="min-w-0">
          <p className="mb-3 text-sm text-muted">
            Scheduled episodes get 2 to 3 freshly drawn props of their own. A prop switched on here is reused only when a script names it exactly, never by keyword, so an unrelated leftover never shows up.
          </p>
          <PropBankList props={props} />
        </Card>
      </div>
    </div>
  );
}

/** The Product Bank's list (Loading: the Suspense fallback; Error: a readable message, the rest of the page unaffected). */
async function ProductBankBody() {
  let products;
  try {
    products = await listProducts();
  } catch (e) {
    console.error("[affiliate] product bank failed:", e);
    return (
      <p role="alert" className="text-sm" style={{ color: "var(--bad)" }} data-error>
        The product bank couldn&apos;t load: {e instanceof Error ? e.message : String(e)}. Reload the page to try again.
      </p>
    );
  }
  const view: ProductView[] = products.map((p) => ({
    id: p.id,
    name: p.name,
    category: p.category,
    problemAngle: p.problem_angle,
    priceIdr: p.price_idr,
    commissionPct: p.commission_pct,
    tiktokShopUrl: p.tiktok_shop_url,
    shopeeUrl: p.shopee_url,
    status: p.status,
    timesUsed: p.times_used,
  }));
  return <ProductBank products={view} save={saveProductAction} setStatus={setProductStatusAction} remove={deleteProductAction} />;
}
