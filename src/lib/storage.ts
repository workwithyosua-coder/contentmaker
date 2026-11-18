import "server-only";
import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { createHmac } from "node:crypto";

// Private file storage for recordings (and later renders).
// Production: Supabase Storage (private bucket, server-side secret key, short-lived signed URLs for playback).
// Local tests: STORAGE_DRIVER=local writes to ./.local-storage and serves files through /api/media (dev only).

const BUCKET = "recordings";
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
export async function getObject(objectPath: string): Promise<ArrayBuffer | null> {
  if (local()) return readFile(path.join(LOCAL_DIR, objectPath)).then((b) => new Uint8Array(b).buffer, () => null);
  const { url, headers } = supabase();
  const res = await fetch(`${url}/storage/v1/object/authenticated/${BUCKET}/${objectPath}`, { headers });
  if (res.status === 404 || res.status === 400) return null;
  if (!res.ok) throw new Error(`Download failed (${res.status}): ${(await res.text()).slice(0, 200)}`);
  return res.arrayBuffer();
}

/**
 * A one-time URL the browser can PUT a file to directly (bypasses the 4.5 MB request limit of our functions).
 * Supabase: storage "upload/sign". Local driver: /api/media/<path> with a signature (dev/tests only).
 */
export async function signedUploadUrl(objectPath: string): Promise<string> {
  if (local()) {
    const exp = Math.floor(Date.now() / 1000) + 900;
    return `/api/media/${objectPath}?exp=${exp}&sig=${localSig(`put:${objectPath}`, exp)}`;
  }
  const { url, headers } = supabase();
  const res = await fetch(`${url}/storage/v1/object/upload/sign/${BUCKET}/${objectPath}`, {
    method: "POST",
    headers: { ...headers, "Content-Type": "application/json" },
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

export async function deleteObjects(paths: string[]) {
  if (!paths.length) return;
  if (local()) {
    await Promise.all(paths.map((p) => rm(path.join(LOCAL_DIR, p), { force: true })));
    return;
  }
  const { url, headers } = supabase();
  await fetch(`${url}/storage/v1/object/${BUCKET}`, {
    method: "DELETE",
    headers: { ...headers, "Content-Type": "application/json" },
    body: JSON.stringify({ prefixes: paths }),
  });
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
