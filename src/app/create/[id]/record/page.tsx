import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { connection } from "next/server";
import { Suspense } from "react";
import { RecordingBooth } from "@/components/recording-booth";
import { AiVoicePanel } from "@/components/voice-ui";
import { elevenLabsConfigured } from "@/lib/voice/elevenlabs";
import { getVoiceProfiles } from "@/lib/voice/profiles";
import { generateAiTakesAction } from "./ai-actions";
import { SetupNotice } from "@/components/setup-notice";
import { Card, EmptyState } from "@/components/ui";
import { getOwner } from "@/lib/queries";
import { getBooth } from "@/lib/recordings";

export const metadata: Metadata = { title: "Recording booth" };
export const maxDuration = 300; // AI voice generation for a whole episode

export default function RecordPage(props: PageProps<"/create/[id]/record">) {
  return (
    <>
      <Suspense fallback={<div className="h-64 animate-pulse rounded-card bg-surface-2" />}>
        <Booth params={props.params} searchParams={props.searchParams} />
      </Suspense>
    </>
  );
}

async function Booth({
  params,
  searchParams,
}: {
  params: PageProps<"/create/[id]/record">["params"];
  searchParams: PageProps<"/create/[id]/record">["searchParams"];
}) {
  await connection();
  const { id } = await params;
  const as = (await searchParams).as;
  const initialFilter = as === "uco" || as === "ocu" ? as : "all";
  const owner = await getOwner().catch(() => null);
  if (!owner) return <SetupNotice />;
  let data;
  try {
    data = await getBooth(owner.id, id);
  } catch (e) {
    return <SetupNotice error={e instanceof Error ? e.message : String(e)} />;
  }
  if (!data) notFound();
  const { project, script, lines, recorded } = data;
  const voices = elevenLabsConfigured() ? await getVoiceProfiles(owner.id).catch(() => ({})) : null;
  const missing = lines.filter((l) => !recorded[l.index]).length;

  return (
    <div className="space-y-4">
      <Link href={`/create/${project.id}`} className="inline-flex min-h-11 items-center text-sm font-semibold text-muted hover:text-text">
        ← Back to episode
      </Link>
      <header>
        <h1 className="text-2xl font-semibold">Recording booth</h1>
        <p className="text-sm text-muted">{project.title}</p>
      </header>
      {!script ? (
        <EmptyState title="No script to record yet">
          Write and approve a script first, then come back here to record the lines.
        </EmptyState>
      ) : (
        <>
          {!script.approved_at && (
            <p className="rounded-card border border-border bg-surface p-3 text-sm">
              This script isn&apos;t approved yet. You can record already, but changes to the script after approval may need new takes.
            </p>
          )}
          <Card title="AI voices">
            {!voices ? (
              <p className="text-sm text-muted">
                Want the app to voice lines for you? Set up AI voices on the <Link href="/accounts" className="text-link underline">Accounts</Link> page.
              </p>
            ) : Object.keys(voices).length < 2 ? (
              <p className="text-sm text-muted">
                Clone {"uco" in voices ? "Ocu's" : "ocu" in voices ? "Uco's" : "Uco's and Ocu's"} voice on the{" "}
                <Link href="/accounts" className="text-link underline">Accounts</Link> page first.
              </p>
            ) : (
              <AiVoicePanel
                action={generateAiTakesAction.bind(null, project.id)}
                lines={lines.map((l) => ({ index: l.index, speaker: l.speaker, text: l.text }))}
                missing={missing}
              />
            )}
          </Card>
          <RecordingBooth
            // remount when takes change on the server (e.g. AI takes), so the list shows them
            key={Object.entries(recorded).map(([i, r]) => `${i}:${r.take}`).join(",")}
            projectId={project.id}
            scriptId={script.id}
            lines={lines}
            initialRecorded={recorded}
            initialFilter={initialFilter}
          />
          <p className="text-xs text-muted">
            Tips: a quiet room with soft things around you, the phone 15 to 20 cm from your mouth, the same distance every line,
            and half a second of silence before and after.
          </p>
        </>
      )}
    </div>
  );
}
