"use client";

import { useActionState, useId, useRef, useState, useTransition } from "react";
import type { StepResult } from "@/app/create/actions";
import { Status } from "@/components/episode-ui";
import { CAPTION_LIMITS, REQUIRED, captionProblems, type CaptionProblem } from "@/lib/publish/manualCaptions";

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
  tiktok,
  videoSeconds,
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
  /** Live TikTok account info (creator_info), required on TikTok's posting screen. */
  tiktok?: { info?: TikTokInfo; error?: string };
  videoSeconds: number | null;
}) {
  const [state, run, pending] = useActionState(action, null);
  const [auto, setAuto] = useState(autoPublish);
  // caption fields live here (not in each row) so one shared caption can be applied to every selected platform
  const [fields, setFields] = useState<Record<string, { title: string; text: string }>>(() =>
    Object.fromEntries(
      accounts.map((a) => [a.platform, { title: saved[a.platform]?.title ?? defaults[a.platform]?.title ?? "", text: saved[a.platform]?.text ?? defaults[a.platform]?.text ?? "" }]),
    ),
  );
  const [enabledLocal, setEnabledLocal] = useState<Record<string, boolean>>(() =>
    Object.fromEntries(accounts.map((a) => [a.platform, a.health === "ok" && saved[a.platform]?.enabled !== false])),
  );
  const [showErrors, setShowErrors] = useState(false);
  const formRef = useRef<HTMLFormElement>(null);
  const [autoState, setAutoState] = useState<StepResult>(null);
  const [autoPending, startAuto] = useTransition();
  const failed = publications.some((p) => p.status === "failed");
  const tt = useTikTokChoices();
  const ttAccount = accounts.find((a) => a.platform === "tiktok" && a.health === "ok");
  const ttProblem = ttAccount && tt.enabled ? tiktokProblem(tt, tiktok, videoSeconds) : null;
  const isOn = (a: Account) => a.health === "ok" && (a.platform === "tiktok" ? tt.enabled : Boolean(enabledLocal[a.platform]));
  const problems = captionProblems(Object.fromEntries(accounts.map((a) => [a.platform, { enabled: isOn(a), ...fields[a.platform] }])));
  const setField = (p: Platform, k: "title" | "text", v: string) => setFields((f) => ({ ...f, [p]: { ...f[p], [k]: v } }));
  const selected = accounts.filter(isOn).map((a) => a.platform);

  if (!accounts.length) {
    return <p className="text-sm text-muted">No social accounts connected yet. Connect them on the Accounts page.</p>;
  }
  return (
    <div className="space-y-4">
      {ready && <p className="rounded-control border border-border bg-surface-2 p-3 text-sm">{ready}</p>}
      <form
        ref={formRef}
        action={run}
        noValidate
        onSubmit={(e) => {
          // Empty state: a switched-on platform with a blank required title or caption is not posted
          const mode = ((e.nativeEvent as SubmitEvent).submitter as HTMLButtonElement | null)?.value;
          if ((mode === "now" || mode === "schedule") && problems.length) {
            e.preventDefault();
            setShowErrors(true);
            const first = problems[0];
            const el = formRef.current?.querySelector<HTMLElement>(`[name="${first.platform}.${first.field}"]`);
            el?.closest("details")?.setAttribute("open", "");
            el?.focus();
          }
        }}
        className="min-w-0 space-y-4"
      >
        {Object.keys(defaults).length > 0 && (
          <SharedCaption
            selected={selected}
            onApply={(text) =>
              setFields((f) => {
                const next = { ...f };
                for (const p of selected) next[p] = { ...next[p], text };
                return next;
              })
            }
          />
        )}
        <ul className="divide-y divide-border">
          {accounts.map((a) => (
            <AccountRow
              key={a.id}
              account={a}
              fields={fields[a.platform]}
              setField={(k, v) => setField(a.platform, k, v)}
              on={isOn(a)}
              setOn={(v) => (a.platform === "tiktok" ? tt.setEnabled(v) : setEnabledLocal((m) => ({ ...m, [a.platform]: v })))}
              problems={problems.filter((x) => x.platform === a.platform)}
              showErrors={showErrors}
              saved={saved[a.platform] ?? {}}
              pub={publications.find((p) => p.platform === a.platform)}
              tt={a.platform === "tiktok" ? { choices: tt, live: tiktok, videoSeconds } : undefined}
            />
          ))}
        </ul>
        {showErrors && problems.length > 0 && (
          <div role="alert" className="rounded-control border p-3 text-sm" style={{ borderColor: "var(--bad)", background: "var(--bad-bg)" }}>
            <p className="font-semibold" style={{ color: "var(--bad)" }}>
              Fix {problems.length === 1 ? "this caption" : `these ${problems.length} captions`} before posting:
            </p>
            <ul className="mt-1 list-disc pl-5">
              {problems.map((x) => (
                <li key={`${x.platform}.${x.field}`}>{x.message}</li>
              ))}
            </ul>
          </div>
        )}

        {ttAccount && tt.enabled && (
          <p className="text-xs text-muted">
            By posting to TikTok, you agree to TikTok&apos;s{" "}
            {tt.disclose && tt.branded && (
              <>
                <a href="https://www.tiktok.com/legal/page/global/bc-policy/en" target="_blank" rel="noreferrer" className="text-link underline">
                  Branded Content Policy
                </a>{" "}
                and{" "}
              </>
            )}
            <a href="https://www.tiktok.com/legal/page/global/music-usage-confirmation/en" target="_blank" rel="noreferrer" className="text-link underline">
              Music Usage Confirmation
            </a>
            .
          </p>
        )}
        {ttProblem && (
          <p className="text-xs" style={{ color: "var(--bad)" }}>
            {ttProblem}
          </p>
        )}
        <div className="flex flex-wrap items-center gap-2 border-t border-border pt-4">
          <button name="mode" value="now" disabled={pending || Boolean(ready) || Boolean(ttProblem)} aria-busy={pending} className="btn btn-primary">
            {pending ? "Working…" : "Post now to selected"}
          </button>
          {failed && (
            <button name="mode" value="retry" disabled={pending || Boolean(ready)} className="btn btn-secondary">
              Retry failed
            </button>
          )}
        </div>
        <div className="flex flex-wrap items-end gap-2">
          <label className="min-w-0 text-xs font-semibold">
            Schedule (WIB)
            <input type="datetime-local" name="at" className="field mt-1 w-auto max-w-full" />
          </label>
          <button name="mode" value="schedule" disabled={pending || Boolean(ready) || Boolean(ttProblem)} aria-busy={pending} className="btn btn-secondary">
            {pending ? "Working…" : "Schedule post"}
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

function AccountRow({
  account: a,
  fields,
  setField,
  on,
  setOn,
  problems,
  showErrors,
  saved,
  pub,
  tt,
}: {
  account: Account;
  fields: { title: string; text: string };
  setField: (k: "title" | "text", v: string) => void;
  on: boolean;
  setOn: (v: boolean) => void;
  problems: CaptionProblem[];
  showErrors: boolean;
  saved: Settings;
  pub?: Pub;
  tt?: { choices: TikTokChoices; live?: { info?: TikTokInfo; error?: string }; videoSeconds: number | null };
}) {
  const ok = a.health === "ok";
  const p = a.platform;
  const id = useId();
  const lim = CAPTION_LIMITS[p];
  const hasTitle = p === "youtube" || p === "facebook";
  // a field the user has edited shows its problem right away; untouched ones only after a post attempt
  const [touched, setTouched] = useState<{ title?: boolean; text?: boolean }>({});
  const problemFor = (k: "title" | "text") => {
    const x = problems.find((q) => q.field === k);
    return x && (showErrors || touched[k]) ? x.message : null;
  };
  const titleProblem = problemFor("title");
  const textProblem = problemFor("text");
  return (
    <li className="min-w-0 space-y-2 py-3">
      <input type="hidden" name={`${p}.present`} value="1" />
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
        {(tt?.live?.info?.creator_avatar_url ?? a.avatar_url) ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={tt?.live?.info?.creator_avatar_url ?? a.avatar_url ?? ""} alt="" className="h-9 w-9 rounded-full" referrerPolicy="no-referrer" />
        ) : (
          <span className="h-9 w-9 rounded-full" style={{ background: COLOR[p] }} />
        )}
        <div className="min-w-0 flex-1">
          <div className="text-sm font-semibold">{LABEL[p]}</div>
          <div className="truncate text-xs text-muted">
            {tt?.live?.info ? `Posting as ${tt.live.info.creator_nickname ?? a.display_name ?? a.handle}` : (a.display_name ?? a.handle)}
          </div>
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
      <details open={(p === "tiktok" && on) || Boolean(on && (titleProblem || textProblem))}>
        <summary className="flex min-h-11 cursor-pointer items-center text-xs font-semibold text-muted">
          Caption and settings{on && (titleProblem || textProblem) ? <span style={{ color: "var(--bad)" }}>&nbsp;· needs a caption</span> : null}
        </summary>
        <div className="mt-2 min-w-0 space-y-3">
          {hasTitle && (
            <div>
              <label htmlFor={`${id}-title`} className="block text-xs font-semibold">
                {LABEL[p]} title{REQUIRED[p].title ? " (required)" : " (optional)"}
              </label>
              <input
                id={`${id}-title`}
                name={`${p}.title`}
                value={fields.title}
                onChange={(e) => setField("title", e.target.value)}
                onBlur={() => setTouched((t) => ({ ...t, title: true }))}
                maxLength={lim.title}
                aria-invalid={Boolean(on && titleProblem)}
                aria-describedby={`${id}-title-count${on && titleProblem ? ` ${id}-title-err` : ""}`}
                className="field mt-1 w-full min-w-0 text-sm"
              />
              <FieldMeta id={`${id}-title`} count={fields.title.length} limit={lim.title!} problem={on ? titleProblem : null} />
            </div>
          )}
          <div>
            <label htmlFor={`${id}-text`} className="block text-xs font-semibold">
              {LABEL[p]} {hasTitle ? "description" : "caption"}
              {REQUIRED[p].text ? " (required)" : " (optional)"}
            </label>
            <textarea
              id={`${id}-text`}
              name={`${p}.text`}
              value={fields.text}
              onChange={(e) => setField("text", e.target.value)}
              onBlur={() => setTouched((t) => ({ ...t, text: true }))}
              rows={5}
              maxLength={lim.text}
              aria-invalid={Boolean(on && textProblem)}
              aria-describedby={`${id}-text-count${on && textProblem ? ` ${id}-text-err` : ""}`}
              className="field mt-1 w-full min-w-0 text-sm"
            />
            <FieldMeta id={`${id}-text`} count={fields.text.length} limit={lim.text} problem={on ? textProblem : null} />
          </div>
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
          {p === "tiktok" && tt && <TikTokSettings tt={tt} />}
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

/** Character count under a caption field, plus its inline problem (blank required field / over the limit). */
function FieldMeta({ id, count, limit, problem }: { id: string; count: number; limit: number; problem: string | null }) {
  return (
    <div className="mt-1 flex flex-wrap items-start justify-between gap-x-3 text-xs">
      {problem ? (
        <p id={`${id}-err`} style={{ color: "var(--bad)" }}>
          {problem}
        </p>
      ) : (
        <span />
      )}
      <span id={`${id}-count`} className="text-muted tabular-nums" style={count > limit * 0.95 ? { color: "var(--bad)" } : undefined}>
        {count.toLocaleString("en-US")} / {limit.toLocaleString("en-US")}
      </span>
    </div>
  );
}

/** One caption for every selected platform: write or paste it once, apply it, then tweak per platform below. */
function SharedCaption({ selected, onApply }: { selected: Platform[]; onApply: (text: string) => void }) {
  const [text, setText] = useState("");
  const [note, setNote] = useState<StepResult>(null);
  const limit = Math.min(...selected.map((p) => CAPTION_LIMITS[p].text), 2200);
  return (
    <div className="min-w-0 space-y-2 rounded-control border border-border p-3">
      <label htmlFor="shared-caption" className="block text-sm font-semibold">
        Caption for all selected platforms
      </label>
      <p id="shared-caption-help" className="text-xs text-muted">
        Paste one caption, apply it to every platform switched on below, then adjust any of them in its own Caption and settings.
      </p>
      <textarea
        id="shared-caption"
        value={text}
        onChange={(e) => {
          setText(e.target.value);
          setNote(null);
        }}
        rows={4}
        maxLength={limit}
        aria-describedby="shared-caption-help shared-caption-count"
        className="field w-full min-w-0 text-sm"
      />
      <div className="flex flex-wrap items-center justify-between gap-2">
        <button
          type="button"
          className="btn btn-secondary"
          disabled={!selected.length}
          onClick={() => {
            if (!text.trim()) return setNote({ ok: false, message: "Write or paste a caption first." });
            onApply(text.trim());
            setNote({ ok: true, message: `Applied to ${selected.map((p) => LABEL[p]).join(", ")}.` });
          }}
        >
          Apply to selected platforms
        </button>
        <span id="shared-caption-count" className="text-xs text-muted tabular-nums">
          {text.length.toLocaleString("en-US")} / {limit.toLocaleString("en-US")}
        </span>
      </div>
      {!selected.length && <p className="text-xs text-muted">Switch on at least one platform below to apply a caption.</p>}
      <div aria-live="polite">
        <Status state={note} />
      </div>
    </div>
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

// ------------------------------------------------------------------ TikTok posting rules (Content Sharing Guidelines)
type TikTokInfo = {
  creator_avatar_url?: string;
  creator_nickname?: string;
  privacy_level_options: string[];
  comment_disabled: boolean;
  duet_disabled: boolean;
  stitch_disabled: boolean;
  max_video_post_duration_sec: number;
};
type TikTokChoices = ReturnType<typeof useTikTokChoices>;

const PRIVACY_LABEL: Record<string, string> = {
  PUBLIC_TO_EVERYONE: "Everyone",
  MUTUAL_FOLLOW_FRIENDS: "Friends",
  FOLLOWER_OF_CREATOR: "Followers",
  SELF_ONLY: "Only me",
};

function useTikTokChoices() {
  const [enabled, setEnabled] = useState(true);
  const [privacy, setPrivacy] = useState(""); // no default: the creator must choose
  const [disclose, setDisclose] = useState(false);
  const [organic, setOrganic] = useState(false);
  const [branded, setBranded] = useState(false);
  return { enabled, setEnabled, privacy, setPrivacy, disclose, setDisclose, organic, setOrganic, branded, setBranded };
}

function tiktokProblem(c: TikTokChoices, live: { info?: TikTokInfo; error?: string } | undefined, videoSeconds: number | null) {
  if (live?.error) return `TikTok: ${live.error}`;
  if (!live?.info) return null;
  if (videoSeconds && videoSeconds > live.info.max_video_post_duration_sec) {
    return `TikTok: this video is ${Math.round(videoSeconds)} s; your account can post up to ${live.info.max_video_post_duration_sec} s. Switch TikTok off or upload a shorter cut.`;
  }
  if (!c.privacy) return "TikTok: choose who can watch before posting.";
  if (c.disclose && !c.organic && !c.branded) return "TikTok: you switched on content disclosure; choose Your brand, Branded content, or both.";
  if (c.branded && c.privacy === "SELF_ONLY") return "TikTok: branded content can't be posted as Only me.";
  return null;
}

function TikTokSettings({ tt }: { tt: { choices: TikTokChoices; live?: { info?: TikTokInfo; error?: string }; videoSeconds: number | null } }) {
  const c = tt.choices;
  const info = tt.live?.info;
  if (!info) return <p className="text-xs" style={{ color: "var(--bad)" }}>{tt.live?.error ?? "Couldn't load your TikTok account settings."}</p>;
  const interactions = [
    ["allowComments", "Allow comments", info.comment_disabled],
    ["allowDuet", "Allow Duet", info.duet_disabled],
    ["allowStitch", "Allow Stitch", info.stitch_disabled],
  ] as const;
  return (
    <div className="space-y-3">
      <label className="block text-xs font-semibold">
        Who can watch this video
        <select name="tiktok.privacy" value={c.privacy} onChange={(e) => c.setPrivacy(e.target.value)} required={c.enabled} className="field mt-1 w-auto">
          <option value="" disabled>
            Choose…
          </option>
          {info.privacy_level_options.map((o) => (
            <option key={o} value={o} disabled={o === "SELF_ONLY" && c.disclose && c.branded}>
              {PRIVACY_LABEL[o] ?? o}
              {o === "SELF_ONLY" && c.disclose && c.branded ? " (not for branded content)" : ""}
            </option>
          ))}
        </select>
      </label>
      <div className="flex flex-wrap gap-4 text-xs font-semibold">
        {interactions.map(([k, l, off]) => (
          <label key={k} className={`flex min-h-11 items-center gap-2 ${off ? "text-muted" : ""}`}>
            <input type="checkbox" name={`tiktok.${k}`} defaultChecked={false} disabled={off} /> {l}
            {off ? " (off in your TikTok settings)" : ""}
          </label>
        ))}
      </div>
      <div className="space-y-2 rounded-control border border-border p-3">
        <label className="flex min-h-11 items-center gap-2 text-xs font-semibold">
          <input type="checkbox" name="tiktok.discloseContent" checked={c.disclose} onChange={(e) => c.setDisclose(e.target.checked)} /> Disclose video content
        </label>
        <p className="text-xs text-muted">Turn on if this video promotes goods or services in exchange for something of value: yourself, a third party, or both.</p>
        {c.disclose && (
          <div className="space-y-2 pl-6">
            <label className="flex min-h-11 items-start gap-2 text-xs">
              <input type="checkbox" name="tiktok.brandOrganic" checked={c.organic} onChange={(e) => c.setOrganic(e.target.checked)} className="mt-0.5" />
              <span>
                <span className="font-semibold">Your brand.</span> You are promoting yourself or your own business. TikTok labels it &quot;Promotional content&quot;.
              </span>
            </label>
            <label className="flex min-h-11 items-start gap-2 text-xs">
              <input type="checkbox" name="tiktok.brandContent" checked={c.branded} onChange={(e) => c.setBranded(e.target.checked)} className="mt-0.5" />
              <span>
                <span className="font-semibold">Branded content.</span> You are promoting another brand or a third party. TikTok labels it &quot;Paid partnership&quot;.
              </span>
            </label>
          </div>
        )}
      </div>
      <p className="text-xs text-muted">
        Max video length for your account: {info.max_video_post_duration_sec} s{tt.videoSeconds ? ` · this video: ${Math.round(tt.videoSeconds)} s` : ""}.
      </p>
    </div>
  );
}
