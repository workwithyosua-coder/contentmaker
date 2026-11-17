"use client";

import { useActionState, useState } from "react";
import type { StepResult } from "@/app/create/actions";

export function Status({ state }: { state: StepResult }) {
  if (!state) return null;
  return (
    <p className="text-xs" style={{ color: state.ok ? "var(--win)" : "var(--bad)" }}>
      {state.message}
    </p>
  );
}

const primary = "rounded-full bg-accent px-4 py-2 text-sm font-semibold text-accent-contrast disabled:opacity-60";
const secondary = "rounded-full border border-border px-4 py-2 text-sm font-semibold disabled:opacity-60";

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
      <textarea
        name="direction"
        required
        rows={3}
        placeholder="e.g. Is coffee actually bad for you?  ·  Tax on sugary drinks  ·  Why Indonesians love instant noodles  ·  anything in this week's news"
        className="w-full rounded-xl border border-border bg-bg px-3 py-2.5 text-sm outline-none focus:border-accent"
      />
      <div className="flex flex-wrap items-center gap-3">
        <button disabled={pending} className={primary}>
          {pending ? "The writers' room is brainstorming… (~30 s)" : "Pitch me 5 ideas"}
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
      <textarea
        name="feedback"
        rows={2}
        placeholder="What should change? e.g. make Ocu darker, shorter ending, more about the price, funnier hook…"
        className="w-full rounded-xl border border-border bg-bg px-3 py-2.5 text-sm outline-none focus:border-accent"
      />
      <div className="flex flex-wrap items-center gap-3">
        <button disabled={pending} className={secondary}>
          {pending ? "Rewriting… (~40 s)" : "Revise script"}
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
      className="rounded-full border border-border px-3 py-1 text-xs font-semibold"
    >
      {done ? "Copied ✓" : label}
    </button>
  );
}
