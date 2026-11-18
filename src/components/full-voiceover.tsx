"use client";

import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { saveRecordingAction, type SaveResult } from "@/app/create/[id]/record/actions";
import type { BoothLine } from "@/lib/recordings";
import { encodeWav, frameLoudness, segments, splitLines, type Split } from "@/lib/voiceover-split";

// One recording of the whole episode → one take per line. The file is decoded and cut in the browser; each clip is
// uploaded as that line's take, the same as a take recorded in the booth. Nothing is saved until "Save".

const RATE = 44100;

type Ready = { name: string; buffer: AudioBuffer; split: Split; cuts: number[] };

export function FullVoiceover({ projectId, scriptId, lines }: { projectId: string; scriptId: string; lines: BoothLine[] }) {
  const router = useRouter();
  const [state, setState] = useState<{ status: "idle" } | { status: "reading" } | { status: "error"; message: string } | ({ status: "ready" } & Ready)>({
    status: "idle",
  });
  const [saving, setSaving] = useState<{ done: number; error?: string } | null>(null);
  const [playing, setPlaying] = useState<number | null>(null);
  const ctxRef = useRef<AudioContext | null>(null);
  const srcRef = useRef<AudioBufferSourceNode | null>(null);

  useEffect(() => () => void ctxRef.current?.close().catch(() => {}), []);

  async function onFile(file: File | undefined) {
    if (!file) return;
    stop();
    setSaving(null);
    setState({ status: "reading" });
    try {
      const ctx = (ctxRef.current ??= new AudioContext({ sampleRate: RATE }));
      const buffer = await ctx.decodeAudioData(await file.arrayBuffer());
      const mono = mixdown(buffer);
      const split = splitLines(
        frameLoudness(mono, buffer.sampleRate),
        lines.map((l) => l.text.split(/\s+/).filter(Boolean).length),
      );
      setState({ status: "ready", name: file.name, buffer, split, cuts: [...split.cuts] });
    } catch (err) {
      setState({ status: "error", message: `Couldn't read that file (${err instanceof Error ? err.message : String(err)}). Use mp3, m4a, wav or webm.` });
    }
  }

  function stop() {
    try {
      srcRef.current?.stop();
    } catch {}
    srcRef.current = null;
    setPlaying(null);
  }

  function play(i: number, start: number, end: number) {
    if (state.status !== "ready") return;
    stop();
    const ctx = ctxRef.current!;
    const src = ctx.createBufferSource();
    src.buffer = state.buffer;
    src.connect(ctx.destination);
    src.onended = () => setPlaying((p) => (p === i ? null : p));
    src.start(0, start, Math.max(0.05, end - start));
    srcRef.current = src;
    setPlaying(i);
  }

  /** Moves cut k to the previous/next pause (or by 0.3 s when there is none), staying between its neighbours. */
  function move(k: number, dir: -1 | 1) {
    if (state.status !== "ready") return;
    const { cuts, split, buffer } = state;
    const lo = k === 0 ? split.speechStart : cuts[k - 1];
    const hi = k === cuts.length - 1 ? Math.min(buffer.duration, split.speechEnd) : cuts[k + 1];
    const mids = split.gaps.map((g) => (g.start + g.end) / 2).filter((m) => m > lo + 0.05 && m < hi - 0.05);
    const target = dir < 0 ? [...mids].reverse().find((m) => m < cuts[k] - 0.01) : mids.find((m) => m > cuts[k] + 0.01);
    const next = target ?? Math.min(hi - 0.1, Math.max(lo + 0.1, cuts[k] + dir * 0.3));
    stop();
    setState({ ...state, cuts: cuts.map((c, i) => (i === k ? next : c)) });
  }

  async function save() {
    if (state.status !== "ready") return;
    stop();
    const segs = segments({ ...state.split, cuts: state.cuts }, state.buffer.duration);
    const mono = mixdown(state.buffer);
    const sr = state.buffer.sampleRate;
    const from = saving?.error ? saving.done : 0; // after a failed upload, carry on where it stopped
    setSaving({ done: from });
    for (let i = from; i < lines.length; i++) {
      const { start, end } = segs[i];
      const clip = mono.subarray(Math.floor(start * sr), Math.ceil(end * sr));
      const fd = new FormData();
      fd.append("scriptId", scriptId);
      fd.append("lineIndex", String(lines[i].index));
      fd.append("source", "upload");
      fd.append("durationMs", String(Math.round((end - start) * 1000)));
      fd.append("file", new Blob([encodeWav(clip, sr)], { type: "audio/wav" }), `full-voiceover-line-${lines[i].index + 1}.wav`);
      let res: SaveResult;
      try {
        res = await saveRecordingAction(projectId, fd);
      } catch {
        res = { ok: false, message: "connection lost" };
      }
      if (!res.ok) {
        setSaving({ done: i, error: `Line ${i + 1} didn't save (${res.message}). Lines 1–${i} are saved; tap Save again to retry the rest.` });
        return;
      }
      setSaving({ done: i + 1 });
    }
    router.refresh();
  }

  const ready = state.status === "ready" ? state : null;
  const segs = ready ? segments({ ...ready.split, cuts: ready.cuts }, ready.buffer.duration) : [];
  const guessed = ready ? ready.split.chosen.filter((c) => c === null).length : 0;
  const busy = state.status === "reading" || (saving !== null && saving.done < lines.length && !saving.error);

  return (
    <div className="space-y-3">
      <p className="text-sm text-muted">
        Recorded the whole episode in one go? Upload it here and the app cuts it into the {lines.length} lines. Read the lines in script order with a
        short pause (about half a second) between them.
      </p>
      <label className="btn btn-secondary inline-flex min-h-11 cursor-pointer items-center">
        {state.status === "reading" ? "Reading the recording…" : ready ? "Choose a different file" : "Upload full voice-over"}
        <input type="file" accept="audio/*,.m4a,.mp3,.wav,.webm,.ogg" className="sr-only" disabled={busy} onChange={(e) => onFile(e.target.files?.[0])} />
      </label>
      {state.status === "error" && (
        <p role="alert" className="text-xs" style={{ color: "var(--bad)" }}>
          {state.message}
        </p>
      )}

      {ready && (
        <div className="space-y-3">
          <p className="text-xs text-muted">
            {ready.name} · {ready.buffer.duration.toFixed(1)} s. Play each line and check it starts and ends in the right place; move a cut with the
            arrows (it jumps to the next pause).
          </p>
          {guessed > 0 && (
            <p role="status" className="rounded-control border border-border p-2 text-xs">
              Found fewer pauses than lines, so {guessed} {guessed === 1 ? "cut was" : "cuts were"} placed by line length (marked “guess”). Check those
              lines, or record again with clearer pauses.
            </p>
          )}
          <ol className="divide-y divide-border rounded-control border border-border">
            {lines.map((l, i) => (
              <li key={l.index} className="space-y-2 p-3">
                <div className="flex items-start gap-3">
                  <button
                    type="button"
                    onClick={() => (playing === i ? stop() : play(i, segs[i].start, segs[i].end))}
                    className="btn btn-quiet min-h-11 min-w-11 shrink-0"
                    aria-label={`${playing === i ? "Stop" : "Play"} line ${i + 1}`}
                  >
                    {playing === i ? "■" : "▶"}
                  </button>
                  <div className="min-w-0 text-sm">
                    <span className="font-semibold" style={{ color: l.speaker === "uco" ? "var(--uco)" : "var(--ocu)" }}>
                      {i + 1}. {l.speaker === "uco" ? "Uco" : "Ocu"}
                    </span>{" "}
                    <span className="text-xs text-muted tabular-nums">{(segs[i].end - segs[i].start).toFixed(1)} s</span>
                    <p className="text-sm">{l.text}</p>
                  </div>
                </div>
                {i < lines.length - 1 && (
                  <div className="flex items-center gap-2 text-xs text-muted">
                    <span>
                      Cut at {ready.cuts[i].toFixed(2)} s{ready.split.chosen[i] === null && ready.cuts[i] === ready.split.cuts[i] ? " (guess)" : ""}
                    </span>
                    <button type="button" onClick={() => move(i, -1)} className="btn btn-quiet min-h-11 min-w-11" aria-label={`Move the cut after line ${i + 1} earlier`}>
                      ◀
                    </button>
                    <button type="button" onClick={() => move(i, 1)} className="btn btn-quiet min-h-11 min-w-11" aria-label={`Move the cut after line ${i + 1} later`}>
                      ▶
                    </button>
                  </div>
                )}
              </li>
            ))}
          </ol>
          <div className="flex flex-wrap items-center gap-3">
            <button type="button" onClick={save} disabled={busy} className="btn btn-primary min-h-11">
              {saving && !saving.error && saving.done < lines.length ? `Saving… ${saving.done}/${lines.length}` : `Save ${lines.length} takes`}
            </button>
            <span className="text-xs text-muted">Each clip becomes that line&apos;s selected take; earlier takes stay in the take history.</span>
          </div>
          {saving?.error && (
            <p role="alert" className="text-xs" style={{ color: "var(--bad)" }}>
              {saving.error}
            </p>
          )}
          {saving && !saving.error && saving.done === lines.length && (
            <p role="status" className="text-xs" style={{ color: "var(--win)" }}>
              All {lines.length} lines saved.
            </p>
          )}
        </div>
      )}
    </div>
  );
}

function mixdown(buffer: AudioBuffer) {
  if (buffer.numberOfChannels === 1) return buffer.getChannelData(0);
  const out = new Float32Array(buffer.length);
  for (let c = 0; c < buffer.numberOfChannels; c++) {
    const d = buffer.getChannelData(c);
    for (let i = 0; i < d.length; i++) out[i] += d[i] / buffer.numberOfChannels;
  }
  return out;
}
