// Cloudflare R2 (S3-compatible) for the app's media: recordings, studio assets and custom assets live in ONE private
// bucket under their old bucket names as key prefixes ("recordings/…", "studio-assets/…", "custom-assets/…"). Used by
// storage.ts whenever R2_ACCOUNT_ID, R2_ACCESS_KEY_ID, R2_SECRET_ACCESS_KEY and R2_BUCKET_NAME are all set; without
// them storage.ts keeps using Supabase Storage (and the local driver in tests). Browsers, the GitHub worker and the
// social publishers only ever get short-lived presigned URLs. No server-only import, so the mapping and the presigning
// are unit-tested.
import { DeleteObjectsCommand, GetObjectCommand, HeadObjectCommand, ListObjectsV2Command, PutObjectCommand, S3Client } from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";

export type R2Config = { accountId: string; accessKeyId: string; secretAccessKey: string; bucket: string; endpoint: string; pathStyle: boolean };

/** The R2 settings from the environment, or null unless all four are set (then Supabase Storage stays in use). */
export function r2Config(env: Record<string, string | undefined> = process.env): R2Config | null {
  const accountId = env.R2_ACCOUNT_ID?.trim();
  const accessKeyId = env.R2_ACCESS_KEY_ID?.trim();
  const secretAccessKey = env.R2_SECRET_ACCESS_KEY?.trim();
  const bucket = env.R2_BUCKET_NAME?.trim();
  if (!accountId || !accessKeyId || !secretAccessKey || !bucket) return null;
  // R2_ENDPOINT (optional) points the client at another S3 endpoint: tests use a local fake S3 server
  const override = env.R2_ENDPOINT?.trim();
  return { accountId, accessKeyId, secretAccessKey, bucket, endpoint: override || `https://${accountId}.r2.cloudflarestorage.com`, pathStyle: Boolean(override) };
}

/** The app's three storage areas; each is a key prefix in the one R2 bucket. */
export const STORAGE_AREAS = ["recordings", "studio-assets", "custom-assets"] as const;
export type StorageArea = (typeof STORAGE_AREAS)[number];

/**
 * The R2 key for an object of one of the old Supabase buckets: "<bucket>/<path>" ("recordings/<episode>/line-01.webm",
 * "studio-assets/sprites/uco-angry-closed.png", "custom-assets/props/sate.png"). Leading slashes are dropped; an
 * unknown bucket or a path that climbs out ("..") is refused.
 */
export function r2Key(bucket: string, objectPath: string): string {
  if (!(STORAGE_AREAS as readonly string[]).includes(bucket)) throw new Error(`Unknown storage bucket "${bucket}".`);
  const p = objectPath.replace(/^\/+/, "");
  if (!p || p.split("/").some((s) => s === ".." || s === ".")) throw new Error(`Bad storage path "${objectPath}".`);
  return `${bucket}/${p}`;
}

/** Back from a key to the old bucket and its path ("studio-assets/sprites/x.png" → studio-assets, sprites/x.png). */
export function fromR2Key(key: string): { bucket: StorageArea; path: string } | null {
  const i = key.indexOf("/");
  const bucket = key.slice(0, i);
  return i > 0 && (STORAGE_AREAS as readonly string[]).includes(bucket) && key.length > i + 1 ? { bucket: bucket as StorageArea, path: key.slice(i + 1) } : null;
}

/** Presigned URL lifetimes (seconds). S3 / R2 allow at most 7 days. */
export const PRESIGN = {
  /** browser playback of a take, a preview */
  playback: 3600,
  /** an uploaded file the browser / worker PUTs */
  upload: 15 * 60,
  /** public-area assets the renderer and the in-app player load (redirected to on every request) */
  asset: 6 * 3600,
  /** the GitHub worker's render downloads and the episode video on the page */
  render: 6 * 3600,
  /** Instagram / Facebook / TikTok pull the MP4 themselves and may queue it for hours */
  publish: 24 * 3600,
  max: 7 * 86400,
} as const;
export const clampExpiry = (seconds: number) => Math.max(60, Math.min(PRESIGN.max, Math.round(seconds)));

const clients = new Map<string, S3Client>();
/** One S3 client per account / key pair (region "auto", the account's R2 endpoint). */
export function r2Client(cfg: R2Config): S3Client {
  const id = `${cfg.endpoint}|${cfg.accessKeyId}`;
  let c = clients.get(id);
  if (!c) {
    c = new S3Client({
      region: "auto",
      endpoint: cfg.endpoint,
      forcePathStyle: cfg.pathStyle,
      credentials: { accessKeyId: cfg.accessKeyId, secretAccessKey: cfg.secretAccessKey },
      // no SDK-added checksums: by default a presigned PUT would carry the CRC32 of an EMPTY body
      // (x-amz-checksum-crc32=AAAAAA==), so every real browser / worker upload to it would be rejected
      requestChecksumCalculation: "WHEN_REQUIRED",
      responseChecksumValidation: "WHEN_REQUIRED",
    });
    clients.set(id, c);
  }
  return c;
}

/** A presigned GET URL for a key (playback, downloads, the worker, the publishers). */
export function presignGet(cfg: R2Config, key: string, seconds: number = PRESIGN.playback, opts: { download?: string } = {}): Promise<string> {
  return getSignedUrl(
    r2Client(cfg),
    new GetObjectCommand({ Bucket: cfg.bucket, Key: key, ...(opts.download ? { ResponseContentDisposition: `attachment; filename="${opts.download.replace(/["\\\r\n]/g, "")}"` } : {}) }),
    { expiresIn: clampExpiry(seconds) },
  );
}

/** A presigned PUT URL the browser or the worker uploads one file to (any Content-Type; an existing key is replaced). */
export function presignPut(cfg: R2Config, key: string, seconds: number = PRESIGN.upload): Promise<string> {
  return getSignedUrl(r2Client(cfg), new PutObjectCommand({ Bucket: cfg.bucket, Key: key }), { expiresIn: clampExpiry(seconds) });
}

const notFound = (e: unknown) => {
  const x = e as { name?: string; $metadata?: { httpStatusCode?: number } } | null;
  return x?.name === "NotFound" || x?.name === "NoSuchKey" || x?.$metadata?.httpStatusCode === 404;
};

/** The object's size, or null when it isn't in R2. */
export async function r2Head(cfg: R2Config, key: string): Promise<{ size: number; contentType: string | null } | null> {
  try {
    const h = await r2Client(cfg).send(new HeadObjectCommand({ Bucket: cfg.bucket, Key: key }));
    return { size: Number(h.ContentLength ?? 0), contentType: h.ContentType ?? null };
  } catch (e) {
    if (notFound(e)) return null;
    throw e;
  }
}

export async function r2Put(cfg: R2Config, key: string, body: Uint8Array, contentType: string, cacheControl = "max-age=3600"): Promise<void> {
  await r2Client(cfg).send(new PutObjectCommand({ Bucket: cfg.bucket, Key: key, Body: body, ContentType: contentType, CacheControl: cacheControl }));
}

/** The object's bytes, or null when it isn't in R2. */
export async function r2Get(cfg: R2Config, key: string): Promise<ArrayBuffer | null> {
  try {
    const r = await r2Client(cfg).send(new GetObjectCommand({ Bucket: cfg.bucket, Key: key }));
    const bytes = await r.Body!.transformToByteArray();
    return bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer;
  } catch (e) {
    if (notFound(e)) return null;
    throw e;
  }
}

/** Files directly under a key prefix ("custom-assets/props"), with size and last-modified time. */
export async function r2List(cfg: R2Config, prefix: string): Promise<{ name: string; updatedAt: number | null; size: number | null }[]> {
  const p = prefix.replace(/\/+$/, "") + "/";
  const out: { name: string; updatedAt: number | null; size: number | null }[] = [];
  let token: string | undefined;
  do {
    const r = await r2Client(cfg).send(new ListObjectsV2Command({ Bucket: cfg.bucket, Prefix: p, Delimiter: "/", ContinuationToken: token }));
    for (const o of r.Contents ?? []) {
      const name = (o.Key ?? "").slice(p.length);
      if (name && !name.startsWith(".")) out.push({ name, updatedAt: o.LastModified ? o.LastModified.getTime() : null, size: o.Size ?? null });
    }
    token = r.IsTruncated ? r.NextContinuationToken : undefined;
  } while (token);
  return out.sort((a, b) => a.name.localeCompare(b.name));
}

export async function r2Delete(cfg: R2Config, keys: string[]): Promise<void> {
  for (let i = 0; i < keys.length; i += 1000) {
    await r2Client(cfg).send(new DeleteObjectsCommand({ Bucket: cfg.bucket, Delete: { Objects: keys.slice(i, i + 1000).map((Key) => ({ Key })), Quiet: true } }));
  }
}

/** An R2 error as name / code / HTTP status / message, with every credential and the account id scrubbed out. */
export type R2ErrorInfo = { name: string; code: string | null; status: number | null; message: string };
export function r2ErrorInfo(e: unknown, cfg?: R2Config | null): R2ErrorInfo {
  const x = (e ?? {}) as { name?: string; Code?: string; code?: string; message?: string; $metadata?: { httpStatusCode?: number } };
  let message = String(x.message ?? e ?? "unknown error");
  for (const [secret, label] of [
    [cfg?.secretAccessKey, "<secret>"],
    [cfg?.accessKeyId, "<access-key-id>"],
    [cfg?.accountId, "<account-id>"],
  ] as const) {
    if (secret) message = message.split(secret).join(label);
  }
  // anything else that looks like a key or a signature (long base64 / hex runs)
  message = message.replace(/[A-Za-z0-9+/=_-]{32,}/g, "<redacted>").replace(/\s+/g, " ").trim().slice(0, 300);
  return { name: String(x.name ?? "Error").slice(0, 60), code: (x.Code ?? x.code ?? null) ? String(x.Code ?? x.code).slice(0, 60) : null, status: x.$metadata?.httpStatusCode ?? null, message };
}

/** "Not found" (a missing object): an answer, not a failure. Anything else means R2 itself isn't usable. */
export const isR2NotFound = (e: unknown) => {
  const x = e as { name?: string; $metadata?: { httpStatusCode?: number } } | null;
  return x?.name === "NotFound" || x?.name === "NoSuchKey" || x?.$metadata?.httpStatusCode === 404;
};

/**
 * A live R2 check for /api/health: list one key of the bucket (an answer with an XML error code, unlike HEAD), so a
 * bad key pair, a wrong bucket name or a wrong endpoint (e.g. an EU-jurisdiction bucket) shows its real error. The
 * endpoint's host and the bucket name are not secret; the keys never appear.
 */
export async function r2Probe(cfg: R2Config): Promise<{ ok: true; ms: number } | { ok: false; ms: number; error: R2ErrorInfo }> {
  const t = Date.now();
  try {
    await r2Client(cfg).send(new ListObjectsV2Command({ Bucket: cfg.bucket, MaxKeys: 1, Prefix: "recordings/_healthcheck/" }));
    return { ok: true, ms: Date.now() - t };
  } catch (e) {
    return { ok: false, ms: Date.now() - t, error: r2ErrorInfo(e, cfg) };
  }
}
