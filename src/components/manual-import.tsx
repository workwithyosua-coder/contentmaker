"use client";

import { useActionState, useCallback, useMemo, useState } from "react";
import type { StepResult } from "@/app/create/actions";
import { createManualEpisodeAction } from "@/app/create/studio-actions";
import { estimatedRuntime, parseManualScript, secondsToClock, type ManualLine, type ManualScript } from "@/lib/manualScriptParser";
import { addAvailableAssets, registerRemoteAssets } from "../../video/src/assets";
import { requiredAssets } from "../../video/src/beats";
import { parseDirection } from "../../video/src/direction";
import { AssetChecklist } from "./asset-checklist";
import { BeatTable } from "./beat-inspector";
import { Status } from "./episode-ui";

// Manual / Exact Import on /create: topic, style, the raw script and optional direction / cue notes → Parse Script
// (in the browser, by fixed rules) → an editable beat table with asset readiness → Create episode. Zero AI: nothing
// here or in the save path calls an LLM, and the dialogue is saved exactly as written.

const SCRIPT_EXAMPLE = `Title: Bubur Diaduk vs Nggak Diaduk
Target Runtime: 60s
[Beat: Hook]
1. UCO (0:00–0:05 | loud): "Dengerin! Bubur nggak diaduk itu kriminal!"
[EN] "Listen up! Not stirring your porridge is a crime!"
2. OCU (0:05–0:11 | deadpan): "Lihat lapisannya: ayam suwir, cakwe, baru bubur di bawah."
[EN] "Look at the layers: shredded chicken, cakwe, then the porridge."
[Beat: Concession]
3. UCO (thought) (0:11–0:15): "Dia ada benernya…"
[EN] "He has a point…"

…or simply:
UCO: Kopi susu 30 ribu itu wajar!
OCU: Wajar buat siapa?`;

const CUES_EXAMPLE = `DIRECTION & VISUAL NOTES
- Pause 0.3s between lines
- BGM on, duck BGM on thought lines
- CTA: Follow buat part 2

LINE-BY-LINE VISUAL, ON-SCREEN TEXT & SFX CUES
- Line 1 (Uco): Dutch tilt. SFX: record scratch · on screen: "KRIMINAL!"
- Line 2 (Ocu): Prop: bubur-unmixed · Callout: ayam, cakwe, bubur`;

export function ManualImport({ attached }: { attached: { props: string[]; sfx: string[] } }) {
  const [topic, setTopic] = useState("");
  const [style, setStyle] = useState("editorial-paper-cutout");
  const [script, setScript] = useState("");
  const [cues, setCues] = useState("");
  const [parsed, setParsed] = useState<ManualScript | null>(null);
  const [parseCount, setParseCount] = useState(0);
  const [edited, setEdited] = useState<ManualLine[] | null>(null);
  const onLinesChange = useCallback((l: ManualLine[]) => setEdited(l), []);

  const parse = () => {
    const r = parseManualScript({ topic, script, direction: cues });
    setParsed(r);
    setEdited(r.lines);
    setParseCount((c) => c + 1);
    if (!topic.trim() && r.title && r.lines.length) setTopic(r.title);
  };

  const lines = useMemo(() => edited ?? parsed?.lines ?? [], [edited, parsed]);
  const readiness = useMemo(() => {
    addAvailableAssets(attached);
    registerRemoteAssets(null);
    return requiredAssets(lines.map((l, i) => ({ ...l, index: i })), { stamp: style === "editorial-paper-cutout", direction: parsed ? parseDirection(parsed.directionText) : null });
  }, [lines, attached, style, parsed]);

  const save = (payload: string) => createManualEpisodeAction(topic, style, parsed?.directionText ?? "", payload);
  const runtime = parsed ? estimatedRuntime(lines, parsed.direction.cta) : 0;

  return (
    <div className="space-y-4">
      <div>
        <label htmlFor="mi-topic" className="label">
          Topic / episode title
        </label>
        <input id="mi-topic" className="field" maxLength={120} value={topic} onChange={(e) => setTopic(e.target.value)} placeholder="Bubur diaduk vs nggak diaduk (or a Title: line in the script)" />
      </div>
      <fieldset>
        <legend className="label">Visual style</legend>
        <div className="flex flex-wrap gap-4 text-sm">
          {[
            ["editorial-paper-cutout", "Koran Kinetik"],
            ["tactical-vector-hud", "Diagram Taktis"],
          ].map(([id, label]) => (
            <label key={id} className="flex items-center gap-2">
              <input type="radio" name="mi-style" value={id} checked={style === id} onChange={() => setStyle(id)} /> {label}
            </label>
          ))}
        </div>
      </fieldset>
      <div>
        <label htmlFor="mi-script" className="label">
          Raw script
        </label>
        <textarea id="mi-script" rows={12} className="field font-mono text-xs" value={script} onChange={(e) => setScript(e.target.value)} placeholder={SCRIPT_EXAMPLE} />
        <p className="mt-1 text-xs text-muted">
          <code>1. UCO (0:00–0:05 | notes): &quot;…&quot;</code> or plain <code>UCO: …</code>, an <code>[EN]</code> row under each line, <code>(thought)</code> for inner thoughts,
          optional <code>Title:</code>, <code>Target Runtime:</code> and <code>[Beat: …]</code>. Your words are kept exactly as written.
        </p>
      </div>
      <div>
        <label htmlFor="mi-cues" className="label">
          Direction &amp; cues <span className="font-normal text-muted">(optional)</span>
        </label>
        <textarea id="mi-cues" rows={6} className="field font-mono text-xs" value={cues} onChange={(e) => setCues(e.target.value)} placeholder={CUES_EXAMPLE} />
      </div>
      <button type="button" className="btn btn-secondary" disabled={!script.trim()} onClick={parse}>
        {parsed ? "Parse again" : "Parse Script"}
      </button>

      {parsed && (
        <div className="space-y-4 border-t border-border pt-4">
          <div className="text-xs" aria-live="polite">
            <p className="text-sm font-semibold">
              {parsed.lines.length} line{parsed.lines.length === 1 ? "" : "s"} parsed
              <span className="font-normal text-muted">
                {" "}
                · {parsed.lines.filter((l) => l.speaker === "uco").length} Uco, {parsed.lines.filter((l) => l.speaker === "ocu").length} Ocu
                {parsed.lines.some((l) => l.thought_bubble) ? `, ${parsed.lines.filter((l) => l.thought_bubble).length} thought` : ""}
                {` · ${parsed.lines.filter((l) => l.start_s !== null).length} timed · about ${secondsToClock(Math.round(runtime))}`}
                {parsed.targetRuntimeS ? ` (target ${secondsToClock(parsed.targetRuntimeS)})` : ""}
              </span>
            </p>
            {parsed.directionText && (
              <p className="mt-1 text-muted">
                Pacing: {parsed.direction.pauseS !== null ? `${parsed.direction.pauseS}s pause` : "default pauses"}
                {parsed.direction.thoughtPauseS !== null ? `, ${parsed.direction.thoughtPauseS}s around thoughts` : ""} · BGM{" "}
                {parsed.direction.bgm ? `on (${Math.round(parsed.direction.bgmVolume * 100)}%${parsed.direction.thoughtDuck < 1 ? ", ducked on thoughts" : ""})` : "off"} · CTA{" "}
                {parsed.direction.cta ? (parsed.direction.ctaText ? `“${parsed.direction.ctaText}”` : "on") : "off"}
              </p>
            )}
            {parsed.warnings.length > 0 && (
              <ul className="mt-2 list-disc space-y-0.5 pl-4" style={{ color: "var(--bad)" }}>
                {parsed.warnings.slice(0, 10).map((w) => (
                  <li key={w}>{w}</li>
                ))}
              </ul>
            )}
          </div>
          {parsed.lines.length > 0 && (
            <>
              <AssetChecklist {...readiness} />
              <BeatTable
                key={parseCount}
                lines={parsed.lines}
                direction={parsed.directionText}
                attached={attached}
                onSave={save}
                onLinesChange={onLinesChange}
                saveLabel="Create episode"
                alwaysSavable
              />
              <p className="text-xs text-muted">No AI is used: the lines above are saved exactly as shown, and the video renders from them.</p>
            </>
          )}
        </div>
      )}
    </div>
  );
}

/** /create: switch between the AI writers' room and Manual / Exact Import. */
export function CreateModes({ ai, manual }: { ai: React.ReactNode; manual: React.ReactNode }) {
  const [mode, setMode] = useState<"ai" | "manual">("ai");
  const tab = (id: "ai" | "manual", label: string) => (
    <button
      type="button"
      role="tab"
      id={`mode-${id}`}
      aria-selected={mode === id}
      aria-controls={`panel-${id}`}
      onClick={() => setMode(id)}
      className={`rounded-control px-3 py-1.5 text-sm font-semibold ${mode === id ? "bg-surface-2" : "text-muted"}`}
    >
      {label}
    </button>
  );
  return (
    <div>
      <div role="tablist" aria-label="How to make the episode" className="mb-4 flex flex-wrap gap-1 border-b border-border pb-2">
        {tab("ai", "Writers' room (AI)")}
        {tab("manual", "Manual / Exact Import")}
      </div>
      <div role="tabpanel" id="panel-ai" aria-labelledby="mode-ai" hidden={mode !== "ai"}>
        {ai}
      </div>
      <div role="tabpanel" id="panel-manual" aria-labelledby="mode-manual" hidden={mode !== "manual"}>
        {manual}
      </div>
    </div>
  );
}

/** Episode page: the direction / pacing notes of a manual script (read by the renderer, no AI). */
export function DirectionForm({ action, initial }: { action: (prev: StepResult, form: FormData) => Promise<StepResult>; initial: string }) {
  const [state, run, pending] = useActionState(action, null);
  return (
    <form action={run} className="space-y-2">
      <label htmlFor="sd-direction" className="label">
        Direction &amp; pacing notes
      </label>
      <textarea id="sd-direction" name="direction" rows={4} defaultValue={initial} className="field font-mono text-xs" placeholder={"Pause 0.3s between lines\nBGM on, duck BGM on thought lines\nCTA: Follow buat part 2"} />
      <div className="flex flex-wrap items-center gap-3">
        <button disabled={pending} className="btn btn-secondary">
          {pending ? "Saving…" : "Save direction"}
        </button>
        <Status state={state} />
      </div>
    </form>
  );
}

/** Episode page: paste a whole new version (parsed by the same rules). */
export function ReplaceScriptForm({ action, direction }: { action: (prev: StepResult, form: FormData) => Promise<StepResult>; direction: string }) {
  const [state, run, pending] = useActionState(action, null);
  const [script, setScript] = useState("");
  const parsed = useMemo(() => (script.trim() ? parseManualScript({ script, direction }) : null), [script, direction]);
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
