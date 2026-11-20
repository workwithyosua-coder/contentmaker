"use client";

import { useRouter } from "next/navigation";
import { useEffect, useId, useRef, useState, useTransition } from "react";
import { finishAssetUploadAction, skipAssetAction, startAssetUploadAction } from "@/app/create/studio-actions";
import { MAX_PICK_BYTES, SLOT_ACCEPT, audioUploadType, slotFileName, type AssetKind } from "@/lib/assetSlots";
import { processPropFile } from "@/lib/clientPropProcessor";
import type { AssetCheck } from "../../video/src/beats";

// Asset readiness: every prop and sound effect the beats ask for, checked against the repo's assetManifest.json
// (public/props, public/sfx) and the custom uploads (public Supabase bucket custom-assets). Each missing slot takes any
// image or audio file straight from a phone: the file is named after the slot (never its own file name), images are
// shrunk, converted to PNG and cut out of a solid white background in the browser (clientPropProcessor.ts, no AI),
// then uploaded to Supabase Storage (never public/: Vercel's filesystem is read-only). Skip renders without it.
// A missing file never blocks saving or rendering.

const slotKey = (kind: AssetKind, name: string) => `${kind}/${name}`;

export function AssetChecklist({
  props,
  sfx,
  projectId,
  urls,
  onUploaded,
  onSkip,
  disabled = false,
}: {
  props: AssetCheck[];
  sfx: AssetCheck[];
  /** episode page: Skip is saved on the episode */
  projectId?: string;
  /** known public URLs of uploads (name → URL), for previews */
  urls?: { props?: Record<string, string>; sfx?: Record<string, string> };
  /** composer: an upload finished (the composer saves its URL on the beats) */
  onUploaded?: (kind: AssetKind, name: string, url: string) => void;
  /** composer: Skip changes the unsaved beats instead of the server */
  onSkip?: (kind: AssetKind, name: string) => void;
  disabled?: boolean;
}) {
  // slots filled in this visit stay in the list (with their preview, Replace and the background toggle)
  const [touched, setTouched] = useState<Set<string>>(() => new Set());
  const all = [...props.map((a) => ({ ...a, kind: "props" as const })), ...sfx.map((a) => ({ ...a, kind: "sfx" as const }))];
  const missing = all.filter((a) => !a.ready);
  const ready = all.filter((a) => a.ready);
  const slots = all.filter((a) => !a.ready || touched.has(slotKey(a.kind, a.name)));
  const others = ready.filter((a) => !touched.has(slotKey(a.kind, a.name)));
  const preview = (a: { kind: AssetKind; name: string; file: string }) =>
    a.kind === "props" ? (urls?.props?.[a.name] ?? (a.file.startsWith("props/") ? `/${a.file}` : /^(https?:|\/)/.test(a.file) ? a.file : null)) : null;

  return (
    <section aria-label="Asset readiness" className="min-w-0 rounded-control border border-border p-3">
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs">
        <span className="text-sm font-semibold">Asset readiness</span>
        <span style={{ color: "var(--good)" }}>
          <span aria-hidden>✓ </span>
          {ready.length} ready
        </span>
        <span style={{ color: missing.length ? "var(--bad)" : "var(--muted)" }}>
          <span aria-hidden>✗ </span>
          {missing.length} missing
        </span>
        {!all.length && <span className="text-muted">No props or sound effects needed.</span>}
      </div>
      {slots.length > 0 && (
        <ul className="mt-3 space-y-3">
          {slots.map((a) => (
            <li key={slotKey(a.kind, a.name)} className="min-w-0 space-y-2 text-xs">
              <div className="flex flex-wrap items-baseline gap-x-2">
                <code className="break-all" style={{ color: a.ready ? "var(--good)" : "var(--bad)" }}>
                  {a.kind}/{a.kind === "props" ? `${a.name}.png` : a.file.startsWith("sfx/") ? a.file.slice(4) : `${a.name}`}
                </code>
                {a.lines.length > 0 && <span className="text-muted">{`${a.lines.length > 1 ? "lines" : "line"} ${a.lines.join(", ")}`}</span>}
              </div>
              <Slot
                kind={a.kind}
                name={a.name}
                ready={a.ready}
                projectId={projectId}
                disabled={disabled}
                onSkip={onSkip}
                onUploaded={(kind, name, url) => {
                  setTouched((t) => new Set(t).add(slotKey(kind, name)));
                  onUploaded?.(kind, name, url);
                }}
              />
            </li>
          ))}
        </ul>
      )}
      {others.length > 0 && (
        <details className="mt-3 text-xs">
          <summary className="cursor-pointer text-muted">Ready ({others.length})</summary>
          <ul className="mt-2 grid gap-2 sm:grid-cols-2">
            {others.map((a) => {
              const src = preview(a);
              return (
                <li key={slotKey(a.kind, a.name)} className="flex min-w-0 items-center gap-2">
                  {src ? <Swatch src={src} alt={`${a.name} prop`} size={36} /> : <span aria-hidden style={{ color: "var(--good)" }}>✓</span>}
                  <code className="break-all">{a.kind === "props" ? `props/${a.name}.png` : a.file.startsWith("sfx/") ? a.file : `sfx/${a.name}`}</code>
                  {a.lines.length > 0 && <span className="text-muted">{`${a.lines.length > 1 ? "lines" : "line"} ${a.lines.join(", ")}`}</span>}
                </li>
              );
            })}
          </ul>
        </details>
      )}
      {(missing.length > 0 || touched.size > 0) && (
        <p className="mt-3 text-xs text-muted">Pick any image from your phone. We rename it, convert to PNG, and remove solid white backgrounds automatically.</p>
      )}
    </section>
  );
}

/** A prop preview on a dark checkerboard, so the transparent cut-out is visible. */
function Swatch({ src, alt, size }: { src: string; alt: string; size: number }) {
  return (
    <span
      className="inline-flex shrink-0 items-center justify-center overflow-hidden rounded border border-border"
      style={{ width: size, height: size, background: "repeating-conic-gradient(#1f2937 0% 25%, #374151 0% 50%) 50% / 12px 12px" }}
    >
      {/* eslint-disable-next-line @next/next/no-img-element -- local blob / public Supabase URL, fixed size */}
      <img src={src} alt={alt} width={size} height={size} style={{ width: size, height: size, objectFit: "contain" }} />
    </span>
  );
}

type Phase = "idle" | "processing" | "uploading" | "ready" | "error";

/** One slot: pick a file → (image: shrink, PNG, cut out white) → upload under the slot's name → preview / Replace. */
function Slot({
  kind,
  name,
  ready,
  projectId,
  onUploaded,
  onSkip,
  disabled,
}: {
  kind: AssetKind;
  name: string;
  ready: boolean;
  projectId?: string;
  onUploaded: (kind: AssetKind, name: string, url: string) => void;
  onSkip?: (kind: AssetKind, name: string) => void;
  disabled: boolean;
}) {
  const id = useId();
  const router = useRouter();
  const input = useRef<HTMLInputElement>(null);
  const [phase, setPhase] = useState<Phase>("idle");
  const [file, setFile] = useState<File | null>(null);
  const [removeWhite, setRemoveWhite] = useState(true);
  const [preview, setPreview] = useState<string | null>(null);
  const [info, setInfo] = useState<{ stored: string; transparent: boolean; removed: boolean } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [skipNote, setSkipNote] = useState<string | null>(null);
  const [skipping, startSkip] = useTransition();
  const busy = phase === "processing" || phase === "uploading" || skipping;
  const off = disabled || busy;

  useEffect(() => () => void (preview && URL.revokeObjectURL(preview)), [preview]);

  async function run(f: File, white: boolean) {
    setError(null);
    setSkipNote(null);
    try {
      if (f.size > MAX_PICK_BYTES) throw new Error("That file is over 10 MB. Pick a smaller one.");
      let body: Blob = f;
      let type: string;
      let stored: string;
      let transparent = false;
      let removed = false;
      if (kind === "props") {
        setPhase("processing");
        const r = await processPropFile(f, { removeWhite: white });
        body = r.blob;
        type = "image/png";
        stored = slotFileName("props", name, { type, name: "" })!;
        transparent = r.hadTransparency;
        removed = r.removedBackground;
        setPreview((old) => {
          if (old) URL.revokeObjectURL(old);
          return URL.createObjectURL(r.blob);
        });
      } else {
        const audio = audioUploadType(f);
        if (!audio) throw new Error("That isn't a sound file we can use. Pick an MP3, WAV, M4A or OGG.");
        type = audio.type;
        stored = slotFileName("sfx", name, f)!;
      }
      setPhase("uploading");
      const s = await startAssetUploadAction(kind, name, type, body.size);
      if (!s.ok) throw new Error(s.message);
      const put = await fetch(s.url, { method: "PUT", headers: { "Content-Type": type, "x-upsert": "true" }, body }).catch(() => null);
      if (!put?.ok) throw new Error("The upload didn't go through. Check your connection and try again.");
      const done = await finishAssetUploadAction(s.path);
      if (!done.ok) throw new Error(done.message);
      setInfo({ stored, transparent, removed });
      setPhase("ready");
      onUploaded(kind, name, done.url);
      router.refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      setPhase("error");
    }
  }

  const pick = () => input.current?.click();
  const label = kind === "props" ? "Upload image" : "Upload audio";
  const status = phase === "processing" ? "Processing image…" : phase === "uploading" ? "Uploading…" : null;
  const done = phase === "ready" || (ready && phase === "idle" && info);

  return (
    <div className="min-w-0 space-y-2">
      <input
        ref={input}
        id={id}
        type="file"
        accept={SLOT_ACCEPT[kind]}
        className="sr-only"
        tabIndex={-1}
        aria-hidden
        onChange={(e) => {
          const f = e.target.files?.[0];
          e.target.value = "";
          if (!f) return;
          setFile(f);
          setRemoveWhite(true);
          void run(f, true);
        }}
      />
      {done && info ? (
        <div className="flex flex-wrap items-center gap-3">
          {kind === "props" && preview && <Swatch src={preview} alt={`${name} prop preview, transparent cut-out`} size={48} />}
          <span className="min-w-0 text-xs" style={{ color: "var(--good)" }}>
            Saved as <code>{kind}/{info.stored}</code>
            {kind === "props" && <span className="text-muted">{info.transparent ? " · already transparent" : info.removed ? " · white background removed" : " · kept as is"}</span>}
          </span>
          <button type="button" className="btn btn-secondary cursor-pointer text-xs" disabled={off} onClick={pick}>
            Replace
          </button>
          {kind === "props" && file && (
            <label className={`flex min-h-[44px] items-center gap-2 text-xs ${info.transparent ? "text-muted" : "cursor-pointer"}`}>
              <input
                type="checkbox"
                className="h-5 w-5"
                checked={removeWhite && !info.transparent}
                disabled={off || info.transparent}
                onChange={(e) => {
                  setRemoveWhite(e.target.checked);
                  void run(file, e.target.checked);
                }}
              />
              Remove white background
              {info.transparent && <span className="sr-only">(not needed: the image is already transparent)</span>}
            </label>
          )}
        </div>
      ) : (
        <div className="flex flex-wrap items-center gap-2">
          <button type="button" className="btn btn-secondary cursor-pointer text-xs" disabled={off} onClick={pick} aria-describedby={status ? `${id}-status` : undefined}>
            {busy && phase !== "idle" ? (phase === "processing" ? "Processing…" : "Uploading…") : label}
          </button>
          {!ready && (
            <button
              type="button"
              className="btn btn-secondary cursor-pointer text-xs"
              disabled={off}
              onClick={() => {
                if (onSkip) {
                  onSkip(kind, name);
                  return setSkipNote(`Skipped: the video renders without ${name}.`);
                }
                if (!projectId) return;
                startSkip(async () => {
                  const r = await skipAssetAction(projectId, kind, name);
                  setSkipNote(r?.message ?? null);
                  if (r?.ok) router.refresh();
                });
              }}
            >
              {skipping ? "Skipping…" : "Skip"}
            </button>
          )}
        </div>
      )}
      <p id={`${id}-status`} role="status" aria-live="polite" className="text-xs text-muted">
        {status}
        {skipNote}
      </p>
      {phase === "error" && error && (
        <div role="alert" className="flex flex-wrap items-center gap-2 rounded-control border p-2 text-xs" style={{ borderColor: "var(--bad)", background: "var(--bad-bg)" }}>
          <span style={{ color: "var(--bad)" }}>{error}</span>
          {file && (
            <button type="button" className="btn btn-secondary cursor-pointer text-xs" disabled={off} onClick={() => void run(file, removeWhite)}>
              Try again
            </button>
          )}
          <button type="button" className="btn btn-secondary cursor-pointer text-xs" disabled={off} onClick={pick}>
            Pick another file
          </button>
        </div>
      )}
    </div>
  );
}
