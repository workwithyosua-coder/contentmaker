"use client";

import { useActionState } from "react";
import { login } from "./actions";

export function LoginForm({ next }: { next: string }) {
  const [error, action, pending] = useActionState(login, null);
  return (
    <form action={action} className="space-y-3">
      <input type="hidden" name="next" value={next} />
      <label htmlFor="password" className="label">
        Password
      </label>
      <input
        id="password"
        type="password"
        name="password"
        autoComplete="current-password"
        required
        autoFocus
        className="field"
      />
      <button
        type="submit"
        disabled={pending}
        className="btn btn-primary w-full"
      >
        {pending ? "Checking…" : "Unlock"}
      </button>
      {error && <p className="text-xs" style={{ color: "var(--bad)" }}>{error}</p>}
    </form>
  );
}
