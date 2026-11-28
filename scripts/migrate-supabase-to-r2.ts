// One-time copy of Supabase Storage objects into Cloudflare R2, keeping each bucket name as the key prefix
// ("studio-assets/sprites/uco-angry-closed.png" → R2 key "studio-assets/sprites/uco-angry-closed.png").
// Idempotent: an object already in R2 with the same size is skipped, so it can be re-run until everything is there.
// It NEVER deletes anything from Supabase: clear Supabase Storage yourself once the app is verified on R2.
//
//   npx tsx --env-file-if-exists=.env.local scripts/migrate-supabase-to-r2.ts [--dry-run] [--bucket studio-assets] ...
//
// Needs SUPABASE_URL, SUPABASE_SECRET_KEY and R2_ACCOUNT_ID, R2_ACCESS_KEY_ID, R2_SECRET_ACCESS_KEY, R2_BUCKET_NAME.
// Default buckets: studio-assets and custom-assets (the private recordings keep working through the app's Supabase
// fallback; pass --bucket recordings to copy them too).
import { r2Config, r2Head, r2Key, r2Put, STORAGE_AREAS, type R2Config } from "../src/lib/r2";

type Listed = { name: string; id: string | null; metadata?: { size?: number; mimetype?: string } | null };

const args = process.argv.slice(2);
const dryRun = args.includes("--dry-run");
const picked = args.flatMap((a, i) => (a === "--bucket" && args[i + 1] ? [args[i + 1]] : []));
const buckets = picked.length ? picked : ["studio-assets", "custom-assets"];

function supabase() {
  const url = process.env.SUPABASE_URL?.trim().replace(/\/$/, "");
  const key = process.env.SUPABASE_SECRET_KEY?.trim();
  if (!url || !key) throw new Error("Set SUPABASE_URL and SUPABASE_SECRET_KEY.");
  return { url, headers: { apikey: key, Authorization: `Bearer ${key}` } };
}

/** Every file in a Supabase bucket (folders walked recursively, 1000 at a time). */
async function listAll(bucket: string, prefix = ""): Promise<{ path: string; size: number | null; mime: string | null }[]> {
  const { url, headers } = supabase();
  const out: { path: string; size: number | null; mime: string | null }[] = [];
  for (let offset = 0; ; offset += 1000) {
    const res = await fetch(`${url}/storage/v1/object/list/${bucket}`, {
      method: "POST",
      headers: { ...headers, "Content-Type": "application/json" },
      body: JSON.stringify({ prefix, limit: 1000, offset, sortBy: { column: "name", order: "asc" } }),
    });
    if (res.status === 404 || res.status === 400) return out; // no such bucket
    if (!res.ok) throw new Error(`Couldn't list ${bucket}/${prefix} (${res.status}): ${(await res.text()).slice(0, 200)}`);
    const rows = (await res.json()) as Listed[];
    for (const r of rows) {
      if (r.name.startsWith(".")) continue;
      const path = prefix ? `${prefix}/${r.name}` : r.name;
      if (r.id === null) out.push(...(await listAll(bucket, path))); // a folder
      else out.push({ path, size: r.metadata?.size ?? null, mime: r.metadata?.mimetype ?? null });
    }
    if (rows.length < 1000) return out;
  }
}

async function download(bucket: string, path: string): Promise<{ bytes: Uint8Array; type: string }> {
  const { url, headers } = supabase();
  const res = await fetch(`${url}/storage/v1/object/authenticated/${bucket}/${path.split("/").map(encodeURIComponent).join("/")}`, { headers });
  if (!res.ok) throw new Error(`download ${res.status}`);
  return { bytes: new Uint8Array(await res.arrayBuffer()), type: res.headers.get("content-type") ?? "application/octet-stream" };
}

async function copyBucket(cfg: R2Config, bucket: string) {
  const files = await listAll(bucket);
  let copied = 0;
  let skipped = 0;
  let failed = 0;
  for (const f of files) {
    const key = r2Key(bucket, f.path);
    try {
      const have = await r2Head(cfg, key);
      if (have && (f.size == null || have.size === f.size)) {
        skipped++;
        continue;
      }
      if (dryRun) {
        console.log(`would copy ${bucket}/${f.path} → ${key}${f.size != null ? ` (${f.size} bytes)` : ""}`);
        copied++;
        continue;
      }
      const { bytes, type } = await download(bucket, f.path);
      await r2Put(cfg, key, bytes, f.mime ?? type, "max-age=3600");
      console.log(`copied ${bucket}/${f.path} → ${key} (${bytes.byteLength} bytes)`);
      copied++;
    } catch (e) {
      failed++;
      console.error(`FAILED ${bucket}/${f.path}: ${e instanceof Error ? e.message : String(e)}`);
    }
  }
  console.log(`${bucket}: ${files.length} file(s): ${copied} ${dryRun ? "to copy" : "copied"}, ${skipped} already in R2, ${failed} failed`);
  return failed;
}

async function main() {
  const cfg = r2Config();
  if (!cfg) throw new Error("Set R2_ACCOUNT_ID, R2_ACCESS_KEY_ID, R2_SECRET_ACCESS_KEY and R2_BUCKET_NAME.");
  for (const b of buckets) if (!(STORAGE_AREAS as readonly string[]).includes(b)) throw new Error(`Unknown bucket "${b}" (use ${STORAGE_AREAS.join(", ")}).`);
  console.log(`${dryRun ? "[dry run] " : ""}Supabase Storage → R2 bucket "${cfg.bucket}": ${buckets.join(", ")}. Nothing is deleted from Supabase.`);
  let failed = 0;
  for (const b of buckets) failed += await copyBucket(cfg, b);
  if (failed) process.exitCode = 1;
}

main().catch((e) => {
  console.error(e instanceof Error ? e.message : e);
  process.exitCode = 1;
});
