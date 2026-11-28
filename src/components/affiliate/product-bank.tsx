"use client";

import { useActionState, useEffect, useRef, useState, useTransition } from "react";
import type { AffiliateResult } from "@/app/schedule/affiliate-actions";
import { PRODUCT_CATEGORIES, STATUS_LABEL, formatRp, type ProductStatus } from "@/lib/affiliate/affiliate";

export type ProductView = {
  id: string;
  name: string;
  category: string;
  problemAngle: string;
  priceIdr: number;
  commissionPct: number | null;
  tiktokShopUrl: string | null;
  shopeeUrl: string | null;
  status: ProductStatus;
  timesUsed: number;
};

type SaveAction = (prev: AffiliateResult | null, form: FormData) => Promise<AffiliateResult>;

/** The Add / Edit product form: a visible label on every field; Escape cancels; errors are announced. */
function ProductForm({ product, action, onClose }: { product?: ProductView; action: SaveAction; onClose: (saved: boolean) => void }) {
  const [state, submit, pending] = useActionState(action, null);
  const [, startSubmit] = useTransition();
  const first = useRef<HTMLInputElement>(null);
  const idp = product ? `edit-${product.id}` : "new";
  useEffect(() => first.current?.focus(), []);
  useEffect(() => {
    if (state?.ok) onClose(true);
  }, [state, onClose]);
  const field = (k: string) => `${idp}-${k}`;
  return (
    <form
      // submitted in a transition, not as a form action: React resets a form after its action, and a validation error
      // must never wipe what the owner typed
      onSubmit={(e) => {
        e.preventDefault();
        const data = new FormData(e.currentTarget);
        startSubmit(() => submit(data));
      }}
      noValidate
      data-product-form={idp}
      onKeyDown={(e) => {
        if (e.key === "Escape") {
          e.preventDefault();
          onClose(false);
        }
      }}
      className="space-y-3 rounded-card border border-border p-3"
    >
      {product && <input type="hidden" name="id" value={product.id} />}
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <div className="sm:col-span-2">
          <label htmlFor={field("name")} className="mb-1 block text-sm font-semibold">
            Product name
          </label>
          <input ref={first} id={field("name")} name="name" className="field" maxLength={120} defaultValue={product?.name} required autoComplete="off" />
        </div>
        <div>
          <label htmlFor={field("category")} className="mb-1 block text-sm font-semibold">
            Category
          </label>
          <select id={field("category")} name="category" className="field" defaultValue={product?.category ?? PRODUCT_CATEGORIES[0]}>
            {[...new Set([...(product ? [product.category] : []), ...PRODUCT_CATEGORIES])].map((c) => (
              <option key={c} value={c}>
                {c}
              </option>
            ))}
          </select>
        </div>
        <div>
          <label htmlFor={field("price")} className="mb-1 block text-sm font-semibold">
            Price (IDR)
          </label>
          <input id={field("price")} name="price_idr" className="field tabular-nums" inputMode="numeric" defaultValue={product?.priceIdr} required autoComplete="off" />
        </div>
        <div className="sm:col-span-2">
          <label htmlFor={field("angle")} className="mb-1 block text-sm font-semibold">
            Problem angle
          </label>
          <textarea
            id={field("angle")}
            name="problem_angle"
            className="field min-h-16"
            rows={2}
            maxLength={300}
            defaultValue={product?.problemAngle}
            required
            aria-describedby={field("angle-hint")}
          />
          <p id={field("angle-hint")} className="mt-1 text-xs text-muted">
            The everyday pain point Uco complains about in the hook, e.g. &quot;es batu di freezer selalu bau bawang&quot;.
          </p>
        </div>
        <div>
          <label htmlFor={field("pct")} className="mb-1 block text-sm font-semibold">
            Commission (%)
          </label>
          <input id={field("pct")} name="commission_pct" className="field tabular-nums" inputMode="decimal" defaultValue={product?.commissionPct ?? ""} autoComplete="off" />
        </div>
        <div />
        <div>
          <label htmlFor={field("tt")} className="mb-1 block text-sm font-semibold">
            TikTok Shop URL
          </label>
          <input id={field("tt")} name="tiktok_shop_url" type="url" className="field" defaultValue={product?.tiktokShopUrl ?? ""} placeholder="https://" autoComplete="off" />
        </div>
        <div>
          <label htmlFor={field("sp")} className="mb-1 block text-sm font-semibold">
            Shopee URL
          </label>
          <input id={field("sp")} name="shopee_url" type="url" className="field" defaultValue={product?.shopeeUrl ?? ""} placeholder="https://" autoComplete="off" />
        </div>
      </div>
      {state && !state.ok && (
        <p role="alert" className="text-sm" style={{ color: "var(--bad)" }} data-product-error>
          {state.message}
        </p>
      )}
      <div className="flex flex-wrap gap-2">
        <button type="submit" className="btn btn-outline" disabled={pending}>
          {pending ? "Saving..." : "Save product"}
        </button>
        <button type="button" className="btn btn-quiet" onClick={() => onClose(false)}>
          Cancel
        </button>
      </div>
    </form>
  );
}

/** Status shown as text inside a bordered badge (never by colour alone). */
function StatusBadge({ status }: { status: ProductStatus }) {
  const color = status === "active" ? "var(--win)" : status === "paused" ? "var(--avg)" : "var(--bad)";
  return (
    <span className="inline-flex items-center rounded-[6px] border px-2 py-0.5 text-xs font-semibold" style={{ color, borderColor: color }} data-status-badge={status}>
      {STATUS_LABEL[status]}
    </span>
  );
}

function ProductRow({
  p,
  save,
  setStatus,
  remove,
}: {
  p: ProductView;
  save: SaveAction;
  setStatus: (id: string, s: ProductStatus) => Promise<AffiliateResult>;
  remove: (id: string) => Promise<AffiliateResult>;
}) {
  const [editing, setEditing] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const [msg, setMsg] = useState<AffiliateResult | null>(null);
  const [pending, start] = useTransition();
  const editRef = useRef<HTMLButtonElement>(null);
  const deleteRef = useRef<HTMLButtonElement>(null);
  const run = (fn: () => Promise<AffiliateResult>) => start(async () => setMsg(await fn()));
  const closeEdit = (saved: boolean) => {
    setEditing(false);
    if (!saved) requestAnimationFrame(() => editRef.current?.focus());
  };
  return (
    <li className="space-y-2 rounded-card border border-border p-3" data-product={p.id}>
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="min-w-0">
          <p className="break-words font-semibold">{p.name}</p>
          <p className="text-xs text-muted">
            {p.category}
            <span className="tabular-nums">
              {" "}
              · {formatRp(p.priceIdr)}
              {p.commissionPct != null ? ` · ${p.commissionPct}% commission` : ""} · used {p.timesUsed}
              {p.timesUsed === 1 ? " time" : " times"}
            </span>
          </p>
        </div>
        <StatusBadge status={p.status} />
      </div>
      {editing ? (
        <ProductForm product={p} action={save} onClose={closeEdit} />
      ) : (
        <div className="flex flex-wrap gap-2">
          <button
            type="button"
            className="btn btn-outline"
            disabled={pending}
            onClick={() => run(() => setStatus(p.id, p.status === "active" ? "paused" : "active"))}
            data-product-toggle
          >
            {p.status === "active" ? "Pause" : "Activate"}
          </button>
          <button ref={editRef} type="button" className="btn btn-outline" disabled={pending} onClick={() => setEditing(true)} data-product-edit>
            Edit
          </button>
          {!confirming ? (
            <button ref={deleteRef} type="button" className="btn btn-danger" disabled={pending} onClick={() => setConfirming(true)} data-product-delete aria-label={`Delete ${p.name}`}>
              Delete
            </button>
          ) : (
            <span
              role="group"
              aria-label={`Confirm deleting ${p.name}`}
              className="flex flex-wrap items-center gap-2"
              onKeyDown={(e) => {
                if (e.key === "Escape") {
                  e.preventDefault();
                  setConfirming(false);
                  requestAnimationFrame(() => deleteRef.current?.focus());
                }
              }}
            >
              <button type="button" className="btn btn-danger" disabled={pending} autoFocus onClick={() => run(() => remove(p.id))} data-product-confirm-delete>
                {pending ? "Deleting..." : "Confirm delete"}
              </button>
              <button
                type="button"
                className="btn btn-quiet"
                onClick={() => {
                  setConfirming(false);
                  requestAnimationFrame(() => deleteRef.current?.focus());
                }}
              >
                Keep
              </button>
            </span>
          )}
        </div>
      )}
      {msg && !msg.ok && (
        <p role="alert" className="text-sm" style={{ color: "var(--bad)" }}>
          {msg.message}
        </p>
      )}
    </li>
  );
}

/** The Affiliate Product Bank: Add product (collapsible), the list with Pause / Activate, Edit and Delete. */
export function ProductBank({
  products,
  save,
  setStatus,
  remove,
}: {
  products: ProductView[];
  save: SaveAction;
  setStatus: (id: string, s: ProductStatus) => Promise<AffiliateResult>;
  remove: (id: string) => Promise<AffiliateResult>;
}) {
  const [adding, setAdding] = useState(false);
  const [saved, setSaved] = useState(false);
  const addRef = useRef<HTMLButtonElement>(null);
  return (
    <div className="space-y-3" data-product-bank>
      <div className="flex flex-wrap items-center gap-2">
        <button
          ref={addRef}
          type="button"
          className="btn btn-outline"
          aria-expanded={adding}
          aria-controls="add-product-form"
          onClick={() => {
            setSaved(false);
            setAdding((a) => !a);
          }}
          data-add-product
        >
          {adding ? "Close" : "Add product"}
        </button>
        <p aria-live="polite" className="text-sm" style={{ color: "var(--win)" }}>
          {saved ? "Product saved." : ""}
        </p>
      </div>
      {adding && (
        <div id="add-product-form">
          <ProductForm
            action={save}
            onClose={(ok) => {
              setAdding(false);
              setSaved(ok);
              requestAnimationFrame(() => addRef.current?.focus());
            }}
          />
        </div>
      )}
      {products.length === 0 ? (
        <p className="rounded-card border border-dashed border-border p-3 text-sm text-muted" data-empty>
          No affiliate products yet. Add a product to unlock Affiliate Debate slots.
        </p>
      ) : (
        <ul className="space-y-2">
          {products.map((p) => (
            <ProductRow key={`${p.id}-${p.status}-${p.name}-${p.priceIdr}-${p.category}-${p.commissionPct}-${p.problemAngle}-${p.tiktokShopUrl}-${p.shopeeUrl}`} p={p} save={save} setStatus={setStatus} remove={remove} />
          ))}
        </ul>
      )}
    </div>
  );
}
