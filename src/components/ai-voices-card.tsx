"use client";

import { useActionState, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import type { AiResult } from "@/app/create/[id]/record/ai-actions";
import { DELIVERY_LABEL, PROVIDER_LABEL, type DeliveryPreset, type VoiceProvider } from "@/lib/voice/acting";
import { redoGapMs, runRedoAll, type RedoFailure, type RedoOutcome } from "@/lib/voice/redo-all";
import { useBoothBusy } from "./booth-busy";
import { VoiceProviderPicker } from "./voice-provider";

type Line = { index: number; speaker: string; text: string };
type Run = { status: "idle" } | { status: "running"; current: number; total: number } | { status: "done"; total: number; failed: RedoFailure[] };

/**
 * The recording booth's "AI voices" card: the voice provider and delivery pickers, "Voice the N missing lines with
 * AI", "Redo all N lines with AI" (every line that already has a take, after an inline confirmation, one line at a
 * time with live progress and a retry for the lines that failed) and "Redo one line with AI". Only these two redo
 * buttons ever voice a line that already has audio.
 */
export function AiVoicesCard({
  provider: savedProvider,
  preset: savedPreset,
  onSave,
  note,
  noteHref,
  missingAction,
  redoLine,
  lines,
  missing,
  voiced,
}: {
  provider: VoiceProvider;
  preset: DeliveryPreset;
  onSave: (provider: VoiceProvider, preset: DeliveryPreset) => Promise<{ ok: boolean; message: string } | null>;
  note: string | null;
  noteHref: string | null;
  missingAction: (prev: AiResult, form: FormData) => Promise<AiResult>;
  redoLine: (lineIndex: number, provider: string, preset: string) => Promise<RedoOutcome>;
  lines: Line[];
  missing: number;
  /** indexes of the lines that already have a take */
  voiced: number[];
}) {
  const router = useRouter();
  const { busy: boothBusy, setBusy } = useBoothBusy();
  const [provider, setProvider] = useState(savedProvider);
  const [preset, setPreset] = useState(savedPreset);
  const [state, runMissing, pending] = useActionState(missingAction, null);
  const [confirming, setConfirming] = useState(false);
  const [run, setRun] = useState<Run>({ status: "idle" });
  const redoAllRef = useRef<HTMLButtonElement>(null);
  const confirmRef = useRef<HTMLButtonElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  const running = run.status === "running";
  const locked = running || boothBusy;
  const count = voiced.length;
  const providerLabel = PROVIDER_LABEL[provider];
  const deliveryLabel = DELIVERY_LABEL[preset];

  useEffect(() => {
    if (!confirming) return;
    // on a phone the panel can open under the fixed bottom tab bar: bring it fully into view (its scroll margin clears
    // the bar), then focus Confirm without a second jump
    const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    panelRef.current?.scrollIntoView({ block: "nearest", behavior: reduce ? "auto" : "smooth" });
    confirmRef.current?.focus({ preventScroll: true });
  }, [confirming]);

  const close = () => {
    setConfirming(false);
    redoAllRef.current?.focus();
  };

  const start = async (indexes: number[]) => {
    setConfirming(false);
    setBusy(true);
    setRun({ status: "running", current: 0, total: indexes.length });
    const p = provider;
    const d = preset;
    const result = await runRedoAll({
      indexes,
      redo: (i) => redoLine(i, p, d),
      gapMs: redoGapMs(p),
      onProgress: (current, total) => setRun({ status: "running", current, total }),
    });
    setRun({ status: "done", total: indexes.length, failed: result.failed });
    setBusy(false);
    // the takes list below picks up the new selected takes
    router.refresh();
  };

  const failed = run.status === "done" ? run.failed : [];
  return (
    <div className="space-y-4">
      <VoiceProviderPicker
        provider={savedProvider}
        preset={savedPreset}
        onSave={onSave}
        note={note}
        noteHref={noteHref}
        locked={locked}
        onChange={(p, d) => {
          setProvider(p);
          setPreset(d);
        }}
      />
      <div className="space-y-3">
        <div className="flex flex-wrap items-start gap-2">
          <form action={runMissing}>
            <input type="hidden" name="mode" value="missing" />
            <button disabled={pending || locked || missing === 0} className="btn btn-primary">
              {pending ? "Generating voices…" : missing ? `Voice the ${missing} missing line${missing > 1 ? "s" : ""} with AI` : "All lines have a take"}
            </button>
          </form>
          <button
            ref={redoAllRef}
            type="button"
            data-redo-all
            disabled={count === 0 || locked || pending}
            aria-expanded={confirming}
            aria-controls="redo-all-confirm"
            onClick={() => setConfirming((c) => !c)}
            className="btn btn-secondary"
          >
            {count === 1 ? "Redo 1 line with AI" : `Redo all ${count} lines with AI`}
          </button>
        </div>

        {confirming && (
          <div
            ref={panelRef}
            id="redo-all-confirm"
            role="group"
            aria-label="Confirm redo all"
            data-redo-confirm
            onKeyDown={(e) => {
              if (e.key === "Escape") {
                e.preventDefault();
                close();
              }
            }}
            className="scroll-mb-28 space-y-3 rounded-card border border-border bg-surface p-3"
          >
            <p className="text-sm">
              Redo all {count} voiced lines using {providerLabel} ({deliveryLabel})? New AI takes will be added and set active for each line.
            </p>
            <div className="flex flex-wrap gap-2">
              <button ref={confirmRef} type="button" className="btn btn-primary" onClick={() => start(voiced)}>
                Confirm redo ({count} lines)
              </button>
              <button type="button" className="btn btn-secondary" onClick={close}>
                Cancel
              </button>
            </div>
          </div>
        )}

        <div aria-live="polite" data-redo-status className="space-y-2 text-sm">
          {run.status === "running" && (
            <p className="tabular-nums">
              Redoing line {run.current} of {run.total} with {providerLabel}…
            </p>
          )}
          {run.status === "done" && !failed.length && (
            <p style={{ color: "var(--win)" }}>
              Redid {run.total} {run.total === 1 ? "line" : "lines"} with {providerLabel} ({deliveryLabel}). Ready to render.
            </p>
          )}
          {run.status === "done" && failed.length > 0 && (
            <div className="space-y-2" role="alert">
              <p style={{ color: "var(--bad)" }}>
                {run.total - failed.length} of {run.total} lines redone. These failed:
              </p>
              <ul className="space-y-1 text-xs tabular-nums" style={{ color: "var(--bad)" }}>
                {failed.map((f) => (
                  <li key={f.index}>
                    Line {f.index + 1}: {f.message}
                  </li>
                ))}
              </ul>
              <button type="button" data-redo-retry disabled={locked} onClick={() => start(failed.map((f) => f.index))} className="btn btn-secondary">
                Retry failed lines ({failed.length})
              </button>
            </div>
          )}
        </div>

        <details>
          <summary className="inline-flex min-h-11 cursor-pointer items-center text-sm font-semibold">Redo one line with AI</summary>
          <form action={runMissing} className="mt-2">
            <fieldset disabled={locked || pending} className="min-w-0 space-y-2">
              <input type="hidden" name="mode" value="line" />
              {/* the pickers' current choice, so a change applies right away */}
              <input type="hidden" name="provider" value={provider} />
              <input type="hidden" name="preset" value={preset} />
              <select name="lineIndex" className="field disabled:cursor-not-allowed" aria-label="Line">
                {lines.map((l) => (
                  <option key={l.index} value={l.index}>
                    {l.index + 1}. {l.speaker.toUpperCase()}: {l.text.slice(0, 60)}
                  </option>
                ))}
              </select>
              <input name="extra" className="field disabled:cursor-not-allowed" placeholder="Extra direction, e.g. faster, more annoyed, whisper the end" autoComplete="off" />
              <button disabled={pending || locked} className="btn btn-secondary">
                {pending ? "Generating…" : "Generate a new take"}
              </button>
            </fieldset>
          </form>
        </details>
        {state && (
          <p role="status" className="text-xs" style={{ color: state.ok ? "var(--win)" : "var(--bad)" }}>
            {state.message}
          </p>
        )}
        <p className="text-xs text-muted">
          AI takes use the voice provider above (Gemini TTS is free) and each line&apos;s pose. They show up as new takes in the list below, so you can
          still record over any line yourself. Lines that already have audio are never voiced again unless you redo them here.
        </p>
      </div>
    </div>
  );
}
