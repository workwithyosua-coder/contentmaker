import type { Metadata } from "next";
import Link from "next/link";
import { connection } from "next/server";
import { Suspense } from "react";
import { NewEpisodeForm } from "@/components/episode-ui";
import { SetupNotice } from "@/components/setup-notice";
import { Card } from "@/components/ui";
import { listEpisodes } from "@/lib/episodes";
import { getOwner } from "@/lib/queries";
import { createEpisodeAction } from "./actions";

export const maxDuration = 300;

const STATUS_LABEL: Record<string, string> = {
  ideating: "Brainstorming…",
  awaiting_concept: "Pick an idea",
  scripting: "Writing script…",
  awaiting_script_approval: "Review script",
  awaiting_recording: "Ready to record",
  published: "Published",
};

export const metadata: Metadata = { title: "Create" };

export default function CreatePage() {
  return (
    <>
      <header className="mb-4">
        <h1 className="text-2xl font-semibold">Create</h1>
        <p className="text-sm text-muted">
          Give a topic. Uco &amp; Ocu&apos;s writers&apos; room pitches ideas, fact-checks them and writes the banter.
        </p>
      </header>
      <div className="space-y-4">
        <Card title="New episode">
          <NewEpisodeForm action={createEpisodeAction} />
        </Card>
        <Suspense fallback={<div className="h-40 animate-pulse rounded-card bg-surface-2" />}>
          <Episodes />
        </Suspense>
      </div>
    </>
  );
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
  if (!episodes.length) return null;
  return (
    <Card title="Episodes">
      <ul className="space-y-2">
        {episodes.map((e) => (
          <li key={e.id}>
            <Link
              href={`/create/${e.id}`}
              className="ticket flex min-h-14 items-center justify-between gap-3 px-6 py-3 transition-colors hover:border-muted"
            >
              <div className="min-w-0">
                <div className="truncate text-sm font-medium">{e.title ?? e.direction ?? "Untitled"}</div>
                <div className="text-[11px] text-muted">{new Date(e.created_at).toLocaleDateString()}</div>
              </div>
              <span className="stamp shrink-0 text-muted">
                {STATUS_LABEL[e.status] ?? e.status}
              </span>
            </Link>
          </li>
        ))}
      </ul>
    </Card>
  );
}
