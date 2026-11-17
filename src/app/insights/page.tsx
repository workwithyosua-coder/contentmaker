import type { Metadata } from "next";
import { connection } from "next/server";
import { Suspense } from "react";
import { RunAnalystButton } from "@/components/run-analyst";
import { SetupNotice } from "@/components/setup-notice";
import { Card, EmptyState, PlatformDot } from "@/components/ui";
import { getInsights, getLatestReport, getOwner } from "@/lib/queries";

export const metadata: Metadata = { title: "Insights" };

export default function InsightsPage() {
  return (
    <>
      <header className="mb-4 flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <h1 className="text-2xl font-semibold">Insights</h1>
          <p className="text-sm text-muted">
            The Analyst agent reads your last 90 days and writes what&apos;s working. Your other agents use these when
            they suggest ideas, styles and captions.
          </p>
        </div>
        <RunAnalystButton />
      </header>
      <Suspense fallback={<div className="h-64 animate-pulse rounded-card bg-surface-2" />}>
        <InsightsList />
      </Suspense>
    </>
  );
}

const DIM_LABEL: Record<string, string> = {
  hook_type: "Hook",
  style: "Editing style",
  duration: "Length",
  pillar: "Topic",
  posting_time: "Timing",
  face: "Face on screen",
};

async function InsightsList() {
  await connection(); // request time only: never query the database during the build
  let owner;
  try {
    owner = await getOwner();
  } catch (e) {
    console.error("[db] failed to load owner:", e);
    return <SetupNotice error={e instanceof Error ? e.message : String(e)} />;
  }
  if (!owner) return <SetupNotice />;
  const [insights, report] = await Promise.all([getInsights(owner.id), getLatestReport(owner.id)]);

  if (!insights.length) {
    return (
      <EmptyState title="No insights yet">
        Tap <b>Run Analyst</b>. It takes up to a minute and costs a few cents of Claude usage.
      </EmptyState>
    );
  }

  return (
    <div className="space-y-4">
      {report && (
        <Card title={`Summary · ${new Date(report.created_at).toLocaleDateString()}`}>
          <ul className="list-disc space-y-1.5 pl-5 text-sm">
            {report.summary_md
              .split("\n")
              .map((l) => l.replace(/^\s*[-*]\s*/, "").replace(/\*\*(.+?)\*\*/g, "$1").trim())
              .filter(Boolean)
              .map((l, i) => <li key={i}>{l}</li>)}
          </ul>
        </Card>
      )}
      <div className="grid gap-4 md:grid-cols-2">
        {insights.map((i) => {
          const conf = Number(i.confidence ?? 0);
          return (
            <Card key={i.id}>
              <div className="mb-2 flex flex-wrap items-center gap-2 text-[11px]">
                <span className="stamp text-muted">{DIM_LABEL[i.dimension] ?? i.dimension}</span>
                {i.platform ? <PlatformDot platform={i.platform} /> : <span className="text-muted">All platforms</span>}
                <span className="ml-auto text-muted">
                  n={i.sample_size} · {conf >= 0.7 ? "high" : conf >= 0.45 ? "medium" : "low"} confidence
                </span>
              </div>
              <p className="font-medium">{i.finding}</p>
              {i.recommendation && <p className="mt-2 text-sm text-muted">→ {i.recommendation}</p>}
              {i.effect_size && (
                <p className="mt-2 text-xs tabular-nums" style={{ color: Number(i.effect_size) >= 1 ? "var(--win)" : "var(--bad)" }}>
                  {Number(i.effect_size).toFixed(2)}× vs. your average
                </p>
              )}
            </Card>
          );
        })}
      </div>
    </div>
  );
}
