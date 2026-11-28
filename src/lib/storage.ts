import "server-only";
import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { createHmac } from "node:crypto";
import { isR2NotFound, PRESIGN, presignGet, presignPut, r2Config, r2Delete, r2ErrorInfo, r2Get, r2Head, r2Key, r2List, r2Probe, r2Put, type R2Config } from "./r2";

// Private file storage for recordings, renders, studio assets and custom assets.
// Production with R2_ACCOUNT_ID / R2_ACCESS_KEY_ID / R2_SECRET_ACCESS_KEY / R2_BUCKET_NAME: Cloudflare R2 (one private
// bucket, the old Supabase bucket names as key prefixes, presigned URLs for every read). Every new upload goes to R2;
// a read whose object isn't in R2 yet (an older episode or asset) falls back to Supabase Storage, so no existing link
// breaks; a delete removes both copies (so the fallback can't bring a deleted file back).
// Production without R2: Supabase Storage (private bucket, server-side secret key, short-lived signed URLs).
// Local tests: STORAGE_DRIVER=local writes to ./.local-storage and serves files through /api/media (dev only).

const BUCKET = "recordings";
/** Local driver: the default bucket's objects sit at the top of ./.local-storage, other buckets in a folder each. */
const localPath = (objectPath: string, bucket: string) => path.join(LOCAL_DIR, bucket === BUCKET ? objectPath : `${bucket}/${objectPath}`);
const local = () => process.env.STORAGE_DRIVER === "local" && !process.env.VERCEL; // never on Vercel
const LOCAL_DIR = path.join(process.cwd(), ".local-storage");

/** Supabase Storage is still reachable for the fallback (older objects, and whenever R2 fails). */
const supabaseReady = () => Boolean(process.env.SUPABASE_URL?.trim() && process.env.SUPABASE_SECRET_KEY?.trim());

// Circuit breaker: an R2 failure that isn't "not found" (bad keys, wrong bucket or endpoint, an outage) sends every
// storage call to Supabase for a minute, with the real (sanitized) error in the log, instead of failing the request.
// Objects written to Supabase meanwhile stay readable through the normal fallback once R2 is back.
const R2_COOLDOWN_MS = 60_000;
let r2DownUntil = 0;
let r2LastError: (ReturnType<typeof r2ErrorInfo> & { op: string; at: string }) | null = null;
function r2Failed(op: string, e: unknown, cfg: R2Config | null) {
  const info = r2ErrorInfo(e, cfg);
  r2LastError = { ...info, op, at: new Date().toISOString() };
  r2DownUntil = Date.now() + R2_COOLDOWN_MS;
  console.error(`[storage] R2 ${op} failed (${info.name}${info.code && info.code !== info.name ? ` ${info.code}` : ""}${info.status ? ` HTTP ${info.status}` : ""}): ${info.message}. ${supabaseReady() ? "Using Supabase Storage for the next minute." : "No Supabase fallback configured."}`);
}
/** Whether an R2 error can fall back (Supabase is configured); otherwise it is rethrown. */
const canFallBack = () => supabaseReady();

/** R2 settings when configured and not cooling down after a failure (never with the local test driver). */
const r2 = (): R2Config | null => {
  if (local()) return null;
  const cfg = r2Config();
  if (!cfg) return null;
  return Date.now() < r2DownUntil && canFallBack() ? null : cfg;
};

/** Which backend serves storage right now (health checks, logs). */
export const storageDriver = (): "local" | "r2" | "supabase" => (local() ? "local" : r2() ? "r2" : "supabase");

// a positive R2 existence answer is remembered briefly, so a page signing 15 takes doesn't HEAD each one every time
const inR2 = new Map<string, number>();
/** Whether R2 has the object; an R2 failure counts as "no" (so the caller uses Supabase) when Supabase is there. */
async function r2Has(cfg: R2Config, key: string): Promise<boolean> {
  const seen = inR2.get(key);
  if (seen && seen > Date.now()) return true;
  try {
    const ok = Boolean(await r2Head(cfg, key));
    if (ok) inR2.set(key, Date.now() + 5 * 60_000);
    return ok;
  } catch (e) {
    if (isR2NotFound(e) || !canFallBack()) throw e;
    r2Failed("head", e, cfg);
    return false;
  }
}

// before handing out a presigned PUT (signed offline, so it can't fail by itself) the bucket is probed, at most once
// a minute, so a browser never gets an upload URL that R2 would refuse
let reachable: { ok: boolean; until: number } | null = null;
async function r2Reachable(cfg: R2Config): Promise<boolean> {
  if (reachable && reachable.until > Date.now()) return reachable.ok;
  const p = await r2Probe(cfg);
  if (!p.ok) r2Failed("probe", Object.assign(new Error(p.error.message), { name: p.error.name, Code: p.error.code, $metadata: { httpStatusCode: p.error.status } }), cfg);
  reachable = { ok: p.ok, until: Date.now() + R2_COOLDOWN_MS };
  return p.ok;
}

/** The live R2 check for /api/health?storage=1: configured or not, reachable or the sanitized error, and the last failure. */
export async function r2Health() {
  if (local()) return { configured: false, driver: "local" as const };
  const cfg = r2Config();
  if (!cfg) return { configured: false, driver: storageDriver() };
  const probe = await r2Probe(cfg);
  return {
    configured: true,
    driver: storageDriver(),
    endpointHost: new URL(cfg.endpoint).host.replace(cfg.accountId, "<account-id>"),
    bucket: cfg.bucket,
    ok: probe.ok,
    ms: probe.ms,
    ...(probe.ok ? {} : { error: probe.error }),
    lastError: r2LastError,
    coolingDown: Date.now() < r2DownUntil,
  };
}

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
  const cfg = r2();
  if (cfg) {
    try {
      await r2Put(cfg, r2Key(BUCKET, objectPath), new Uint8Array(data), baseMime(contentType));
      inR2.set(r2Key(BUCKET, objectPath), Date.now() + 5 * 60_000);
      return;
    } catch (e) {
      if (!canFallBack()) throw e;
      r2Failed("put", e, cfg);
    }
  }
  const { url, headers } = supabase();
  const res = await fetch(`${url}/storage/v1/object/${BUCKET}/${objectPath}`, {
    method: "POST",
    headers: { ...headers, "Content-Type": baseMime(contentType), "x-upsert": "true", "cache-control": "max-age=3600" },
    body: data,
  });
  if (!res.ok) throw new Error(`Upload failed (${res.status}): ${(await res.text()).slice(0, 200)}`);
}

/**
 * A playback / download URL valid for `seconds` (R2: a presigned GET; an object not in R2 yet: Supabase's signed URL).
 * `download` makes the browser save it under that file name (R2: signed into the URL; Supabase: its &download= flag).
 * Never append query parameters to an R2 URL afterwards: that breaks its signature.
 */
export async function signedUrl(objectPath: string, seconds = 3600, opts: { download?: string } = {}): Promise<string> {
  if (local()) {
    const exp = Math.floor(Date.now() / 1000) + seconds;
    return `/api/media/${objectPath}?exp=${exp}&sig=${localSig(objectPath, exp)}`;
  }
  const cfg = r2();
  if (cfg) {
    const key = r2Key(BUCKET, objectPath);
    if (!supabaseReady() || (await r2Has(cfg, key))) return presignGet(cfg, key, seconds, opts);
  }
  const u = await supabaseSignedUrl(objectPath, seconds);
  return opts.download ? `${u}&download=${encodeURIComponent(opts.download)}` : u;
}

async function supabaseSignedUrl(objectPath: string, seconds: number): Promise<string> {
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
  const cfg = r2();
  if (cfg) {
    try {
      const got = await r2Get(cfg, r2Key(bucket, objectPath));
      if (got || !supabaseReady()) return got;
    } catch (e) {
      if (!canFallBack()) throw e;
      r2Failed("get", e, cfg);
    }
  }
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
  const cfg = r2();
  // R2: a presigned PUT (it replaces an existing object, so `upsert` needs nothing more)
  if (cfg && (!canFallBack() || (await r2Reachable(cfg)))) return presignPut(cfg, r2Key(bucket, objectPath), PRESIGN.upload);
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
  const cfg = r2();
  if (cfg) {
    try {
      const h = await r2Head(cfg, r2Key(BUCKET, objectPath));
      if (h || !supabaseReady()) return h ? h.size : null;
    } catch (e) {
      if (!canFallBack()) throw e;
      r2Failed("head", e, cfg);
    }
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
  if (r2()) return (await listObjectInfo(clean, bucket)).map((o) => o.name);
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
  const cfg = r2();
  if (cfg) {
    // R2's files plus older ones still only in Supabase (R2 wins on a name in both)
    try {
      const [fromR2, older] = await Promise.all([r2List(cfg, r2Key(bucket, clean)), supabaseReady() ? supabaseListInfo(clean, bucket).catch(() => []) : []]);
      const names = new Set(fromR2.map((o) => o.name));
      return [...fromR2, ...older.filter((o) => !names.has(o.name))].sort((a, b) => a.name.localeCompare(b.name));
    } catch (e) {
      if (!canFallBack()) throw e;
      r2Failed("list", e, cfg);
    }
  }
  return supabaseListInfo(clean, bucket);
}

async function supabaseListInfo(clean: string, bucket: string): Promise<{ name: string; updatedAt: number | null; size?: number | null }[]> {
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
  const cfg = r2();
  if (cfg) {
    const keys = paths.map((p) => r2Key(bucket, p));
    for (const k of keys) inR2.delete(k);
    try {
      await r2Delete(cfg, keys);
    } catch (e) {
      if (!canFallBack()) throw e;
      r2Failed("delete", e, cfg); // the Supabase copies are still removed below
    }
    // the older copy too, so the Supabase fallback can't serve a deleted file again
    if (!supabaseReady()) return;
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
  if (local() || r2()) return; // R2: one bucket, no per-bucket limits; uploads are size / type checked by the app
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
  if (local() || r2()) return;
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
 * Permanent HTTPS URL of an object in a public bucket (studio-assets, custom-assets). Local driver: an /api/media URL
 * signed for 10 years. R2: the app's /api/storage/<bucket>/<path>, which redirects every request to a fresh presigned
 * R2 URL (or to the Supabase public URL for an older object not copied yet), so the URL itself never expires and the
 * bucket stays private. Pass `origin` to make it absolute, as the renderer needs (else the production URL on Vercel).
 */
export function publicObjectUrl(objectPath: string, bucket: string, origin?: string) {
  if (local()) {
    const p = `${bucket}/${objectPath}`;
    const exp = Math.floor(Date.now() / 1000) + 10 * 365 * 86400;
    const u = `/api/media/${p}?exp=${exp}&sig=${localSig(p, exp)}`;
    return origin ? new URL(u, origin).toString() : u;
  }
  if (r2()) {
    const u = `/api/storage/${bucket}/${objectPath.split("/").map(encodeURIComponent).join("/")}`;
    const host = origin ?? (process.env.VERCEL_PROJECT_PRODUCTION_URL ? `https://${process.env.VERCEL_PROJECT_PRODUCTION_URL}` : null);
    return host ? new URL(u, host).toString() : u;
  }
  return supabasePublicUrl(objectPath, bucket);
}

/** The Supabase Storage public URL of an object (the fallback for older assets not copied to R2). */
export function supabasePublicUrl(objectPath: string, bucket: string) {
  return `${process.env.SUPABASE_URL!.trim().replace(/\/$/, "")}/storage/v1/object/public/${bucket}/${objectPath}`;
}

/** Public buckets the /api/storage redirect serves (never the private recordings). */
export const PUBLIC_AREAS = ["studio-assets", "custom-assets"] as const;

/**
 * Where /api/storage/<bucket>/<path> sends the browser / renderer: a fresh presigned R2 URL, or the Supabase public
 * URL when the object isn't in R2 yet. Null for a private bucket or a bad path.
 */
export async function publicRedirect(bucket: string, objectPath: string): Promise<string | null> {
  if (!(PUBLIC_AREAS as readonly string[]).includes(bucket)) return null;
  let key: string;
  try {
    key = r2Key(bucket, objectPath);
  } catch {
    return null;
  }
  const cfg = r2();
  if (!cfg) return supabaseReady() ? supabasePublicUrl(objectPath, bucket) : null;
  if (!supabaseReady() || (await r2Has(cfg, key))) return presignGet(cfg, key, PRESIGN.asset);
  return supabasePublicUrl(objectPath, bucket);
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
