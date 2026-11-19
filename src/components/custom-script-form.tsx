"use client";

import { useActionState, useMemo, useState } from "react";
import type { StepResult } from "@/app/create/actions";
import { parseCustomScript } from "@/lib/custom-script";
import { Status } from "./episode-ui";

// "Your own script" on /create: topic, style, direction notes and a pasted script, parsed in the browser by the same
// rules the server uses (no AI), so the summary under the form is exactly what gets saved.

const SCRIPT_EXAMPLE = `HOOK
UCO (0:00–0:05 | SFX: record-scratch): Dengerin! Bubur nggak diaduk itu kriminal!
[EN] Listen up! Not stirring your porridge is a crime!
OCU: Lihat lapisannya: ayam suwir, cakwe, baru bubur di bawah.
[EN] Look at the layers: shredded chicken, cakwe, then the porridge.
CALLOUT: ayam, cakwe, bubur
UCO (thought): Dia ada benernya…
[EN] He has a point…`;

const DIRECTION_EXAMPLE = `Pause: 0.3s between lines
BGM on, volume 8%
Duck BGM on thought lines
CTA: Follow buat part 2`;

export function CustomScriptForm({ action }: { action: (prev: StepResult, form: FormData) => Promise<StepResult> }) {
  const [state, run, pending] = useActionState(action, null);
  const [topic, setTopic] = useState("");
  const [script, setScript] = useState("");
  const [direction, setDirection] = useState("");
  const parsed = useMemo(() => (script.trim() ? parseCustomScript({ topic, script, direction }) : null), [topic, script, direction]);
  const timed = parsed?.lines.filter((l) => l.start_s !== null).length ?? 0;
  const d = parsed?.direction;

  return (
    <form action={run} className="space-y-4">
      <div>
        <label htmlFor="cs-topic" className="label">
          Topic / episode title
        </label>
        <input id="cs-topic" name="topic" required minLength={3} maxLength={120} className="field" value={topic} onChange={(e) => setTopic(e.target.value)} placeholder="Bubur diaduk vs nggak diaduk" />
      </div>

      <fieldset>
        <legend className="label">Visual style</legend>
        <div className="flex flex-wrap gap-4 text-sm">
          <label className="flex items-center gap-2">
            <input type="radio" name="style" value="editorial-paper-cutout" defaultChecked /> Koran Kinetik
          </label>
          <label className="flex items-center gap-2">
            <input type="radio" name="style" value="tactical-vector-hud" /> Diagram Taktis
          </label>
        </div>
      </fieldset>

      <div>
        <label htmlFor="cs-direction" className="label">
          Direction &amp; pacing notes <span className="font-normal text-muted">(optional)</span>
        </label>
        <textarea id="cs-direction" name="direction" rows={4} className="field font-mono text-xs" value={direction} onChange={(e) => setDirection(e.target.value)} placeholder={DIRECTION_EXAMPLE} />
        <p className="mt-1 text-xs text-muted">One note per line: pause, thought pause, BGM on/off/volume, duck BGM on thought lines, CTA off or CTA text.</p>
      </div>

      <div>
        <label htmlFor="cs-script" className="label">
          Script &amp; line cues
        </label>
        <textarea id="cs-script" name="script" required rows={12} className="field font-mono text-xs" value={script} onChange={(e) => setScript(e.target.value)} placeholder={SCRIPT_EXAMPLE} />
        <p className="mt-1 text-xs text-muted">
          Start lines with <code>UCO:</code> or <code>OCU:</code>, put <code>[EN]</code> under each line, mark inner thoughts with <code>(thought)</code>. Optional cues in brackets or on
          the rows under a line: <code>0:24–0:28</code>, <code>SFX:</code>, <code>PROP:</code>, <code>SHOT:</code>, <code>POSE:</code>, <code>TEXT:</code>, <code>STAMP:</code>,{" "}
          <code>CALLOUT:</code>, <code>OVERLAY:</code>, <code>VISUAL:</code>.
        </p>
      </div>

      {parsed && (
        <div className="rounded-control border border-border p-3 text-xs" aria-live="polite">
          <p className="font-semibold">
            {parsed.lines.length} line{parsed.lines.length === 1 ? "" : "s"} found
            {parsed.lines.length > 0 && (
              <span className="font-normal text-muted">
                {" "}
                · {parsed.lines.filter((l) => l.speaker === "uco").length} Uco, {parsed.lines.filter((l) => l.speaker === "ocu").length} Ocu
                {parsed.lines.some((l) => l.thought_bubble) ? `, ${parsed.lines.filter((l) => l.thought_bubble).length} thought` : ""}
                {timed ? ` · ${timed} timed` : ""}
              </span>
            )}
          </p>
          {d && direction.trim() && (
            <p className="mt-1 text-muted">
              Pacing: {d.pauseS !== null ? `${d.pauseS}s pause` : "default pauses"}
              {d.thoughtPauseS !== null ? `, ${d.thoughtPauseS}s around thoughts` : ""} · BGM {d.bgm ? `on (${Math.round(d.bgmVolume * 100)}%${d.thoughtDuck < 1 ? ", ducked on thoughts" : ""})` : "off"} · CTA{" "}
              {d.cta ? (d.ctaText ? `“${d.ctaText}”` : "on") : "off"}
            </p>
          )}
          {parsed.warnings.length > 0 && (
            <ul className="mt-2 list-disc space-y-0.5 pl-4" style={{ color: "var(--bad)" }}>
              {parsed.warnings.slice(0, 8).map((w) => (
                <li key={w}>{w}</li>
              ))}
            </ul>
          )}
        </div>
      )}

      <div className="flex flex-wrap items-center gap-3">
        <button disabled={pending || !parsed?.lines.length} className="btn btn-primary">
          {pending ? "Saving…" : "Create episode"}
        </button>
        <span className="text-xs text-muted">No AI is used: your lines are saved word for word.</span>
      </div>
      <Status state={state} />
    </form>
  );
}

/** Episode page: the direction / pacing notes of a custom script (read by the renderer, no AI). */
export function DirectionForm({ action, initial }: { action: (prev: StepResult, form: FormData) => Promise<StepResult>; initial: string }) {
  const [state, run, pending] = useActionState(action, null);
  return (
    <form action={run} className="space-y-2">
      <label htmlFor="sd-direction" className="label">
        Direction &amp; pacing notes
      </label>
      <textarea id="sd-direction" name="direction" rows={4} defaultValue={initial} className="field font-mono text-xs" placeholder={DIRECTION_EXAMPLE} />
      <div className="flex flex-wrap items-center gap-3">
        <button disabled={pending} className="btn btn-secondary">
          {pending ? "Saving…" : "Save direction"}
        </button>
        <Status state={state} />
      </div>
    </form>
  );
}

/** Episode page: paste a whole new version of a custom script (parsed by the same rules). */
export function ReplaceScriptForm({ action, direction }: { action: (prev: StepResult, form: FormData) => Promise<StepResult>; direction: string }) {
  const [state, run, pending] = useActionState(action, null);
  const [script, setScript] = useState("");
  const parsed = useMemo(() => (script.trim() ? parseCustomScript({ topic: "", script, direction }) : null), [script, direction]);
  return (
    <form action={run} className="space-y-2">
      <input type="hidden" name="direction" value={direction} />
      <label htmlFor="sr-script" className="label">
        Paste a new version
      </label>
      <textarea id="sr-script" name="script" rows={8} className="field font-mono text-xs" value={script} onChange={(e) => setScript(e.target.value)} placeholder={SCRIPT_EXAMPLE} />
      {parsed && (
        <p className="text-xs text-muted" aria-live="polite">
          {parsed.lines.length} lines found{parsed.warnings.length ? ` · ${parsed.warnings[0]}` : ""}
        </p>
      )}
      <div className="flex flex-wrap items-center gap-3">
        <button disabled={pending || !parsed?.lines.length} className="btn btn-secondary">
          {pending ? "Saving…" : "Save as a new version"}
        </button>
        <span className="text-xs text-muted">Recorded takes stay with the old version.</span>
      </div>
      <Status state={state} />
    </form>
  );
}
