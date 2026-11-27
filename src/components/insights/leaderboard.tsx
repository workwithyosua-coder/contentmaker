"use client";

import { useActionState, useState } from "react";
import { useRouter } from "next/navigation";
import type { ActionResult } from "@/app/insights/actions";

type SyncResponse = { synced: number; failed: number; notices: string[]; analysis: string | null; posts: { platform: string; title: string; score: number | null; error?: string }[] };
type SyncState = { status: "idle" } | { status: "running" } | { status: "done"; r: SyncResponse } | { status: "error"; message: string };

/** "Sync metrics now": POST /api/insights/sync-metrics with the session cookie, then the leaderboard refreshes. */
export function SyncMetricsButton() {
  const router = useRouter();
  const [state, setState] = useState<SyncState>({ status: "idle" });
  const run = async () => {
    setState({ status: "running" });
    try {
      const res = await fetch("/api/insights/sync-metrics", { method: "POST" });
      const j = (await res.json().catch(() => ({}))) as SyncResponse & { error?: string };
      if (!res.ok) throw new Error(j.error ?? `The sync answered ${res.status}.`);
      setState({ status: "done", r: j });
      router.refresh();
    } catch (e) {
      setState({ status: "error", message: e instanceof Error ? e.message : String(e) });
    }
  };
  return (
    <div className="space-y-2">
      <button type="button" className="btn btn-primary" onClick={run} disabled={state.status === "running"} data-sync-metrics>
        {state.status === "running" ? "Syncing metrics..." : "Sync metrics now"}
      </button>
      <div aria-live="polite" className="text-sm">
        {state.status === "done" && (
          <div className="space-y-1" data-sync-result>
            <p>
              {state.r.synced === 0 && state.r.failed === 0
                ? "No posts published in the last 14 days to sync."
                : `Synced ${state.r.synced} post${state.r.synced === 1 ? "" : "s"}${state.r.failed ? `, ${state.r.failed} failed` : ""}.`}
            </p>
            {state.r.posts
              .filter((p) => p.error)
              .map((p) => (
                <p key={`${p.platform}-${p.title}`} style={{ color: "var(--bad)" }}>
                  {p.platform}, {p.title}: {p.error}
                </p>
              ))}
            {state.r.notices.map((n) => (
              <p key={n} className="text-muted">
                {n}
              </p>
            ))}
            {state.r.analysis && <p className="text-muted">{state.r.analysis}</p>}
          </div>
        )}
        {state.status === "error" && (
          <p role="alert" style={{ color: "var(--bad)" }} data-sync-error>
            {state.message}
          </p>
        )}
      </div>
    </div>
  );
}

const FIELDS = [
  ["views", "Views"],
  ["likes", "Likes"],
  ["comments", "Comments"],
  ["shares", "Shares"],
  ["saves", "Saves"],
] as const;

/** TikTok isn't posted by the app, so its numbers are logged by hand (snapshot window "manual"). */
export function TikTokForm({ episodes, action }: { episodes: { id: string; title: string }[]; action: (prev: ActionResult | null, form: FormData) => Promise<ActionResult> }) {
  const [state, submit, pending] = useActionState(action, null);
  return (
    <details className="rounded-card border border-border" data-tiktok>
      <summary className="flex min-h-11 cursor-pointer items-center px-3 text-sm font-semibold">Log TikTok metrics</summary>
      <form action={submit} className="space-y-3 border-t border-border p-3">
        {episodes.length === 0 ? (
          <p className="text-sm text-muted">No rendered episodes yet. Render one, post it on TikTok, then log its numbers here.</p>
        ) : (
          <>
            <div>
              <label htmlFor="tt-episode" className="mb-1 block text-sm font-semibold">
                Episode
              </label>
              <select id="tt-episode" name="episodeId" className="field" required defaultValue="">
                <option value="" disabled>
                  Pick an episode
                </option>
                {episodes.map((e) => (
                  <option key={e.id} value={e.id}>
                    {e.title}
                  </option>
                ))}
              </select>
            </div>
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-5">
              {FIELDS.map(([name, label]) => (
                <div key={name}>
                  <label htmlFor={`tt-${name}`} className="mb-1 block text-sm font-semibold">
                    {label}
                  </label>
                  <input id={`tt-${name}`} name={name} type="number" min={0} step={1} inputMode="numeric" className="field tabular-nums" defaultValue={0} required />
                </div>
              ))}
            </div>
            <div>
              <label htmlFor="tt-post" className="mb-1 block text-sm font-semibold">
                TikTok post ID <span className="font-normal text-muted">(optional)</span>
              </label>
              <input id="tt-post" name="postId" className="field" autoComplete="off" maxLength={64} />
            </div>
            <button className="btn btn-secondary" disabled={pending}>
              {pending ? "Saving metrics..." : "Save TikTok metrics"}
            </button>
          </>
        )}
        {state && (
          <p role={state.ok ? "status" : "alert"} className="text-sm" style={{ color: state.ok ? "var(--win)" : "var(--bad)" }}>
            {state.message}
          </p>
        )}
      </form>
    </details>
  );
}
