"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import type { StepResult } from "@/app/create/actions";
import { Status } from "@/components/episode-ui";

type Start = (size: number, type: string) => Promise<{ ok: true; url: string; path: string } | { ok: false; message: string }>;
type Finish = (path: string, durationMs: number | null) => Promise<StepResult>;

/** Upload a finished MP4 (from CapCut, Gemini, Drive…) as the episode's video, straight to private storage. */
export function VideoUpload({ start, finish }: { start: Start; finish: Finish }) {
  const router = useRouter();
  const [progress, setProgress] = useState<number | null>(null);
  const [state, setState] = useState<StepResult>(null);

  async function upload(file: File) {
    setState(null);
    const type = file.type || (file.name.toLowerCase().endsWith(".mp4") ? "video/mp4" : "");
    const s = await start(file.size, type);
    if (!s.ok) return setState({ ok: false, message: s.message });
    const durationMs = await duration(file);
    setProgress(0);
    const ok = await new Promise<boolean>((resolve) => {
      const xhr = new XMLHttpRequest();
      xhr.open("PUT", s.url);
      xhr.setRequestHeader("Content-Type", "video/mp4");
      xhr.upload.onprogress = (e) => e.lengthComputable && setProgress(Math.round((e.loaded / e.total) * 100));
      xhr.onload = () => resolve(xhr.status >= 200 && xhr.status < 300);
      xhr.onerror = () => resolve(false);
      xhr.send(file);
    });
    setProgress(null);
    if (!ok) return setState({ ok: false, message: "The upload was interrupted. Check your connection and try again." });
    const r = await finish(s.path, durationMs);
    setState(r);
    if (r?.ok) router.refresh();
  }

  return (
    <div className="space-y-2">
      <label className={`btn btn-secondary ${progress !== null ? "pointer-events-none opacity-60" : "cursor-pointer"}`}>
        {progress !== null ? `Uploading… ${progress}%` : "Upload a finished video (MP4)"}
        <input
          type="file"
          accept="video/mp4,.mp4"
          className="sr-only"
          disabled={progress !== null}
          onChange={(e) => {
            const f = e.target.files?.[0];
            e.target.value = "";
            if (f) void upload(f);
          }}
        />
      </label>
      {progress !== null && (
        <div className="h-2 w-full max-w-sm overflow-hidden rounded-full bg-surface-2" role="progressbar" aria-valuenow={progress} aria-valuemin={0} aria-valuemax={100}>
          <div className="h-full bg-[var(--accent,#F2A93B)]" style={{ width: `${progress}%` }} />
        </div>
      )}
      <p className="text-xs text-muted">For videos made outside the app (CapCut, Gemini). On a phone you can pick the file straight from Google Drive. Up to 49 MB.</p>
      <Status state={state} />
    </div>
  );
}

function duration(file: File) {
  return new Promise<number | null>((resolve) => {
    const v = document.createElement("video");
    v.preload = "metadata";
    v.onloadedmetadata = () => {
      resolve(Number.isFinite(v.duration) ? Math.round(v.duration * 1000) : null);
      URL.revokeObjectURL(v.src);
    };
    v.onerror = () => resolve(null);
    v.src = URL.createObjectURL(file);
  });
}
