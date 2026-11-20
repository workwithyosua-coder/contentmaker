import "server-only";
import { addAvailableAssets } from "../../video/src/assets";
import { AUDIO_TYPES, MAX_PICK_BYTES, isSlotName, type AssetKind } from "./assetSlots";
import { ensurePublicBucket, listObjects, publicObjectUrl } from "./storage";

// Custom props and SFX uploaded in the app (Manual mode's asset readiness "Upload"). Vercel's filesystem is
// read-only, so they never go to public/: they live in the public Supabase Storage bucket `custom-assets`, at
// props/{name}.png (the browser converts every picked image to PNG first, see clientPropProcessor.ts) and
// sfx/{name}.{mp3|wav|m4a|ogg}, named after the slot, never the user's file (assetSlots.ts), shared by every episode. Each upload has a permanent public HTTPS
// URL, saved on the beats that use it; the render handoff (/api/render/:id) passes them too, and Remotion loads them
// directly next to the repo's staticFile() assets. The bucket only holds props and sound effects (things that end up
// in published videos anyway): voice recordings stay in the private `recordings` bucket.

export type { AssetKind } from "./assetSlots";
export const ASSET_BUCKET = "custom-assets";
export const ASSET_MAX_BYTES = MAX_PICK_BYTES;

/** Upload types per kind → stored extension. Props arrive as PNG (converted in the browser). */
export const ASSET_TYPES: Record<AssetKind, Record<string, string>> = {
  props: { "image/png": "png", "image/webp": "webp" },
  sfx: AUDIO_TYPES,
};

export const isAssetName = isSlotName;
/** Path inside the bucket. */
export const assetPath = (kind: AssetKind, name: string, ext: string) => `${kind}/${name}.${ext}`;

/** A path inside the bucket that uploads may use: props/x.png|webp or sfx/x.mp3|wav|m4a|ogg, nothing else. */
export function isAttachedAssetPath(p: string) {
  return /^props\/[a-z0-9]+(-[a-z0-9]+)*\.(png|webp)$/.test(p) || /^sfx\/[a-z0-9]+(-[a-z0-9]+)*\.(mp3|wav|m4a|ogg)$/.test(p);
}

export async function ensureAssetBucket() {
  await ensurePublicBucket(ASSET_BUCKET, { maxBytes: ASSET_MAX_BYTES, types: [...new Set(Object.values(ASSET_TYPES).flatMap((t) => Object.keys(t)))] });
}

/** File names of the uploaded props and SFX ("sate-padang.png", "bgm.mp3"). Empty lists when storage is unreachable. */
export async function listAttachedAssets(): Promise<{ props: string[]; sfx: string[] }> {
  const [props, sfx] = await Promise.all([listObjects("props", ASSET_BUCKET).catch(() => []), listObjects("sfx", ASSET_BUCKET).catch(() => [])]);
  return { props: props.filter((n) => /\.(png|webp)$/.test(n)), sfx: sfx.filter((n) => /\.(mp3|wav|m4a|ogg)$/.test(n)) };
}

/** Lists the uploads and makes the beats / readiness bar treat them as available. */
export async function loadAttachedAssets() {
  const a = await listAttachedAssets();
  addAvailableAssets(a);
  return a;
}

/** name → public HTTPS URL for every upload. `origin` makes local-driver URLs absolute (for the renderer). */
export async function attachedAssetUrls(origin?: string): Promise<{ props: Record<string, string>; sfx: Record<string, string> }> {
  const a = await listAttachedAssets();
  const urls = (kind: AssetKind, files: string[]) => Object.fromEntries(files.map((f) => [f.replace(/\.[a-z0-9]+$/, ""), publicObjectUrl(`${kind}/${f}`, ASSET_BUCKET, origin)]));
  return { props: urls("props", a.props), sfx: urls("sfx", a.sfx) };
}
