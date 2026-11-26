import "server-only";
import { AUDIO_TYPES } from "./assetSlots";
import { ensurePublicBucket, listObjectInfo, publicObjectUrl } from "./storage";
import { ORIGINAL_TYPES, STUDIO_BUCKET, STUDIO_MAX_BYTES, STUDIO_SLOTS, parseOriginal, studioVideoUrls, withVersion, type StudioAssetStatus } from "./studioAssets";

// Server side of Studio Assets (see studioAssets.ts for the keys): the public `studio-assets` bucket, listing what's
// uploaded with cache-busted public URLs, and the URL map the preview and the renderer register. No AI anywhere.

export async function ensureStudioBucket() {
  await ensurePublicBucket(STUDIO_BUCKET, {
    maxBytes: STUDIO_MAX_BYTES,
    types: [...new Set(["image/png", ...Object.keys(ORIGINAL_TYPES), ...Object.keys(AUDIO_TYPES)])],
  });
}

/**
 * Every studio slot with its public URL (`?v=<upload time>` so a replaced file is never served stale) or null when it
 * isn't uploaded. Storage problems read as "not uploaded" so pages and renders never fail on them.
 */
export async function listStudioAssets(origin?: string): Promise<StudioAssetStatus[]> {
  type Info = { name: string; updatedAt: number | null; size?: number | null };
  const [sprites, sfx, originals, models] = await Promise.all([
    ...["sprites", "sfx", "originals"].map((dir) => listObjectInfo(dir, STUDIO_BUCKET).catch(() => [] as Info[])),
    // voice models: private, in the recordings bucket
    listObjectInfo("studio-assets/voices").catch(() => [] as Info[]),
  ]);
  const found = new Map<string, { name: string; updatedAt: number | null }>();
  for (const [dir, list] of [["sprites", sprites], ["sfx", sfx]] as const) for (const f of list) found.set(`${dir}/${f.name}`, f);
  return STUDIO_SLOTS.map((slot) => {
    if (slot.kind === "model") {
      const m = models.find((x) => `studio-assets/voices/${x.name}` === slot.path);
      return { key: slot.key, url: null, present: Boolean(m), sizeBytes: m?.size ?? null, updatedAt: m?.updatedAt ?? null, originalUrl: null, removeWhite: true };
    }
    const f = found.get(slot.path);
    const orig = originals.map((o) => ({ o, info: parseOriginal(`originals/${o.name}`) })).find((x) => x.info?.key === slot.key);
    return {
      key: slot.key,
      url: f ? withVersion(publicObjectUrl(slot.path, STUDIO_BUCKET, origin), f.updatedAt) : null,
      present: Boolean(f),
      updatedAt: f?.updatedAt ?? null,
      originalUrl: orig ? withVersion(publicObjectUrl(`originals/${orig.o.name}`, STUDIO_BUCKET, origin), orig.o.updatedAt) : null,
      removeWhite: orig?.info?.removeWhite ?? true,
    };
  });
}

/** The uploaded studio files as the video's asset map ({ cast: { "uco/angry-closed.png": url }, sfx: { "bgm-urgent": url } }). */
export async function studioAssetUrls(origin?: string) {
  return studioVideoUrls(await listStudioAssets(origin).catch(() => []));
}

/**
 * Every uploaded asset the video can use, for the render handoff and the in-app preview: the custom props / SFX, plus
 * the Studio Assets sprites (cast) and audio, which win over a custom upload of the same name.
 */
export async function videoAssetUrls(origin?: string): Promise<{ props: Record<string, string>; sfx: Record<string, string>; cast: Record<string, string> }> {
  const { attachedAssetUrls } = await import("./attached-assets");
  const [attached, studio] = await Promise.all([attachedAssetUrls(origin).catch(() => ({ props: {}, sfx: {} })), studioAssetUrls(origin)]);
  return { props: attached.props, sfx: { ...attached.sfx, ...studio.sfx }, cast: studio.cast };
}

/** Which characters have an Own-Voice .pth model (and optional .index) in the private recordings bucket. */
export async function rvcModelStatus(): Promise<{ uco: boolean; ocu: boolean; index: { uco: boolean; ocu: boolean } }> {
  const names = new Set((await listObjectInfo("studio-assets/voices").catch(() => [])).map((o) => o.name));
  return {
    uco: names.has("uco-voice.pth"),
    ocu: names.has("ocu-voice.pth"),
    index: { uco: names.has("uco-voice.index"), ocu: names.has("ocu-voice.index") },
  };
}
