"use client";

import { useRouter } from "next/navigation";
import { useActionState, useEffect, useState } from "react";
import type { StepResult } from "@/app/create/actions";

export function Status({ state }: { state: StepResult }) {
  if (!state) return null;
  return (
    <p className="text-xs" style={{ color: state.ok ? "var(--win)" : "var(--bad)" }}>
      {state.message}
    </p>
  );
}

const primary = "btn btn-primary";
const secondary = "btn btn-secondary";

/** A button that runs one server action step, with a "working…" label (agent steps take 20–90 s). */
export function StepButton({
  action,
  label,
  pendingLabel,
  variant = "primary",
  confirmText,
}: {
  action: () => Promise<StepResult>;
  label: string;
  pendingLabel: string;
  variant?: "primary" | "secondary";
  confirmText?: string;
}) {
  const [state, run, pending] = useActionState(action, null);
  return (
    <form
      action={run}
      onSubmit={(e) => {
        if (confirmText && !confirm(confirmText)) e.preventDefault();
      }}
      className="flex flex-col items-start gap-1"
    >
      <button disabled={pending} className={variant === "primary" ? primary : secondary}>
        {pending ? pendingLabel : label}
      </button>
      <Status state={state} />
    </form>
  );
}

export function NewEpisodeForm({ action }: { action: (prev: StepResult, form: FormData) => Promise<StepResult> }) {
  const [state, run, pending] = useActionState(action, null);
  return (
    <form action={run} className="space-y-3">
      <label htmlFor="direction" className="label">
        Topic or direction
      </label>
      <textarea
        id="direction"
        name="direction"
        required
        rows={3}
        placeholder="e.g. Is coffee actually bad for you?  ·  Tax on sugary drinks  ·  Why Indonesians love instant noodles  ·  anything in this week's news"
        className="field"
      />
      <div className="flex flex-wrap items-center gap-3">
        <button disabled={pending} className={primary}>
          {pending ? "Starting…" : "Pitch me 5 ideas"}
        </button>
        <Status state={state} />
      </div>
    </form>
  );
}

export function ReviseForm({ action }: { action: (prev: StepResult, form: FormData) => Promise<StepResult> }) {
  const [state, run, pending] = useActionState(action, null);
  return (
    <form action={run} className="space-y-2">
      <label htmlFor="feedback" className="label">
        What should change?
      </label>
      <textarea
        id="feedback"
        name="feedback"
        rows={2}
        placeholder="e.g. make Ocu darker, shorter ending, more about the price, funnier hook…"
        className="field"
      />
      <div className="flex flex-wrap items-center gap-3">
        <button disabled={pending} className={secondary}>
          {pending ? "Starting…" : "Revise script"}
        </button>
        <Status state={state} />
      </div>
    </form>
  );
}

export function CopyButton({ text, label = "Copy" }: { text: string; label?: string }) {
  const [done, setDone] = useState(false);
  return (
    <button
      type="button"
      onClick={async () => {
        await navigator.clipboard.writeText(text);
        setDone(true);
        setTimeout(() => setDone(false), 1500);
      }}
      className="btn btn-secondary"
    >
      {done ? "Copied ✓" : label}
    </button>
  );
}

/** While a background step runs, re-fetch the page every few seconds so results appear by themselves. */
export function AutoRefresh({ active, everyMs = 4000 }: { active: boolean; everyMs?: number }) {
  const router = useRouter();
  useEffect(() => {
    if (!active) return;
    const t = setInterval(() => router.refresh(), everyMs);
    return () => clearInterval(t);
  }, [active, everyMs, router]);
  return null;
}

/** Render progress bar: the percentage and stage the renderer last reported (the page refreshes every few seconds). */
export function RenderProgress({ job }: { job: { status: string; progress: number | null; stage: string | null } }) {
  const pct = job.status === "queued" ? 0 : (job.progress ?? 0);
  const stage = job.status === "queued" ? "Waiting for GitHub to start the render" : (job.stage ?? "Starting");
  return (
    <div className="space-y-1">
      <div className="flex items-baseline justify-between gap-3 text-xs">
        <span className="font-semibold">{stage}…</span>
        <span className="font-mono tabular-nums">{pct}%</span>
      </div>
      <div
        role="progressbar"
        aria-label="Rendering progress"
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={pct}
        aria-valuetext={`${pct}%, ${stage}`}
        className="h-3 overflow-hidden rounded-control border border-border bg-surface-2"
      >
        <div className="h-full bg-accent transition-[width] duration-700 ease-out motion-reduce:transition-none" style={{ width: `${pct}%` }} />
      </div>
    </div>
  );
}
