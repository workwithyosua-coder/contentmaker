"use client";

import { useMemo, useState, useTransition } from "react";
import type { StepResult } from "@/app/create/actions";
import { clockToSeconds, secondsToClock, spokenSeconds } from "@/lib/custom-script";
import { addAvailableAssets } from "../../video/src/assets";
import { CAMERA_SHOTS, EMOTIONS, OVERLAYS, buildBeats } from "../../video/src/beats";
import { parseDirection } from "../../video/src/direction";
import { PNG_PROPS } from "../../video/src/props/library";
import { FPS, type EpisodeLine } from "../../video/src/types";
import { Status } from "./episode-ui";

// Beat Inspector: every line's timing, speaker, pose, shot, prop, callouts, card and SFX, as the renderer will use
// them. Blank fields are "auto": the column shows what the rules picked. Edits are checked and saved in place
// (no AI, no new script version), so recorded takes stay attached.

export type InspectorLine = {
  speaker: "uco" | "ocu";
  text: string;
  subtitle: string;
  thought_bubble: boolean;
  beat: string;
  expression: string;
  visual?: string;
  on_screen_text?: string | null;
  important_message?: { kicker: string; headline: string; stamp?: string | null } | null;
  start_s?: number | null;
  end_s?: number | null;
  emotion?: string | null;
  camera_shot?: string | null;
  prop_tag?: string | null;
  overlay?: string | null;
  callouts?: string[] | null;
  sfx?: string[] | null;
};

type Row = {
  start: string;
  end: string;
  speaker: "uco" | "ocu";
  text: string;
  subtitle: string;
  thought: boolean;
  emotion: string;
  shot: string;
  prop: string;
  overlay: string;
  callouts: string;
  sfx: string;
};

const toRow = (l: InspectorLine): Row => ({
  start: l.start_s != null ? secondsToClock(l.start_s) : "",
  end: l.end_s != null ? secondsToClock(l.end_s) : "",
  speaker: l.speaker,
  text: l.text,
  subtitle: l.subtitle ?? "",
  thought: Boolean(l.thought_bubble),
  emotion: l.emotion ?? "",
  shot: l.camera_shot ?? "",
  prop: l.prop_tag ?? "",
  overlay: l.overlay ?? "",
  callouts: l.callouts ? l.callouts.join(", ") : "",
  sfx: (l.sfx ?? []).join(", "),
});

const list = (s: string) =>
  s
    .split(",")
    .map((x) => x.trim().toLowerCase())
    .filter(Boolean);

function rowToLine(r: Row, base: InspectorLine) {
  const time = (v: string) => (v.trim() ? clockToSeconds(v.trim()) : null);
  return {
    ...base,
    speaker: r.speaker,
    text: r.text,
    subtitle: r.subtitle,
    thought_bubble: r.thought,
    start_s: time(r.start),
    end_s: time(r.end),
    emotion: r.emotion || null,
    camera_shot: r.shot || null,
    prop_tag: r.prop || null,
    overlay: r.overlay || null,
    callouts: r.callouts.trim() ? list(r.callouts) : null,
    sfx: list(r.sfx),
  };
}

export function BeatInspector({
  lines,
  recordedMs,
  direction,
  attached,
  save,
}: {
  lines: InspectorLine[];
  /** recorded take length per line index (ms), for real timing */
  recordedMs: Record<number, number | null>;
  direction: string;
  attached: { props: string[]; sfx: string[] };
  save: (payload: string) => Promise<StepResult>;
}) {
  const [rows, setRows] = useState<Row[]>(() => lines.map(toRow));
  const [state, setState] = useState<StepResult>(null);
  const [pending, start] = useTransition();
  const dirty = rows.some((r, i) => JSON.stringify(r) !== JSON.stringify(toRow(lines[i])));
  const badTime = rows.findIndex((r) => (r.start.trim() && clockToSeconds(r.start) === null) || (r.end.trim() && clockToSeconds(r.end) === null));

  // the beats exactly as the renderer will build them (same rules, same assets)
  const beats = useMemo(() => {
    addAvailableAssets(attached);
    const episodeLines = rows.map((r, i) => {
      const l = rowToLine(r, lines[i]);
      const ms = recordedMs[i];
      const timed = l.start_s !== null && l.end_s !== null && l.end_s > l.start_s ? l.end_s - l.start_s : null;
      const frames = Math.round((ms ? ms / 1000 : (timed ?? spokenSeconds(l.text))) * FPS);
      return { ...l, index: i, hasAudio: Boolean(ms), audio: null, frames, envelope: [] } as unknown as EpisodeLine;
    });
    return buildBeats(episodeLines, parseDirection(direction));
  }, [rows, lines, recordedMs, direction, attached]);

  const set = (i: number, patch: Partial<Row>) => setRows((rs) => rs.map((r, j) => (j === i ? { ...r, ...patch } : r)));
  const clock = (f: number) => secondsToClock(Math.round((f / FPS) * 10) / 10);
  const propOptions = [...new Set([...PNG_PROPS.map((p) => p.name), ...attached.props.map((p) => p.replace(/\.png$/, ""))])].sort();
  const sfxOptions = [...new Set(["whoosh", "pop", "stamp", "ding", "record-scratch", ...attached.sfx.map((s) => s.replace(/\.(mp3|wav)$/, ""))])].sort();

  const onSave = () => {
    if (badTime >= 0) {
      setState({ ok: false, message: `Line ${badTime + 1}: write times as m:ss, e.g. 0:24.` });
      return;
    }
    const payload = rows.map((r, i) => {
      const l = rowToLine(r, lines[i]);
      return {
        index: i,
        speaker: l.speaker,
        text: l.text,
        subtitle: l.subtitle,
        thought_bubble: l.thought_bubble,
        start_s: l.start_s,
        end_s: l.end_s,
        emotion: l.emotion,
        camera_shot: l.camera_shot,
        prop_tag: l.prop_tag,
        overlay: l.overlay,
        callouts: l.callouts,
        sfx: l.sfx,
      };
    });
    start(async () => setState(await save(JSON.stringify(payload))));
  };

  const cell = "field !min-h-0 px-2 py-1 text-xs";
  return (
    <div className="space-y-3">
      <datalist id="bi-props">
        <option value="none" />
        {propOptions.map((p) => (
          <option key={p} value={p} />
        ))}
      </datalist>
      <datalist id="bi-sfx">
        {sfxOptions.map((p) => (
          <option key={p} value={p} />
        ))}
      </datalist>
      <div className="-mx-1 overflow-x-auto px-1">
        <table className="w-full min-w-[860px] border-separate border-spacing-y-1 text-left text-xs">
          <caption className="sr-only">Beats: one row per line. Blank fields are picked automatically; the grey text shows the pick.</caption>
          <thead className="text-muted">
            <tr>
              <th scope="col" className="w-7 px-1 font-semibold">#</th>
              <th scope="col" className="w-36 px-1 font-semibold">Start – end</th>
              <th scope="col" className="w-[72px] px-1 font-semibold">Speaker</th>
              <th scope="col" className="px-1 font-semibold">Line &amp; [EN]</th>
              <th scope="col" className="w-40 px-1 font-semibold">Pose · shot</th>
              <th scope="col" className="w-40 px-1 font-semibold">Prop · callouts</th>
              <th scope="col" className="w-36 px-1 font-semibold">Card · SFX</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r, i) => {
              const b = beats.find((x) => x.line === i);
              const auto = (v: string | null | undefined) => (v ? `auto: ${v}` : "auto");
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
                    <select aria-label={`Line ${i + 1} speaker`} className={cell} value={r.speaker} onChange={(e) => set(i, { speaker: e.target.value as Row["speaker"] })}>
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
                      {EMOTIONS.filter((e) => e !== "cta").map((e) => (
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
                    <input aria-label={`Line ${i + 1} prop`} list="bi-props" className={`${cell} w-full`} value={r.prop} placeholder={auto(b?.propImage ?? (b && b.propTag !== "none" ? b.propTag : null))} onChange={(e) => set(i, { prop: e.target.value.trim().toLowerCase() })} />
                    <input aria-label={`Line ${i + 1} callouts`} className={`${cell} w-full`} value={r.callouts} placeholder={b?.callouts.length ? b.callouts.join(", ") : "callouts"} onChange={(e) => set(i, { callouts: e.target.value })} />
                  </td>
                  <td className="space-y-1 px-1">
                    <select aria-label={`Line ${i + 1} card`} className={`${cell} w-full`} value={r.overlay} onChange={(e) => set(i, { overlay: e.target.value })}>
                      <option value="">{auto(b?.overlay?.kind ?? "none")}</option>
                      <option value="none">none</option>
                      {OVERLAYS.map((o) => (
                        <option key={o} value={o}>
                          {o}
                        </option>
                      ))}
                    </select>
                    <input aria-label={`Line ${i + 1} sound effects`} list="bi-sfx" className={`${cell} w-full`} value={r.sfx} placeholder="e.g. ding" onChange={(e) => set(i, { sfx: e.target.value })} />
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      <div className="flex flex-wrap items-center gap-3">
        <button type="button" disabled={pending || !dirty} onClick={onSave} className="btn btn-primary">
          {pending ? "Saving…" : "Save beats"}
        </button>
        {dirty && (
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
              kinetic: b.kinetic,
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
