"use client";

import { useRouter } from "next/navigation";
import { useEffect, useId, useRef, useState } from "react";
import { finishStudioUploadAction, removeStudioAssetAction, startStudioUploadAction } from "@/app/studio-asset-actions";
import { audioUploadType } from "@/lib/assetSlots";
import { processPropFile } from "@/lib/clientPropProcessor";
import { MODEL_TYPE, ORIGINAL_TYPES, RVC_GROUP, RVC_HELP, STUDIO_SLOTS, acceptFor, maxBytesFor, modelFileOk, originalType, studioSlot, type StudioAssetStatus, type StudioSlot } from "@/lib/studioAssets";

// Studio Assets uploader (Accounts → Studio Assets, and the "Global studio asset" rows in Asset readiness). Any phone
// image goes through the same in-browser cut-out as props (clientPropProcessor.ts: ≤ 1024 px, white background removed
// by an edge flood fill that leaves white teeth and eyes alone, PNG) and is saved under the slot's fixed key, never
// the phone's file name. Audio is stored as picked. No AI anywhere.

type Phase = "idle" | "processing" | "uploading" | "removing" | "error";

const empty = (key: string): StudioAssetStatus => ({ key, url: null, updatedAt: null, originalUrl: null, removeWhite: true });

/** The Accounts card: the four angry sprites (Uco, Ocu) and the urgent background track. */
export function StudioAssetsPanel({ initial }: { initial: StudioAssetStatus[] }) {
  const groups = [...new Set(STUDIO_SLOTS.map((s) => s.group))];
  return (
    <div className="min-w-0 space-y-4">
      <p className="text-sm text-muted">Upload character sprites and default audio once from your phone. Reused across all episodes.</p>
      {groups.map((g) => (
        <section key={g} aria-label={g} className="min-w-0 space-y-2">
          <h3 className="text-sm font-semibold">{g}</h3>
          {g === RVC_GROUP && <p className="text-xs text-muted">{RVC_HELP}</p>}
          <ul className="space-y-3">
            {STUDIO_SLOTS.filter((s) => s.group === g).map((slot) => (
              <li key={slot.key} className="min-w-0 rounded-control border border-border p-3">
                <StudioSlotControl slot={slot} initial={initial.find((x) => x.key === slot.key) ?? empty(slot.key)} />
              </li>
            ))}
          </ul>
        </section>
      ))}
    </div>
  );
}

/** Missing global slots inside Asset readiness (episodes with an angry line), with the same one-tap upload. */
export function GlobalStudioRows({ status }: { status: StudioAssetStatus[] }) {
  // a slot uploaded here stays listed (ready) until the page is left
  const [shown] = useState(() => status.filter((s) => !s.url && studioSlot(s.key)?.kind !== "model").map((s) => s.key));
  if (!shown.length) return null;
  return (
    <ul className="mt-3 space-y-3" aria-label="Global studio assets">
      {shown.map((key) => {
        const slot = studioSlot(key)!;
        return (
          <li key={key} className="min-w-0 space-y-2 text-xs">
            <div className="flex flex-wrap items-baseline gap-x-2">
              <code className="break-all">{slot.path}</code>
              <span className="stamp text-muted">Global studio asset</span>
              <span className="text-muted">{slot.kind === "sprite" ? `${slot.group}, ${slot.label.toLowerCase()}` : "Urgent BGM"}</span>
            </div>
            <StudioSlotControl slot={slot} initial={status.find((x) => x.key === key) ?? empty(key)} compact />
          </li>
        );
      })}
    </ul>
  );
}

/** One slot: Missing → (pick) → Processing image… → Uploading… → Ready (preview, background switch, Replace, Remove). */
export function StudioSlotControl({ slot, initial, compact = false }: { slot: StudioSlot; initial: StudioAssetStatus; compact?: boolean }) {
  const id = useId();
  const router = useRouter();
  const input = useRef<HTMLInputElement>(null);
  const [status, setStatus] = useState(initial);
  const [phase, setPhase] = useState<Phase>("idle");
  const [error, setError] = useState<string | null>(null);
  const [note, setNote] = useState<string | null>(null);
  // the photo picked this visit (re-processed when the background switch changes)
  const [picked, setPicked] = useState<File | null>(null);
  const [localPreview, setLocalPreview] = useState<string | null>(null);
  const busy = phase === "processing" || phase === "uploading" || phase === "removing";
  const sprite = slot.kind === "sprite";

  useEffect(() => () => void (localPreview && URL.revokeObjectURL(localPreview)), [localPreview]);

  async function put(part: "file" | "original", body: Blob, type: string, removeWhite: boolean) {
    const s = await startStudioUploadAction(slot.key, part, type, body.size, removeWhite);
    if (!s.ok) throw new Error(s.message);
    const res = await fetch(s.url, { method: "PUT", headers: { "Content-Type": type, "x-upsert": "true" }, body }).catch(() => null);
    if (!res?.ok) throw new Error("The upload didn't go through. Check your connection and try again.");
    return s.path;
  }

  /** Processes (images) and uploads `source` into the slot; `keepOriginal` also stores the photo for later re-cuts. */
  async function upload(source: Blob, removeWhite: boolean, keepOriginal: boolean) {
    setError(null);
    setNote(null);
    try {
      const max = maxBytesFor(slot);
      if (source.size > max) throw new Error(`That file is over ${max / 1024 / 1024} MB. Pick a smaller one.`);
      let kept: string | null = null;
      if (slot.kind === "model") {
        // a trained RVC voice model: uploaded as is, straight to private Storage
        if (!(source instanceof File) || !modelFileOk(slot, source.name)) throw new Error(`Pick a ${slot.ext} file for this slot.`);
        setPhase("uploading");
        await put("file", source, MODEL_TYPE, true);
      } else if (sprite) {
        setPhase("processing");
        const r = await processPropFile(source, { removeWhite });
        setLocalPreview((old) => {
          if (old) URL.revokeObjectURL(old);
          return URL.createObjectURL(r.blob);
        });
        setPhase("uploading");
        const otype = source.type.toLowerCase();
        if (keepOriginal && ORIGINAL_TYPES[otype]) kept = await put("original", source, otype, removeWhite);
        await put("file", r.blob, "image/png", removeWhite);
      } else {
        const audio = source instanceof File ? audioUploadType(source) : null;
        if (!audio) throw new Error("That isn't a sound file we can use. Pick an MP3, WAV, M4A or OGG.");
        setPhase("uploading");
        await put("file", source, audio.type, true);
      }
      const done = await finishStudioUploadAction(slot.key, kept);
      if (!done.ok) throw new Error(done.message);
      // a re-cut without a new original keeps the stored switch position in step with what's shown
      setStatus({ ...done.status, removeWhite: kept ? done.status.removeWhite : removeWhite });
      setPhase("idle");
      setNote(sprite ? "Saved. Used by every episode from the next preview or render." : slot.kind === "model" ? "Saved. The Own-Voice render worker picks it up." : "Saved. Used as the urgent background track.");
      router.refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      setPhase("error");
    }
  }

  async function toggle(removeWhite: boolean) {
    // re-cut from the photo picked this visit, else from the stored original
    let source: Blob | null = picked;
    if (!source && status.originalUrl) {
      setPhase("processing");
      const url = status.originalUrl;
      source = await fetch(url)
        .then((r) => (r.ok ? r.blob() : null))
        .then((b) => (b ? new Blob([b], { type: originalType(url) ?? b.type }) : null))
        .catch(() => null);
    }
    if (!source) {
      setError("The original photo isn't stored for this sprite. Replace it to change the background.");
      setPhase("error");
      return;
    }
    setStatus((s) => ({ ...s, removeWhite }));
    await upload(source, removeWhite, true);
  }

  async function remove() {
    if (!window.confirm(`Remove ${slot.path}? Episodes fall back to the stand-in until you upload a new one.`)) return;
    setError(null);
    setPhase("removing");
    const r = await removeStudioAssetAction(slot.key);
    if (!r.ok) {
      setError(r.message);
      setPhase("error");
      return;
    }
    setStatus(empty(slot.key));
    setPicked(null);
    setLocalPreview(null);
    setPhase("idle");
    setNote("Removed.");
    router.refresh();
  }

  const pick = () => input.current?.click();
  const ready = Boolean(status.present ?? status.url);
  const label = sprite ? "Upload image" : slot.kind === "model" ? `Upload ${slot.ext}` : "Upload audio";
  const working = phase === "processing" ? "Processing image..." : phase === "uploading" ? "Uploading..." : phase === "removing" ? "Removing..." : null;
  const canRecut = Boolean(picked || status.originalUrl);
  const name = sprite ? `${slot.group.replace(/ \(Angry\)/, "")} angry, ${slot.label.toLowerCase()}` : slot.kind === "model" ? slot.label : "Urgent background track";

  return (
    <div className="min-w-0 space-y-2">
      <input
        ref={input}
        type="file"
        accept={acceptFor(slot)}
        className="sr-only"
        tabIndex={-1}
        aria-hidden
        onChange={(e) => {
          const f = e.target.files?.[0];
          e.target.value = "";
          if (!f) return;
          setPicked(f);
          void upload(f, true, true);
        }}
      />
      {!compact && (
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div className="min-w-0">
            <div className="text-sm font-semibold">{slot.kind === "audio" ? "Background track" : slot.label}</div>
            <code className="block break-all text-xs text-muted">{slot.path}</code>
          </div>
          <span className="stamp" style={{ color: ready ? "var(--win)" : "var(--bad)" }}>
            {ready ? "Ready" : "Missing"}
          </span>
        </div>
      )}

      {ready && !busy ? (
        <div className="flex min-w-0 flex-wrap items-center gap-3">
          {slot.kind === "model" ? (
            <span className="text-xs text-muted">Uploaded{status.sizeBytes ? ` · ${(status.sizeBytes / 1024 / 1024).toFixed(1)} MB` : ""} · private</span>
          ) : sprite ? (
            <Checker>
              {/* eslint-disable-next-line @next/next/no-img-element -- public Supabase URL or local blob, fixed 48 px */}
              <img src={localPreview ?? status.url!} alt={`${name} sprite preview, transparent cut-out`} width={48} height={48} style={{ width: 48, height: 48, objectFit: "contain" }} />
            </Checker>
          ) : (
            <audio controls preload="none" src={status.url!} className="h-11 w-full min-w-0 max-w-xs" aria-label={`${name} preview`} />
          )}
          {sprite && (
            <label className={`flex min-h-11 items-center gap-2 text-xs ${canRecut ? "cursor-pointer" : "text-muted"}`}>
              <input type="checkbox" className="h-5 w-5" checked={status.removeWhite} disabled={!canRecut} onChange={(e) => void toggle(e.target.checked)} />
              Remove white background
            </label>
          )}
          <div className="flex flex-wrap gap-2">
            <button type="button" className="btn btn-secondary text-xs" onClick={pick} aria-label={`Replace ${name}`}>
              Replace
            </button>
            <button type="button" className="btn btn-danger text-xs" onClick={() => void remove()} aria-label={`Remove ${name}`}>
              Remove
            </button>
          </div>
        </div>
      ) : (
        <div className="flex flex-wrap items-center gap-2">
          <button type="button" className="btn btn-secondary text-xs" disabled={busy} aria-busy={busy} onClick={pick} aria-describedby={`${id}-status`} aria-label={busy ? undefined : `${label} for ${name}`}>
            {working ?? label}
          </button>
          {compact && !busy && <span className="text-xs" style={{ color: "var(--bad)" }}>Missing</span>}
        </div>
      )}

      <p id={`${id}-status`} role="status" aria-live="polite" className="text-xs text-muted">
        {working ? null : note}
      </p>
      {phase === "error" && error && (
        <div role="alert" className="flex flex-wrap items-center gap-2 rounded-control border p-2 text-xs" style={{ borderColor: "var(--bad)", background: "var(--bad-bg)" }}>
          <span style={{ color: "var(--bad)" }}>{error}</span>
          {picked && (
            <button type="button" className="btn btn-secondary text-xs" onClick={() => void upload(picked, status.removeWhite, true)}>
              Try again
            </button>
          )}
          <button type="button" className="btn btn-secondary text-xs" onClick={pick}>
            Pick another file
          </button>
        </div>
      )}
    </div>
  );
}

/** A dark checkerboard swatch so a transparent cut-out is visible. */
function Checker({ children }: { children: React.ReactNode }) {
  return (
    <span
      className="inline-flex shrink-0 items-center justify-center overflow-hidden rounded border border-border"
      style={{ width: 48, height: 48, background: "repeating-conic-gradient(#1f2937 0% 25%, #374151 0% 50%) 50% / 12px 12px" }}
    >
      {children}
    </span>
  );
}
