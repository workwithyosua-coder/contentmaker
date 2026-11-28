"use client";

import { useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { CONVERSION_PLATFORMS, PLATFORM_LABEL } from "@/lib/affiliate/affiliate";

type State = { status: "idle" } | { status: "saving" } | { status: "saved"; message: string } | { status: "error"; message: string };

/** "Log affiliate orders": POST /api/insights/affiliate-conversions; Loading, Saved and Error states; then the totals refresh. */
export function LogAffiliateOrders({ episodes }: { episodes: { id: string; title: string; affiliate: boolean }[] }) {
  const router = useRouter();
  const [state, setState] = useState<State>({ status: "idle" });
  const formRef = useRef<HTMLFormElement>(null);
  const submit = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const f = new FormData(e.currentTarget);
    setState({ status: "saving" });
    try {
      const res = await fetch("/api/insights/affiliate-conversions", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ episodeId: f.get("episodeId"), platform: f.get("platform"), clicks: f.get("clicks"), orders: f.get("orders"), commissionIdr: f.get("commissionIdr") }),
      });
      const j = (await res.json().catch(() => ({}))) as { error?: string };
      if (!res.ok) throw new Error(j.error ?? `The server answered ${res.status}.`);
      setState({ status: "saved", message: "Saved. The totals above include it." });
      formRef.current?.reset();
      router.refresh();
    } catch (err) {
      setState({ status: "error", message: err instanceof Error ? err.message : String(err) });
    }
  };
  const busy = state.status === "saving";
  return (
    <details className="rounded-card border border-border" data-log-orders>
      <summary className="flex min-h-11 cursor-pointer items-center px-3 text-sm font-semibold">Log affiliate orders</summary>
      <form ref={formRef} onSubmit={submit} noValidate className="space-y-3 border-t border-border p-3">
        {episodes.length === 0 ? (
          <p className="text-sm text-muted">No episodes to log against yet. Render or queue an Affiliate Debate first.</p>
        ) : (
          <>
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              <div>
                <label htmlFor="ac-episode" className="mb-1 block text-sm font-semibold">
                  Episode
                </label>
                <select id="ac-episode" name="episodeId" className="field" defaultValue="" required>
                  <option value="" disabled>
                    Pick an episode
                  </option>
                  {episodes.map((e) => (
                    <option key={e.id} value={e.id}>
                      {e.title}
                      {e.affiliate ? " (Affiliate Debate)" : ""}
                    </option>
                  ))}
                </select>
              </div>
              <div>
                <label htmlFor="ac-platform" className="mb-1 block text-sm font-semibold">
                  Platform
                </label>
                <select id="ac-platform" name="platform" className="field" defaultValue="tiktok_shop">
                  {CONVERSION_PLATFORMS.map((p) => (
                    <option key={p} value={p}>
                      {PLATFORM_LABEL[p]}
                    </option>
                  ))}
                </select>
              </div>
            </div>
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
              {[
                ["ac-clicks", "clicks", "Clicks"],
                ["ac-orders", "orders", "Orders"],
                ["ac-commission", "commissionIdr", "Commission (IDR)"],
              ].map(([id, name, label]) => (
                <div key={id}>
                  <label htmlFor={id} className="mb-1 block text-sm font-semibold">
                    {label}
                  </label>
                  <input id={id} name={name} className="field tabular-nums" inputMode="numeric" defaultValue="0" autoComplete="off" />
                </div>
              ))}
            </div>
            <button type="submit" className="btn btn-outline" disabled={busy} data-log-orders-submit>
              {busy ? "Saving..." : "Save orders"}
            </button>
          </>
        )}
        <div aria-live="polite" className="text-sm">
          {state.status === "saved" && (
            <p style={{ color: "var(--win)" }} data-log-saved>
              {state.message}
            </p>
          )}
          {state.status === "error" && (
            <p role="alert" style={{ color: "var(--bad)" }} data-log-error>
              {state.message}
            </p>
          )}
        </div>
      </form>
    </details>
  );
}
