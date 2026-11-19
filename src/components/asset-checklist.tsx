"use client";

import { useRouter } from "next/navigation";
import { useId, useState } from "react";
import { finishAssetUploadAction, startAssetUploadAction } from "@/app/create/studio-actions";
import type { AssetCheck } from "../../video/src/beats";

// Pre-render asset checklist: the illustrated props and sound effects this episode's lines call for, checked against
// what's in public/props and public/sfx (the asset manifest built at deploy) plus files attached here. Missing ones
// still render (the video falls back to a coded prop, or plays no sound); "Attach file" uploads the missing file to
// private storage, and every later render (and this checklist) picks it up.

export function AssetChecklist({ props, sfx, projectId }: { props: AssetCheck[]; sfx: AssetCheck[]; projectId?: string }) {
  const missing = [...props, ...sfx].filter((a) => !a.ready);
  return (
    <div className="rounded-control border border-border p-3">
      <div className="mb-2 flex items-center justify-between gap-2">
        <span className="text-sm font-semibold">Assets for this render</span>
        <span className="text-xs" style={{ color: missing.length ? "var(--bad)" : "var(--good)" }}>
          {missing.length ? `${missing.length} missing` : "All ready"}
        </span>
      </div>
      <div className="grid gap-3 sm:grid-cols-2">
        <Group title="Props" kind="props" items={props} empty="No illustrated props needed." projectId={projectId} />
        <Group title="Sound effects" kind="sfx" items={sfx} empty="No sound effects cued." projectId={projectId} />
      </div>
      {missing.length > 0 && (
        <p className="mt-2 text-xs text-muted">
          {projectId ? "Attach the missing files here (props: transparent PNG; sound: MP3 or WAV; up to 8 MB), or add them to the repo at " : "Add the missing files to the repo at "}
          <code>public/</code> with these exact names. Until then the video uses a coded prop or skips the sound.
        </p>
      )}
    </div>
  );
}

function Group({ title, kind, items, empty, projectId }: { title: string; kind: "props" | "sfx"; items: AssetCheck[]; empty: string; projectId?: string }) {
  return (
    <div>
      <p className="mb-1 text-xs font-semibold uppercase tracking-wide text-muted">{title}</p>
      {items.length === 0 ? (
        <p className="text-xs text-muted">{empty}</p>
      ) : (
        <ul className="space-y-2">
          {items.map((a) => (
            <li key={a.file} className="text-xs">
              <div className="flex items-baseline gap-2">
                <span aria-hidden style={{ color: a.ready ? "var(--good)" : "var(--bad)" }}>
                  {a.ready ? "✓" : "✗"}
                </span>
                <code className="break-all">{a.file}</code>
                <span className="sr-only">{a.ready ? "ready" : "missing"}</span>
                {a.lines.length > 0 && <span className="text-muted">{`${a.lines.length > 1 ? "lines" : "line"} ${a.lines.join(", ")}`}</span>}
              </div>
              {!a.ready && projectId && <Attach projectId={projectId} kind={kind} name={a.name} />}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

/** File picker → one-time upload URL → PUT straight to storage → server checks the file → checklist refreshes. */
function Attach({ projectId, kind, name }: { projectId: string; kind: "props" | "sfx"; name: string }) {
  const id = useId();
  const router = useRouter();
  const [state, setState] = useState<{ busy: boolean; msg: string | null; ok: boolean }>({ busy: false, msg: null, ok: false });
  const accept = kind === "props" ? "image/png" : "audio/mpeg,audio/wav,audio/x-wav,.mp3,.wav";

  async function upload(file: File) {
    setState({ busy: true, msg: "Uploading…", ok: false });
    const type = file.type || (/\.wav$/i.test(file.name) ? "audio/wav" : /\.mp3$/i.test(file.name) ? "audio/mpeg" : "");
    const s = await startAssetUploadAction(projectId, kind, name, type, file.size);
    if (!s.ok) return setState({ busy: false, msg: s.message, ok: false });
    const put = await fetch(s.url, { method: "PUT", headers: { "Content-Type": type }, body: file }).catch(() => null);
    if (!put?.ok) return setState({ busy: false, msg: "The upload failed. Check your connection and try again.", ok: false });
    const done = await finishAssetUploadAction(projectId, s.path);
    setState({ busy: false, msg: done?.message ?? null, ok: Boolean(done?.ok) });
    if (done?.ok) router.refresh();
  }

  return (
    <div className="mt-1 pl-5">
      <label htmlFor={id} className="btn btn-secondary !min-h-0 cursor-pointer px-2 py-1 text-xs" aria-disabled={state.busy}>
        {state.busy ? "Uploading…" : "Attach file"}
      </label>
      <input
        id={id}
        type="file"
        accept={accept}
        className="sr-only"
        disabled={state.busy}
        onChange={(e) => {
          const f = e.target.files?.[0];
          e.target.value = "";
          if (f) void upload(f);
        }}
      />
      {state.msg && !state.busy && (
        <p className="mt-1" role="status" style={{ color: state.ok ? "var(--good)" : "var(--bad)" }}>
          {state.msg}
        </p>
      )}
    </div>
  );
}
