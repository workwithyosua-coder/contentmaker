import { staticFile } from "remotion";

/**
 * The src for an asset path from propFile() / sfxFile(): uploaded assets are HTTPS URLs and load as they are; repo
 * assets go through staticFile(). Null for a name-only placeholder ("remote:…"), which the video then skips.
 */
export function assetSrc(file: string | null): string | null {
  if (!file || file.startsWith("remote:")) return null;
  return /^https?:\/\//.test(file) || file.startsWith("/") ? file : staticFile(file);
}
