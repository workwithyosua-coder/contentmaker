"use client";

import { useActionState } from "react";
import type { AffiliateResult } from "@/app/schedule/affiliate-actions";

/**
 * Create page: queue a one-off Affiliate Debate (written, voiced and rendered by the scheduler with Gemini, like
 * every scheduled episode). The product is the owner's pick, else the least recently used active one.
 */
export function QueueAffiliateDebate({
  products,
  action,
}: {
  products: { id: string; name: string }[];
  action: (prev: AffiliateResult | null, form: FormData) => Promise<AffiliateResult>;
}) {
  const [state, submit, pending] = useActionState(action, null);
  return (
    <form action={submit} className="space-y-3" data-queue-affiliate>
      <p className="text-sm text-muted">
        A comedy debate about an everyday problem that turns naturally to one product, ending with a direct basket CTA. Format: Affiliate Debate.
      </p>
      {products.length === 0 ? (
        <p className="text-sm text-muted" data-empty>
          No active affiliate products. Add one in the Affiliate Product Bank on the Schedule page first.
        </p>
      ) : (
        <>
          <div>
            <label htmlFor="affiliate-product" className="mb-1 block text-sm font-semibold">
              Product
            </label>
            <select id="affiliate-product" name="productId" className="field" defaultValue="">
              <option value="">Auto: least recently used active product</option>
              {products.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name}
                </option>
              ))}
            </select>
          </div>
          <button type="submit" className="btn btn-outline" disabled={pending}>
            {pending ? "Queuing..." : "Queue Affiliate Debate"}
          </button>
        </>
      )}
      {state && (
        <p role={state.ok ? "status" : "alert"} className="text-sm" style={{ color: state.ok ? "var(--win)" : "var(--bad)" }}>
          {state.message}
        </p>
      )}
    </form>
  );
}
