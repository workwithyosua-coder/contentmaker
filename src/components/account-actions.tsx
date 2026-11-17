"use client";

import { useActionState } from "react";
import { removeDemoDataAction, syncNowAction } from "@/app/accounts/actions";

function Status({ state }: { state: { ok: boolean; message: string } | null }) {
  if (!state) return null;
  return <p className="text-xs" style={{ color: state.ok ? "var(--win)" : "var(--bad)" }}>{state.message}</p>;
}

export function SyncNowButton() {
  const [state, action, pending] = useActionState(syncNowAction, null);
  return (
    <form action={action} className="flex flex-col items-end gap-1">
      <button disabled={pending} className="rounded-full border border-border px-3 py-1.5 text-xs font-semibold disabled:opacity-60">
        {pending ? "Syncing…" : "Sync now"}
      </button>
      <Status state={state} />
    </form>
  );
}

export function RemoveDemoButton() {
  const [state, action, pending] = useActionState(removeDemoDataAction, null);
  return (
    <form
      action={action}
      onSubmit={(e) => {
        if (!confirm("Delete all demo posts, demo accounts and the insights based on them?")) e.preventDefault();
      }}
      className="flex flex-col items-start gap-1"
    >
      <button disabled={pending} className="rounded-full border border-border px-3 py-1.5 text-xs font-semibold disabled:opacity-60" style={{ color: "var(--bad)" }}>
        {pending ? "Removing…" : "Remove demo data"}
      </button>
      <Status state={state} />
    </form>
  );
}
