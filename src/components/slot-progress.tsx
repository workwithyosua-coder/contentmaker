"use client";

import { useNow } from "./use-now";
import { STAGE_LABEL, freshness, isActiveStage, milestones, type MilestoneState, type ProgressStage } from "@/lib/slotProgress";

// The pipeline progress block inside a Schedule slot card: the worker's real step and percentage, an accessible bar,
// the 5-step strip (Script, Props, Voice, Render, Post) and when the worker last reported. No timer-driven numbers:
// without a reported percentage the bar stays indeterminate ("Waiting").

export type ProgressFields = {
  status: string;
  progressPercent: number | null;
  progressStage: string | null;
  progressDetail: string | null;
  progressUpdatedAt: string | null;
};

/** Whether a card shows the block: running, failed with a reached point, or just finished (briefly at 100 %). */
export function showsProgress(s: ProgressFields, now: number | null): boolean {
  if (s.status === "failed") return s.progressStage !== null || s.progressPercent !== null;
  if (isActiveStage(s.progressStage)) return true;
  if (s.progressStage === "done" && s.progressUpdatedAt && now !== null) return now - new Date(s.progressUpdatedAt).getTime() < 90_000;
  return false;
}

const MARK: Record<MilestoneState, { icon: string; sr: string }> = {
  done: { icon: "✓", sr: "done" },
  current: { icon: "●", sr: "in progress" },
  todo: { icon: "○", sr: "to do" },
  failed: { icon: "✕", sr: "stopped here" },
};

export function SlotProgress({ slot: s, name }: { slot: ProgressFields; name: string }) {
  const failed = s.status === "failed";
  const active = !failed && isActiveStage(s.progressStage);
  // the "Updated 6s ago" line ticks every second (not rendered on the server: no hydration mismatch)
  const now = useNow(1000);
  const stage = (s.progressStage ?? "starting") as ProgressStage;
  const determinate = s.progressPercent !== null;
  const pct = s.progressPercent ?? 0;
  const label = STAGE_LABEL[stage] ?? "Starting";
  const detail = s.progressDetail ?? (stage === "starting" ? "Starting GitHub worker..." : label);
  const fresh = now === null ? null : freshness(s.progressUpdatedAt, now, active);
  const steps = milestones(stage, failed);
  return (
    <div className="min-w-0 space-y-2" data-testid="slot-progress" data-stage={stage} data-state={failed ? "failed" : stage === "done" ? "done" : determinate ? "running" : "waiting"}>
      <div className="flex min-w-0 items-baseline justify-between gap-3 text-sm">
        <span className="min-w-0 break-words">{detail}</span>
        <span className="shrink-0 font-semibold tabular-nums">{determinate ? `${pct}%` : "Waiting"}</span>
      </div>
      <div
        role="progressbar"
        aria-label={`Pipeline progress for ${name}`}
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={determinate ? pct : undefined}
        aria-valuetext={`${failed ? `Failed while ${label.toLowerCase()}` : label}${determinate ? `, ${pct}%` : ", waiting for the worker"}`}
        className="h-2 w-full overflow-hidden rounded-full bg-[var(--surface-2)]"
      >
        {determinate && (
          <div
            className={`h-full rounded-full transition-[width] duration-200 ease-out motion-reduce:transition-none ${failed ? "bg-[var(--bad)] opacity-70" : "bg-[var(--accent)]"}`}
            style={{ width: `${pct}%` }}
          />
        )}
      </div>
      <p className="sr-only" aria-live="polite">
        {failed ? `Failed while ${label.toLowerCase()}` : label}
      </p>
      <ol className="grid grid-cols-5 gap-1 text-[11px] leading-tight" aria-label="Pipeline steps">
        {steps.map((m) => (
          <li
            key={m.label}
            className={`flex min-w-0 items-center gap-1 ${m.state === "current" || m.state === "failed" ? "font-bold" : m.state === "done" ? "font-medium" : "text-muted"} ${m.state === "failed" ? "text-[var(--bad)]" : ""}`}
          >
            <span aria-hidden>{MARK[m.state].icon}</span>
            <span className="truncate">{m.label}</span>
            <span className="sr-only">, {MARK[m.state].sr}</span>
          </li>
        ))}
      </ol>
      {fresh && <p className={`text-xs ${fresh.stale ? "font-semibold text-[var(--text)]" : "text-muted"}`}>{fresh.text}</p>}
    </div>
  );
}
