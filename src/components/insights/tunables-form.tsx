"use client";

import { useActionState } from "react";
import type { ActionResult } from "@/app/insights/actions";
import { TUNABLE_BOUNDS, TUNABLE_KEYS, type Tunables } from "@/lib/insights/tunables";

/** Live Studio Tunables: one labelled number input per value with its allowed range; saved values are clamped on the server. */
export function TunablesForm({ values, action }: { values: Tunables; action: (prev: ActionResult | null, form: FormData) => Promise<ActionResult> }) {
  const [state, submit, pending] = useActionState(action, null);
  return (
    <form action={submit} className="space-y-4" data-tunables key={JSON.stringify(values)}>
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        {TUNABLE_KEYS.map((k) => {
          const b = TUNABLE_BOUNDS[k];
          const hint = `${b.min} to ${b.max}${b.unit && b.unit !== "x" ? ` ${b.unit}` : ""}, default ${b.def}`;
          return (
            <div key={k}>
              <label htmlFor={`tn-${k}`} className="mb-1 block text-sm font-semibold">
                {b.label}
              </label>
              <input
                id={`tn-${k}`}
                name={k}
                type="number"
                min={b.min}
                max={b.max}
                step={b.step}
                defaultValue={values[k]}
                aria-describedby={`tn-${k}-hint`}
                className="field tabular-nums"
                inputMode="decimal"
                required
              />
              <p id={`tn-${k}-hint`} className="mt-1 text-xs text-muted tabular-nums">
                {hint}
              </p>
            </div>
          );
        })}
      </div>
      <div className="flex flex-wrap gap-2">
        <button name="intent" value="save" className="btn btn-secondary" disabled={pending} data-tunables-save>
          {pending ? "Saving..." : "Save tunables"}
        </button>
        <button name="intent" value="reset" formNoValidate className="btn btn-quiet" disabled={pending} data-tunables-reset>
          Reset defaults
        </button>
      </div>
      {state && (
        <p role={state.ok ? "status" : "alert"} className="text-sm" style={{ color: state.ok ? "var(--win)" : "var(--bad)" }}>
          {state.message}
        </p>
      )}
    </form>
  );
}
