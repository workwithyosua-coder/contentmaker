// YouTube Shorts upload (Data API v3, resumable), hardened against transient network failures. Pure enough to test:
// fetch and sleep are passed in. No server-only imports.
//
//   1st call: opens the resumable session and saves its URL in `step` (nothing is uploaded yet)
//   next call: asks the session first: already complete → published with that video (never uploaded twice);
//              incomplete → uploads the file; expired → opens a new session
// Network errors are retried up to 3 times with backoff, and reported with their real cause (`ECONNRESET`, …)
// instead of a bare "fetch failed".

export type UploadStep = { uploadUrl?: string; videoId?: string; note?: string };
export type UploadAdvance =
  | { status: "uploading"; step: UploadStep; retryInSec: number; note?: string }
  | { status: "published"; step: UploadStep; externalId: string; externalUrl: string }
  | { status: "failed"; step: UploadStep; error: string };

type Fetch = (url: string, init?: RequestInit) => Promise<Response>;

const TRANSIENT = /^(ECONNRESET|ECONNREFUSED|ETIMEDOUT|EPIPE|ENOTFOUND|EAI_AGAIN|ENETUNREACH|EHOSTUNREACH|UND_ERR_[A-Z_]+)$/;

/** "fetch failed (ECONNRESET: socket hang up)" instead of "fetch failed": the cause node's fetch hides. */
export function describeFetchError(err: unknown): string {
  if (!(err instanceof Error)) return String(err);
  const cause = (err as Error & { cause?: { code?: string; message?: string; errno?: string } }).cause;
  const code = cause?.code ?? cause?.errno;
  const detail = [code, cause?.message && cause.message !== code ? cause.message : null].filter(Boolean).join(": ");
  return detail ? `${err.message} (${detail})` : err.message;
}

/** A network-level failure worth retrying (not an HTTP answer, which the API meant). */
export function isTransient(err: unknown): boolean {
  if (!(err instanceof Error)) return false;
  const code = (err as Error & { cause?: { code?: string } }).cause?.code ?? (err as Error & { code?: string }).code ?? "";
  return /fetch failed|network|socket hang up|timed? ?out/i.test(err.message) || TRANSIENT.test(code) || err.name === "TimeoutError";
}

/** fetch with up to `tries` attempts on network errors and 502 / 503 / 504, with exponential backoff. */
export async function fetchRetry(url: string, init: RequestInit, o: { tries?: number; baseMs?: number; fetchImpl?: Fetch; sleep?: (ms: number) => Promise<void> } = {}): Promise<Response> {
  const tries = o.tries ?? 3;
  const f = o.fetchImpl ?? (fetch as Fetch);
  const sleep = o.sleep ?? ((ms: number) => new Promise((r) => setTimeout(r, ms)));
  let last: unknown;
  for (let i = 1; i <= tries; i++) {
    try {
      const res = await f(url, init);
      if (![502, 503, 504].includes(res.status) || i === tries) return res;
      last = new Error(`HTTP ${res.status}`);
    } catch (e) {
      last = e;
      if (!isTransient(e) || i === tries) throw e;
    }
    await sleep((o.baseMs ?? 1000) * 2 ** (i - 1));
  }
  throw last;
}

export type UploadMeta = { title: string; description: string; tags: string[]; privacy: string };
const UPLOAD = "https://www.googleapis.com/upload/youtube/v3/videos?uploadType=resumable&part=snippet,status";

/** One step of the upload (see the top). Never throws: every failure is a `failed` with the real reason. */
export async function youtubeUpload(p: { token: string; bytes: Uint8Array; meta: UploadMeta; step: UploadStep; fetchImpl?: Fetch; sleep?: (ms: number) => Promise<void> }): Promise<UploadAdvance> {
  const opts = { fetchImpl: p.fetchImpl, sleep: p.sleep };
  const auth = { Authorization: `Bearer ${p.token}` };
  const published = (json: { id?: string; status?: { privacyStatus?: string } }, step: UploadStep): UploadAdvance => {
    const note = json.status?.privacyStatus && json.status.privacyStatus !== p.meta.privacy ? ` (YouTube set it to ${json.status.privacyStatus})` : "";
    return { status: "published", step: { ...step, videoId: json.id, note }, externalId: json.id!, externalUrl: `https://www.youtube.com/shorts/${json.id}` };
  };
  /** Asks a session whether the upload finished: the video, "incomplete", or "gone" (expired / unknown). */
  const sessionState = async (url: string): Promise<{ id?: string; status?: { privacyStatus?: string } } | "incomplete" | "gone"> => {
    const r = await fetchRetry(url, { method: "PUT", headers: { ...auth, "Content-Range": `bytes */${p.bytes.byteLength}`, "Content-Length": "0" } }, opts);
    if (r.status === 200 || r.status === 201) return (await r.json().catch(() => ({}))) as { id?: string };
    if (r.status === 308) return "incomplete";
    return "gone";
  };
  try {
    if (!p.step.uploadUrl) {
      const start = await fetchRetry(
        UPLOAD,
        {
          method: "POST",
          headers: { ...auth, "Content-Type": "application/json; charset=UTF-8", "X-Upload-Content-Type": "video/mp4", "X-Upload-Content-Length": String(p.bytes.byteLength) },
          body: JSON.stringify({
            snippet: { title: p.meta.title, description: p.meta.description, tags: p.meta.tags, categoryId: "23", defaultLanguage: "id" },
            status: { privacyStatus: p.meta.privacy, selfDeclaredMadeForKids: false },
          }),
        },
        opts,
      );
      const location = start.headers.get("location");
      if (!start.ok || !location) return { status: "failed", step: {}, error: `YouTube refused the upload (${start.status}): ${(await start.text().catch(() => "")).slice(0, 300)}` };
      // saved before any byte goes up: a crash or retry resumes this session instead of posting a second video
      return { status: "uploading", step: { uploadUrl: location }, retryInSec: 1 };
    }
    const state = await sessionState(p.step.uploadUrl);
    if (typeof state === "object" && state.id) return published(state, p.step); // finished earlier: never upload twice
    if (state === "gone") return { status: "uploading", step: {}, retryInSec: 1, note: "The YouTube upload session expired; starting a new one." };
    try {
      const put = await fetchRetry(p.step.uploadUrl, { method: "PUT", headers: { ...auth, "Content-Type": "video/mp4" }, body: p.bytes as BodyInit }, opts);
      const json = (await put.json().catch(() => ({}))) as { id?: string; status?: { privacyStatus?: string }; error?: { message?: string } };
      if (put.ok && json.id) return published(json, p.step);
      return { status: "failed", step: p.step, error: `YouTube upload failed: ${json.error?.message ?? put.status}` };
    } catch (e) {
      // the bytes may have arrived even though the answer didn't: ask once more before calling it failed
      const again = await sessionState(p.step.uploadUrl).catch(() => "gone" as const);
      if (typeof again === "object" && again.id) return published(again, p.step);
      return { status: "failed", step: p.step, error: `YouTube upload: ${describeFetchError(e)}` };
    }
  } catch (e) {
    return { status: "failed", step: p.step, error: `YouTube: ${describeFetchError(e)}` };
  }
}
