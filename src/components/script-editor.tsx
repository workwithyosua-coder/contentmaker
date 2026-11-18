"use client";

import { useActionState, useEffect, useState } from "react";
import type { StepResult } from "@/app/create/actions";
import { ReviseForm, Status } from "@/components/episode-ui";

type Action = (prev: StepResult, form: FormData) => Promise<StepResult>;

/** "Revise with AI" and "Paste / Import script" as two tabs under the script. */
export function ScriptEditor({ reviseAction, importAction }: { reviseAction: Action; importAction: Action }) {
  const [tab, setTab] = useState<"revise" | "import">("revise");
  return (
    <div className="space-y-3">
      <div role="tablist" aria-label="Change the script" className="inline-flex rounded-control border border-border p-1">
        {(
          [
            ["revise", "Revise with AI"],
            ["import", "Paste / Import script"],
          ] as const
        ).map(([id, label]) => (
          <button
            key={id}
            type="button"
            role="tab"
            aria-selected={tab === id}
            onClick={() => setTab(id)}
            className={`min-h-11 rounded-control px-3 text-sm font-semibold ${tab === id ? "bg-surface-2 text-text" : "text-muted hover:text-text"}`}
          >
            {label}
          </button>
        ))}
      </div>
      {tab === "revise" ? <ReviseForm action={reviseAction} /> : <ImportForm action={importAction} />}
    </div>
  );
}

function ImportForm({ action }: { action: Action }) {
  const [state, run, pending] = useActionState(action, null);
  const [mode, setMode] = useState<"exact" | "adapt">("exact");
  return (
    <form action={run} className="space-y-3">
      <div className="space-y-1">
        <label htmlFor="import-script" className="label">
          Your script
        </label>
        <textarea
          id="import-script"
          name="script"
          rows={10}
          required
          className="field font-mono text-xs"
          placeholder={`1. UCO (0:00–0:06 | Hook, loud, holding phone): "Semua ngaku bokek, tapi kafe penuh!"\n[EN] Everyone says they're broke, but cafes are packed!\n2. OCU: "Justru itu tanda kita lagi bokek."\nUCO (thought): Sial, masuk akal.`}
        />
        <p className="text-xs text-muted">
          Each line starts with UCO: or OCU:, with the words after it or on the row below. Numbers, timestamps, cues in brackets, (thought) and [EN] lines are all fine.
        </p>
      </div>
      <div className="space-y-1">
        <label htmlFor="import-notes" className="label">
          Direction and visual notes (optional)
        </label>
        <textarea
          id="import-notes"
          name="notes"
          rows={4}
          className="field text-xs"
          placeholder="Visual or SFX table, pacing notes, or instructions like: keep my exact Indonesian wording, map visual cues from the beat table."
        />
      </div>
      <fieldset className="space-y-2">
        <legend className="label">How to use it</legend>
        {(
          [
            ["exact", "Exact import", "Your lines and order stay word for word. The AI only fills in beats, emotions, visuals and missing translations."],
            ["adapt", "Import and adapt", "Your script is the base; the AI refines it following your notes (for example, to hit a target length)."],
          ] as const
        ).map(([value, title, hint]) => (
          <label key={value} className={`flex cursor-pointer gap-3 rounded-control border p-3 ${mode === value ? "border-text" : "border-border"}`}>
            <input type="radio" name="mode" value={value} checked={mode === value} onChange={() => setMode(value)} className="mt-1" />
            <span>
              <span className="block text-sm font-semibold">{title}</span>
              <span className="block text-xs text-muted">{hint}</span>
            </span>
          </label>
        ))}
      </fieldset>
      <div className="flex flex-wrap items-center gap-3">
        <button disabled={pending} className="btn btn-primary">
          {pending ? "Importing… (about 30 s)" : "Import as new version"}
        </button>
        <Status state={state} />
      </div>
    </form>
  );
}

export type LineView = {
  speaker: "uco" | "ocu";
  text: string;
  subtitle: string;
  expression: string;
  thought_bubble: boolean;
  visual: string;
  on_screen_text: string | null;
};

/** One dialogue card, with an inline editor (no new version). */
export function ScriptLine({
  line,
  expressions,
  editAction,
}: {
  line: LineView;
  expressions: readonly string[];
  /** Omitted for older versions (view only). */
  editAction?: Action;
}) {
  const [editing, setEditing] = useState(false);
  const uco = line.speaker === "uco";
  const tint = { background: uco ? "var(--uco-bg)" : "var(--ocu-bg)", borderColor: uco ? "var(--uco)" : "var(--ocu)" };
  return (
    <div className={`flex ${uco ? "justify-start" : "justify-end"}`}>
      <div className={`relative max-w-[88%] rounded-card px-3 py-2 ${line.thought_bubble ? "border-2 border-dashed" : ""}`} style={tint}>
        <div className="mb-0.5 flex items-center gap-2 pr-8 text-[11px]">
          <span className="font-bold" style={{ color: uco ? "var(--uco)" : "var(--ocu)" }}>
            {uco ? "Uco" : "Ocu"}
          </span>
          <span className="text-muted">{line.thought_bubble ? "💭 thinking" : line.expression}</span>
        </div>
        {editAction && !editing && (
          <button
            type="button"
            onClick={() => setEditing(true)}
            aria-label="Edit this line"
            className="absolute right-1 top-1 flex h-9 w-9 items-center justify-center rounded-control text-muted hover:text-text"
          >
            ✎
          </button>
        )}
        {editing && editAction ? (
          <LineEditForm line={line} expressions={expressions} action={editAction} onDone={() => setEditing(false)} />
        ) : (
          <>
            <p className="text-sm">{line.text}</p>
            <p className="mt-0.5 text-xs italic text-muted">{line.subtitle}</p>
            {(line.on_screen_text || line.visual) && (
              <p className="mt-1 text-[11px] text-muted">
                🎬 {line.visual}
                {line.on_screen_text ? ` · on screen: “${line.on_screen_text}”` : ""}
              </p>
            )}
          </>
        )}
      </div>
    </div>
  );
}

function LineEditForm({ line, expressions, action, onDone }: { line: LineView; expressions: readonly string[]; action: Action; onDone: () => void }) {
  const [state, run, pending] = useActionState(action, null);
  useEffect(() => {
    if (state?.ok) onDone();
  }, [state, onDone]);
  return (
    <form action={run} className="mt-1 space-y-2">
      <label className="block text-[11px] font-semibold">
        Indonesian
        <textarea name="text" defaultValue={line.text} rows={2} required className="field mt-1 text-sm" />
      </label>
      <label className="block text-[11px] font-semibold">
        English
        <textarea name="subtitle" defaultValue={line.subtitle} rows={2} className="field mt-1 text-xs" />
      </label>
      <div className="flex flex-wrap items-center gap-3">
        <label className="text-[11px] font-semibold">
          Emotion{" "}
          <select name="expression" defaultValue={line.expression} className="field mt-1 w-auto">
            {expressions.map((e) => (
              <option key={e} value={e}>
                {e}
              </option>
            ))}
          </select>
        </label>
        <label className="flex min-h-11 items-center gap-2 text-[11px] font-semibold">
          <input type="checkbox" name="thought_bubble" defaultChecked={line.thought_bubble} /> Inner thought
        </label>
      </div>
      <label className="block text-[11px] font-semibold">
        🎬 Visual direction
        <input name="visual" defaultValue={line.visual} className="field mt-1 text-xs" />
      </label>
      <label className="block text-[11px] font-semibold">
        On-screen text (optional)
        <input name="on_screen_text" defaultValue={line.on_screen_text ?? ""} className="field mt-1 text-xs" />
      </label>
      <div className="flex flex-wrap items-center gap-2">
        <button disabled={pending} className="btn btn-primary">
          {pending ? "Saving…" : "Save line"}
        </button>
        <button type="button" onClick={onDone} className="btn btn-quiet">
          Cancel
        </button>
        <Status state={state} />
      </div>
      <p className="text-[11px] text-muted">Edits this version in place. If the line is already recorded, record it again after changing the words.</p>
    </form>
  );
}
