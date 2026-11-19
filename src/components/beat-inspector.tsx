"use client";

import { useEffect, useMemo, useState, useTransition } from "react";
import type { StepResult } from "@/app/create/actions";
import { POSES, clockToSeconds, secondsToClock, spokenSeconds, type ManualLine } from "@/lib/manualScriptParser";
import { addAvailableAssets, registerRemoteAssets } from "../../video/src/assets";
import { CAMERA_SHOTS, OVERLAYS, buildBeats } from "../../video/src/beats";
import { parseDirection } from "../../video/src/direction";
import { PNG_PROPS } from "../../video/src/props/library";
import { FPS, type EpisodeLine } from "../../video/src/types";
import { Status } from "./episode-ui";

// Editable beat table (Manual / Exact Import). One row per line: timing, thought, speaker, the Indonesian line and
// its [EN] subtitle (saved exactly as typed), pose (only the poses that character has), shot, short on-screen text,
// card, prop + callouts and SFX. Blank fields are "auto": the grey text shows what the rules pick, computed with the
// renderer's own buildBeats, so the table is the pre-render preview. Used before saving (/create) and after
// (episode page). No AI anywhere.

/** A stored line: the parser's shape (older custom lines may miss some optional fields). */
export type TableLine = Partial<ManualLine> & Pick<ManualLine, "speaker" | "text">;

type Row = {
  start: string;
  end: string;
  speaker: "uco" | "ocu";
  text: string;
  subtitle: string;
  thought: boolean;
  emotion: string;
  shot: string;
  kinetic: string;
  overlay: string;
  prop: string;
  callouts: string;
  sfx: string;
};

const toRow = (l: TableLine): Row => ({
  start: l.start_s != null ? secondsToClock(l.start_s) : "",
  end: l.end_s != null ? secondsToClock(l.end_s) : "",
  speaker: l.speaker,
  text: l.text,
  subtitle: l.subtitle ?? "",
  thought: Boolean(l.thought_bubble),
  emotion: l.emotion && POSES[l.speaker].includes(l.emotion) ? l.emotion : "",
  shot: l.camera_shot ?? "",
  kinetic: l.kinetic_text ?? "",
  overlay: l.overlay ?? "",
  prop: l.prop_tag ?? "",
  callouts: l.callouts ? l.callouts.join(", ") : "",
  sfx: (l.sfx ?? []).join(", "),
});

const list = (s: string) =>
  s
    .split(",")
    .map((x) => x.trim().toLowerCase().replace(/\s+/g, "-"))
    .filter(Boolean);

/** A row back to a full stored line (fields the table doesn't edit are carried over unchanged). */
function rowToLine(r: Row, base: TableLine): ManualLine {
  const time = (v: string) => (v.trim() ? clockToSeconds(v.trim()) : null);
  return {
    beat: base.beat ?? "counter",
    expression: base.expression ?? "neutral",
    visual: base.visual ?? "",
    on_screen_text: base.on_screen_text ?? null,
    delivery: base.delivery ?? null,
    important_message: base.important_message ?? null,
    speaker: r.speaker,
    text: r.text, // exactly as typed
    subtitle: r.subtitle,
    thought_bubble: r.thought,
    start_s: time(r.start),
    end_s: time(r.end),
    emotion: r.emotion || null,
    camera_shot: r.shot || null,
    kinetic_text: r.kinetic.trim() || null,
    overlay: r.overlay || null,
    prop_tag: r.prop.trim() || null,
    callouts: r.callouts.trim() ? list(r.callouts) : null,
    sfx: list(r.sfx),
  };
}

export function BeatTable({
  lines,
  recordedMs = {},
  direction,
  attached,
  assetUrls,
  onSave,
  saveLabel = "Save beats",
  alwaysSavable = false,
  onLinesChange,
}: {
  lines: TableLine[];
  /** recorded take length per line index (ms), for real timing */
  recordedMs?: Record<number, number | null>;
  direction: string;
  /** uploaded props / SFX file names ("sate-padang.png") */
  attached: { props: string[]; sfx: string[] };
  /** their URLs, when known (the episode page signs them), so auto picks match the render */
  assetUrls?: { props: Record<string, string>; sfx: Record<string, string> };
  onSave: (payload: string) => Promise<StepResult>;
  saveLabel?: string;
  /** /create: the button works before anything is edited */
  alwaysSavable?: boolean;
  /** called with the edited lines whenever the table changes (the readiness bar follows the edits) */
  onLinesChange?: (lines: ManualLine[]) => void;
}) {
  const [rows, setRows] = useState<Row[]>(() => lines.map(toRow));
  const [state, setState] = useState<StepResult>(null);
  const [pending, start] = useTransition();
  const dirty = alwaysSavable || rows.some((r, i) => JSON.stringify(r) !== JSON.stringify(toRow(lines[i])));
  const badTime = rows.findIndex((r) => (r.start.trim() && clockToSeconds(r.start) === null) || (r.end.trim() && clockToSeconds(r.end) === null));

  // the beats exactly as the renderer will build them (same rules, same assets)
  const beats = useMemo(() => {
    addAvailableAssets(attached);
    registerRemoteAssets(assetUrls);
    const episodeLines = rows.map((r, i) => {
      const l = rowToLine(r, lines[i]);
      const ms = recordedMs[i];
      const timed = l.start_s !== null && l.end_s !== null && l.end_s > l.start_s ? l.end_s - l.start_s : null;
      const frames = Math.round((ms ? ms / 1000 : (timed ?? spokenSeconds(l.text))) * FPS);
      return { ...l, index: i, hasAudio: Boolean(ms), audio: null, frames, envelope: [] } as unknown as EpisodeLine;
    });
    return buildBeats(episodeLines, parseDirection(direction));
  }, [rows, lines, recordedMs, direction, attached, assetUrls]);

  useEffect(() => {
    onLinesChange?.(rows.map((r, i) => rowToLine(r, lines[i])));
  }, [rows, lines, onLinesChange]);

  const set = (i: number, patch: Partial<Row>) => setRows((rs) => rs.map((r, j) => (j === i ? { ...r, ...patch } : r)));
  const clock = (f: number) => secondsToClock(Math.round((f / FPS) * 10) / 10);
  const strip = (f: string) => f.replace(/\.[a-z0-9]+$/, "");
  const propOptions = [...new Set([...PNG_PROPS.map((p) => p.name), ...attached.props.map(strip)])].sort();
  const sfxOptions = [...new Set(["whoosh", "pop", "stamp", "ding", "record-scratch", ...attached.sfx.map(strip)])].sort();

  const save = () => {
    if (badTime >= 0) return setState({ ok: false, message: `Line ${badTime + 1}: write times as m:ss, e.g. 0:24.` });
    const payload = rows.map((r, i) => rowToLine(r, lines[i]));
    start(async () => setState(await onSave(JSON.stringify(payload))));
  };

  const cell = "field !min-h-0 px-2 py-1 text-xs";
  return (
    <div className="space-y-3">
      <datalist id="bt-props">
        <option value="none" />
        {propOptions.map((p) => (
          <option key={p} value={p} />
        ))}
      </datalist>
      <datalist id="bt-sfx">
        {sfxOptions.map((p) => (
          <option key={p} value={p} />
        ))}
      </datalist>
      <div className="-mx-1 overflow-x-auto px-1">
        <table className="w-full min-w-[900px] border-separate border-spacing-y-1 text-left text-xs">
          <caption className="sr-only">Beats: one row per line. Blank fields are picked automatically; the grey text shows the pick.</caption>
          <thead className="text-muted">
            <tr>
              <th scope="col" className="w-7 px-1 font-semibold">#</th>
              <th scope="col" className="w-36 px-1 font-semibold">Start – end</th>
              <th scope="col" className="w-[72px] px-1 font-semibold">Speaker</th>
              <th scope="col" className="px-1 font-semibold">Line &amp; [EN]</th>
              <th scope="col" className="w-36 px-1 font-semibold">Pose · shot</th>
              <th scope="col" className="w-36 px-1 font-semibold">On screen · card</th>
              <th scope="col" className="w-36 px-1 font-semibold">Prop · callouts · SFX</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r, i) => {
              const b = beats.find((x) => x.line === i);
              const auto = (v: string | null | undefined) => (v ? `auto: ${v}` : "auto");
              const autoProp = b?.propImage ?? (b && b.propTag !== "none" ? b.propTag : null);
              return (
                <tr key={i} className="align-top">
                  <td className="px-1 pt-2 font-semibold tabular-nums">{i + 1}</td>
                  <td className="px-1">
                    <div className="flex items-center gap-1">
                      <input aria-label={`Line ${i + 1} start`} className={`${cell} w-16`} value={r.start} placeholder={b ? clock(b.startFrame) : ""} onChange={(e) => set(i, { start: e.target.value })} />
                      <span aria-hidden>–</span>
                      <input aria-label={`Line ${i + 1} end`} className={`${cell} w-16`} value={r.end} placeholder={b ? clock(b.startFrame + b.durationInFrames) : ""} onChange={(e) => set(i, { end: e.target.value })} />
                    </div>
                    <label className="mt-1 flex items-center gap-1 text-muted">
                      <input type="checkbox" checked={r.thought} onChange={(e) => set(i, { thought: e.target.checked })} /> thought
                    </label>
                  </td>
                  <td className="px-1">
                    <select
                      aria-label={`Line ${i + 1} speaker`}
                      className={cell}
                      value={r.speaker}
                      onChange={(e) => {
                        const speaker = e.target.value as Row["speaker"];
                        // a pose the other character doesn't have goes back to auto
                        set(i, { speaker, emotion: POSES[speaker].includes(r.emotion) ? r.emotion : "" });
                      }}
                    >
                      <option value="uco">Uco</option>
                      <option value="ocu">Ocu</option>
                    </select>
                  </td>
                  <td className="space-y-1 px-1">
                    <input aria-label={`Line ${i + 1} Indonesian`} className={`${cell} w-full`} value={r.text} onChange={(e) => set(i, { text: e.target.value })} />
                    <input aria-label={`Line ${i + 1} English subtitle`} className={`${cell} w-full italic`} value={r.subtitle} placeholder="[EN] subtitle" onChange={(e) => set(i, { subtitle: e.target.value })} />
                  </td>
                  <td className="space-y-1 px-1">
                    <select aria-label={`Line ${i + 1} pose`} className={`${cell} w-full`} value={r.emotion} onChange={(e) => set(i, { emotion: e.target.value })}>
                      <option value="">{auto(b?.emotion)}</option>
                      {POSES[r.speaker].map((e) => (
                        <option key={e} value={e}>
                          {e}
                        </option>
                      ))}
                    </select>
                    <select aria-label={`Line ${i + 1} shot`} className={`${cell} w-full`} value={r.shot} onChange={(e) => set(i, { shot: e.target.value })}>
                      <option value="">{auto(b?.cameraShot)}</option>
                      {CAMERA_SHOTS.filter((c) => c !== "cta-stinger").map((c) => (
                        <option key={c} value={c}>
                          {c}
                        </option>
                      ))}
                    </select>
                  </td>
                  <td className="space-y-1 px-1">
                    <input
                      aria-label={`Line ${i + 1} on-screen text`}
                      className={`${cell} w-full`}
                      value={r.kinetic}
                      maxLength={48}
                      placeholder={b?.kinetic ? `auto: ${b.kinetic}` : "2–4 words"}
                      onChange={(e) => set(i, { kinetic: e.target.value })}
                    />
                    {r.kinetic.trim().split(/\s+/).length > 4 && <span className="block text-[11px]" style={{ color: "var(--bad)" }}>Only the first 4 words show.</span>}
                    <select aria-label={`Line ${i + 1} card`} className={`${cell} w-full`} value={r.overlay} onChange={(e) => set(i, { overlay: e.target.value })}>
                      <option value="">{auto(b?.overlay?.kind ?? "none")}</option>
                      <option value="none">none</option>
                      {OVERLAYS.map((o) => (
                        <option key={o} value={o}>
                          {o}
                        </option>
                      ))}
                    </select>
                  </td>
                  <td className="space-y-1 px-1">
                    <input aria-label={`Line ${i + 1} prop`} list="bt-props" className={`${cell} w-full`} value={r.prop} placeholder={auto(autoProp)} onChange={(e) => set(i, { prop: e.target.value.trim().toLowerCase() })} />
                    <input aria-label={`Line ${i + 1} callouts`} className={`${cell} w-full`} value={r.callouts} placeholder={b?.callouts.length ? b.callouts.join(", ") : "callouts"} onChange={(e) => set(i, { callouts: e.target.value })} />
                    <input aria-label={`Line ${i + 1} sound effects`} list="bt-sfx" className={`${cell} w-full`} value={r.sfx} placeholder="SFX, e.g. ding" onChange={(e) => set(i, { sfx: e.target.value })} />
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      <div className="flex flex-wrap items-center gap-3">
        <button type="button" disabled={pending || !dirty} onClick={save} className="btn btn-primary">
          {pending ? "Saving…" : saveLabel}
        </button>
        {!alwaysSavable && dirty && (
          <button type="button" className="btn btn-secondary" onClick={() => setRows(lines.map(toRow))}>
            Undo changes
          </button>
        )}
        <span className="text-xs text-muted">
          {beats.filter((b) => b.line !== null).length} beats · {clock(beats.reduce((m, b) => Math.max(m, b.startFrame + b.durationInFrames), 0))} with the end card
        </span>
      </div>
      <Status state={state} />
      <details className="text-xs">
        <summary className="cursor-pointer text-muted">Beat sheet (JSON, what the renderer gets)</summary>
        <pre className="mt-2 max-h-72 overflow-auto rounded-control border border-border p-2 font-mono text-[11px]">
          {JSON.stringify(
            beats.map((b) => ({
              id: b.id,
              start: clock(b.startFrame),
              end: clock(b.startFrame + b.durationInFrames),
              speaker: b.speaker,
              shot: b.cameraShot,
              pose: b.emotion,
              prop: b.propImage ?? (b.propTag !== "none" ? b.propTag : null),
              callouts: b.callouts,
              card: b.overlay?.kind ?? null,
              thought: b.thought,
              onScreen: b.kinetic,
              sfx: b.sfx,
            })),
            null,
            1,
          )}
        </pre>
      </details>
    </div>
  );
}
