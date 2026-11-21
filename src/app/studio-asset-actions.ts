"use server";

import { revalidatePath } from "next/cache";
import { audioUploadType } from "@/lib/assetSlots";
import { getOwner } from "@/lib/queries";
import { ensureStudioBucket, listStudioAssets } from "@/lib/studio-assets";
import { STUDIO_BUCKET, STUDIO_MAX_BYTES, isStudioObjectPath, originalPath, parseOriginal, studioSlot, type StudioAssetStatus } from "@/lib/studioAssets";
import { deleteObjects, listObjectInfo, signedUploadUrl } from "@/lib/storage";

// Studio Assets: upload / replace / remove one global slot by key. Plain code and Storage calls, no AI. Only the
// allowlisted keys (studioAssets.ts) can be written, whatever the browser sends.

type Fail = { ok: false; message: string };
const message = (err: unknown) => (err instanceof Error ? err.message : String(err));

async function owner() {
  const o = await getOwner();
  if (!o) throw new Error("No user found.");
  return o;
}

function refresh() {
  revalidatePath("/accounts");
  revalidatePath("/create", "layout");
}

/**
 * Step 1: a one-time upload URL for a slot. `part: "file"` is what the video uses (a sprite's processed PNG, or the
 * audio as picked); `part: "original"` keeps a sprite's picked photo so the background switch can be changed later.
 */
export async function startStudioUploadAction(
  key: string,
  part: "file" | "original",
  type: string,
  size: number,
  removeWhite = true,
): Promise<{ ok: true; url: string; path: string } | Fail> {
  try {
    await owner();
    const slot = studioSlot(key);
    if (!slot) return { ok: false, message: "Unknown studio asset." };
    if (!(size > 0) || size > STUDIO_MAX_BYTES) return { ok: false, message: `That file is over ${STUDIO_MAX_BYTES / 1024 / 1024} MB. Pick a smaller one.` };
    let path: string | null;
    if (part === "original") path = originalPath(slot, removeWhite, type);
    else if (slot.kind === "sprite") path = type === "image/png" ? slot.path : null;
    else path = audioUploadType({ type, name: "" }) ? slot.path : null;
    if (!path || !isStudioObjectPath(path)) return { ok: false, message: slot.kind === "sprite" ? "That image type can't be stored." : "Pick an MP3, WAV, M4A or OGG file." };
    await ensureStudioBucket();
    return { ok: true, url: await signedUploadUrl(path, STUDIO_BUCKET, true), path };
  } catch (err) {
    return { ok: false, message: message(err) };
  }
}

/** Step 2: the upload landed. Drops a sprite's older originals and returns the slot's fresh status. */
export async function finishStudioUploadAction(key: string, keptOriginal: string | null): Promise<{ ok: true; status: StudioAssetStatus } | Fail> {
  try {
    await owner();
    const slot = studioSlot(key);
    if (!slot) return { ok: false, message: "Unknown studio asset." };
    if (keptOriginal !== null && parseOriginal(keptOriginal)?.key !== slot.key) return { ok: false, message: "Unknown upload." };
    if (slot.kind === "sprite") {
      const stale = (await listObjectInfo("originals", STUDIO_BUCKET).catch(() => []))
        .map((o) => `originals/${o.name}`)
        .filter((p) => parseOriginal(p)?.key === slot.key && p !== keptOriginal);
      if (keptOriginal) await deleteObjects(stale, STUDIO_BUCKET);
    }
    const status = (await listStudioAssets()).find((s) => s.key === slot.key);
    if (!status?.url) return { ok: false, message: "The upload didn't arrive. Try again." };
    refresh();
    return { ok: true, status };
  } catch (err) {
    return { ok: false, message: message(err) };
  }
}

/** Removes a slot's file (and a sprite's kept original). The video falls back to its stand-in until a new upload. */
export async function removeStudioAssetAction(key: string): Promise<{ ok: true } | Fail> {
  try {
    await owner();
    const slot = studioSlot(key);
    if (!slot) return { ok: false, message: "Unknown studio asset." };
    const originals = (await listObjectInfo("originals", STUDIO_BUCKET).catch(() => [])).map((o) => `originals/${o.name}`).filter((p) => parseOriginal(p)?.key === slot.key);
    await deleteObjects([slot.path, ...originals], STUDIO_BUCKET);
    refresh();
    return { ok: true };
  } catch (err) {
    return { ok: false, message: message(err) };
  }
}
