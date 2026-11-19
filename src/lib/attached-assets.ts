import "server-only";
import { addAvailableAssets } from "../../video/src/assets";
import { listObjects } from "./storage";

// Props and sound effects attached in the app (the asset checklist's "Attach file"). They live in private storage
// next to the recordings, at assets/props/{name}.png and assets/sfx/{name}.{mp3|wav}, shared by every episode.
// The renderer downloads them through /api/render/:id/assets and adds them to its asset manifest, so a render uses
// them exactly like files in the repo's public/props and public/sfx.

export type AssetKind = "props" | "sfx";
export const ASSET_ROOT = "assets";
export const ASSET_MAX_BYTES = 8 * 1024 * 1024;

/** Allowed upload types per kind → stored extension. */
export const ASSET_TYPES: Record<AssetKind, Record<string, string>> = {
  props: { "image/png": "png" },
  sfx: { "audio/mpeg": "mp3", "audio/mp3": "mp3", "audio/wav": "wav", "audio/x-wav": "wav", "audio/wave": "wav" },
};

export const isAssetName = (n: string) => /^[a-z0-9]+(-[a-z0-9]+)*$/.test(n) && n.length <= 40;
export const assetPath = (kind: AssetKind, name: string, ext: string) => `${ASSET_ROOT}/${kind}/${name}.${ext}`;

/** A stored path the renderer may download: assets/props/x.png or assets/sfx/x.mp3|wav, nothing else. */
export function isAttachedAssetPath(p: string) {
  return /^assets\/props\/[a-z0-9]+(-[a-z0-9]+)*\.png$/.test(p) || /^assets\/sfx\/[a-z0-9]+(-[a-z0-9]+)*\.(mp3|wav)$/.test(p);
}

/** File names of the attached props and SFX ("sate-padang.png", "bgm.mp3"). Empty lists when storage is unreachable. */
export async function listAttachedAssets(): Promise<{ props: string[]; sfx: string[] }> {
  const [props, sfx] = await Promise.all([
    listObjects(`${ASSET_ROOT}/props`).catch(() => []),
    listObjects(`${ASSET_ROOT}/sfx`).catch(() => []),
  ]);
  return { props: props.filter((n) => /\.png$/.test(n)), sfx: sfx.filter((n) => /\.(mp3|wav)$/.test(n)) };
}

/** Lists the attached assets and makes the beats / checklist treat them as available. */
export async function loadAttachedAssets() {
  const a = await listAttachedAssets();
  addAvailableAssets(a);
  return a;
}
