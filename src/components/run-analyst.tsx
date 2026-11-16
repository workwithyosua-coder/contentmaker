"use client";

import { useActionState } from "react";
import { runAnalystAction } from "@/app/actions";

export function RunAnalystButton() {
  const [state, action, pending] = useActionState(runAnalystAction, null);
  return (
    <form action={action} className="flex flex-col items-start gap-2 sm:items-end">
      <button
        type="submit"
        disabled={pending}
        className="rounded-full bg-accent px-4 py-2 text-sm font-semibold text-accent-contrast disabled:opacity-60"
      >
        {pending ? "Analyzing… (up to a minute)" : "Run Analyst"}
      </button>
      {state && !state.ok && <p className="text-xs" style={{ color: "var(--bad)" }}>{state.error}</p>}
      {state?.ok && (
        <p className="text-xs" style={{ color: "var(--win)" }}>
          {state.insights} insights updated · cost ${state.costUsd.toFixed(3)}
        </p>
      )}
    </form>
  );
}
