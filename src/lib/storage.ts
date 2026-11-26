import "server-only";
import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { createHmac } from "node:crypto";

// Private file storage for recordings (and later renders).
// Production: Supabase Storage (private bucket, server-side secret key, short-lived signed URLs for playback).
// Local tests: STORAGE_DRIVER=local writes to ./.local-storage and serves files through /api/media (dev only).

const BUCKET = "recordings";
/** Local driver: the default bucket's objects sit at the top of ./.local-storage, other buckets in a folder each. */
const localPath = (objectPath: string, bucket: string) => path.join(LOCAL_DIR, bucket === BUCKET ? objectPath : `${bucket}/${objectPath}`);
const local = () => process.env.STORAGE_DRIVER === "local" && !process.env.VERCEL; // never on Vercel
const LOCAL_DIR = path.join(process.cwd(), ".local-storage");

function supabase() {
  const url = process.env.SUPABASE_URL?.trim();
  const key = process.env.SUPABASE_SECRET_KEY?.trim();
  if (!url || !key) throw new Error("Storage isn't configured (SUPABASE_URL / SUPABASE_SECRET_KEY missing in Vercel).");
  return { url, headers: { apikey: key, Authorization: `Bearer ${key}` } };
}

/** Keep only the base type ("audio/webm;codecs=opus" → "audio/webm"). */
export const baseMime = (mime: string) => mime.split(";")[0].trim().toLowerCase();

export async function putObject(objectPath: string, data: ArrayBuffer, contentType: string) {
  if (local()) {
    const file = path.join(LOCAL_DIR, objectPath);
    await mkdir(path.dirname(file), { recursive: true });
    await writeFile(file, Buffer.from(data));
    return;
  }
  const { url, headers } = supabase();
  const res = await fetch(`${url}/storage/v1/object/${BUCKET}/${objectPath}`, {
    method: "POST",
    headers: { ...headers, "Content-Type": baseMime(contentType), "x-upsert": "true", "cache-control": "max-age=3600" },
    body: data,
  });
  if (!res.ok) throw new Error(`Upload failed (${res.status}): ${(await res.text()).slice(0, 200)}`);
}

/** A playback URL valid for `seconds`. */
export async function signedUrl(objectPath: string, seconds = 3600): Promise<string> {
  if (local()) {
    const exp = Math.floor(Date.now() / 1000) + seconds;
    return `/api/media/${objectPath}?exp=${exp}&sig=${localSig(objectPath, exp)}`;
  }
  const { url, headers } = supabase();
  const res = await fetch(`${url}/storage/v1/object/sign/${BUCKET}/${objectPath}`, {
    method: "POST",
    headers: { ...headers, "Content-Type": "application/json" },
    body: JSON.stringify({ expiresIn: seconds }),
  });
  const json = (await res.json()) as { signedURL?: string; error?: string; message?: string };
  if (!res.ok || !json.signedURL) throw new Error(`Couldn't sign URL: ${json.message ?? json.error ?? res.status}`);
  return `${url}/storage/v1${json.signedURL}`;
}

export async function signedUrls(paths: string[], seconds = 3600) {
  return Object.fromEntries(await Promise.all(paths.map(async (p) => [p, await signedUrl(p, seconds)] as const)));
}

/** Downloads a private object (server-side only). Returns null if it doesn't exist. */
export async function getObject(objectPath: string, bucket = BUCKET): Promise<ArrayBuffer | null> {
  if (local()) return readFile(localPath(objectPath, bucket)).then((b) => new Uint8Array(b).buffer, () => null);
  const { url, headers } = supabase();
  const res = await fetch(`${url}/storage/v1/object/authenticated/${bucket}/${objectPath}`, { headers });
  if (res.status === 404 || res.status === 400) return null;
  if (!res.ok) throw new Error(`Download failed (${res.status}): ${(await res.text()).slice(0, 200)}`);
  return res.arrayBuffer();
}

/**
 * A one-time URL the browser can PUT a file to directly (bypasses the 4.5 MB request limit of our functions).
 * Supabase: storage "upload/sign". Local driver: /api/media/<path> with a signature (dev/tests only).
 */
export async function signedUploadUrl(objectPath: string, bucket = BUCKET, upsert = false): Promise<string> {
  if (local()) {
    const p = bucket === BUCKET ? objectPath : `${bucket}/${objectPath}`;
    const exp = Math.floor(Date.now() / 1000) + 900;
    return `/api/media/${p}?exp=${exp}&sig=${localSig(`put:${p}`, exp)}`;
  }
  const { url, headers } = supabase();
  const res = await fetch(`${url}/storage/v1/object/upload/sign/${bucket}/${objectPath}`, {
    method: "POST",
    headers: { ...headers, "Content-Type": "application/json", ...(upsert ? { "x-upsert": "true" } : {}) },
    body: "{}",
  });
  const json = (await res.json()) as { url?: string; message?: string; error?: string };
  if (!res.ok || !json.url) throw new Error(`Couldn't prepare the upload: ${json.message ?? json.error ?? res.status}`);
  return `${url}/storage/v1${json.url}`;
}

/** Size of a stored object, or null if it doesn't exist. */
export async function objectSize(objectPath: string): Promise<number | null> {
  if (local()) {
    const { stat } = await import("node:fs/promises");
    return stat(path.join(LOCAL_DIR, objectPath)).then((s) => s.size, () => null);
  }
  const { url, headers } = supabase();
  const res = await fetch(`${url}/storage/v1/object/info/authenticated/${BUCKET}/${objectPath}`, { headers });
  if (!res.ok) return null;
  const j = (await res.json()) as { size?: number; metadata?: { size?: number } };
  return j.size ?? j.metadata?.size ?? 0;
}

/** File names directly under a folder ("assets/props" → ["sate-padang.png", …]), sorted. Empty when there's none. */
export async function listObjects(prefix: string, bucket = BUCKET): Promise<string[]> {
  const clean = prefix.replace(/^\/+|\/+$/g, "");
  if (local()) {
    const { readdir } = await import("node:fs/promises");
    const dir = localPath(clean, bucket);
    if (!dir.startsWith(LOCAL_DIR + path.sep)) return [];
    const entries = await readdir(dir, { withFileTypes: true }).catch(() => []);
    return entries.filter((e) => e.isFile()).map((e) => e.name).sort();
  }
  const { url, headers } = supabase();
  const res = await fetch(`${url}/storage/v1/object/list/${bucket}`, {
    method: "POST",
    headers: { ...headers, "Content-Type": "application/json" },
    body: JSON.stringify({ prefix: clean, limit: 1000, offset: 0, sortBy: { column: "name", order: "asc" } }),
  });
  if (res.status === 404 || res.status === 400) return []; // bucket not created yet
  if (!res.ok) throw new Error(`Couldn't list ${clean} (${res.status})`);
  const rows = (await res.json()) as { name: string; id: string | null }[];
  return rows.filter((r) => r.id && !r.name.startsWith(".")).map((r) => r.name);
}

/** Like listObjects, with each file's last-modified time (ms), for cache-busting public URLs. */
export async function listObjectInfo(prefix: string, bucket = BUCKET): Promise<{ name: string; updatedAt: number | null; size?: number | null }[]> {
  const clean = prefix.replace(/^\/+|\/+$/g, "");
  if (local()) {
    const { readdir, stat } = await import("node:fs/promises");
    const dir = localPath(clean, bucket);
    if (!dir.startsWith(LOCAL_DIR + path.sep)) return [];
    const entries = await readdir(dir, { withFileTypes: true }).catch(() => []);
    const files = entries.filter((e) => e.isFile()).map((e) => e.name).sort();
    return Promise.all(
      files.map(async (name) => {
        const st = await stat(path.join(dir, name)).catch(() => null);
        return { name, updatedAt: st ? Math.round(st.mtimeMs) : null, size: st?.size ?? null };
      }),
    );
  }
  const { url, headers } = supabase();
  const res = await fetch(`${url}/storage/v1/object/list/${bucket}`, {
    method: "POST",
    headers: { ...headers, "Content-Type": "application/json" },
    body: JSON.stringify({ prefix: clean, limit: 1000, offset: 0, sortBy: { column: "name", order: "asc" } }),
  });
  if (res.status === 404 || res.status === 400) return [];
  if (!res.ok) throw new Error(`Couldn't list ${clean} (${res.status})`);
  const rows = (await res.json()) as { name: string; id: string | null; updated_at?: string | null; created_at?: string | null; metadata?: { size?: number } | null }[];
  return rows
    .filter((r) => r.id && !r.name.startsWith("."))
    .map((r) => {
      const t = Date.parse(r.updated_at ?? r.created_at ?? "");
      return { name: r.name, updatedAt: Number.isFinite(t) ? t : null, size: r.metadata?.size ?? null };
    });
}

export async function deleteObjects(paths: string[], bucket = BUCKET) {
  if (!paths.length) return;
  if (local()) {
    await Promise.all(paths.map((p) => rm(localPath(p, bucket), { force: true })));
    return;
  }
  const { url, headers } = supabase();
  await fetch(`${url}/storage/v1/object/${bucket}`, {
    method: "DELETE",
    headers: { ...headers, "Content-Type": "application/json" },
    body: JSON.stringify({ prefixes: paths }),
  });
}

/**
 * Makes sure a public bucket exists (created on first use: files there are readable by anyone with the URL, so only
 * put things in it that end up in published videos anyway, never recordings). Allowed types and size are enforced
 * by Supabase too. No-op for the local driver.
 */
export async function ensurePublicBucket(bucket: string, opts: { maxBytes: number; types: string[] }) {
  if (local()) return;
  const { url, headers } = supabase();
  const res = await fetch(`${url}/storage/v1/bucket/${bucket}`, { headers });
  if (res.ok) {
    // keep an existing bucket's limits in step with the app (e.g. new audio formats, a larger size limit)
    const b = (await res.json()) as { file_size_limit?: number | null; allowed_mime_types?: string[] | null; public?: boolean };
    const same = b.public && b.file_size_limit === opts.maxBytes && [...(b.allowed_mime_types ?? [])].sort().join() === [...opts.types].sort().join();
    if (!same) {
      const put = await fetch(`${url}/storage/v1/bucket/${bucket}`, {
        method: "PUT",
        headers: { ...headers, "Content-Type": "application/json" },
        body: JSON.stringify({ public: true, file_size_limit: opts.maxBytes, allowed_mime_types: opts.types }),
      });
      if (!put.ok) throw new Error(`Couldn't update the ${bucket} storage bucket (${put.status}): ${(await put.text()).slice(0, 200)}`);
    }
    return;
  }
  const made = await fetch(`${url}/storage/v1/bucket`, {
    method: "POST",
    headers: { ...headers, "Content-Type": "application/json" },
    body: JSON.stringify({ id: bucket, name: bucket, public: true, file_size_limit: opts.maxBytes, allowed_mime_types: opts.types }),
  });
  if (!made.ok && made.status !== 409) throw new Error(`Couldn't create the ${bucket} storage bucket (${made.status}): ${(await made.text()).slice(0, 200)}`);
}

/**
 * Makes sure the private recordings bucket accepts files up to `maxBytes` of these types (e.g. 100 MB voice models),
 * keeping every type it already allows. It stays private. No-op for the local driver. (Supabase's own per-project
 * upload limit still applies: 50 MB on the Free plan.)
 */
export async function raisePrivateBucketLimit(maxBytes: number, types: string[], bucket = BUCKET) {
  if (local()) return;
  const { url, headers } = supabase();
  const res = await fetch(`${url}/storage/v1/bucket/${bucket}`, { headers });
  if (!res.ok) throw new Error(`Couldn't read the ${bucket} storage bucket (${res.status}).`);
  const b = (await res.json()) as { file_size_limit?: number | null; allowed_mime_types?: string[] | null };
  const allowed = b.allowed_mime_types ?? null;
  const missing = allowed ? types.filter((t) => !allowed.includes(t)) : [];
  if ((b.file_size_limit ?? Infinity) >= maxBytes && !missing.length) return;
  const put = await fetch(`${url}/storage/v1/bucket/${bucket}`, {
    method: "PUT",
    headers: { ...headers, "Content-Type": "application/json" },
    body: JSON.stringify({ public: false, file_size_limit: Math.max(maxBytes, b.file_size_limit ?? 0), allowed_mime_types: allowed ? [...allowed, ...missing] : null }),
  });
  if (!put.ok) throw new Error(`Couldn't raise the ${bucket} bucket's size limit (${put.status}): ${(await put.text()).slice(0, 200)}`);
}

/**
 * Permanent HTTPS URL of an object in a public bucket. Local driver: an /api/media URL signed for 10 years (pass
 * `origin` to make it absolute, as the renderer needs).
 */
export function publicObjectUrl(objectPath: string, bucket: string, origin?: string) {
  if (local()) {
    const p = `${bucket}/${objectPath}`;
    const exp = Math.floor(Date.now() / 1000) + 10 * 365 * 86400;
    const u = `/api/media/${p}?exp=${exp}&sig=${localSig(p, exp)}`;
    return origin ? new URL(u, origin).toString() : u;
  }
  return `${process.env.SUPABASE_URL!.trim().replace(/\/$/, "")}/storage/v1/object/public/${bucket}/${objectPath}`;
}

// ---- local driver helpers (dev/test only) ----
function localSig(objectPath: string, exp: number) {
  return createHmac("sha256", process.env.APP_PASSWORD ?? "local").update(`${objectPath}:${exp}`).digest("hex").slice(0, 32);
}

export async function readLocalObject(objectPath: string, exp: number, sig: string) {
  if (!local()) return null;
  if (exp < Date.now() / 1000 || sig !== localSig(objectPath, exp)) return null;
  const file = path.join(LOCAL_DIR, objectPath);
  if (!file.startsWith(LOCAL_DIR + path.sep)) return null; // no path traversal
  return readFile(file).catch(() => null);
}

/** Local driver: accepts a browser upload for a path signed by signedUploadUrl() (dev/tests only). */
export async function writeLocalUpload(objectPath: string, exp: number, sig: string, data: ArrayBuffer) {
  if (!local()) return false;
  if (exp < Date.now() / 1000 || sig !== localSig(`put:${objectPath}`, exp)) return false;
  const file = path.join(LOCAL_DIR, objectPath);
  if (!file.startsWith(LOCAL_DIR + path.sep)) return false;
  await mkdir(path.dirname(file), { recursive: true });
  await writeFile(file, Buffer.from(data));
  return true;
}
