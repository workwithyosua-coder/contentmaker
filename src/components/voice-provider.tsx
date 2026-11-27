"use client";

import { useId, useState, useTransition } from "react";
import { DELIVERY_LABEL, DELIVERY_PRESETS, PROVIDER_LABEL, SELECTABLE_PROVIDERS, type DeliveryPreset, type VoiceProvider } from "@/lib/voice/acting";

type Result = { ok: boolean; message: string } | null;

/**
 * Voice provider (Gemini TTS, free, by default; ElevenLabs) and delivery preset (Standard / Angry / Urgent) as two
 * native radio groups. Inside a form it submits `provider` and `preset`; with `onSave` it also saves each change.
 * Changing them never re-voices lines that already have audio.
 */
export function VoiceProviderPicker({
  provider: initialProvider,
  preset: initialPreset,
  onSave,
  note,
  noteHref,
  onChange,
  locked = false,
}: {
  provider: VoiceProvider;
  preset: DeliveryPreset;
  onSave?: (provider: VoiceProvider, preset: DeliveryPreset) => Promise<Result>;
  /** the current choice, for a parent that acts on it (the booth's "Redo all") */
  onChange?: (provider: VoiceProvider, preset: DeliveryPreset) => void;
  /** locked while a batch runs (radios disabled, cursor not-allowed) */
  locked?: boolean;
  /** e.g. a warning that the chosen provider isn't set up */
  note?: string | null;
  /** where the note's problem is fixed (e.g. Accounts → Studio Assets for missing voice models) */
  noteHref?: string | null;
}) {
  const id = useId();
  const [provider, setProvider] = useState<VoiceProvider>(initialProvider);
  const [preset, setPreset] = useState(initialPreset);
  const [state, setState] = useState<Result>(null);
  const [pending, start] = useTransition();
  const save = (p: VoiceProvider, d: DeliveryPreset) => {
    onChange?.(p, d);
    if (!onSave) return;
    start(async () => setState(await onSave(p, d)));
  };
  const option =
    "flex min-h-11 cursor-pointer items-center gap-2 rounded-control border border-border px-3 text-sm has-[:checked]:border-[var(--text)] has-[:focus-visible]:outline has-[:focus-visible]:outline-2 has-[:disabled]:cursor-not-allowed has-[:disabled]:opacity-60";
  return (
    <div className="min-w-0 space-y-3">
      <fieldset className="min-w-0 space-y-2" disabled={pending || locked}>
        <legend className="text-sm font-semibold">Voice provider</legend>
        <div className="grid gap-2 sm:grid-cols-2">
          {SELECTABLE_PROVIDERS.map((p) => (
            <label key={p} className={option}>
              <input
                type="radio"
                name="provider"
                value={p}
                checked={provider === p}
                onChange={() => {
                  setProvider(p);
                  save(p, preset);
                }}
                className="h-5 w-5"
              />
              {PROVIDER_LABEL[p]}
            </label>
          ))}
        </div>
      </fieldset>
      <fieldset className="min-w-0 space-y-2" disabled={pending || locked} aria-describedby={`${id}-help`}>
        <legend className="text-sm font-semibold">Delivery</legend>
        <div className="grid gap-2 sm:grid-cols-2">
          {DELIVERY_PRESETS.map((d) => (
            <label key={d} className={option}>
              <input
                type="radio"
                name="preset"
                value={d}
                checked={preset === d}
                onChange={() => {
                  setPreset(d);
                  save(provider, d);
                }}
                className="h-5 w-5"
              />
              {DELIVERY_LABEL[d]}
            </label>
          ))}
        </div>
        <p id={`${id}-help`} className="text-xs text-muted">
          Each line is acted from its pose (angry, deadpan, defensive…). The script text is read exactly as written. Lines that already have audio keep it.
        </p>
      </fieldset>
      {note && (
        <p className="text-xs" style={{ color: "var(--bad)" }}>
          {note}{" "}
          {noteHref && (
            <a href={noteHref} className="inline-flex min-h-11 items-center font-semibold text-link underline">
              Open Studio Assets
            </a>
          )}
        </p>
      )}
      <div aria-live="polite">
        {pending ? (
          <p className="text-xs text-muted">Saving…</p>
        ) : state ? (
          <p className="text-xs" style={{ color: state.ok ? "var(--win)" : "var(--bad)" }}>
            {state.message}
          </p>
        ) : null}
      </div>
    </div>
  );
}
