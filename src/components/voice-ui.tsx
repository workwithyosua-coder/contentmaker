"use client";

import { useActionState, useState } from "react";
import {
  cloneVoiceAction,
  setVoiceIdAction,
  type ActionResult,
} from "@/app/accounts/actions";
import type { AiResult } from "@/app/create/[id]/record/ai-actions";

function Msg({ state }: { state: ActionResult | AiResult }) {
  if (!state) return null;
  return (
    <p
      role="status"
      className="text-xs"
      style={{ color: state.ok ? "var(--win)" : "var(--bad)" }}
    >
      {state.message}
    </p>
  );
}

/** Create page: set up one character's AI voice. */
export type VoiceOption = { id: string; label: string; preview: string | null };

export function VoiceSetup({
  speaker,
  hasVoice,
  sampleSeconds,
  canClone,
  voices,
  currentId,
}: {
  speaker: "uco" | "ocu";
  hasVoice: boolean;
  sampleSeconds: number;
  canClone: boolean;
  voices: VoiceOption[];
  currentId?: string;
}) {
  const [cloneState, clone, cloning] = useActionState(
    () => cloneVoiceAction(speaker),
    null,
  );
  const [idState, saveId, saving] = useActionState(
    setVoiceIdAction.bind(null, speaker),
    null,
  );
  const [showId, setShowId] = useState(false);
  const [pick, setPick] = useState(currentId ?? "");
  const preview = voices.find((v) => v.id === pick)?.preview;
  return (
    <div className="space-y-2">
      {voices.length > 0 && (
        <form action={saveId} className="space-y-2">
          <div className="flex flex-wrap items-center gap-2">
            <select
              name="voiceId"
              value={pick}
              onChange={(e) => setPick(e.target.value)}
              className="field max-w-sm"
              aria-label={`Voice for ${speaker}`}
            >
              <option value="" disabled>
                Choose a ready-made voice…
              </option>
              {voices.map((v) => (
                <option key={v.id} value={v.id}>
                  {v.label}
                </option>
              ))}
            </select>
            <button
              disabled={saving || !pick || pick === currentId}
              className="btn btn-secondary"
            >
              {saving
                ? "Saving…"
                : pick && pick === currentId
                  ? "In use"
                  : "Use this voice"}
            </button>
          </div>
          {preview && (
            <audio
              key={preview}
              controls
              src={preview}
              className="w-full max-w-sm"
            />
          )}
        </form>
      )}
      {canClone ? (
        <form action={clone} className="flex flex-wrap items-center gap-2">
          <button
            disabled={cloning || sampleSeconds < 20}
            className={hasVoice ? "btn btn-secondary" : "btn btn-primary"}
          >
            {cloning
              ? "Cloning…"
              : hasVoice
                ? "Clone again from my recordings"
                : "Clone from my recordings"}
          </button>
          <span className="text-xs text-muted">
            {sampleSeconds < 20
              ? "Record at least 20 s of this character in the booth first."
              : `${sampleSeconds} s of recordings available`}
          </span>
        </form>
      ) : (
        <p className="text-xs text-muted">
          Cloning your own voice needs the ElevenLabs Starter plan. Ready-made
          voices work on the free plan.
        </p>
      )}
      <Msg state={cloneState} />
      {showId ? (
        <form action={saveId} className="flex flex-wrap items-center gap-2">
          <input
            name="voiceId"
            placeholder="ElevenLabs voice ID"
            className="field max-w-xs"
            autoComplete="off"
          />
          <button disabled={saving} className="btn btn-secondary">
            {saving ? "Checking…" : "Use this voice"}
          </button>
        </form>
      ) : (
        <button
          type="button"
          onClick={() => setShowId(true)}
          className="text-xs font-semibold text-link underline"
        >
          Or paste a voice ID from elevenlabs.io
        </button>
      )}
      <Msg state={idState} />
    </div>
  );
}
