import type { Metadata } from "next";
import { connection } from "next/server";
import { Suspense, type ReactNode } from "react";
import { PLATFORM_LABEL, fmtNum } from "@/components/ui";
import { SyncMetricsButton, TikTokForm } from "@/components/insights/leaderboard";
import { PlaybookRules } from "@/components/insights/playbook-rules";
import { TunablesForm } from "@/components/insights/tunables-form";
import { Pronunciations } from "@/components/insights/pronunciations";
import { getOverrides, getTunablesState, leaderboard, listLessons, loggableEpisodes } from "@/lib/insights/server";
import { LESSON_CAP } from "@/lib/insights/playbook";
import {
  addPronunciationAction,
  deleteLessonAction,
  editLessonAction,
  logTikTokAction,
  removePronunciationAction,
  saveTunablesAction,
  setLessonStatusAction,
} from "./actions";

export const metadata: Metadata = { title: "Insights" };

// The Showrunner Playbook's home: how published episodes performed, the rules the writers' room follows, the live
// production numbers and the pronunciation fixes. Each section loads on its own (Loading), says when it has
// nothing yet (Empty), and fails on its own (Error) without taking the page down.

function Section({ id, title, action, children }: { id: string; title: string; action?: ReactNode; children: ReactNode }) {
  return (
    <section aria-labelledby={`${id}-h`} className="rounded-card border border-border bg-surface p-4 md:p-5" data-section={id}>
      <div className="mb-3 flex flex-wrap items-start justify-between gap-3">
        <h2 id={`${id}-h`} className="text-lg font-semibold">
          {title}
        </h2>
        {action}
      </div>
      {children}
    </section>
  );
}

const Loading = ({ what }: { what: string }) => (
  <div role="status" aria-busy="true" className="space-y-2" data-loading>
    <p className="text-sm text-muted">Loading {what}...</p>
    <div className="h-16 animate-pulse rounded-card bg-surface-2 motion-reduce:animate-none" />
  </div>
);

const Failed = ({ what, error }: { what: string; error: unknown }) => {
  console.error(`[insights] ${what} failed:`, error);
  return (
    <p role="alert" className="text-sm" style={{ color: "var(--bad)" }} data-error>
      {what} couldn&apos;t load: {error instanceof Error ? error.message : String(error)}. Reload the page to try again.
    </p>
  );
};

export default function InsightsPage() {
  return (
    <div className="space-y-5">
      <header>
        <h1 className="text-2xl font-semibold">Insights</h1>
        <p className="text-sm text-muted">
          What your published episodes earned, the playbook the writers&apos; room follows, and the numbers the studio produces with. Director&apos;s
          Reviews on episode pages and the daily metrics sync keep it learning.
        </p>
      </header>

      <Section id="leaderboard" title="Leaderboard" action={<SyncMetricsButton />}>
        <Suspense fallback={<Loading what="the leaderboard" />}>
          <LeaderboardBody />
        </Suspense>
      </Section>

      <Suspense
        fallback={
          <Section id="playbook" title="Active Playbook Rules">
            <Loading what="the playbook" />
          </Section>
        }
      >
        <PlaybookSection />
      </Suspense>

      <Section id="tunables" title="Live Studio Tunables">
        <Suspense fallback={<Loading what="the tunables" />}>
          <TunablesBody />
        </Suspense>
      </Section>

      <Section id="affiliate" title="Affiliate Conversions">
        <Suspense fallback={<Loading what="affiliate conversions" />}>
          <AffiliateBody />
        </Suspense>
      </Section>

      <Section id="pronunciation" title="Pronunciation Dictionary">
        <Suspense fallback={<Loading what="the dictionary" />}>
          <PronunciationBody />
        </Suspense>
      </Section>
    </div>
  );
}

async function LeaderboardBody() {
  await connection(); // request time only: never query the database during the build
  let rows, episodes;
  try {
    [rows, episodes] = await Promise.all([leaderboard(), loggableEpisodes()]);
  } catch (e) {
    return <Failed what="The leaderboard" error={e} />;
  }
  return (
    <div className="space-y-4">
      {rows.length === 0 ? (
        <p className="rounded-card border border-dashed border-border p-4 text-sm text-muted" data-empty>
          No post metrics synced yet. Run Sync metrics now after publishing.
        </p>
      ) : (
        <ol className="space-y-2" data-leaderboard>
          {rows.map((r, i) => (
            <li key={r.episode_id} className="grid grid-cols-[2rem_1fr] gap-x-2 gap-y-1 rounded-card border border-border p-3 sm:grid-cols-[2rem_1fr_auto]">
              <span className="row-span-2 text-lg font-semibold tabular-nums text-muted">{i + 1}</span>
              <div className="min-w-0">
                <p className="break-words font-semibold">
                  {r.url ? (
                    <a href={r.url} target="_blank" rel="noreferrer" className="underline decoration-1 underline-offset-2">
                      {r.title}
                    </a>
                  ) : (
                    r.title
                  )}
                </p>
                <p className="text-xs text-muted">
                  {PLATFORM_LABEL[r.platform] ?? r.platform}, {r.snapshot_window === "manual" ? "logged by hand" : `${r.snapshot_window} snapshot`}
                </p>
              </div>
              <p className="text-sm tabular-nums sm:row-span-2 sm:text-right">
                <span className="block text-xl font-semibold">{r.engagement_score.toFixed(1)}</span>
                <span className="text-xs text-muted">score</span>
              </p>
              <p className="col-start-2 text-xs tabular-nums text-muted">
                {fmtNum(r.views)} views, {fmtNum(r.likes)} likes, {fmtNum(r.comments)} comments, {fmtNum(r.shares)} shares, {fmtNum(r.saves)} saves
                {r.avg_view_pct != null ? `, ${r.avg_view_pct.toFixed(0)}% watched` : ""}
              </p>
            </li>
          ))}
        </ol>
      )}
      <TikTokForm episodes={episodes} action={logTikTokAction} />
    </div>
  );
}

async function PlaybookSection() {
  await connection();
  let rules;
  try {
    rules = await listLessons();
  } catch (e) {
    return (
      <Section id="playbook" title="Active Playbook Rules">
        <Failed what="The playbook" error={e} />
      </Section>
    );
  }
  const active = rules.filter((r) => r.status === "active").length;
  return (
    <Section id="playbook" title={`Active Playbook Rules ${active} / ${LESSON_CAP} active`}>
      {rules.length === 0 ? (
        <p className="text-sm text-muted" data-empty>
          No rules yet. Save a Director&apos;s Review with notes on an episode, or sync metrics once a few episodes are published: the studio learns rules from
          both.
        </p>
      ) : (
        <PlaybookRules
          rules={rules.map((r) => ({ id: r.id, category: r.category, rule_text: r.rule_text, source: r.source, status: r.status, evidence_count: r.evidence_count }))}
          cap={LESSON_CAP}
          setStatus={setLessonStatusAction}
          edit={editLessonAction}
          remove={deleteLessonAction}
        />
      )}
    </Section>
  );
}

async function TunablesBody() {
  await connection();
  let state;
  try {
    state = await getTunablesState();
  } catch (e) {
    return <Failed what="The tunables" error={e} />;
  }
  return (
    <>
      <p className="mb-3 text-sm text-muted">
        Read by every new episode: line gaps, music under speech, puppet motion, voice expressiveness, script length.
        {!state.saved && <span data-empty> Nothing changed yet: the studio runs on the defaults below.</span>}
      </p>
      <TunablesForm values={state.values} action={saveTunablesAction} />
    </>
  );
}

async function PronunciationBody() {
  await connection();
  let rows;
  try {
    rows = await getOverrides();
  } catch (e) {
    return <Failed what="The dictionary" error={e} />;
  }
  return <Pronunciations rows={rows.map((r) => ({ term: r.term, spoken_as: r.spoken_as }))} add={addPronunciationAction} remove={removePronunciationAction} />;
}

async function AffiliateBody() {
  await connection();
  const { conversionSummary, loggableAffiliateEpisodes } = await import("@/lib/affiliate/server");
  const { formatRp } = await import("@/lib/affiliate/affiliate");
  const { LogAffiliateOrders } = await import("@/components/affiliate/conversions");
  let totals, episodes;
  try {
    [totals, episodes] = await Promise.all([conversionSummary(), loggableAffiliateEpisodes()]);
  } catch (e) {
    return <Failed what="Affiliate conversions" error={e} />;
  }
  return (
    <div className="space-y-4">
      {totals.episodes.length === 0 ? (
        <p className="rounded-card border border-dashed border-border p-4 text-sm text-muted" data-empty>
          No affiliate orders logged yet.
        </p>
      ) : (
        <>
          <dl className="grid grid-cols-3 gap-2" data-affiliate-totals>
            {[
              ["Orders", totals.orders.toLocaleString("id-ID")],
              ["Clicks", totals.clicks.toLocaleString("id-ID")],
              ["Commission (IDR)", formatRp(totals.commissionIdr)],
            ].map(([k, v]) => (
              <div key={k} className="min-w-0 rounded-card border border-border p-3">
                <dt className="text-xs text-muted">{k}</dt>
                <dd className="break-words text-lg font-semibold tabular-nums">{v}</dd>
              </div>
            ))}
          </dl>
          <ul className="space-y-2" data-affiliate-episodes>
            {totals.episodes.map((e) => (
              <li key={e.episodeId} className="rounded-card border border-border p-3 text-sm">
                <p className="break-words font-semibold">{e.title}</p>
                <p className="text-xs tabular-nums text-muted">
                  {e.orders.toLocaleString("id-ID")} orders, {e.clicks.toLocaleString("id-ID")} clicks, {formatRp(e.commissionIdr)} commission
                </p>
              </li>
            ))}
          </ul>
        </>
      )}
      <LogAffiliateOrders episodes={episodes} />
    </div>
  );
}
