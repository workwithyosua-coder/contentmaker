"use client";

import { useActionState } from "react";
import { login } from "./actions";

export function LoginForm({ next }: { next: string }) {
  const [error, action, pending] = useActionState(login, null);
  return (
    <form action={action} className="space-y-3">
      <input type="hidden" name="next" value={next} />
      <input
        type="password"
        name="password"
        autoComplete="current-password"
        required
        autoFocus
        placeholder="Password"
        className="w-full rounded-xl border border-border bg-bg px-3 py-2.5 text-sm outline-none focus:border-accent"
      />
      <button
        type="submit"
        disabled={pending}
        className="w-full rounded-xl bg-accent py-2.5 text-sm font-semibold text-accent-contrast disabled:opacity-60"
      >
        {pending ? "Checking…" : "Unlock"}
      </button>
      {error && <p className="text-xs" style={{ color: "var(--bad)" }}>{error}</p>}
    </form>
  );
}
