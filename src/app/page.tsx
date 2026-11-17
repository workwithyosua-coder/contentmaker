import type { Metadata } from "next";
import Link from "next/link";
import { Suspense } from "react";
import { Breakdown } from "@/components/breakdown";
import { WeeklyViewsChart } from "@/components/charts";
import { Filters } from "@/components/filters";
import { PostList } from "@/components/post-list";
import { SetupNotice } from "@/components/setup-notice";
import { Card, EmptyState, Kpi, PlatformDot, fmtNum } from "@/components/ui";
import { parseFilters } from "@/lib/params";
import {
  getBreakdown,
  getConnectedPlatforms,
  getInsights,
  getKpis,
  getOwner,
  getPosts,
  getWeeklyViews,
} from "@/lib/queries";

export const metadata: Metadata = { title: { absolute: "Dashboard · Dapur Konten" } };

export default function DashboardPage(props: PageProps<"/">) {
  return (
    <>
      <header className="mb-4">
        <h1 className="text-2xl font-semibold">Dashboard</h1>
        <p className="text-sm text-muted">What&apos;s working across your accounts, ranked against your own average.</p>
      </header>
      <Suspense fallback={<DashboardSkeleton />}>
        <Dashboard searchParams={props.searchParams} />
      </Suspense>
    </>
  );
}

async function Dashboard({ searchParams }: { searchParams: PageProps<"/">["searchParams"] }) {
  const { platform, days } = parseFilters(await searchParams);
  let owner;
  try {
    owner = await getOwner();
  } catch (e) {
    console.error("[db] failed to load owner:", e);
    return <SetupNotice error={e instanceof Error ? e.message : String(e)} />;
  }
  if (!owner) return <SetupNotice />;

  const [platforms, kpis, weekly, posts, insights, byHook, byStyle, byLength, byTime] = await Promise.all([
    getConnectedPlatforms(owner.id),
    getKpis(owner.id, days, platform),
    getWeeklyViews(owner.id),
    getPosts(owner.id, days, platform, 25),
    getInsights(owner.id),
    getBreakdown(owner.id, "hook_type", days, platform),
    getBreakdown(owner.id, "style", days, platform),
    getBreakdown(owner.id, "duration", days, platform),
    getBreakdown(owner.id, "posting_time", days, platform),
  ]);
  const shownInsights = insights.filter((i) => !platform || !i.platform || i.platform === platform).slice(0, 3);

  return (
    <div className="space-y-4">
      {platforms.length === 0 ? (
        <EmptyState title="No accounts connected yet">
          Connect TikTok, Instagram, Facebook or YouTube to see what&apos;s working.{" "}
          <Link href="/accounts" className="font-semibold text-link underline">Go to Accounts</Link>
        </EmptyState>
      ) : kpis.posts === 0 ? (
        <EmptyState title={`No posts in the last ${days} days`}>
          Your connected accounts have nothing published in this period yet. Make your next episode in{" "}
          <Link href="/create" className="font-semibold text-link underline">Create</Link>; its stats appear here a day after it&apos;s posted.
          {days < 90 && (
            <>
              {" "}Or look at a{" "}
              <Link href={platform ? `/?platform=${platform}` : "/"} className="font-semibold text-link underline">longer period</Link>.
            </>
          )}
        </EmptyState>
      ) : null}

      {platforms.length > 0 && <Filters basePath="/" platforms={platforms} platform={platform} days={days} />}

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Kpi label={`Posts · ${days}d`} value={String(kpis.posts)} sub={`${kpis.winners} winners · ${kpis.underperformers} flops`} />
        <Kpi label={`Views · ${days}d`} value={fmtNum(kpis.views)} />
        <Kpi
          label="Median score"
          value={kpis.medianScore === null ? "–" : kpis.medianScore.toFixed(2)}
          sub="0.50 = your typical post"
        />
        <Kpi
          label="Followers"
          value={fmtNum(kpis.followers)}
          sub={<span style={{ color: kpis.followersDelta >= 0 ? "var(--win)" : "var(--bad)" }}>
            {kpis.followersDelta >= 0 ? "+" : ""}{fmtNum(kpis.followersDelta)} in {days}d
          </span>}
        />
      </div>

      {shownInsights.length > 0 && (
        <Card title="What the Analyst found" action={<Link href="/insights" className="inline-flex min-h-11 items-center text-xs font-semibold text-link underline-offset-4 hover:underline">All insights</Link>}>
          <ul className="space-y-3">
            {shownInsights.map((i) => (
              <li key={i.id} className="text-sm">
                <div className="font-medium">{i.finding}</div>
                <div className="mt-0.5 text-muted">→ {i.recommendation}</div>
              </li>
            ))}
          </ul>
        </Card>
      )}

      {!platform && (
        <Card title="Weekly views by platform">
          {weekly.length ? (
            <WeeklyViewsChart data={weekly} platforms={platforms} />
          ) : (
            <p className="text-sm text-muted">No views in the last 12 weeks yet. The chart fills in as your posts collect views.</p>
          )}
        </Card>
      )}

      <div className="grid gap-4 md:grid-cols-2">
        <Card title="Hook type"><Breakdown rows={byHook} /></Card>
        <Card title="Editing style"><Breakdown rows={byStyle} /></Card>
        <Card title="Video length"><Breakdown rows={byLength} /></Card>
        <Card title="Posting time"><Breakdown rows={byTime} /></Card>
      </div>

      <Card title="Recent posts" action={platform ? <PlatformDot platform={platform} /> : null}>
        <PostList posts={posts} />
      </Card>
    </div>
  );
}

function DashboardSkeleton() {
  return (
    <div className="animate-pulse space-y-4">
      <div className="h-11 w-64 rounded-control bg-surface-2" />
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        {[0, 1, 2, 3].map((i) => <div key={i} className="h-24 rounded-card bg-surface-2" />)}
      </div>
      <div className="h-64 rounded-card bg-surface-2" />
    </div>
  );
}
