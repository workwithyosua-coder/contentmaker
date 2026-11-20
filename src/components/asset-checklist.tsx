"use client";

import { useRouter } from "next/navigation";
import { useId, useState, useTransition } from "react";
import { finishAssetUploadAction, skipAssetAction, startAssetUploadAction } from "@/app/create/studio-actions";
import type { AssetCheck } from "../../video/src/beats";

// Asset readiness: every prop and sound effect the beats ask for, checked against the repo's assetManifest.json
// (public/props, public/sfx) and the custom uploads (public Supabase bucket custom-assets). Missing ones get Upload
// (straight to Supabase Storage, never public/: Vercel's filesystem is read-only) and Skip (render without it).
// A missing file never blocks saving or rendering: the video falls back to no prop / a coded prop, or no sound.

type Kind = "props" | "sfx";

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
  onUploaded?: (kind: Kind, name: string, url: string) => void;
  /** composer: Skip changes the unsaved beats instead of the server */
  onSkip?: (kind: Kind, name: string) => void;
  disabled?: boolean;
}) {
  const all = [...props.map((a) => ({ ...a, kind: "props" as const })), ...sfx.map((a) => ({ ...a, kind: "sfx" as const }))];
  const missing = all.filter((a) => !a.ready);
  const ready = all.filter((a) => a.ready);
  const preview = (a: { kind: Kind; name: string; file: string }) => (a.kind === "props" ? (urls?.props?.[a.name] ?? (a.file.startsWith("props/") ? `/${a.file}` : null)) : null);
  return (
    <section aria-label="Asset readiness" className="rounded-control border border-border p-3">
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
      {missing.length > 0 && (
        <ul className="mt-2 space-y-2">
          {missing.map((a) => (
            <li key={a.file} className="space-y-1 text-xs">
              <div className="flex flex-wrap items-baseline gap-x-2">
                <code className="break-all" style={{ color: "var(--bad)" }}>
                  {a.file}
                </code>
                {a.lines.length > 0 && <span className="text-muted">{`${a.lines.length > 1 ? "lines" : "line"} ${a.lines.join(", ")}`}</span>}
              </div>
              <Fix kind={a.kind} name={a.name} projectId={projectId} onUploaded={onUploaded} onSkip={onSkip} disabled={disabled} />
            </li>
          ))}
        </ul>
      )}
      {ready.length > 0 && (
        <details className="mt-2 text-xs">
          <summary className="cursor-pointer text-muted">Ready ({ready.length})</summary>
          <ul className="mt-2 grid gap-2 sm:grid-cols-2">
            {ready.map((a) => {
              const src = preview(a);
              return (
                <li key={a.file} className="flex items-center gap-2">
                  {src ? (
                    // eslint-disable-next-line @next/next/no-img-element -- remote Supabase URLs and repo files, shown at a fixed size
                    <img src={src} alt="" width={36} height={36} loading="lazy" className="shrink-0 rounded border border-border bg-surface-2" style={{ objectFit: "contain", aspectRatio: "1 / 1" }} />
                  ) : (
                    <span aria-hidden style={{ color: "var(--good)" }}>
                      ✓
                    </span>
                  )}
                  <code className="break-all">{a.file}</code>
                  {a.lines.length > 0 && <span className="text-muted">{`${a.lines.length > 1 ? "lines" : "line"} ${a.lines.join(", ")}`}</span>}
                </li>
              );
            })}
          </ul>
        </details>
      )}
      {missing.length > 0 && <p className="mt-2 text-xs text-muted">Props: transparent PNG or WebP. Sound: MP3 or WAV. Up to 8 MB. Missing files never block saving or rendering.</p>}
    </section>
  );
}

/** Upload: file picker → one-time URL → PUT straight to Supabase Storage → server checks the bytes. Skip: render without. */
function Fix({
  kind,
  name,
  projectId,
  onUploaded,
  onSkip,
  disabled,
}: {
  kind: Kind;
  name: string;
  projectId?: string;
  onUploaded?: (kind: Kind, name: string, url: string) => void;
  onSkip?: (kind: Kind, name: string) => void;
  disabled: boolean;
}) {
  const id = useId();
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [skipping, startSkip] = useTransition();
  const accept = kind === "props" ? "image/png,image/webp,.png,.webp" : "audio/mpeg,audio/wav,audio/x-wav,.mp3,.wav";
  const off = disabled || busy || skipping;

  async function upload(file: File) {
    setBusy(true);
    setMsg(null);
    try {
      const type =
        file.type ||
        (/\.wav$/i.test(file.name) ? "audio/wav" : /\.mp3$/i.test(file.name) ? "audio/mpeg" : /\.webp$/i.test(file.name) ? "image/webp" : /\.png$/i.test(file.name) ? "image/png" : "");
      const s = await startAssetUploadAction(kind, name, type, file.size);
      if (!s.ok) return setMsg({ ok: false, text: s.message });
      const put = await fetch(s.url, { method: "PUT", headers: { "Content-Type": type, "x-upsert": "true" }, body: file }).catch(() => null);
      if (!put?.ok) return setMsg({ ok: false, text: "The upload failed. Check your connection and try again." });
      const done = await finishAssetUploadAction(s.path);
      setMsg({ ok: done.ok, text: done.message });
      if (done.ok) {
        onUploaded?.(kind, name, done.url);
        router.refresh();
      }
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="flex flex-wrap items-center gap-2">
      <label htmlFor={id} className={`btn btn-secondary text-xs ${off ? "pointer-events-none opacity-55" : "cursor-pointer"}`} aria-disabled={off}>
        {busy ? "Uploading…" : `Upload ${kind === "props" ? "PNG / WebP" : "MP3 / WAV"}`}
      </label>
      <input
        id={id}
        type="file"
        accept={accept}
        className="sr-only"
        disabled={off}
        aria-label={`Upload ${name}`}
        onChange={(e) => {
          const f = e.target.files?.[0];
          e.target.value = "";
          if (f) void upload(f);
        }}
      />
      <button
        type="button"
        className="btn btn-secondary text-xs"
        disabled={off}
        onClick={() => {
          if (onSkip) {
            onSkip(kind, name);
            return setMsg({ ok: true, text: `Skipped: the video renders without ${name}.` });
          }
          if (!projectId) return;
          startSkip(async () => {
            const r = await skipAssetAction(projectId, kind, name);
            setMsg(r ? { ok: r.ok, text: r.message } : null);
            if (r?.ok) router.refresh();
          });
        }}
      >
        {skipping ? "Skipping…" : "Skip"}
      </button>
      {msg && (
        <span role="status" className="text-xs" style={{ color: msg.ok ? "var(--good)" : "var(--bad)" }}>
          {msg.text}
        </span>
      )}
    </div>
  );
}
