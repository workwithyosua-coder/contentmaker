"use client";

import { useActionState, useState } from "react";
import { cloneVoiceAction, setVoiceIdAction, type ActionResult } from "@/app/accounts/actions";
import type { AiResult } from "@/app/create/[id]/record/ai-actions";

function Msg({ state }: { state: ActionResult | AiResult }) {
  if (!state) return null;
  return (
    <p role="status" className="text-xs" style={{ color: state.ok ? "var(--win)" : "var(--bad)" }}>
      {state.message}
    </p>
  );
}

/** Accounts page: set up one character's AI voice. */
export function VoiceSetup({ speaker, hasVoice, sampleSeconds }: { speaker: "uco" | "ocu"; hasVoice: boolean; sampleSeconds: number }) {
  const [cloneState, clone, cloning] = useActionState(() => cloneVoiceAction(speaker), null);
  const [idState, saveId, saving] = useActionState(setVoiceIdAction.bind(null, speaker), null);
  const [showId, setShowId] = useState(false);
  return (
    <div className="space-y-2">
      <form action={clone} className="flex flex-wrap items-center gap-2">
        <button disabled={cloning || sampleSeconds < 20} className={hasVoice ? "btn btn-secondary" : "btn btn-primary"}>
          {cloning ? "Cloning…" : hasVoice ? "Clone again from my recordings" : "Clone from my recordings"}
        </button>
        <span className="text-xs text-muted">
          {sampleSeconds < 20 ? "Record at least 20 s of this character in the booth first." : `${sampleSeconds} s of recordings available`}
        </span>
      </form>
      <Msg state={cloneState} />
      {showId ? (
        <form action={saveId} className="flex flex-wrap items-center gap-2">
          <input name="voiceId" placeholder="ElevenLabs voice ID" className="field max-w-xs" autoComplete="off" />
          <button disabled={saving} className="btn btn-secondary">
            {saving ? "Checking…" : "Use this voice"}
          </button>
        </form>
      ) : (
        <button type="button" onClick={() => setShowId(true)} className="text-xs font-semibold text-link underline">
          Or use a voice you made on elevenlabs.io
        </button>
      )}
      <Msg state={idState} />
    </div>
  );
}

/** Recording booth: voice lines with the AI clones. */
export function AiVoicePanel({
  action,
  lines,
  missing,
}: {
  action: (prev: AiResult, form: FormData) => Promise<AiResult>;
  lines: { index: number; speaker: string; text: string }[];
  missing: number;
}) {
  const [state, run, pending] = useActionState(action, null);
  return (
    <div className="space-y-3">
      <form action={run}>
        <input type="hidden" name="mode" value="missing" />
        <button disabled={pending || missing === 0} className="btn btn-primary">
          {pending ? "Generating voices…" : missing ? `Voice the ${missing} missing line${missing > 1 ? "s" : ""} with AI` : "All lines have a take"}
        </button>
      </form>
      <details>
        <summary className="cursor-pointer text-sm font-semibold">Redo one line with AI</summary>
        <form action={run} className="mt-2 space-y-2">
          <input type="hidden" name="mode" value="line" />
          <select name="lineIndex" className="field" aria-label="Line">
            {lines.map((l) => (
              <option key={l.index} value={l.index}>
                {l.index + 1}. {l.speaker.toUpperCase()}: {l.text.slice(0, 60)}
              </option>
            ))}
          </select>
          <input name="extra" className="field" placeholder="Extra direction, e.g. faster, more annoyed, whisper the end" autoComplete="off" />
          <button disabled={pending} className="btn btn-secondary">
            {pending ? "Generating…" : "Generate a new take"}
          </button>
        </form>
      </details>
      <Msg state={state} />
      <p className="text-xs text-muted">
        AI takes use your cloned voices and the script&apos;s delivery notes. They show up as new takes in the list below, so you can
        still record over any line yourself.
      </p>
    </div>
  );
}
