// Lists the optional animation assets that exist, so the video can use them and fall back when they don't:
//   public/cast/{uco|ocu}/{emotion}-{closed|open}.png   illustrated puppet sprites (see video/src/cast/README.md)
//   public/sfx/{whoosh|stamp|pop}.mp3                     sound effects
// Writes video/src/assets/assetManifest.json. Runs before `next build` (prebuild) and before every render, so files
// added straight to GitHub are picked up on the next deploy / render without touching code.
import { existsSync, readdirSync, statSync, writeFileSync } from "node:fs";
import path from "node:path";

const root = path.resolve(path.dirname(new URL(import.meta.url).pathname), "..");

function list(dir: string, ext: RegExp): string[] {
  const abs = path.join(root, "public", dir);
  if (!existsSync(abs)) return [];
  const out: string[] = [];
  const walk = (d: string) => {
    for (const name of readdirSync(d).sort()) {
      const p = path.join(d, name);
      if (statSync(p).isDirectory()) walk(p);
      else if (ext.test(name)) out.push(path.relative(abs, p).split(path.sep).join("/"));
    }
  };
  walk(abs);
  return out;
}

export function writeAssetManifest() {
  const manifest = { cast: list("cast", /\.png$/i), sfx: list("sfx", /\.(mp3|wav)$/i) };
  writeFileSync(path.join(root, "video/src/assets/assetManifest.json"), JSON.stringify(manifest, null, 2) + "\n");
  return manifest;
}

if (process.argv[1] && path.resolve(process.argv[1]) === path.resolve(new URL(import.meta.url).pathname)) {
  const m = writeAssetManifest();
  console.log(`asset manifest: ${m.cast.length} cast sprites, ${m.sfx.length} sound effects`);
}
