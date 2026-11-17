"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { saveRecordingAction, type SaveResult } from "@/app/create/[id]/record/actions";
import type { BoothLine, RecordedTake } from "@/lib/recordings";

type Filter = "all" | "uco" | "ocu";
type Phase = "idle" | "starting" | "recording" | "review" | "saving";

const MAX_SECONDS = 60;
const NAME = { uco: "Uco", ocu: "Ocu" } as const;
const DIRECTION: Record<string, string> = {
  excited: "excited, energetic",
  angry: "annoyed, rising volume",
  furious: "furious (step back from the phone, don't shout into it)",
  smug: "smug, a small smile in the voice",
  calm: "calm, unhurried",
  worried: "worried, a little slower",
  deadpan: "flat, zero energy",
  thinking: "thinking out loud",
  laughing: "laughing through the line",
  shocked: "shocked, slow realisation",
  neutral: "natural",
};

function pickMime() {
  if (typeof MediaRecorder === "undefined") return "";
  for (const m of ["audio/webm;codecs=opus", "audio/mp4", "audio/webm", "audio/ogg;codecs=opus"]) {
    if (MediaRecorder.isTypeSupported(m)) return m;
  }
  return "";
}

function micError(err: unknown) {
  const name = (err as { name?: string })?.name;
  if (name === "NotAllowedError") return "Microphone access was blocked. Allow the microphone for this site in your browser settings, then try again.";
  if (name === "NotFoundError") return "No microphone found on this device.";
  if (name === "NotReadableError") return "The microphone is being used by another app. Close it and try again.";
  return "Couldn't start the microphone. Reload the page and try again.";
}

const fmt = (ms: number) => `${Math.floor(ms / 60000)}:${String(Math.floor((ms % 60000) / 1000)).padStart(2, "0")}`;

export function RecordingBooth({
  projectId,
  scriptId,
  lines,
  initialRecorded,
  initialFilter = "all",
}: {
  projectId: string;
  scriptId: string;
  lines: BoothLine[];
  initialRecorded: Record<number, RecordedTake>;
  initialFilter?: Filter;
}) {
  const [filter, setFilter] = useState<Filter>(initialFilter);
  const [recorded, setRecorded] = useState(initialRecorded);
  const visible = useMemo(() => lines.filter((l) => filter === "all" || l.speaker === filter), [lines, filter]);
  const firstOpen = useCallback(
    (list: BoothLine[], rec: Record<number, RecordedTake>) => (list.find((l) => !rec[l.index]) ?? list[0])?.index ?? 0,
    [],
  );
  const [current, setCurrent] = useState(() =>
    firstOpen(lines.filter((l) => initialFilter === "all" || l.speaker === initialFilter), initialRecorded),
  );
  const [phase, setPhase] = useState<Phase>("idle");
  const [error, setError] = useState<string | null>(null);
  const [elapsed, setElapsed] = useState(0);
  const [level, setLevel] = useState(0);
  const [take, setTake] = useState<{ blob: Blob; url: string; durationMs: number } | null>(null);

  const streamRef = useRef<MediaStream | null>(null);
  const recRef = useRef<MediaRecorder | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const startRef = useRef(0);
  const rafRef = useRef(0);
  const ctxRef = useRef<AudioContext | null>(null);

  // the chosen character lives in the URL (?as=uco), so a bookmark opens the booth ready for that voice
  const chooseFilter = (f: Filter) => {
    setFilter(f);
    window.history.replaceState(null, "", f === "all" ? window.location.pathname : `?as=${f}`);
    const list = lines.filter((l) => f === "all" || l.speaker === f);
    setCurrent(firstOpen(list, recorded));
    discard();
  };

  // release the microphone when leaving the page
  useEffect(
    () => () => {
      cancelAnimationFrame(rafRef.current);
      streamRef.current?.getTracks().forEach((t) => t.stop());
      ctxRef.current?.close().catch(() => {});
    },
    [],
  );

  const line = lines.find((l) => l.index === current) ?? lines[0];
  const done = visible.filter((l) => recorded[l.index]).length;
  const allDone = lines.every((l) => recorded[l.index]);

  async function start() {
    setError(null);
    setPhase("starting");
    try {
      if (!streamRef.current) {
        streamRef.current = await navigator.mediaDevices.getUserMedia({
          audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true },
        });
      }
      const stream = streamRef.current;
      // level meter
      const ctx = (ctxRef.current ??= new AudioContext());
      await ctx.resume();
      const analyser = ctx.createAnalyser();
      analyser.fftSize = 512;
      ctx.createMediaStreamSource(stream).connect(analyser);
      const buf = new Uint8Array(analyser.fftSize);
      const tick = () => {
        analyser.getByteTimeDomainData(buf);
        let sum = 0;
        for (const v of buf) sum += ((v - 128) / 128) ** 2;
        setLevel(Math.min(1, Math.sqrt(sum / buf.length) * 3));
        const ms = Date.now() - startRef.current;
        setElapsed(ms);
        if (ms >= MAX_SECONDS * 1000) stop();
        else rafRef.current = requestAnimationFrame(tick);
      };

      const mime = pickMime();
      const rec = new MediaRecorder(stream, mime ? { mimeType: mime } : undefined);
      chunksRef.current = [];
      rec.ondataavailable = (e) => e.data.size && chunksRef.current.push(e.data);
      rec.onstop = () => {
        cancelAnimationFrame(rafRef.current);
        setLevel(0);
        const blob = new Blob(chunksRef.current, { type: rec.mimeType || mime || "audio/webm" });
        const durationMs = Date.now() - startRef.current;
        if (blob.size === 0) {
          setError("Nothing was recorded. Try again.");
          setPhase("idle");
          return;
        }
        setTake({ blob, url: URL.createObjectURL(blob), durationMs });
        setPhase("review");
      };
      recRef.current = rec;
      startRef.current = Date.now();
      setElapsed(0);
      rec.start(250);
      setPhase("recording");
      rafRef.current = requestAnimationFrame(tick);
    } catch (err) {
      setError(micError(err));
      setPhase("idle");
    }
  }

  function stop() {
    if (recRef.current && recRef.current.state !== "inactive") recRef.current.stop();
  }

  function discard() {
    if (take) URL.revokeObjectURL(take.url);
    setTake(null);
    setPhase("idle");
  }

  async function save(blob: Blob, durationMs: number | null, source: "booth" | "upload", filename: string) {
    setPhase("saving");
    setError(null);
    const fd = new FormData();
    fd.append("scriptId", scriptId);
    fd.append("lineIndex", String(current));
    fd.append("source", source);
    if (durationMs) fd.append("durationMs", String(Math.round(durationMs)));
    fd.append("file", blob, filename);
    let res: SaveResult;
    try {
      res = await saveRecordingAction(projectId, fd);
    } catch {
      res = { ok: false, message: "Upload failed (connection). Your take is still here; tap Keep to try again." };
    }
    if (!res.ok) {
      setError(res.message);
      setPhase(source === "booth" ? "review" : "idle");
      return;
    }
    const next = { ...recorded, [res.lineIndex]: { take: res.take, url: res.url, durationMs: res.durationMs, source } };
    setRecorded(next);
    if (take) URL.revokeObjectURL(take.url);
    setTake(null);
    setPhase("idle");
    // move on to the next unrecorded line for this character
    const after = visible.find((l) => l.index > current && !next[l.index]) ?? visible.find((l) => !next[l.index]);
    if (after) setCurrent(after.index);
  }

  async function onUpload(file: File | undefined) {
    if (!file) return;
    const durationMs = await new Promise<number | null>((resolve) => {
      const a = new Audio();
      a.preload = "metadata";
      a.onloadedmetadata = () => resolve(Number.isFinite(a.duration) ? a.duration * 1000 : null);
      a.onerror = () => resolve(null);
      a.src = URL.createObjectURL(file);
    });
    await save(file, durationMs, "upload", file.name);
  }

  const ext = (take?.blob.type ?? "").includes("mp4") ? "m4a" : "webm";
  const busy = phase === "starting" || phase === "recording" || phase === "saving";
  const color = line?.speaker === "uco" ? "var(--uco)" : "var(--ocu)";
  const bg = line?.speaker === "uco" ? "var(--uco-bg)" : "var(--ocu-bg)";

  return (
    <div className="space-y-4">
      {/* who is recording */}
      <div role="group" aria-label="Record lines for" className="flex flex-wrap items-center gap-2">
        {(["all", "uco", "ocu"] as const).map((f) => (
          <button key={f} type="button" className="chip" aria-current={filter === f} disabled={busy} onClick={() => chooseFilter(f)}>
            {f === "all" ? "Both characters" : `${NAME[f]} only`}
          </button>
        ))}
        <span className="ml-auto text-sm font-semibold tabular-nums" aria-live="polite">
          {done} of {visible.length} recorded
        </span>
      </div>

      {allDone && (
        <div role="status" className="rounded-card border p-4 text-sm" style={{ borderColor: "var(--win)", background: "var(--win-bg)" }}>
          <p className="font-semibold" style={{ color: "var(--win)" }}>Every line is recorded.</p>
          <p className="mt-1">You can still re-record any line. Next step: the animation (coming soon).</p>
        </div>
      )}

      {/* teleprompter (IP content: uses the character's colors) */}
      {line && (
        <section aria-label="Current line" className="rounded-card border-2 p-5" style={{ borderColor: color, background: bg }}>
          <div className="mb-3 flex flex-wrap items-baseline gap-x-3 gap-y-1">
            <span className="text-lg font-bold" style={{ color }}>{NAME[line.speaker]}</span>
            <span className="text-sm">Line {line.index + 1} of {lines.length}</span>
            {recorded[line.index] && <span className="stamp" style={{ color: "var(--win)" }}>{recorded[line.index].source === "ai" ? "AI voice" : "Recorded"} · take {recorded[line.index].take}</span>}
          </div>
          <p className="text-2xl font-semibold leading-snug md:text-3xl">{line.text}</p>
          <p className="mt-2 text-sm italic">{line.subtitle}</p>
          <p className="mt-3 text-sm">
            <b>How to say it:</b> {line.thought_bubble ? "inner voice: soft and close to the phone, like thinking to yourself" : (DIRECTION[line.expression] ?? line.expression)}
          </p>
        </section>
      )}

      {/* controls */}
      <div className="rounded-card border border-border bg-surface p-4">
        {phase === "recording" || phase === "starting" ? (
          <div className="space-y-3">
            <div className="flex items-center gap-3">
              <span aria-hidden className="h-3 w-3 animate-pulse rounded-full" style={{ background: "var(--bad)" }} />
              <span className="font-semibold tabular-nums">{phase === "starting" ? "Starting microphone…" : `Recording ${fmt(elapsed)}`}</span>
            </div>
            <div className="h-2 overflow-hidden rounded-full bg-surface-2" aria-hidden>
              <div className="h-full rounded-full bg-accent transition-[width] duration-75" style={{ width: `${Math.round(level * 100)}%` }} />
            </div>
            <button type="button" className="btn btn-primary w-full" onClick={stop} disabled={phase === "starting"}>
              Stop
            </button>
          </div>
        ) : phase === "review" || (phase === "saving" && take) ? (
          <div className="space-y-3">
            <p className="text-sm font-semibold">Listen back</p>
            {take && <audio controls src={take.url} className="w-full" />}
            <div className="grid grid-cols-2 gap-2">
              <button type="button" className="btn btn-secondary" onClick={discard} disabled={phase === "saving"}>
                Retake
              </button>
              <button
                type="button"
                className="btn btn-primary"
                disabled={phase === "saving"}
                onClick={() => take && save(take.blob, take.durationMs, "booth", `take.${ext}`)}
              >
                {phase === "saving" ? "Saving…" : "Keep"}
              </button>
            </div>
          </div>
        ) : (
          <div className="space-y-3">
            <button type="button" className="btn btn-primary w-full" onClick={start} disabled={busy || !line}>
              {recorded[line?.index ?? -1] ? "Record again" : "Record this line"}
            </button>
            {recorded[line?.index ?? -1] && <audio controls src={recorded[line.index].url} className="w-full" />}
            <label className="btn btn-quiet w-full">
              Upload an audio file instead
              <input
                type="file"
                accept="audio/*"
                className="sr-only"
                disabled={busy}
                onChange={(e) => {
                  void onUpload(e.target.files?.[0]);
                  e.target.value = "";
                }}
              />
            </label>
          </div>
        )}
        {phase === "saving" && !take && <p className="mt-2 text-sm" role="status">Uploading…</p>}
        {error && <p role="alert" className="mt-2 text-sm" style={{ color: "var(--bad)" }}>{error}</p>}
      </div>

      {/* all lines */}
      <section aria-label="All lines" className="rounded-card border border-border bg-surface p-2">
        <ol>
          {visible.map((l) => {
            const r = recorded[l.index];
            const active = l.index === current;
            return (
              <li key={l.index}>
                <button
                  type="button"
                  disabled={busy}
                  onClick={() => {
                    discard();
                    setCurrent(l.index);
                    window.scrollTo({ top: 0, behavior: "smooth" });
                  }}
                  aria-current={active}
                  className={`flex min-h-12 w-full items-center gap-3 rounded-control px-3 py-2 text-left transition-colors hover:bg-surface-2 ${active ? "bg-surface-2" : ""}`}
                >
                  <span className="w-6 shrink-0 text-xs font-semibold tabular-nums text-muted">{l.index + 1}</span>
                  <span className="w-9 shrink-0 text-xs font-bold" style={{ color: l.speaker === "uco" ? "var(--uco)" : "var(--ocu)" }}>
                    {NAME[l.speaker]}
                  </span>
                  <span className="min-w-0 flex-1 truncate text-sm">{l.text}</span>
                  <span className="shrink-0 text-xs font-semibold" style={{ color: r ? "var(--win)" : "var(--muted)" }}>
                    {r ? "Recorded" : "To do"}
                  </span>
                </button>
              </li>
            );
          })}
        </ol>
      </section>
    </div>
  );
}
