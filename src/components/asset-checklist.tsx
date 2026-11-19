"use client";

import { useRouter } from "next/navigation";
import { useId, useState, useTransition } from "react";
import { finishAssetUploadAction, skipAssetAction, startAssetUploadAction } from "@/app/create/studio-actions";
import type { AssetCheck } from "../../video/src/beats";

// Asset readiness, shown above the Render button: every prop and sound effect the beats ask for, checked against
// the repo's assetManifest.json (public/props, public/sfx) and the custom uploads in Supabase Storage. Missing ones
// get Upload (stored in Supabase Storage, never in public/: Vercel's filesystem is read-only) and Skip (render
// without it). A missing file never blocks a render: the video falls back to no prop / a coded prop, or no sound.

export function AssetChecklist({ props, sfx, projectId }: { props: AssetCheck[]; sfx: AssetCheck[]; projectId?: string }) {
  const all = [...props.map((a) => ({ ...a, kind: "props" as const })), ...sfx.map((a) => ({ ...a, kind: "sfx" as const }))];
  const missing = all.filter((a) => !a.ready);
  const ready = all.filter((a) => a.ready);
  return (
    <section aria-label="Asset readiness" className="rounded-control border border-border p-3">
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs">
        <span className="text-sm font-semibold">Asset readiness</span>
        <span style={{ color: "var(--good)" }}>
          <span aria-hidden>✓ </span>
          {ready.length} ready
        </span>
        <span style={{ color: missing.length ? "var(--bad)" : "var(--muted, inherit)" }}>
          <span aria-hidden>✗ </span>
          {missing.length} missing
        </span>
        {!all.length && <span className="text-muted">No props or sound effects needed.</span>}
      </div>
      {missing.length > 0 && (
        <ul className="mt-2 space-y-2">
          {missing.map((a) => (
            <li key={a.file} className="flex flex-wrap items-center gap-2 text-xs">
              <code className="break-all" style={{ color: "var(--bad)" }}>
                {a.file}
              </code>
              {a.lines.length > 0 && <span className="text-muted">{`${a.lines.length > 1 ? "lines" : "line"} ${a.lines.join(", ")}`}</span>}
              {projectId ? <Fix projectId={projectId} kind={a.kind} name={a.name} /> : <span className="text-muted">upload after creating the episode</span>}
            </li>
          ))}
        </ul>
      )}
      {ready.length > 0 && (
        <details className="mt-2 text-xs">
          <summary className="cursor-pointer text-muted">Ready ({ready.length})</summary>
          <ul className="mt-1 flex flex-wrap gap-x-3 gap-y-1">
            {ready.map((a) => (
              <li key={a.file}>
                <span aria-hidden style={{ color: "var(--good)" }}>
                  ✓{" "}
                </span>
                <code>{a.file}</code>
                {a.lines.length > 0 && <span className="text-muted">{` · ${a.lines.length > 1 ? "lines" : "line"} ${a.lines.join(", ")}`}</span>}
              </li>
            ))}
          </ul>
        </details>
      )}
      {missing.length > 0 && projectId && (
        <p className="mt-2 text-xs text-muted">Props: transparent PNG or WebP. Sound: MP3 or WAV. Up to 8 MB. Missing files never block a render.</p>
      )}
    </section>
  );
}

/** Upload: file picker → one-time URL → PUT straight to Supabase Storage → server checks the bytes. Skip: render without. */
function Fix({ projectId, kind, name }: { projectId: string; kind: "props" | "sfx"; name: string }) {
  const id = useId();
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [skipping, startSkip] = useTransition();
  const accept = kind === "props" ? "image/png,image/webp,.png,.webp" : "audio/mpeg,audio/wav,audio/x-wav,.mp3,.wav";

  async function upload(file: File) {
    setBusy(true);
    setMsg(null);
    const type =
      file.type ||
      (/\.wav$/i.test(file.name) ? "audio/wav" : /\.mp3$/i.test(file.name) ? "audio/mpeg" : /\.webp$/i.test(file.name) ? "image/webp" : /\.png$/i.test(file.name) ? "image/png" : "");
    const s = await startAssetUploadAction(projectId, kind, name, type, file.size);
    if (!s.ok) {
      setBusy(false);
      return setMsg({ ok: false, text: s.message });
    }
    const put = await fetch(s.url, { method: "PUT", headers: { "Content-Type": type }, body: file }).catch(() => null);
    if (!put?.ok) {
      setBusy(false);
      return setMsg({ ok: false, text: "The upload failed. Check your connection and try again." });
    }
    const done = await finishAssetUploadAction(projectId, s.path);
    setBusy(false);
    setMsg(done ? { ok: done.ok, text: done.message } : null);
    if (done?.ok) router.refresh();
  }

  return (
    <span className="flex flex-wrap items-center gap-2">
      <label htmlFor={id} className="btn btn-secondary !min-h-0 cursor-pointer px-2 py-1 text-xs" aria-disabled={busy}>
        {busy ? "Uploading…" : "Upload"}
      </label>
      <input
        id={id}
        type="file"
        accept={accept}
        className="sr-only"
        disabled={busy}
        aria-label={`Upload ${name}`}
        onChange={(e) => {
          const f = e.target.files?.[0];
          e.target.value = "";
          if (f) void upload(f);
        }}
      />
      <button
        type="button"
        className="btn btn-secondary !min-h-0 px-2 py-1 text-xs"
        disabled={busy || skipping}
        onClick={() =>
          startSkip(async () => {
            const r = await skipAssetAction(projectId, kind, name);
            setMsg(r ? { ok: r.ok, text: r.message } : null);
            if (r?.ok) router.refresh();
          })
        }
      >
        {skipping ? "Skipping…" : "Skip"}
      </button>
      {msg && (
        <span role="status" style={{ color: msg.ok ? "var(--good)" : "var(--bad)" }}>
          {msg.text}
        </span>
      )}
    </span>
  );
}
