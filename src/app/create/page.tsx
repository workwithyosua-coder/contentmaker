import type { Metadata } from "next";
import Link from "next/link";
import { connection } from "next/server";
import { Suspense } from "react";
import { AutoRefresh, NewEpisodeForm } from "@/components/episode-ui";
import { SetupNotice } from "@/components/setup-notice";
import { VoicesCard } from "@/components/voices-card";
import { Card, EmptyState } from "@/components/ui";
import { listEpisodes } from "@/lib/episodes";
import { getOwner } from "@/lib/queries";
import { createEpisodeAction } from "./actions";
import { NewEpisodeCard } from "@/components/manual-import";
import { listAttachedAssets } from "@/lib/attached-assets";
import { listStudioAssets, videoAssetUrls } from "@/lib/studio-assets";

export const maxDuration = 300;

const STATUS_LABEL: Record<string, string> = {
  draft: "Needs retry",
  ideating: "Brainstorming…",
  awaiting_concept: "Pick an idea",
  scripting: "Writing script…",
  captioning: "Writing captions…",
  awaiting_script_approval: "Review script",
  awaiting_recording: "Ready to record",
  recorded: "Voices recorded",
  awaiting_approval: "Video ready",
  published: "Published",
};

export const metadata: Metadata = { title: "Create" };

export default function CreatePage() {
  return (
    <>
      <header className="mb-4">
        <h1 className="text-2xl font-semibold">Create</h1>
        <p className="text-sm text-muted">Pitch ideas with the writers&apos; room, or paste your own script and render directly.</p>
      </header>
      <div className="space-y-4">
        <Card title="New episode">
          <Suspense fallback={<NewEpisodeForm action={createEpisodeAction} />}>
            <NewEpisodeModes />
          </Suspense>
        </Card>
        <Card title="Affiliate Debate">
          <Suspense
            fallback={
              <p role="status" aria-busy="true" className="text-sm text-muted">
                Loading products...
              </p>
            }
          >
            <AffiliateDebateCard />
          </Suspense>
        </Card>
        <Suspense
          fallback={
            <div className="h-40 animate-pulse rounded-card bg-surface-2" />
          }
        >
          <Episodes />
        </Suspense>
      </div>
    </>
  );
}

/** Idea pitch (writers' room, AI) or "Use my own script (No AI)"; the composer needs the uploaded props / SFX. */
async function NewEpisodeModes() {
  await connection();
  const [attached, assetUrls, studio] = await Promise.all([
    listAttachedAssets().catch(() => ({ props: [] as string[], sfx: [] as string[] })),
    videoAssetUrls().catch(() => ({ props: {} as Record<string, string>, sfx: {} as Record<string, string>, cast: {} as Record<string, string> })),
    listStudioAssets().catch(() => []),
  ]);
  return <NewEpisodeCard pitchAction={createEpisodeAction} attached={attached} assetUrls={assetUrls} studio={studio} />;
}

async function Episodes() {
  await connection();
  let owner;
  try {
    owner = await getOwner();
  } catch (e) {
    return <SetupNotice error={e instanceof Error ? e.message : String(e)} />;
  }
  if (!owner) return <SetupNotice />;
  const episodes = await listEpisodes(owner.id);
  if (!episodes.length) {
    return (
      <>
        <EmptyState title="No episodes yet">
          Type a topic above and the writers&apos; room pitches 5 ideas. Pick
          one and it fact-checks and writes the script.
        </EmptyState>
        <Voices ownerId={owner.id} />
      </>
    );
  }
  const working = episodes.some((e) =>
    ["ideating", "scripting", "captioning"].includes(e.status),
  );
  return (
    <>
      <Card title="Episodes">
        <AutoRefresh active={working} />
        <ul className="space-y-2">
          {episodes.map((e) => (
            <li key={e.id}>
              <Link
                href={`/create/${e.id}`}
                className="ticket flex min-h-14 items-center justify-between gap-3 px-6 py-3 transition-colors hover:border-muted"
              >
                <div className="min-w-0">
                  <div className="truncate text-sm font-medium">
                    {e.title ?? e.direction ?? "Untitled"}
                  </div>
                  <div className="text-[11px] text-muted">
                    {new Date(e.created_at).toLocaleDateString()}
                  </div>
                </div>
                <span className="stamp shrink-0 text-muted">
                  {STATUS_LABEL[e.status] ?? e.status}
                </span>
              </Link>
            </li>
          ))}
        </ul>
      </Card>
      <Voices ownerId={owner.id} />
    </>
  );
}

/** The voices card waits on ElevenLabs; it streams in separately so the episode list never waits for it. */
function Voices({ ownerId }: { ownerId: string }) {
  return (
    <Suspense fallback={<div className="h-32 animate-pulse rounded-card bg-surface-2" aria-label="Loading AI voices" />}>
      <VoicesCard ownerId={ownerId} />
    </Suspense>
  );
}

/** Queue a one-off Affiliate Debate slot (Gemini only, through the scheduler); the active products to pick from. */
async function AffiliateDebateCard() {
  await connection();
  const { listProducts } = await import("@/lib/affiliate/server");
  const { QueueAffiliateDebate } = await import("@/components/affiliate/queue-affiliate");
  const { queueAffiliateDebateAction } = await import("../schedule/affiliate-actions");
  let products;
  try {
    products = (await listProducts()).filter((p) => p.status === "active").map((p) => ({ id: p.id, name: p.name }));
  } catch (e) {
    return (
      <p role="alert" className="text-sm" style={{ color: "var(--bad)" }}>
        The product bank couldn&apos;t load: {e instanceof Error ? e.message : String(e)}.
      </p>
    );
  }
  return <QueueAffiliateDebate products={products} action={queueAffiliateDebateAction} />;
}
