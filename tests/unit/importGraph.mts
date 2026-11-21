// Static import-graph walker for the "never reaches X" tests (value imports only: type-only imports are erased).
import fs from "node:fs";
import path from "node:path";

export const ROOT = path.resolve(import.meta.dirname, "../..");

function importsOf(file: string): string[] {
  const src = fs.readFileSync(file, "utf8");
  const out: string[] = [];
  for (const m of src.matchAll(/^\s*(import|export)\s+(type\s+)?[^;]*?\sfrom\s+["']([^"']+)["']/gm)) if (!m[2]) out.push(m[3]);
  for (const m of src.matchAll(/^\s*import\s+["']([^"']+)["']/gm)) out.push(m[1]);
  for (const m of src.matchAll(/import\(\s*["']([^"']+)["']\s*\)/g)) out.push(m[1]);
  return out;
}

function resolve(from: string, spec: string): string | null {
  const base = spec.startsWith("@/") ? path.join(ROOT, "src", spec.slice(2)) : spec.startsWith(".") ? path.resolve(path.dirname(from), spec) : null;
  if (!base) return null;
  for (const ext of ["", ".ts", ".tsx", ".mts", "/index.ts", "/index.tsx"]) if (fs.existsSync(base + ext) && fs.statSync(base + ext).isFile()) return base + ext;
  return null;
}

/** The first import chain from `entry` (repo-relative) to a module matching one of `targets`, or null. */
export function pathTo(entry: string, targets: RegExp[]): string[] | null {
  const seen = new Set<string>();
  const queue: { file: string; trail: string[] }[] = [{ file: path.join(ROOT, entry), trail: [entry] }];
  while (queue.length) {
    const { file, trail } = queue.shift()!;
    if (seen.has(file)) continue;
    seen.add(file);
    for (const spec of importsOf(file)) {
      const hit = resolve(file, spec);
      const name = hit ? path.relative(ROOT, hit) : spec;
      if (targets.some((rx) => rx.test(name))) return [...trail, name];
      if (hit) queue.push({ file: hit, trail: [...trail, name] });
    }
  }
  return null;
}
