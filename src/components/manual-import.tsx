"use client";

import { useActionState, useCallback, useMemo, useRef, useState, useTransition } from "react";
import type { StepResult } from "@/app/create/actions";
import { createManualEpisodeAction } from "@/app/create/studio-actions";
import { estimatedRuntime, parseManualScript, secondsToClock, type ManualLine, type ManualScript } from "@/lib/manualScriptParser";
import { addAvailableAssets, registerRemoteAssets } from "../../video/src/assets";
import { requiredAssets, wantedPropImage } from "../../video/src/beats";
import { parseDirection } from "../../video/src/direction";
import { AssetChecklist } from "./asset-checklist";
import { needsAngry, type StudioAssetStatus } from "@/lib/studioAssets";
import { storedDirection } from "@/lib/manualScriptParser";
import type { DeliveryPreset, VoiceProvider } from "@/lib/voice/acting";
import { VoiceProviderPicker } from "./voice-provider";
import { BeatTable, type TableLine } from "./beat-inspector";
import { NewEpisodeForm, Status } from "./episode-ui";

// Create page, "New episode" card: the writers' room pitch (AI) or, behind "Use my own script (No AI)", the Manual
// Composer: title, style, script and direction → Parse & preview beats (in the browser, by fixed rules) → editable
// beat list + asset readiness (uploads go to Supabase Storage) → Save episode (No AI). Nothing in the composer or its
// save path calls an LLM, and the dialogue is saved exactly as written.

type Urls = { props: Record<string, string>; sfx: Record<string, string>; cast?: Record<string, string> };

const SCRIPT_EXAMPLE = `1. UCO (0:00-0:05 | loud): "Dengerin! Bubur nggak diaduk itu kriminal!"
[EN] "Listen up! Not stirring your porridge is a crime!"
2. OCU (0:05-0:11): "Lihat lapisannya: ayam suwir, cakwe, bubur."
[EN] "Look at the layers: chicken, cakwe, porridge."
3. UCO (thought) (0:11-0:15): "Dia ada benernya…"
[EN] "He has a point…"

…or simply:
UCO: Kopi susu 30 ribu itu wajar!
OCU: Wajar buat siapa?`;

const CUES_EXAMPLE = `Pause 0.3s between lines
BGM on, duck BGM on thought lines

LINE-BY-LINE VISUAL, ON-SCREEN TEXT & SFX CUES
- Line 1 (Uco): SFX: record scratch · on screen: "KRIMINAL!"
- Line 2 (Ocu): Prop: bubur-unmixed · Callout: ayam, cakwe`;

/** The "New episode" card: idea pitch by default, the Manual Composer behind its button. Both stay mounted (drafts kept). */
export function NewEpisodeCard({
  pitchAction,
  attached,
  assetUrls,
  studio = [],
}: {
  pitchAction: (prev: StepResult, form: FormData) => Promise<StepResult>;
  attached: { props: string[]; sfx: string[] };
  assetUrls: Urls;
  /** global Studio Assets status (angry sprites, urgent BGM) */
  studio?: StudioAssetStatus[];
}) {
  const [mode, setMode] = useState<"pitch" | "manual">("pitch");
  const manualTop = useRef<HTMLButtonElement>(null);
  const ownButton = useRef<HTMLButtonElement>(null);
  return (
    <div>
      <div hidden={mode !== "pitch"}>
        <NewEpisodeForm action={pitchAction} />
        <div role="separator" aria-orientation="horizontal" className="my-4 flex items-center gap-3 text-xs text-muted">
          <span aria-hidden className="h-px flex-1 bg-border" />
          or
          <span aria-hidden className="h-px flex-1 bg-border" />
        </div>
        <button
          ref={ownButton}
          type="button"
          className="btn btn-secondary w-full cursor-pointer"
          onClick={() => {
            setMode("manual");
            requestAnimationFrame(() => manualTop.current?.focus());
          }}
        >
          Use my own script (No AI)
        </button>
      </div>
      <div hidden={mode !== "manual"}>
        <ManualComposer
          backRef={manualTop}
          onBack={() => {
            setMode("pitch");
            requestAnimationFrame(() => ownButton.current?.focus());
          }}
          attached={attached}
          assetUrls={assetUrls}
          studio={studio}
        />
      </div>
    </div>
  );
}

function ManualComposer({
  onBack,
  backRef,
  attached,
  assetUrls,
  studio = [],
}: {
  onBack: () => void;
  backRef: React.RefObject<HTMLButtonElement | null>;
  attached: { props: string[]; sfx: string[] };
  assetUrls: Urls;
  /** global Studio Assets status (angry sprites, urgent BGM) */
  studio?: StudioAssetStatus[];
}) {
  const [title, setTitle] = useState("");
  const [style, setStyle] = useState("editorial-paper-cutout");
  const [script, setScript] = useState("");
  const [cues, setCues] = useState("");
  const [errors, setErrors] = useState<{ title?: string; script?: string }>({});
  const [parsed, setParsed] = useState<ManualScript | null>(null);
  const [base, setBase] = useState<TableLine[]>([]);
  const [listKey, setListKey] = useState(0);
  const [edited, setEdited] = useState<ManualLine[] | null>(null);
  const [direction, setDirection] = useState("");
  const [uploads, setUploads] = useState<Urls>(assetUrls);
  const [saveError, setSaveError] = useState<string | null>(null);
  // voice provider / delivery for the new episode (Gemini TTS, free, by default)
  const [voice, setVoice] = useState<{ provider: VoiceProvider; preset: DeliveryPreset }>({ provider: "gemini_tts", preset: "standard" });
  const [saving, startSave] = useTransition();
  const titleRef = useRef<HTMLInputElement>(null);
  const scriptRef = useRef<HTMLTextAreaElement>(null);
  const onLinesChange = useCallback((l: ManualLine[]) => setEdited(l), []);

  const parse = () => {
    const next: typeof errors = {};
    if (!title.trim()) next.title = "Give the episode a title or topic.";
    if (!script.trim()) next.script = "Paste the script: one line per row, starting with UCO: or OCU:.";
    setErrors(next);
    setSaveError(null);
    if (next.title) return titleRef.current?.focus();
    if (next.script) return scriptRef.current?.focus();
    const r = parseManualScript({ topic: title, script, direction: cues });
    setParsed(r);
    setBase(r.lines);
    setEdited(r.lines);
    // the cue block is stored with the pacing notes, so a later re-pasted script or direction edit applies it again
    setDirection(storedDirection(r));
    setListKey((k) => k + 1);
  };

  const lines = useMemo(() => edited ?? [], [edited]);
  const readiness = useMemo(() => {
    addAvailableAssets(attached);
    registerRemoteAssets(uploads);
    return requiredAssets(
      lines.map((l, i) => ({ ...l, index: i })),
      { stamp: style === "editorial-paper-cutout", direction: { ...parseDirection(direction), exact: true } },
    );
  }, [lines, attached, uploads, style, direction]);

  // Skip before saving: change the unsaved beats (the list re-opens with them)
  const skip = (kind: "props" | "sfx", name: string) => {
    if (kind === "sfx" && name === "bgm") return setDirection((d) => `${d}\nBGM off`.trim());
    const next = lines.map((l) =>
      kind === "sfx" ? { ...l, sfx: l.sfx.filter((s) => s !== name) } : wantedPropImage(l)?.name === name ? { ...l, prop_tag: "none" } : l,
    );
    setBase(next);
    setEdited(next);
    setListKey((k) => k + 1);
  };

  const save = () => {
    setSaveError(null);
    const bad = lines.findIndex((l) => !l.text.trim());
    if (bad >= 0) return setSaveError(`Line ${bad + 1} has no Indonesian text.`);
    startSave(async () => {
      const r = await createManualEpisodeAction(title, style, direction, JSON.stringify(lines), voice);
      // on success the action redirects to the new episode; anything returned is an error
      if (r && !r.ok) setSaveError(r.message);
    });
  };

  const runtime = parsed ? estimatedRuntime(lines, parseDirection(direction).cta) : 0;
  const d = parseDirection(direction);

  return (
    <div className="space-y-4">
      <button ref={backRef} type="button" className="btn btn-secondary cursor-pointer" onClick={onBack} disabled={saving}>
        <span aria-hidden>←</span> Back to idea pitch
      </button>
      <fieldset disabled={saving} className="min-w-0 space-y-4">
        <legend className="text-sm font-semibold">Use my own script (No AI)</legend>
        <div>
          <label htmlFor="mc-title" className="label">
            Episode title / topic
          </label>
          <input
            ref={titleRef}
            id="mc-title"
            className="field"
            maxLength={120}
            value={title}
            aria-invalid={Boolean(errors.title)}
            aria-describedby={errors.title ? "mc-title-err" : undefined}
            onChange={(e) => setTitle(e.target.value)}
            placeholder="Bubur diaduk vs nggak diaduk"
          />
          {errors.title && (
            <p id="mc-title-err" className="mt-1 text-xs" style={{ color: "var(--bad)" }}>
              {errors.title}
            </p>
          )}
        </div>
        <fieldset>
          <legend className="label">Visual style</legend>
          <div className="grid grid-cols-2 gap-2">
            {[
              ["editorial-paper-cutout", "Koran Kinetik"],
              ["tactical-vector-hud", "Diagram Taktis"],
            ].map(([id, label]) => (
              <label
                key={id}
                className="flex min-h-[44px] cursor-pointer items-center justify-center gap-2 rounded-control border px-3 text-sm font-semibold has-[:focus-visible]:outline has-[:focus-visible]:outline-2"
                style={{ borderColor: style === id ? "var(--accent)" : "var(--border)", background: style === id ? "var(--surface-2)" : "var(--surface)", outlineColor: "var(--focus)" }}
              >
                <input type="radio" name="mc-style" value={id} checked={style === id} onChange={() => setStyle(id)} className="sr-only" />
                {label}
              </label>
            ))}
          </div>
        </fieldset>
        <div>
          <label htmlFor="mc-script" className="label">
            Script
          </label>
          <textarea
            ref={scriptRef}
            id="mc-script"
            rows={10}
            className="field font-mono text-sm"
            value={script}
            aria-invalid={Boolean(errors.script)}
            aria-describedby={`mc-script-help${errors.script ? " mc-script-err" : ""}`}
            onChange={(e) => setScript(e.target.value)}
            placeholder={SCRIPT_EXAMPLE}
          />
          {errors.script && (
            <p id="mc-script-err" className="mt-1 text-xs" style={{ color: "var(--bad)" }}>
              {errors.script}
            </p>
          )}
          <p id="mc-script-help" className="mt-1 text-xs text-muted">
            Numbered lines like <code>1. UCO (0:00-0:05 | notes): &quot;…&quot;</code> or plain <code>UCO: …</code>, an <code>[EN]</code> row under each line, and{" "}
            <code>(thought)</code> for inner thoughts. Your words are kept exactly as written.
          </p>
        </div>
        <div>
          <label htmlFor="mc-cues" className="label">
            Direction &amp; visual cues <span className="font-normal text-muted">(optional)</span>
          </label>
          <textarea id="mc-cues" rows={6} className="field font-mono text-sm" value={cues} onChange={(e) => setCues(e.target.value)} placeholder={CUES_EXAMPLE} />
        </div>
        <button type="button" className="btn btn-primary w-full cursor-pointer sm:w-auto" onClick={parse}>
          {parsed ? "Parse again" : "Parse & preview beats"}
        </button>
      </fieldset>

      {parsed && parsed.lines.length === 0 && (
        <div role="alert" className="rounded-control border p-3 text-sm" style={{ borderColor: "var(--bad)", background: "var(--bad-bg)" }}>
          <p className="font-semibold" style={{ color: "var(--bad)" }}>
            No dialogue lines found.
          </p>
          <p className="mt-1">
            Put each line on its own row starting with <code>UCO:</code> or <code>OCU:</code> (numbers and timestamps are optional), then parse again.
          </p>
        </div>
      )}

      {parsed && parsed.lines.length > 0 && (
        <div className="space-y-4 border-t border-border pt-4">
          <div className="text-xs" aria-live="polite">
            <p className="text-sm font-semibold">
              {parsed.lines.length} line{parsed.lines.length === 1 ? "" : "s"} parsed
              <span className="font-normal text-muted">
                {" "}
                · {lines.filter((l) => l.speaker === "uco").length} Uco, {lines.filter((l) => l.speaker === "ocu").length} Ocu
                {lines.some((l) => l.thought_bubble) ? `, ${lines.filter((l) => l.thought_bubble).length} thought` : ""}
                {` · ${lines.filter((l) => l.start_s !== null).length} timed · about ${secondsToClock(Math.round(runtime))}`}
                {parsed.targetRuntimeS ? ` (target ${secondsToClock(parsed.targetRuntimeS)})` : ""}
              </span>
            </p>
            {direction && (
              <p className="mt-1 text-muted">
                Pacing: {d.pauseS !== null ? `${d.pauseS}s pause` : "default pauses"}
                {d.thoughtPauseS !== null ? `, ${d.thoughtPauseS}s around thoughts` : ""} · BGM{" "}
                {d.bgm ? `on (${Math.round(d.bgmVolume * 100)}%${d.thoughtDuck < 1 ? ", ducked on thoughts" : ""})` : "off"} · CTA {d.cta ? (d.ctaText ? `“${d.ctaText}”` : "on") : "off"}
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
          <BeatTable key={listKey} lines={base} direction={direction} attached={attached} assetUrls={uploads} onLinesChange={onLinesChange} disabled={saving} />
          <AssetChecklist
            {...readiness}
            urls={uploads}
            studio={needsAngry(lines) ? studio : undefined}
            disabled={saving}
            onSkip={skip}
            onUploaded={(kind, name, url) => setUploads((u) => ({ ...u, [kind]: { ...u[kind], [name]: url } }))}
          />
          <VoiceProviderPicker
            provider={voice.provider}
            preset={voice.preset}
            onSave={async (provider, preset) => {
              setVoice({ provider, preset });
              return null;
            }}
          />
          {saveError && (
            <div role="alert" className="rounded-control border p-3 text-sm" style={{ borderColor: "var(--bad)", background: "var(--bad-bg)" }}>
              <p className="font-semibold" style={{ color: "var(--bad)" }}>
                The episode wasn&apos;t saved.
              </p>
              <p className="mt-1">{saveError}</p>
              <button type="button" className="btn btn-secondary mt-2 cursor-pointer" onClick={save}>
                Try again
              </button>
            </div>
          )}
          <div className="flex flex-wrap items-center gap-3">
            <button type="button" className="btn btn-primary w-full cursor-pointer sm:w-auto" disabled={saving} aria-busy={saving} onClick={save}>
              {saving ? "Saving…" : "Save episode (No AI)"}
            </button>
            <span className="text-xs text-muted">Saved word for word. Missing assets never block saving or rendering.</span>
          </div>
        </div>
      )}
    </div>
  );
}

/** Episode page: the direction / pacing notes of a manual script (read by the renderer, no AI). */
export function DirectionForm({ action, initial }: { action: (prev: StepResult, form: FormData) => Promise<StepResult>; initial: string }) {
  const [state, run, pending] = useActionState(action, null);
  return (
    <form action={run} className="space-y-2">
      <label htmlFor="sd-direction" className="label">
        Direction &amp; visual cues
      </label>
      <textarea
        id="sd-direction"
        name="direction"
        rows={8}
        defaultValue={initial}
        aria-describedby="sd-direction-help"
        className="field font-mono text-sm"
        placeholder={"Pause 0.3s between lines\nBGM on, duck BGM on thought lines\n\nLINE-BY-LINE VISUAL, ON-SCREEN TEXT & SFX CUES\n- Line 1 (Uco): prop: peta-relokasi-jawa · layout: takeover · stat: \"20 KM | MATI DALAM 2 HARI\" · SFX: stamp · on screen: \"PINDAH?!\""}
      />
      <p id="sd-direction-help" className="text-xs text-muted">Line cues are applied to the beats when you save (recorded voices stay).</p>
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
      <textarea id="sr-script" name="script" rows={8} className="field font-mono text-sm" value={script} onChange={(e) => setScript(e.target.value)} placeholder={SCRIPT_EXAMPLE} />
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
