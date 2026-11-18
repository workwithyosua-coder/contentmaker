"use client";

import { useActionState, useState, useTransition } from "react";
import type { StepResult } from "@/app/create/actions";
import { Status } from "@/components/episode-ui";

type Platform = "youtube" | "tiktok" | "instagram" | "facebook";
type Account = {
  id: string;
  platform: Platform;
  handle: string;
  display_name: string | null;
  avatar_url: string | null;
  health: "ok" | "missing_permission" | "expired";
  problem: string | null;
  reconnect: string;
};
type Pub = { platform: Platform; status: string; external_post_url: string | null; error: string | null; run_after: string; note: string | null };
type Settings = {
  enabled?: boolean;
  title?: string;
  text?: string;
  privacy?: string;
  allowComments?: boolean;
  allowDuet?: boolean;
  allowStitch?: boolean;
  shareToFeed?: boolean;
  coverSecond?: number;
};

const LABEL: Record<Platform, string> = { tiktok: "TikTok", instagram: "Instagram Reels", youtube: "YouTube Shorts", facebook: "Facebook Reels" };
const COLOR: Record<Platform, string> = { tiktok: "var(--tiktok, #25F4EE)", instagram: "var(--instagram, #E1306C)", youtube: "var(--youtube, #FF0000)", facebook: "var(--facebook, #1877F2)" };

const wib = (iso: string) => new Date(iso).toLocaleString("en-GB", { timeZone: "Asia/Jakarta", dateStyle: "medium", timeStyle: "short" }) + " WIB";

export function PublishPanel({
  accounts,
  defaults,
  saved,
  publications,
  autoPublish,
  publishAt,
  ready,
  action,
  autoAction,
}: {
  accounts: Account[];
  defaults: Partial<Record<Platform, { title?: string; text: string }>>;
  saved: Partial<Record<Platform, Settings>>;
  publications: Pub[];
  autoPublish: boolean;
  publishAt: string | null;
  /** null when the episode can be posted; otherwise why not. */
  ready: string | null;
  action: (prev: StepResult, form: FormData) => Promise<StepResult>;
  autoAction: (on: boolean) => Promise<StepResult>;
}) {
  const [state, run, pending] = useActionState(action, null);
  const [auto, setAuto] = useState(autoPublish);
  const [autoState, setAutoState] = useState<StepResult>(null);
  const [autoPending, startAuto] = useTransition();
  const failed = publications.some((p) => p.status === "failed");

  if (!accounts.length) {
    return <p className="text-sm text-muted">No social accounts connected yet. Connect them on the Accounts page.</p>;
  }
  return (
    <div className="space-y-4">
      {ready && <p className="rounded-control border border-border bg-surface-2 p-3 text-sm">{ready}</p>}
      <form action={run} className="space-y-4">
        <ul className="divide-y divide-border">
          {accounts.map((a) => (
            <AccountRow key={a.id} account={a} preview={defaults[a.platform]} saved={saved[a.platform] ?? {}} pub={publications.find((p) => p.platform === a.platform)} />
          ))}
        </ul>

        <div className="flex flex-wrap items-center gap-2 border-t border-border pt-4">
          <button name="mode" value="now" disabled={pending || Boolean(ready)} className="btn btn-primary">
            {pending ? "Starting…" : "Post now to selected"}
          </button>
          {failed && (
            <button name="mode" value="retry" disabled={pending || Boolean(ready)} className="btn btn-secondary">
              Retry failed
            </button>
          )}
        </div>
        <div className="flex flex-wrap items-end gap-2">
          <label className="text-xs font-semibold">
            Schedule (WIB)
            <input type="datetime-local" name="at" className="field mt-1 w-auto" />
          </label>
          <button name="mode" value="schedule" disabled={pending || Boolean(ready)} className="btn btn-secondary">
            Schedule post
          </button>
          {publishAt && (
            <>
              <span className="text-xs text-muted">Scheduled for {wib(publishAt)}</span>
              <button name="mode" value="cancel" disabled={pending} className="btn btn-quiet">
                Cancel schedule
              </button>
            </>
          )}
        </div>
        <Status state={state} />
      </form>

      <label className="flex min-h-11 cursor-pointer items-center gap-3 border-t border-border pt-4 text-sm">
        <input
          type="checkbox"
          checked={auto}
          disabled={autoPending}
          onChange={(e) => {
            const on = e.target.checked;
            setAuto(on);
            startAuto(async () => setAutoState(await autoAction(on)));
          }}
        />
        <span>
          <span className="font-semibold">Auto-post on render complete</span>
          <span className="block text-xs text-muted">When a new render lands and captions are approved, post it to every enabled platform.</span>
        </span>
      </label>
      <Status state={autoState} />
    </div>
  );
}

function AccountRow({ account: a, preview, saved, pub }: { account: Account; preview?: { title?: string; text: string }; saved: Settings; pub?: Pub }) {
  const ok = a.health === "ok";
  const [on, setOn] = useState(ok && saved.enabled !== false);
  const p = a.platform;
  return (
    <li className="space-y-2 py-3">
      <input type="hidden" name={`${p}.present`} value="1" />
      <div className="flex items-center gap-3">
        {a.avatar_url ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={a.avatar_url} alt="" className="h-9 w-9 rounded-full" referrerPolicy="no-referrer" />
        ) : (
          <span className="h-9 w-9 rounded-full" style={{ background: COLOR[p] }} />
        )}
        <div className="min-w-0 flex-1">
          <div className="text-sm font-semibold">{LABEL[p]}</div>
          <div className="truncate text-xs text-muted">{a.display_name ?? a.handle}</div>
        </div>
        <span className="stamp" style={{ color: ok ? "var(--win)" : "var(--bad)" }}>
          {ok ? "Connected" : a.health === "expired" ? "Login expired" : "Needs permission"}
        </span>
        <label className="flex min-h-11 items-center gap-2 text-xs font-semibold">
          <input type="checkbox" name={`${p}.enabled`} checked={on} disabled={!ok} onChange={(e) => setOn(e.target.checked)} aria-label={`Post to ${LABEL[p]}`} />
          Post
        </label>
      </div>
      {!ok && (
        <p className="text-xs" style={{ color: "var(--bad)" }}>
          {a.problem}{" "}
          <a href={a.reconnect} className="text-link underline">
            Reconnect
          </a>
        </p>
      )}
      {pub && <PubStatus pub={pub} />}
      <details>
        <summary className="cursor-pointer text-xs font-semibold text-muted">Caption and settings</summary>
        <div className="mt-2 space-y-2">
          {(p === "youtube" || p === "facebook") && (
            <label className="block text-xs font-semibold">
              Title
              <input name={`${p}.title`} defaultValue={saved.title ?? preview?.title ?? ""} maxLength={p === "youtube" ? 100 : 255} className="field mt-1 text-sm" />
            </label>
          )}
          <label className="block text-xs font-semibold">
            {p === "youtube" || p === "facebook" ? "Description" : "Caption"}
            <textarea name={`${p}.text`} defaultValue={saved.text ?? preview?.text ?? ""} rows={5} maxLength={p === "tiktok" || p === "instagram" ? 2200 : 5000} className="field mt-1 text-xs" />
          </label>
          {p === "youtube" && (
            <label className="block text-xs font-semibold">
              Visibility{" "}
              <select name="youtube.privacy" defaultValue={saved.privacy ?? "public"} className="field mt-1 w-auto">
                <option value="public">Public</option>
                <option value="unlisted">Unlisted</option>
                <option value="private">Private</option>
              </select>
            </label>
          )}
          {p === "tiktok" && (
            <>
              <label className="block text-xs font-semibold">
                Who can watch{" "}
                <select name="tiktok.privacy" defaultValue={saved.privacy ?? "PUBLIC_TO_EVERYONE"} className="field mt-1 w-auto">
                  <option value="PUBLIC_TO_EVERYONE">Everyone</option>
                  <option value="MUTUAL_FOLLOW_FRIENDS">Friends</option>
                  <option value="FOLLOWER_OF_CREATOR">Followers</option>
                  <option value="SELF_ONLY">Only me</option>
                </select>
              </label>
              <div className="flex flex-wrap gap-4 text-xs font-semibold">
                {(
                  [
                    ["allowComments", "Comments"],
                    ["allowDuet", "Duet"],
                    ["allowStitch", "Stitch"],
                  ] as const
                ).map(([k, l]) => (
                  <label key={k} className="flex min-h-11 items-center gap-2">
                    <input type="checkbox" name={`tiktok.${k}`} defaultChecked={saved[k] !== false} /> {l}
                  </label>
                ))}
              </div>
            </>
          )}
          {p === "instagram" && (
            <label className="flex min-h-11 items-center gap-2 text-xs font-semibold">
              <input type="checkbox" name="instagram.shareToFeed" defaultChecked={saved.shareToFeed !== false} /> Also share to the feed
            </label>
          )}
          {(p === "tiktok" || p === "instagram") && (
            <label className="block text-xs font-semibold">
              Cover frame (seconds into the video)
              <input type="number" name={`${p}.coverSecond`} min={0} max={180} step={0.5} defaultValue={saved.coverSecond ?? 1} className="field mt-1 w-28" />
            </label>
          )}
        </div>
      </details>
    </li>
  );
}

function PubStatus({ pub }: { pub: Pub }) {
  const scheduled = pub.status === "queued" && new Date(pub.run_after).getTime() > Date.now() + 30_000;
  const label: Record<string, string> = { queued: "Queued", uploading: "Uploading…", processing: "Processing…", published: "Published", failed: "Failed" };
  const color = pub.status === "published" ? "var(--win)" : pub.status === "failed" ? "var(--bad)" : undefined;
  return (
    <div className="space-y-1 text-xs">
      <span className="stamp" style={{ color }}>
        {scheduled ? `Scheduled · ${wib(pub.run_after)}` : (label[pub.status] ?? pub.status)}
      </span>
      {pub.status === "published" && pub.external_post_url && (
        <a href={pub.external_post_url} target="_blank" rel="noreferrer" className="ml-2 text-link underline">
          Open post
        </a>
      )}
      {pub.note && <p className="text-muted">{pub.note}</p>}
      {pub.status === "failed" && pub.error && <p style={{ color: "var(--bad)" }}>{pub.error}</p>}
    </div>
  );
}
