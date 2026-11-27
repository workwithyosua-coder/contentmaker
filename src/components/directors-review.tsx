"use client";

import { useState, useTransition } from "react";
import type { ReviewResult } from "@/lib/insights/server";
import { ISSUE_LABEL, ISSUE_TAGS, RATING_LABEL, RATINGS, type IssueTag, type Rating } from "@/lib/insights/tunables";

type Saved = ReviewResult;
type Last = { rating: string; issue_tags: string[]; created_at: string } | null;

/**
 * Director's Review: the owner rates a finished episode, tags what went wrong, and writes a note. Saving stores the
 * review, nudges the Live Studio Tunables for the tags that map to a number, saves an optional pronunciation fix, and
 * distills one playbook rule from the notes. States: Empty (no review yet), Loading (saving), Saved (what changed),
 * Error.
 */
export function DirectorsReview({
  last,
  save,
}: {
  last: Last;
  save: (input: { rating: string | null; tags: string[]; notes: string; term: string; spokenAs: string }) => Promise<Saved | { ok: false; message: string }>;
}) {
  const [rating, setRating] = useState<Rating | null>(null);
  const [tags, setTags] = useState<IssueTag[]>([]);
  const [notes, setNotes] = useState("");
  const [term, setTerm] = useState("");
  const [spokenAs, setSpokenAs] = useState("");
  const [saved, setSaved] = useState<Saved | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();

  const toggle = (t: IssueTag) => setTags((cur) => (cur.includes(t) ? cur.filter((x) => x !== t) : [...cur, t]));
  const submit = () => {
    setError(null);
    if (!rating) {
      setError("Pick a rating first.");
      return;
    }
    if (Boolean(term.trim()) !== Boolean(spokenAs.trim())) {
      setError("Fill in both the written term and how it should be spoken, or leave both empty.");
      return;
    }
    start(async () => {
      const r = await save({ rating, tags, notes, term, spokenAs });
      if (!r.ok) {
        setError(r.message);
        return;
      }
      setSaved(r);
      setRating(null);
      setTags([]);
      setNotes("");
      setTerm("");
      setSpokenAs("");
    });
  };

  return (
    <div className="space-y-4" data-directors-review aria-busy={pending}>
      {!saved && !last && (
        <p className="text-sm text-muted" data-review-empty>
          No review yet. Rate this episode and say what to change: the studio adjusts its pacing, music and voice settings and learns a rule for the next scripts.
        </p>
      )}
      {!saved && last && (
        <p className="text-sm text-muted">
          Last review: {RATING_LABEL[last.rating as Rating] ?? last.rating}
          {last.issue_tags.length ? `, ${last.issue_tags.map((t) => ISSUE_LABEL[t as IssueTag] ?? t).join(", ")}` : ""} ({new Date(last.created_at).toLocaleDateString("en-GB", { dateStyle: "medium" })}). Add
          another below.
        </p>
      )}

      <fieldset disabled={pending} className="min-w-0 space-y-4">
        <div>
          <p className="mb-2 text-sm font-semibold" id="review-rating">
            Rating
          </p>
          <div className="grid grid-cols-1 gap-2 sm:grid-cols-3" role="group" aria-labelledby="review-rating">
            {RATINGS.map((r) => (
              <button key={r} type="button" aria-pressed={rating === r} data-rating={r} onClick={() => setRating(r)} className="btn btn-secondary review-toggle">
                {RATING_LABEL[r]}
              </button>
            ))}
          </div>
        </div>

        <div>
          <p className="mb-2 text-sm font-semibold" id="review-tags">
            What needs work? <span className="font-normal text-muted">(optional)</span>
          </p>
          <div className="flex flex-wrap gap-2" role="group" aria-labelledby="review-tags">
            {ISSUE_TAGS.map((t) => (
              <button key={t} type="button" aria-pressed={tags.includes(t)} data-tag={t} onClick={() => toggle(t)} className="btn btn-secondary review-toggle text-sm">
                {ISSUE_LABEL[t]}
              </button>
            ))}
          </div>
        </div>

        <div>
          <label htmlFor="review-notes" className="mb-1 block text-sm font-semibold">
            Notes <span className="font-normal text-muted">(optional, one rule is learned from these)</span>
          </label>
          <textarea
            id="review-notes"
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            rows={3}
            maxLength={2000}
            className="field min-h-24"
            placeholder="e.g. The hook took too long. Open on Uco's dumbest claim."
          />
        </div>

        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <div>
            <label htmlFor="review-term" className="mb-1 block text-sm font-semibold">
              Written term <span className="font-normal text-muted">(optional)</span>
            </label>
            <input id="review-term" value={term} onChange={(e) => setTerm(e.target.value)} maxLength={60} className="field" placeholder="e.g. QRIS" autoComplete="off" />
          </div>
          <div>
            <label htmlFor="review-spoken" className="mb-1 block text-sm font-semibold">
              Spoken as
            </label>
            <input id="review-spoken" value={spokenAs} onChange={(e) => setSpokenAs(e.target.value)} maxLength={80} className="field" placeholder="e.g. kris" autoComplete="off" />
          </div>
        </div>

        <button type="button" onClick={submit} className="btn btn-primary" data-review-save>
          {pending ? "Saving review..." : "Save and learn"}
        </button>
      </fieldset>

      <div aria-live="polite" className="space-y-2 text-sm">
        {pending && <p className="text-muted">Saving the review and learning from your notes. This can take a few seconds.</p>}
        {error && (
          <p role="alert" data-review-error style={{ color: "var(--bad)" }}>
            {error}
          </p>
        )}
        {saved && (
          <div data-review-saved className="space-y-2 rounded-card border border-border bg-surface-2 p-3">
            <p className="font-semibold" style={{ color: "var(--win)" }}>
              Review saved.
            </p>
            {saved.adjustments.length > 0 ? (
              <>
                <p className="text-muted">Studio adjustments for the next episodes:</p>
                <ul className="list-disc space-y-1 pl-5 tabular-nums">
                  {saved.adjustments.map((a) => (
                    <li key={a}>{a}</li>
                  ))}
                </ul>
              </>
            ) : (
              <p className="text-muted">No tunable changed (none of the tags move a number).</p>
            )}
            {saved.rule && (
              <p>
                Learned rule: <q>{saved.rule}</q>
              </p>
            )}
            {saved.ruleNote && <p className="text-muted">{saved.ruleNote}</p>}
            {saved.pronunciation && <p>{saved.pronunciation}</p>}
          </div>
        )}
      </div>
    </div>
  );
}
