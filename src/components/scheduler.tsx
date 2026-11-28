"use client";

import Link from "next/link";
import { SlotProgress, showsProgress } from "./slot-progress";
import { useNow } from "./use-now";
import { POLL_MS, isActiveStage, shouldPoll } from "@/lib/slotProgress";
import { useRouter } from "next/navigation";
import {
  useActionState,
  useEffect,
  useId,
  useState,
  useTransition,
} from "react";
import {
  regenerateSlotAction,
  retrySlotAction,
  runSlotAction,
  savePropAction,
  saveScheduleAction,
  setSeedAction,
  setSeedsAction,
  type Result,
} from "@/app/schedule/actions";
import {
  CADENCES,
  FORMATS,
  SCHEDULE_STYLES,
  FORMAT_IDS,
  QUEUE_LABEL,
  TARGETS,
  TARGET_LABEL,
  defaultSlotTimes,
  formatWib,
  isWorking,
  type EpisodeFormat,
  type QueueStatus,
  type ScheduleRule,
} from "@/lib/scheduler";

// The Schedule page's controls: the rule editor, the upcoming queue and the Prop Bank tags. Plain forms, no AI.

const option =
  "flex min-h-11 cursor-pointer items-center gap-2 rounded-control border border-border px-3 text-sm has-[:checked]:border-[var(--text)] has-[:focus-visible]:outline has-[:focus-visible]:outline-2";
const WEEKDAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

function Note({ state }: { state: Result }) {
  if (!state) return null;
  return (
    <p
      role={state.ok ? "status" : "alert"}
      className={`text-sm ${state.ok ? "text-muted" : "text-[var(--bad)]"}`}
    >
      {state.message}
    </p>
  );
}

// ------------------------------------------------------------------ the rule
export function RuleEditor({
  initial,
  rvcReady,
  geminiReady,
}: {
  initial: ScheduleRule;
  rvcReady: { uco: boolean; ocu: boolean };
  geminiReady: boolean;
}) {
  const id = useId();
  const [r, setR] = useState(initial);
  const [state, setState] = useState<Result>(null);
  const [pending, start] = useTransition();
  const set = <K extends keyof ScheduleRule>(k: K, v: ScheduleRule[K]) =>
    setR((x) => ({ ...x, [k]: v }));
  const setSlots = (n: number) =>
    setR((x) => {
      const times = defaultSlotTimes(n).map((t, i) => x.slot_times[i] ?? t);
      return {
        ...x,
        slots_per_day: n,
        slot_times: times,
        format_mix: Array.from(
          { length: n },
          (_, i) => x.format_mix[i] ?? x.format_mix[i % x.format_mix.length],
        ),
      };
    });
  const toggle = <T,>(list: T[], v: T) =>
    list.includes(v) ? list.filter((x) => x !== v) : [...list, v];
  const missingModels = (["uco", "ocu"] as const).filter((w) => !rvcReady[w]);

  return (
    <form
      className="min-w-0 space-y-5"
      onSubmit={(e) => {
        e.preventDefault();
        start(async () => setState(await saveScheduleAction(r)));
      }}
    >
      <fieldset className="min-w-0 space-y-2">
        <legend className="text-sm font-semibold">Cadence</legend>
        <div className="grid grid-cols-3 gap-2">
          {CADENCES.map((c) => (
            <label key={c} className={option}>
              <input
                type="radio"
                name="cadence"
                className="h-5 w-5"
                checked={r.cadence === c}
                onChange={() => set("cadence", c)}
              />
              {c[0].toUpperCase() + c.slice(1)}
            </label>
          ))}
        </div>
        {r.cadence === "weekly" && (
          <div
            className="grid grid-cols-4 gap-2 sm:grid-cols-7"
            role="group"
            aria-label="Days of the week"
          >
            {WEEKDAYS.map((d, i) => (
              <label key={d} className={option}>
                <input
                  type="checkbox"
                  className="h-5 w-5"
                  checked={r.days_of_week.includes(i)}
                  onChange={() =>
                    set("days_of_week", toggle(r.days_of_week, i).sort())
                  }
                />
                {d}
              </label>
            ))}
          </div>
        )}
        {r.cadence === "monthly" && (
          <label className="block">
            <span className="label">Days of the month</span>
            <input
              className="field"
              inputMode="numeric"
              defaultValue={r.days_of_month.join(", ")}
              onBlur={(e) =>
                set(
                  "days_of_month",
                  [
                    ...new Set(
                      e.target.value
                        .split(/[^\d]+/)
                        .map(Number)
                        .filter((n) => n >= 1 && n <= 31),
                    ),
                  ].sort((a, b) => a - b),
                )
              }
              aria-describedby={`${id}-dom`}
            />
            <span id={`${id}-dom`} className="mt-1 block text-xs text-muted">
              Comma-separated, e.g. 1, 8, 15, 22. Days a month doesn&apos;t have
              are skipped.
            </span>
          </label>
        )}
        <p className="text-xs text-muted">
          Every active day gets all of its slots: at least 2 episodes a day.
        </p>
      </fieldset>

      <fieldset className="min-w-0 space-y-2">
        <legend className="text-sm font-semibold">Slots per day (WIB)</legend>
        <label className="flex items-center gap-3">
          <span className="text-sm">Episodes a day</span>
          <select
            className="field w-24"
            value={r.slots_per_day}
            onChange={(e) => setSlots(Number(e.target.value))}
          >
            {[2, 3, 4, 5, 6].map((n) => (
              <option key={n} value={n}>
                {n}
              </option>
            ))}
          </select>
        </label>
        <ol className="space-y-2">
          {r.slot_times.map((t, i) => (
            <li key={i} className="min-w-0 space-y-1">
              <span className="block text-xs font-semibold text-muted">
                Slot {i + 1}
              </span>
              <div className="grid min-w-0 grid-cols-[minmax(0,9.5rem)_minmax(0,1fr)] gap-2">
                <input
                  type="time"
                  className="field"
                  aria-label={`Slot ${i + 1} time (WIB)`}
                  value={t}
                  onChange={(e) =>
                    set(
                      "slot_times",
                      r.slot_times.map((x, j) =>
                        j === i ? e.target.value : x,
                      ),
                    )
                  }
                />
                <select
                  className="field min-w-0"
                  aria-label={`Slot ${i + 1} format`}
                  value={r.format_mix[i]}
                  onChange={(e) =>
                    set(
                      "format_mix",
                      r.format_mix.map((x, j) =>
                        j === i ? (e.target.value as EpisodeFormat) : x,
                      ),
                    )
                  }
                >
                  {FORMAT_IDS.map((f) => (
                    <option key={f} value={f}>
                      {FORMATS[f].label}
                    </option>
                  ))}
                </select>
              </div>
            </li>
          ))}
        </ol>
      </fieldset>

      <fieldset className="min-w-0 space-y-2">
        <legend className="text-sm font-semibold">Visual style</legend>
        <div className="grid gap-2 sm:grid-cols-2">
          {SCHEDULE_STYLES.map((v) => (
            <label key={v.id} className={option}>
              <input type="radio" name="visual_style" className="h-5 w-5" checked={r.visual_style === v.id} onChange={() => set("visual_style", v.id)} />
              {v.label}
            </label>
          ))}
        </div>
        <p className="text-xs text-muted">Every scheduled episode renders in this style: the illustrated cast, generated props, callouts and stat cards.</p>
      </fieldset>

      <fieldset className="min-w-0 space-y-2">
        <legend className="text-sm font-semibold">Voice</legend>
        <div className="grid gap-2 sm:grid-cols-2">
          <label className={option}>
            <input
              type="radio"
              name="voice"
              className="h-5 w-5"
              checked={r.voice_provider === "gemini_tts"}
              onChange={() => set("voice_provider", "gemini_tts")}
            />
            Gemini TTS (Free)
          </label>
          <label className={option}>
            <input
              type="radio"
              name="voice"
              className="h-5 w-5"
              checked={r.voice_provider === "gemini_tts_rvc"}
              onChange={() => set("voice_provider", "gemini_tts_rvc")}
            />
            Own Voice (Gemini + RVC)
          </label>
        </div>
        {r.voice_provider === "gemini_tts_rvc" && missingModels.length > 0 && (
          <p className="text-sm text-[var(--bad)]" role="alert">
            Own Voice slots fail until{" "}
            {missingModels.map((w) => `${w}-voice.pth`).join(" and ")}{" "}
            {missingModels.length > 1 ? "are" : "is"} uploaded.{" "}
            <Link
              href="/accounts#studio-assets"
              className="font-semibold underline underline-offset-2"
            >
              Open Studio Assets
            </Link>
          </p>
        )}
        {!geminiReady && (
          <p className="text-sm text-[var(--bad)]">
            GEMINI_API_KEY is not set in environment variables. Scripts, topics
            and voices need it.
          </p>
        )}
      </fieldset>

      <fieldset className="min-w-0 space-y-2">
        <legend className="text-sm font-semibold">Post to</legend>
        <div className="grid gap-2 sm:grid-cols-2">
          {TARGETS.map((t) => (
            <label key={t} className={option}>
              <input
                type="checkbox"
                className="h-5 w-5"
                checked={r.target_platforms.includes(t)}
                onChange={() =>
                  set("target_platforms", toggle(r.target_platforms, t))
                }
              />
              {TARGET_LABEL[t]}
            </label>
          ))}
        </div>
        <p className="text-xs text-muted">
          TikTok is a hand-off: the queue shows the caption to copy and the
          video to download, for posting with Yellow Basket tags.
        </p>
      </fieldset>

      <label className="block">
        <span className="label">Topic direction (optional)</span>
        <textarea
          className="field min-h-20"
          maxLength={300}
          value={r.topic_hint ?? ""}
          onChange={(e) => set("topic_hint", e.target.value || null)}
          placeholder="e.g. money habits of first-jobbers, food myths"
        />
        <span className="mt-1 block text-xs text-muted">
          Gemini suggests topics for slots without one. Your own topics in the
          queue always win.
        </span>
      </label>

      <label className="flex min-h-11 cursor-pointer items-start gap-3 rounded-control border border-border p-3 has-[:focus-visible]:outline has-[:focus-visible]:outline-2">
        <input
          type="checkbox"
          role="switch"
          className="mt-0.5 h-5 w-5 shrink-0"
          checked={r.auto_execute}
          onChange={(e) => set("auto_execute", e.target.checked)}
        />
        <span className="min-w-0">
          <span className="block text-sm font-semibold">Auto-execute</span>
          <span className="block text-xs text-muted">
            GitHub runs at 09:47 and 17:47 WIB, makes the slots due next and
            posts them at their time. Off: the queue fills, nothing runs until
            you tap Run slot now.
          </span>
        </span>
      </label>

      <div className="flex flex-wrap items-center gap-3">
        <button className="btn btn-primary" disabled={pending}>
          {pending ? "Saving…" : "Save schedule"}
        </button>
        <Note state={state} />
      </div>
    </form>
  );
}

// ------------------------------------------------------------------ the queue
export type SlotView = {
  id: string;
  scheduledFor: string;
  format: EpisodeFormat;
  topic: string | null;
  topicSource: string | null;
  status: QueueStatus;
  episodeId: string | null;
  episodeTitle: string | null;
  error: string | null;
  runUrl: string | null;
  /**
   * While the pipeline runs this holds only the episode's props ({ props, propWarning }); the posting fields arrive
   * when the slot finishes. So every posting field is optional here and read defensively.
   */
  handoff: {
    tiktokCaption?: string | null;
    queued?: string[];
    postAt?: string;
    notConnected?: string[];
    /** why generated props failed, in short (the episode renders without them) */
    propWarning?: string | null;
  } | null;
  videoUrl: string | null;
  /** Affiliate Debate: the product this queued slot is pinned to (null: the least recently used active one) */
  affiliateProductId?: string | null;
  progressPercent: number | null;
  progressStage: string | null;
  progressDetail: string | null;
  progressUpdatedAt: string | null;
};

const STAMP_COLOR: Record<QueueStatus, string> = {
  queued: "var(--muted)",
  scripting: "var(--text)",
  voicing: "var(--text)",
  rendering: "var(--text)",
  ready_to_post: "var(--good)",
  published: "var(--win)",
  failed: "var(--bad)",
};

export function SeedsForm() {
  const [state, action, pending] = useActionState(setSeedsAction, null);
  return (
    <form action={action} className="min-w-0 space-y-2">
      <label className="block">
        <span className="label">Topics for the next open slots</span>
        <textarea
          name="seeds"
          className="field min-h-24"
          placeholder={
            "One topic per line, e.g.\nKenapa harga cabai naik tiap Lebaran\nPaylater buat beli kopi: pintar atau bahaya?"
          }
        />
      </label>
      <div className="flex flex-wrap items-center gap-3">
        <button className="btn btn-secondary" disabled={pending}>
          {pending ? "Adding…" : "Add topics"}
        </button>
        <Note state={state} />
      </div>
    </form>
  );
}

type Live = Pick<SlotView, "id" | "status" | "error" | "runUrl" | "episodeId" | "episodeTitle" | "handoff" | "progressPercent" | "progressStage" | "progressDetail" | "progressUpdatedAt">;

/**
 * The queue, with live pipeline progress: while a slot is running and the tab is visible, the progress fields come
 * from /api/schedule/queue every 4 s; polling stops when every slot is idle, done or failed, and pauses while the tab
 * is hidden. A slot whose status changed brings in the full card (hand-off, buttons) with one page refresh.
 */
export type SlotProductOption = { id: string; name: string };

export function QueueList({
  slots,
  canRun,
  products = [],
  setSlotProduct,
}: {
  slots: SlotView[];
  canRun: boolean;
  /** active Affiliate Product Bank products, for a queued Affiliate Debate slot's picker */
  products?: SlotProductOption[];
  setSlotProduct?: (slotId: string, productId: string) => Promise<{ ok: boolean; message: string }>;
}) {
  const router = useRouter();
  const [live, setLive] = useState<SlotView[]>(slots);
  // a server refresh brings new slots: they replace the live copy (React's "adjust state on a prop change" pattern)
  const [given, setGiven] = useState(slots);
  if (slots !== given) {
    setGiven(slots);
    setLive(slots);
  }
  const [visible, setVisible] = useState(true);
  useEffect(() => {
    const read = () => setVisible(document.visibilityState === "visible");
    read();
    document.addEventListener("visibilitychange", read);
    return () => document.removeEventListener("visibilitychange", read);
  }, []);
  const polling = shouldPoll(live, visible ? "visible" : "hidden");
  useEffect(() => {
    if (!polling) return;
    let stopped = false;
    const t = setInterval(async () => {
      try {
        const res = await fetch("/api/schedule/queue", { cache: "no-store" });
        if (!res.ok || stopped) return;
        const { slots: fresh } = (await res.json()) as { slots: Live[] };
        let statusChanged = false;
        setLive((cur) =>
          cur.map((s) => {
            const f = fresh.find((x) => x.id === s.id);
            if (!f) return s;
            if (f.status !== s.status) statusChanged = true;
            return { ...s, ...f, status: f.status as SlotView["status"] };
          }),
        );
        if (statusChanged) router.refresh();
      } catch {
        // a missed poll is retried on the next tick
      }
    }, POLL_MS);
    return () => {
      stopped = true;
      clearInterval(t);
    };
  }, [polling, router]);
  if (!live.length) return <p className="text-sm text-muted">No slots yet. Save the schedule to fill the next 3 days.</p>;
  return (
    <ol className="space-y-3" data-polling={polling ? "on" : "off"}>
      {live.map((s) => (
        <li key={s.id} className="min-w-0 rounded-control border border-border p-3" aria-busy={isActiveStage(s.progressStage) && s.status !== "failed" ? true : undefined}>
          <SlotRow slot={s} canRun={canRun} products={products} setSlotProduct={setSlotProduct} />
        </li>
      ))}
    </ol>
  );
}

/** A queued Affiliate Debate slot's product: Auto (least recently used active product) or one from the bank. */
function SlotProductPicker({ slot, products, save }: { slot: SlotView; products: SlotProductOption[]; save: (slotId: string, productId: string) => Promise<{ ok: boolean; message: string }> }) {
  const [value, setValue] = useState(slot.affiliateProductId ?? "");
  const [msg, setMsg] = useState<{ ok: boolean; message: string } | null>(null);
  const [pending, start] = useTransition();
  const id = `slot-product-${slot.id}`;
  return (
    <div className="space-y-1" data-slot-product>
      <label htmlFor={id} className="block text-xs font-semibold">
        Product
      </label>
      <select
        id={id}
        className="field min-w-0"
        value={value}
        disabled={pending}
        onChange={(e) => {
          const v = e.target.value;
          setValue(v);
          start(async () => setMsg(await save(slot.id, v)));
        }}
      >
        <option value="">Auto: least recently used active product</option>
        {products.map((p) => (
          <option key={p.id} value={p.id}>
            {p.name}
          </option>
        ))}
      </select>
      <p aria-live="polite" className="text-xs" style={{ color: msg && !msg.ok ? "var(--bad)" : "var(--muted)" }}>
        {pending ? "Saving..." : msg?.message ?? (products.length ? "" : "No active products: this slot runs as a regular Comedy Debate.")}
      </p>
    </div>
  );
}

function SlotRow({
  slot: s,
  canRun,
  products = [],
  setSlotProduct,
}: {
  slot: SlotView;
  canRun: boolean;
  products?: SlotProductOption[];
  setSlotProduct?: (slotId: string, productId: string) => Promise<{ ok: boolean; message: string }>;
}) {
  const [state, setState] = useState<Result>(null);
  const [pending, start] = useTransition();
  const [editing, setEditing] = useState(false);
  const [topic, setTopic] = useState(s.topic ?? "");
  const [copied, setCopied] = useState(false);
  // a finished slot shows its 100 % bar for a short while, then settles into Ready to post / Published
  const now = useNow(10_000);
  const run = (fn: () => Promise<Result>) =>
    start(async () => setState(await fn()));
  return (
    <div className="min-w-0 space-y-2">
      <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
        <span className="text-sm font-semibold">
          {formatWib(new Date(s.scheduledFor))}
        </span>
        <span className="stamp" style={{ color: STAMP_COLOR[s.status] }}>
          {QUEUE_LABEL[s.status]}
        </span>
        <span className="text-xs text-muted">{FORMATS[s.format].label}</span>
      </div>

      {editing ? (
        <form
          className="flex min-w-0 flex-wrap gap-2"
          onSubmit={(e) => {
            e.preventDefault();
            run(async () => {
              const r = await setSeedAction(s.id, topic);
              if (r?.ok) setEditing(false);
              return r;
            });
          }}
        >
          <input
            className="field min-w-0 flex-1 basis-56"
            value={topic}
            maxLength={300}
            onChange={(e) => setTopic(e.target.value)}
            aria-label="Topic"
            autoFocus
          />
          <button className="btn btn-secondary" disabled={pending}>
            Save
          </button>
          <button
            type="button"
            className="btn btn-quiet"
            onClick={() => setEditing(false)}
          >
            Cancel
          </button>
        </form>
      ) : (
        <p className="break-words text-sm">
          {s.episodeTitle ? (
            s.episodeId ? (
              <Link
                href={`/create/${s.episodeId}`}
                className="font-semibold underline underline-offset-2"
              >
                {s.episodeTitle}
              </Link>
            ) : (
              s.episodeTitle
            )
          ) : (
            (s.topic ?? (
              <span className="text-muted">
                No topic yet: Gemini suggests one before the slot runs.
              </span>
            ))
          )}
          {s.topic && s.topicSource === "gemini" && !s.episodeTitle && (
            <span className="text-xs text-muted"> (Gemini)</span>
          )}
        </p>
      )}

      {s.format === "affiliate" && s.status === "queued" && setSlotProduct && <SlotProductPicker slot={s} products={products} save={setSlotProduct} />}

      {showsProgress(s, now) && <SlotProgress slot={s} name={s.episodeTitle ?? s.topic ?? formatWib(new Date(s.scheduledFor))} />}

      {s.status === "failed" && s.error && <p className="break-words text-sm text-[var(--bad)]">{s.error}</p>}
      {s.handoff?.propWarning && (
        <p className="break-words text-xs text-muted" data-prop-warning>
          <span className="font-semibold text-[var(--text)]">Props:</span> {s.handoff.propWarning}
        </p>
      )}

      {s.handoff &&
        (s.status === "ready_to_post" || s.status === "published") && (
          <div className="min-w-0 space-y-2 text-sm">
            {(s.handoff.queued?.length ?? 0) > 0 && s.handoff.postAt && (
              <p className="text-muted">
                Posting to {s.handoff.queued!.join(", ")} at{" "}
                {formatWib(new Date(s.handoff.postAt))}.
              </p>
            )}
            {(s.handoff.notConnected?.length ?? 0) > 0 && (
              <p className="text-muted">
                Not connected: {s.handoff.notConnected!.join(", ")}. Connect on
                Accounts to post there.
              </p>
            )}
            {s.handoff.tiktokCaption && (
              <div className="min-w-0 space-y-2 rounded-control border border-border p-3">
                <p className="text-xs font-semibold">
                  TikTok / Shopee hand-off
                </p>
                <p className="whitespace-pre-wrap break-words text-xs text-muted">
                  {s.handoff.tiktokCaption}
                </p>
                <div className="flex flex-wrap gap-2">
                  <button
                    type="button"
                    className="btn btn-secondary"
                    onClick={() =>
                      navigator.clipboard
                        ?.writeText(s.handoff!.tiktokCaption!)
                        .then(
                          () => setCopied(true),
                          () => setCopied(false),
                        )
                    }
                  >
                    {copied ? "Copied" : "Copy caption"}
                  </button>
                  {s.videoUrl && (
                    <a className="btn btn-secondary" href={s.videoUrl} download>
                      Download video
                    </a>
                  )}
                </div>
              </div>
            )}
          </div>
        )}

      <div className="flex flex-wrap items-center gap-2">
        {s.status === "queued" && (
          <>
            <button
              type="button"
              className="btn btn-outline"
              disabled={pending || !canRun}
              onClick={() => run(() => runSlotAction(s.id))}
            >
              Run slot now
            </button>
            {!editing && (
              <button
                type="button"
                className="btn btn-quiet"
                onClick={() => setEditing(true)}
              >
                {s.topic ? "Edit topic" : "Add topic"}
              </button>
            )}
          </>
        )}
        {s.status === "failed" && s.runUrl && (
          <a href={s.runUrl} target="_blank" rel="noreferrer" className="btn btn-quiet underline underline-offset-2">
            Run log
          </a>
        )}
        {s.status === "failed" && (
          <button
            type="button"
            className="btn btn-outline"
            disabled={pending}
            onClick={() => run(() => retrySlotAction(s.id))}
          >
            Retry
          </button>
        )}
        {(s.status === "failed" || s.status === "queued") && s.episodeId && (
          <button
            type="button"
            className="btn btn-outline"
            disabled={pending}
            onClick={() => {
              if (window.confirm(`Delete the draft "${s.episodeTitle ?? "episode"}" (script, voices, video) and write a fresh script for this slot?`))
                run(() => regenerateSlotAction(s.id));
            }}
          >
            Regenerate script &amp; run
          </button>
        )}
        {isWorking(s.status) && s.runUrl && (
          <a
            href={s.runUrl}
            target="_blank"
            rel="noreferrer"
            className="btn btn-quiet"
          >
            Watch on GitHub
          </a>
        )}
      </div>
      <Note state={state} />
    </div>
  );
}

// ------------------------------------------------------------------ the Prop Bank
export type PropView = {
  name: string;
  keywords: string[];
  category: string | null;
  vetted: boolean;
  source: "repo" | "upload";
  url: string | null;
};

export function PropBankList({ props }: { props: PropView[] }) {
  if (!props.length)
    return (
      <p className="text-sm text-muted">
        No props yet. Upload props on an episode&apos;s asset checklist; they
        appear here to tag.
      </p>
    );
  return (
    <ul className="space-y-3">
      {props.map((p) => (
        <li
          key={p.name}
          className="min-w-0 rounded-control border border-border p-3"
        >
          <PropRow prop={p} />
        </li>
      ))}
    </ul>
  );
}

function PropRow({ prop }: { prop: PropView }) {
  const [tags, setTags] = useState(prop.keywords.join(", "));
  const [vetted, setVetted] = useState(prop.vetted);
  const [state, setState] = useState<Result>(null);
  const [pending, start] = useTransition();
  const dirty = tags !== prop.keywords.join(", ") || vetted !== prop.vetted;
  return (
    <form
      className="min-w-0 space-y-2"
      onSubmit={(e) => {
        e.preventDefault();
        start(async () =>
          setState(
            await savePropAction(prop.name, tags, vetted, prop.category ?? ""),
          ),
        );
      }}
    >
      <div className="flex min-w-0 items-center gap-3">
        {prop.url ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={prop.url}
            alt=""
            width={44}
            height={44}
            className="h-11 w-11 shrink-0 rounded-[6px] border border-border bg-surface-2 object-contain"
          />
        ) : (
          <span
            className="h-11 w-11 shrink-0 rounded-[6px] border border-border bg-surface-2"
            aria-hidden
          />
        )}
        <div className="min-w-0">
          <code className="block break-all text-sm font-semibold">
            {prop.name}
          </code>
          <span className="text-xs text-muted">
            {prop.source === "repo" ? "Built in" : "Uploaded"}
          </span>
        </div>
      </div>
      <label className="block">
        <span className="label">Keywords</span>
        <input
          className="field"
          value={tags}
          onChange={(e) => setTags(e.target.value)}
          placeholder="comma-separated, e.g. kopi, es kopi, latte"
        />
      </label>
      <div className="flex flex-wrap items-center gap-3">
        <label className="flex min-h-11 cursor-pointer items-center gap-2 text-sm">
          <input
            type="checkbox"
            className="h-5 w-5"
            checked={vetted}
            onChange={(e) => setVetted(e.target.checked)}
          />
          Use in unattended episodes
        </label>
        <button className="btn btn-secondary" disabled={pending || !dirty}>
          {pending ? "Saving…" : "Save tags"}
        </button>
      </div>
      <Note state={state} />
    </form>
  );
}
