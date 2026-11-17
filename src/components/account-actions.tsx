"use client";

import { useActionState } from "react";
import { removeAccountAction, removeDemoDataAction, syncNowAction } from "@/app/accounts/actions";

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

export function RemoveAccountButton({ accountId, name }: { accountId: string; name: string }) {
  const [state, action, pending] = useActionState(() => removeAccountAction(accountId), null);
  return (
    <form
      action={action}
      onSubmit={(e) => {
        if (!confirm(`Remove ${name} from Studio? Its posts and stats are deleted here (nothing changes on the platform itself).`)) e.preventDefault();
      }}
      className="flex shrink-0 flex-col items-end gap-1"
    >
      <button disabled={pending} className="rounded-full px-2 py-1 text-[11px] font-semibold text-muted hover:text-text disabled:opacity-60">
        {pending ? "Removing…" : "Remove"}
      </button>
      {state && !state.ok && <p className="text-[11px]" style={{ color: "var(--bad)" }}>{state.message}</p>}
    </form>
  );
}
