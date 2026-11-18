"use client";

import { useActionState } from "react";
import { removeAccountAction, setCountFromAction, removeDemoDataAction, syncNowAction, disconnectDriveAction } from "@/app/accounts/actions";

function Status({ state }: { state: { ok: boolean; message: string } | null }) {
  if (!state) return null;
  return <p className="text-xs" style={{ color: state.ok ? "var(--win)" : "var(--bad)" }}>{state.message}</p>;
}

export function SyncNowButton() {
  const [state, action, pending] = useActionState(syncNowAction, null);
  return (
    <form action={action} className="flex flex-col items-end gap-1">
      <button disabled={pending} className="btn btn-secondary">
        {pending ? "Syncing…" : "Sync now"}
      </button>
      <Status state={state} />
    </form>
  );
}

/** "Count posts from" date: the dashboard ignores this account's posts from before it (they stay on the platform). */
export function CountFromForm({ accountId, value }: { accountId: string; value: string | null }) {
  const [state, action, pending] = useActionState(setCountFromAction.bind(null, accountId), null);
  return (
    <form action={action} className="mt-2 flex flex-wrap items-end gap-2">
      <label className="text-[11px] text-muted">
        Count posts from
        <input type="date" name="count_from" defaultValue={value ?? ""} className="field mt-1 block min-h-11 w-auto text-sm" />
      </label>
      <button disabled={pending} className="btn btn-secondary min-h-11">
        {pending ? "Saving…" : "Save"}
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
      <button disabled={pending} className="btn btn-danger">
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
        if (!confirm(`Remove ${name} from Dapur Konten? Its posts and stats are deleted here (nothing changes on the platform itself).`)) e.preventDefault();
      }}
      className="flex shrink-0 flex-col items-end gap-1"
    >
      <button disabled={pending} className="btn btn-quiet" aria-label={`Remove ${name}`}>
        {pending ? "Removing…" : "Remove"}
      </button>
      {state && !state.ok && <p className="text-[11px]" style={{ color: "var(--bad)" }}>{state.message}</p>}
    </form>
  );
}

export function DisconnectDriveButton() {
  const [state, action, pending] = useActionState(() => disconnectDriveAction(), null);
  return (
    <form
      action={action}
      onSubmit={(e) => {
        if (!confirm("Stop copying new videos to Google Drive? Videos already in Drive stay there.")) e.preventDefault();
      }}
      className="flex shrink-0 flex-col items-end gap-1"
    >
      <button disabled={pending} className="btn btn-quiet">
        {pending ? "Disconnecting…" : "Disconnect"}
      </button>
      {state && !state.ok && <p className="text-[11px]" style={{ color: "var(--bad)" }}>{state.message}</p>}
    </form>
  );
}
