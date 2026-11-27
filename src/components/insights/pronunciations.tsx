"use client";

import { useActionState, useState, useTransition } from "react";
import type { ActionResult } from "@/app/insights/actions";

/** The Pronunciation Dictionary: written term → how the voice says it (TTS text only; subtitles keep the term). */
export function Pronunciations({
  rows,
  add,
  remove,
}: {
  rows: { term: string; spoken_as: string }[];
  add: (prev: ActionResult | null, form: FormData) => Promise<ActionResult>;
  remove: (term: string) => Promise<ActionResult>;
}) {
  const [state, submit, pending] = useActionState(add, null);
  const [removing, start] = useTransition();
  const [removeMsg, setRemoveMsg] = useState<ActionResult | null>(null);
  return (
    <div className="space-y-4">
      {rows.length === 0 ? (
        <p className="text-sm text-muted" data-pron-empty>
          No pronunciation rules yet. Add one when the voice misreads a word, a brand or an acronym.
        </p>
      ) : (
        <ul className="divide-y divide-border rounded-card border border-border" data-pron-list>
          {rows.map((r) => (
            <li key={r.term} className="flex flex-wrap items-center justify-between gap-2 px-3 py-2">
              <span className="min-w-0 break-words text-sm">
                <b>{r.term}</b> <span className="text-muted">spoken as</span> {r.spoken_as}
              </span>
              <button
                type="button"
                className="btn btn-danger"
                disabled={removing}
                aria-label={`Remove ${r.term}`}
                onClick={() => start(async () => setRemoveMsg(await remove(r.term)))}
              >
                Remove
              </button>
            </li>
          ))}
        </ul>
      )}
      {removeMsg && !removeMsg.ok && (
        <p role="alert" className="text-sm" style={{ color: "var(--bad)" }}>
          {removeMsg.message}
        </p>
      )}
      <form action={submit} className="space-y-3" data-pron-form>
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <div>
            <label htmlFor="pron-term" className="mb-1 block text-sm font-semibold">
              Written term
            </label>
            <input id="pron-term" name="term" className="field" maxLength={60} required autoComplete="off" placeholder="e.g. QRIS" />
          </div>
          <div>
            <label htmlFor="pron-spoken" className="mb-1 block text-sm font-semibold">
              Spoken as
            </label>
            <input id="pron-spoken" name="spokenAs" className="field" maxLength={80} required autoComplete="off" placeholder="e.g. kris" />
          </div>
        </div>
        <button className="btn btn-secondary" disabled={pending} data-pron-add>
          {pending ? "Adding..." : "Add pronunciation rule"}
        </button>
        {state && (
          <p role={state.ok ? "status" : "alert"} className="text-sm" style={{ color: state.ok ? "var(--win)" : "var(--bad)" }}>
            {state.message}
          </p>
        )}
      </form>
    </div>
  );
}
