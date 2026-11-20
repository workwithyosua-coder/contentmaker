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

// Editable beat list (Manual mode), one card per line, mobile first: timing, thought, speaker, the Indonesian line
// and its [EN] subtitle (saved exactly as typed), pose (only the poses that character has sprites for), shot, a short
// 2–4 word on-screen callout, card, prop + callouts and SFX. Blank fields are "auto": the hint shows what the rules
// pick, computed with the renderer's own buildBeats, so this list is the pre-render preview. No AI anywhere.

/** A stored line: the parser's shape (older custom lines may miss some optional fields). */
export type TableLine = Partial<ManualLine> & Pick<ManualLine, "speaker" | "text"> & { asset_urls?: AssetUrlMap | null };
type AssetUrlMap = { props?: Record<string, string>; sfx?: Record<string, string> };

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

/** A row back to a full stored line (fields the list doesn't edit are carried over unchanged). */
function rowToLine(r: Row, base: TableLine, uploads: AssetUrlMap): ManualLine & { asset_urls: AssetUrlMap | null } {
  const time = (v: string) => (v.trim() ? clockToSeconds(v.trim()) : null);
  const sfx = list(r.sfx);
  const prop = r.prop.trim() || null;
  // the public URL of every uploaded asset this line names travels with the line
  const propUrl = prop && uploads.props?.[prop];
  const sfxUrls = Object.fromEntries(sfx.filter((n) => uploads.sfx?.[n]).map((n) => [n, uploads.sfx![n]]));
  const asset_urls = propUrl || Object.keys(sfxUrls).length ? { ...(propUrl ? { props: { [prop!]: propUrl } } : {}), ...(Object.keys(sfxUrls).length ? { sfx: sfxUrls } : {}) } : null;
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
    prop_tag: prop,
    callouts: r.callouts.trim() ? list(r.callouts) : null,
    sfx,
    asset_urls,
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
  onLinesChange,
  disabled = false,
}: {
  lines: TableLine[];
  /** recorded take length per line index (ms), for real timing */
  recordedMs?: Record<number, number | null>;
  direction: string;
  /** uploaded props / SFX file names ("sate-padang.png") */
  attached: { props: string[]; sfx: string[] };
  /** public URLs of the uploads (name → URL) */
  assetUrls?: AssetUrlMap;
  /** episode page: a Save button under the list (the composer has its own save button) */
  onSave?: (payload: string) => Promise<StepResult>;
  saveLabel?: string;
  /** called with the edited lines whenever the list changes */
  onLinesChange?: (lines: ManualLine[]) => void;
  disabled?: boolean;
}) {
  const [rows, setRows] = useState<Row[]>(() => lines.map(toRow));
  const [state, setState] = useState<StepResult>(null);
  const [pending, start] = useTransition();
  const uploads = useMemo(() => assetUrls ?? {}, [assetUrls]);
  const dirty = rows.some((r, i) => JSON.stringify(r) !== JSON.stringify(toRow(lines[i])));
  const badTime = rows.findIndex((r) => (r.start.trim() && clockToSeconds(r.start) === null) || (r.end.trim() && clockToSeconds(r.end) === null));
  const off = disabled || pending;

  // the beats exactly as the renderer will build them (same rules, same assets)
  const beats = useMemo(() => {
    addAvailableAssets(attached);
    registerRemoteAssets(uploads);
    const episodeLines = rows.map((r, i) => {
      const l = rowToLine(r, lines[i], uploads);
      const ms = recordedMs[i];
      const timed = l.start_s !== null && l.end_s !== null && l.end_s > l.start_s ? l.end_s - l.start_s : null;
      const frames = Math.round((ms ? ms / 1000 : (timed ?? spokenSeconds(l.text))) * FPS);
      return { ...l, index: i, hasAudio: Boolean(ms), audio: null, frames, envelope: [] } as unknown as EpisodeLine;
    });
    return buildBeats(episodeLines, parseDirection(direction));
  }, [rows, lines, recordedMs, direction, attached, uploads]);

  useEffect(() => {
    onLinesChange?.(rows.map((r, i) => rowToLine(r, lines[i], uploads)));
  }, [rows, lines, uploads, onLinesChange]);

  const set = (i: number, patch: Partial<Row>) => setRows((rs) => rs.map((r, j) => (j === i ? { ...r, ...patch } : r)));
  const clock = (f: number) => secondsToClock(Math.round((f / FPS) * 10) / 10);
  const strip = (f: string) => f.replace(/\.[a-z0-9]+$/, "");
  const propOptions = [...new Set([...PNG_PROPS.map((p) => p.name), ...attached.props.map(strip), ...Object.keys(uploads.props ?? {})])].sort();
  const sfxOptions = [...new Set(["whoosh", "pop", "stamp", "ding", "record-scratch", ...attached.sfx.map(strip), ...Object.keys(uploads.sfx ?? {})])].sort();
  const propSrc = (name: string) => uploads.props?.[name] ?? (PNG_PROPS.some((p) => p.name === name) ? `/props/${name}.png` : null);

  const save = () => {
    if (!onSave) return;
    if (badTime >= 0) return setState({ ok: false, message: `Line ${badTime + 1}: write times as m:ss, e.g. 0:24.` });
    const payload = rows.map((r, i) => rowToLine(r, lines[i], uploads));
    start(async () => setState(await onSave(JSON.stringify(payload))));
  };

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
      <p className="text-xs text-muted">
        {beats.filter((b) => b.line !== null).length} beats · {clock(beats.reduce((m, b) => Math.max(m, b.startFrame + b.durationInFrames), 0))} with the end card. Blank
        fields are picked automatically; the hint shows the pick.
      </p>
      <ol className="space-y-3">
        {rows.map((r, i) => {
          const b = beats.find((x) => x.line === i);
          const auto = (v: string | null | undefined) => (v ? `Auto (${v})` : "Auto");
          const autoProp = b?.propImage ?? (b && b.propTag !== "none" ? b.propTag : null);
          const shownProp = r.prop && r.prop !== "none" ? r.prop : (b?.propImage ?? null);
          const src = shownProp ? propSrc(shownProp) : null;
          const id = (f: string) => `bt-${i}-${f}`;
          const timeBad = (v: string) => Boolean(v.trim()) && clockToSeconds(v) === null;
          return (
            <li key={i} className="rounded-control border border-border p-3">
              <fieldset disabled={off} className="min-w-0 space-y-3">
                <legend className="sr-only">Line {i + 1}</legend>
                <div className="flex flex-wrap items-end gap-3">
                  <span className="pb-3 text-sm font-semibold tabular-nums">#{i + 1}</span>
                  <div>
                    <label htmlFor={id("speaker")} className="label">
                      Speaker
                    </label>
                    <select
                      id={id("speaker")}
                      className="field w-auto"
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
                  </div>
                  <div>
                    <label htmlFor={id("start")} className="label">
                      Start
                    </label>
                    <input id={id("start")} inputMode="decimal" className="field w-24" value={r.start} placeholder={b ? clock(b.startFrame) : "0:00"} aria-invalid={timeBad(r.start)} onChange={(e) => set(i, { start: e.target.value })} />
                  </div>
                  <div>
                    <label htmlFor={id("end")} className="label">
                      End
                    </label>
                    <input id={id("end")} inputMode="decimal" className="field w-24" value={r.end} placeholder={b ? clock(b.startFrame + b.durationInFrames) : "0:05"} aria-invalid={timeBad(r.end)} onChange={(e) => set(i, { end: e.target.value })} />
                  </div>
                  <label className="flex min-h-[44px] items-center gap-2 text-sm">
                    <input type="checkbox" className="h-5 w-5" checked={r.thought} onChange={(e) => set(i, { thought: e.target.checked })} /> Thought
                  </label>
                </div>
                {(timeBad(r.start) || timeBad(r.end)) && (
                  <p className="text-xs" style={{ color: "var(--bad)" }}>
                    Write times as m:ss, e.g. 0:24.
                  </p>
                )}
                <div>
                  <label htmlFor={id("text")} className="label">
                    Indonesian line
                  </label>
                  <textarea id={id("text")} rows={2} className="field" value={r.text} onChange={(e) => set(i, { text: e.target.value })} />
                </div>
                <div>
                  <label htmlFor={id("en")} className="label">
                    English subtitle
                  </label>
                  <textarea id={id("en")} rows={2} className="field italic" value={r.subtitle} placeholder="No subtitle" onChange={(e) => set(i, { subtitle: e.target.value })} />
                </div>
                <div className="grid gap-3 sm:grid-cols-2">
                  <div>
                    <label htmlFor={id("pose")} className="label">
                      Pose
                    </label>
                    <select id={id("pose")} className="field" value={r.emotion} onChange={(e) => set(i, { emotion: e.target.value })}>
                      <option value="">{auto(b?.emotion)}</option>
                      {POSES[r.speaker].map((e) => (
                        <option key={e} value={e}>
                          {e}
                        </option>
                      ))}
                    </select>
                  </div>
                  <div>
                    <label htmlFor={id("shot")} className="label">
                      Shot
                    </label>
                    <select id={id("shot")} className="field" value={r.shot} onChange={(e) => set(i, { shot: e.target.value })}>
                      <option value="">{auto(b?.cameraShot)}</option>
                      {CAMERA_SHOTS.filter((c) => c !== "cta-stinger").map((c) => (
                        <option key={c} value={c}>
                          {c}
                        </option>
                      ))}
                    </select>
                  </div>
                  <div>
                    <label htmlFor={id("callout")} className="label">
                      On-screen callout <span className="font-normal text-muted">(2–4 words)</span>
                    </label>
                    <input id={id("callout")} className="field" value={r.kinetic} maxLength={48} placeholder={b?.kinetic ? `Auto: ${b.kinetic}` : "None"} onChange={(e) => set(i, { kinetic: e.target.value })} />
                    {r.kinetic.trim().split(/\s+/).length > 4 && (
                      <p className="mt-1 text-xs" style={{ color: "var(--bad)" }}>
                        Only the first 4 words show.
                      </p>
                    )}
                  </div>
                  <div>
                    <label htmlFor={id("card")} className="label">
                      Explainer card
                    </label>
                    <select id={id("card")} className="field" value={r.overlay} onChange={(e) => set(i, { overlay: e.target.value })}>
                      <option value="">{auto(b?.overlay?.kind ?? "none")}</option>
                      <option value="none">none</option>
                      {OVERLAYS.map((o) => (
                        <option key={o} value={o}>
                          {o}
                        </option>
                      ))}
                    </select>
                  </div>
                  <div>
                    <label htmlFor={id("prop")} className="label">
                      Prop
                    </label>
                    <div className="flex items-center gap-2">
                      <input id={id("prop")} list="bt-props" className="field min-w-0" value={r.prop} placeholder={auto(autoProp)} onChange={(e) => set(i, { prop: e.target.value.trim().toLowerCase() })} />
                      {src && (
                        // eslint-disable-next-line @next/next/no-img-element -- repo props and public Supabase URLs, fixed size
                        <img src={src} alt={`${shownProp} preview`} width={44} height={44} loading="lazy" className="shrink-0 rounded border border-border bg-surface-2" style={{ objectFit: "contain", aspectRatio: "1 / 1" }} />
                      )}
                    </div>
                  </div>
                  <div>
                    <label htmlFor={id("callouts")} className="label">
                      Prop labels
                    </label>
                    <input id={id("callouts")} className="field" value={r.callouts} placeholder={b?.callouts.length ? `Auto: ${b.callouts.join(", ")}` : "e.g. ayam, cakwe"} onChange={(e) => set(i, { callouts: e.target.value })} />
                  </div>
                  <div className="sm:col-span-2">
                    <label htmlFor={id("sfx")} className="label">
                      Sound effects <span className="font-normal text-muted">(comma separated)</span>
                    </label>
                    <input id={id("sfx")} list="bt-sfx" className="field" value={r.sfx} placeholder="e.g. ding, record-scratch" onChange={(e) => set(i, { sfx: e.target.value })} />
                  </div>
                </div>
              </fieldset>
            </li>
          );
        })}
      </ol>
      {onSave && (
        <div className="flex flex-wrap items-center gap-3">
          <button type="button" disabled={off || !dirty} onClick={save} className="btn btn-primary">
            {pending ? "Saving…" : saveLabel}
          </button>
          {dirty && (
            <button type="button" className="btn btn-secondary" disabled={off} onClick={() => setRows(lines.map(toRow))}>
              Undo changes
            </button>
          )}
          <Status state={state} />
        </div>
      )}
      <details className="text-xs">
        <summary className="cursor-pointer text-muted">Beat sheet (JSON, what the renderer gets)</summary>
        <pre className="mt-2 max-h-72 overflow-auto whitespace-pre-wrap break-all rounded-control border border-border p-2 font-mono text-[11px]">
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
