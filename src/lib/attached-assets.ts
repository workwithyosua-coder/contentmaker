import "server-only";
import { addAvailableAssets } from "../../video/src/assets";
import { listObjects, signedUrl } from "./storage";

// Custom props and SFX uploaded in the app (Manual / Exact Import, asset readiness "Upload"). Vercel's filesystem is
// read-only, so they never go to public/: they live in Supabase Storage at custom-assets/props/{name}.{png|webp} and
// custom-assets/sfx/{name}.{mp3|wav}, shared by every episode. The render handoff (/api/render/:id) and the in-app
// preview pass HTTPS URLs for them, and Remotion loads those directly next to the repo's staticFile() assets.
// The bucket is private (it also holds the voice recordings), so the URLs are signed when they're handed over
// instead of being stored as permanent public links.

export type AssetKind = "props" | "sfx";
export const ASSET_ROOT = "custom-assets";
export const ASSET_MAX_BYTES = 8 * 1024 * 1024;

/** Allowed upload types per kind → stored extension. */
export const ASSET_TYPES: Record<AssetKind, Record<string, string>> = {
  props: { "image/png": "png", "image/webp": "webp" },
  sfx: { "audio/mpeg": "mp3", "audio/mp3": "mp3", "audio/wav": "wav", "audio/x-wav": "wav", "audio/wave": "wav" },
};

export const isAssetName = (n: string) => /^[a-z0-9]+(-[a-z0-9]+)*$/.test(n) && n.length <= 40;
export const assetPath = (kind: AssetKind, name: string, ext: string) => `${ASSET_ROOT}/${kind}/${name}.${ext}`;

/** A stored upload path: custom-assets/props/x.png|webp or custom-assets/sfx/x.mp3|wav, nothing else. */
export function isAttachedAssetPath(p: string) {
  return /^custom-assets\/props\/[a-z0-9]+(-[a-z0-9]+)*\.(png|webp)$/.test(p) || /^custom-assets\/sfx\/[a-z0-9]+(-[a-z0-9]+)*\.(mp3|wav)$/.test(p);
}

/** File names of the uploaded props and SFX ("sate-padang.png", "bgm.mp3"). Empty lists when storage is unreachable. */
export async function listAttachedAssets(): Promise<{ props: string[]; sfx: string[] }> {
  const [props, sfx] = await Promise.all([
    listObjects(`${ASSET_ROOT}/props`).catch(() => []),
    listObjects(`${ASSET_ROOT}/sfx`).catch(() => []),
  ]);
  return { props: props.filter((n) => /\.(png|webp)$/.test(n)), sfx: sfx.filter((n) => /\.(mp3|wav)$/.test(n)) };
}

/** Lists the uploads and makes the beats / readiness bar treat them as available. */
export async function loadAttachedAssets() {
  const a = await listAttachedAssets();
  addAvailableAssets(a);
  return a;
}

/** name → signed HTTPS URL for every upload (the render handoff uses 7 days, the preview 1 hour). */
export async function attachedAssetUrls(seconds: number, origin?: string): Promise<{ props: Record<string, string>; sfx: Record<string, string> }> {
  const a = await listAttachedAssets();
  // the local storage driver (dev/tests) signs root-relative /api/media URLs: make them absolute for the renderer
  const abs = (u: string) => (origin && u.startsWith("/") ? new URL(u, origin).toString() : u);
  const sign = async (kind: AssetKind, files: string[]) =>
    Object.fromEntries(
      await Promise.all(files.map(async (f) => [f.replace(/\.[a-z0-9]+$/, ""), abs(await signedUrl(`${ASSET_ROOT}/${kind}/${f}`, seconds))] as const)),
    );
  const [props, sfx] = await Promise.all([sign("props", a.props), sign("sfx", a.sfx)]);
  return { props, sfx };
}
