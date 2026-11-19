import "server-only";
import { decrypt } from "../crypto";
import { db } from "../db";
import { GRAPH_VERSION, graph, graphPost, isMetaRateLimit } from "../platforms/meta";
import { getObject, signedUrl } from "../storage";
import { accessTokenFor as tiktokToken } from "../sync/tiktok";
import { accessTokenFor as youtubeToken } from "../sync/youtube";
import type { PublishPlatform } from "./captions";

// One adapter per platform. Each is a small step machine: advance() does the next piece of work and says what comes
// next, so slow platform processing is polled by the worker instead of blocking a request. Progress is saved in `step`
// after every call, so a crash never repeats a finished step (and never posts twice).

export type PlatformSettings = {
  enabled?: boolean;
  title?: string;
  text?: string;
  privacy?: string; // youtube: public | unlisted | private; tiktok: PUBLIC_TO_EVERYONE | MUTUAL_FOLLOW_FRIENDS | FOLLOWER_OF_CREATOR | SELF_ONLY
  allowComments?: boolean;
  allowDuet?: boolean;
  allowStitch?: boolean;
  shareToFeed?: boolean;
  coverSecond?: number;
  // TikTok commercial content disclosure
  discloseContent?: boolean;
  brandOrganic?: boolean; // "Your brand": promotional content
  brandContent?: boolean; // "Branded content": paid partnership
};

export type PublicationRow = {
  id: string;
  platform: PublishPlatform;
  social_account_id: string;
  caption: { title?: string; text: string; tags?: string[] };
  settings: PlatformSettings;
  step: Record<string, unknown>;
  attempts: number;
  video: { storage_path: string; size_bytes: number | null };
};

export type Advance =
  | { status: "uploading" | "processing"; step: Record<string, unknown>; retryInSec: number; note?: string }
  | { status: "published"; step: Record<string, unknown>; externalId: string; externalUrl: string }
  | { status: "failed"; step: Record<string, unknown>; error: string };

async function account(id: string) {
  const [a] = await db()<{ external_account_id: string; handle: string; access_token_enc: Buffer }[]>`
    SELECT external_account_id, handle, access_token_enc FROM social_accounts WHERE id = ${id}`;
  if (!a) throw new Error("The connected account was removed. Reconnect it on the Accounts page.");
  return a;
}

async function videoBytes(path: string) {
  const bytes = await getObject(path);
  if (!bytes) throw new Error("The rendered video file is missing from storage. Render it again.");
  return bytes;
}

// ------------------------------------------------------------------ YouTube Shorts (Data API v3, resumable upload)
async function youtube(p: PublicationRow): Promise<Advance> {
  const token = await youtubeToken(p.social_account_id);
  const bytes = await videoBytes(p.video.storage_path);
  const start = await fetch("https://www.googleapis.com/upload/youtube/v3/videos?uploadType=resumable&part=snippet,status", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json; charset=UTF-8",
      "X-Upload-Content-Type": "video/mp4",
      "X-Upload-Content-Length": String(bytes.byteLength),
    },
    body: JSON.stringify({
      snippet: { title: p.caption.title ?? "Uco & Ocu #Shorts", description: p.caption.text, tags: p.caption.tags ?? [], categoryId: "23", defaultLanguage: "id" },
      status: { privacyStatus: p.settings.privacy ?? "public", selfDeclaredMadeForKids: false },
    }),
  });
  const location = start.headers.get("location");
  if (!start.ok || !location) return { status: "failed", step: {}, error: `YouTube refused the upload (${start.status}): ${(await start.text()).slice(0, 300)}` };
  const put = await fetch(location, { method: "PUT", headers: { Authorization: `Bearer ${token}`, "Content-Type": "video/mp4" }, body: new Uint8Array(bytes) });
  const json = (await put.json()) as { id?: string; status?: { privacyStatus?: string }; error?: { message?: string } };
  if (!put.ok || !json.id) return { status: "failed", step: {}, error: `YouTube upload failed: ${json.error?.message ?? put.status}` };
  const note = json.status?.privacyStatus && json.status.privacyStatus !== (p.settings.privacy ?? "public") ? ` (YouTube set it to ${json.status.privacyStatus})` : "";
  return { status: "published", step: { videoId: json.id, note }, externalId: json.id, externalUrl: `https://www.youtube.com/shorts/${json.id}` };
}

// ------------------------------------------------------------------ TikTok (Content Posting API v2, Direct Post, FILE_UPLOAD)
// TIKTOK_API_BASE only for local tests with a fake TikTok server.
const TT = `${process.env.TIKTOK_API_BASE?.trim() || "https://open.tiktokapis.com"}/v2/post/publish`;
async function tt<T>(path: string, token: string, body: unknown): Promise<T> {
  const res = await fetch(`${TT}${path}`, {
    method: "POST",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json; charset=UTF-8" },
    body: JSON.stringify(body),
  });
  const json = (await res.json()) as { data?: T; error?: { code?: string; message?: string } };
  if (!res.ok || (json.error?.code && json.error.code !== "ok")) {
    const code = json.error?.code ?? res.status;
    const hint =
      code === "scope_not_authorized"
        ? " Reconnect TikTok for publishing (Accounts or the publish panel)."
        : code === "unaudited_client_can_only_post_to_private_accounts"
          ? " TikTok only lets unaudited apps post to private accounts: set the TikTok account to private, or get the app audited."
          : "";
    throw new Error(`TikTok: ${json.error?.message || code}.${hint}`);
  }
  return json.data as T;
}

export type TikTokCreatorInfo = {
  creator_avatar_url?: string;
  creator_username?: string;
  creator_nickname?: string;
  privacy_level_options: string[];
  comment_disabled: boolean;
  duet_disabled: boolean;
  stitch_disabled: boolean;
  max_video_post_duration_sec: number;
};

function tiktokCreatorInfoWith(token: string) {
  return tt<TikTokCreatorInfo>("/creator_info/query/", token, {});
}

/** Live account info for the posting screen (TikTok requires showing it, and its privacy options, before each post). */
export async function tiktokCreatorInfo(accountId: string) {
  return tiktokCreatorInfoWith(await tiktokToken(accountId));
}

async function tiktok(p: PublicationRow): Promise<Advance> {
  const token = await tiktokToken(p.social_account_id);
  if (!p.step.publishId) {
    const info = await tiktokCreatorInfoWith(token);
    // The creator chose this in the panel from TikTok's own options; never substitute another level.
    const privacy = p.settings.privacy;
    if (!privacy) return { status: "failed", step: {}, error: "Choose who can watch on TikTok, then post again." };
    if (!info.privacy_level_options.includes(privacy)) {
      return { status: "failed", step: {}, error: `TikTok no longer allows "${privacy}" for this account. Choose again from the list, then retry.` };
    }
    if (p.settings.brandContent && privacy === "SELF_ONLY") return { status: "failed", step: {}, error: "Branded content can't be posted as Only me." };
    const bytes = await videoBytes(p.video.storage_path);
    const size = bytes.byteLength;
    // chunks: 5–64 MB each; under 5 MB the whole file is one chunk; the remainder joins the last chunk
    const chunk = size < 5 * 1024 * 1024 ? size : Math.min(size, 10 * 1024 * 1024);
    const count = Math.max(1, Math.floor(size / chunk));
    const init = await tt<{ publish_id: string; upload_url: string }>("/video/init/", token, {
      post_info: {
        title: p.caption.text.slice(0, 2200),
        privacy_level: privacy,
        // interactions are off unless the creator switched them on (and TikTok allows them)
        disable_comment: p.settings.allowComments !== true || info.comment_disabled,
        disable_duet: p.settings.allowDuet !== true || info.duet_disabled,
        disable_stitch: p.settings.allowStitch !== true || info.stitch_disabled,
        brand_content_toggle: Boolean(p.settings.discloseContent && p.settings.brandContent),
        brand_organic_toggle: Boolean(p.settings.discloseContent && p.settings.brandOrganic),
        video_cover_timestamp_ms: Math.round((p.settings.coverSecond ?? 1) * 1000),
      },
      source_info: { source: "FILE_UPLOAD", video_size: size, chunk_size: chunk, total_chunk_count: count },
    });
    for (let i = 0; i < count; i++) {
      const from = i * chunk;
      const to = i === count - 1 ? size : from + chunk;
      const res = await fetch(init.upload_url, {
        method: "PUT",
        headers: { "Content-Type": "video/mp4", "Content-Range": `bytes ${from}-${to - 1}/${size}` },
        body: new Uint8Array(bytes.slice(from, to)),
      });
      if (!res.ok) return { status: "failed", step: {}, error: `TikTok upload failed on part ${i + 1}/${count} (${res.status}).` };
    }
    return { status: "processing", step: { publishId: init.publish_id, privacy }, retryInSec: 15, note: "It can take a few minutes before the video shows on your TikTok profile." };
  }
  const s = await tt<{ status: string; fail_reason?: string; publicaly_available_post_id?: (string | number)[] }>("/status/fetch/", token, { publish_id: p.step.publishId });
  if (s.status === "PUBLISH_COMPLETE") {
    const a = await account(p.social_account_id);
    const id = s.publicaly_available_post_id?.[0];
    return {
      status: "published",
      step: p.step,
      externalId: String(id ?? p.step.publishId),
      externalUrl: id ? `https://www.tiktok.com/@${a.handle.replace(/^@/, "")}/video/${id}` : `https://www.tiktok.com/@${a.handle.replace(/^@/, "")}`,
    };
  }
  if (s.status === "FAILED") return { status: "failed", step: {}, error: `TikTok couldn't publish it: ${s.fail_reason ?? "unknown reason"}.` };
  return { status: "processing", step: p.step, retryInSec: 20 };
}

// ------------------------------------------------------------------ Instagram Reels (Graph API: container → poll → publish)
async function instagram(p: PublicationRow): Promise<Advance> {
  const a = await account(p.social_account_id);
  const token = decrypt(a.access_token_enc);
  if (!p.step.container) {
    const url = await signedUrl(p.video.storage_path, 2 * 3600); // Instagram downloads the file from this URL
    const c = await graphPost<{ id: string }>(`/${a.external_account_id}/media`, token, {
      media_type: "REELS",
      video_url: url,
      caption: p.caption.text.slice(0, 2200),
      share_to_feed: String(p.settings.shareToFeed !== false),
      thumb_offset: String(Math.round((p.settings.coverSecond ?? 1) * 1000)),
    });
    return { status: "processing", step: { container: c.id }, retryInSec: 20 };
  }
  if (!p.step.mediaId) {
    const st = await graph<{ status_code?: string; status?: string }>(`/${p.step.container}`, token, { fields: "status_code,status" });
    if (st.status_code === "ERROR" || st.status_code === "EXPIRED") return { status: "failed", step: {}, error: `Instagram couldn't process the video (${st.status ?? st.status_code}).` };
    if (st.status_code !== "FINISHED") return { status: "processing", step: p.step, retryInSec: 20 };
    const pub = await graphPost<{ id: string }>(`/${a.external_account_id}/media_publish`, token, { creation_id: String(p.step.container) });
    p.step = { ...p.step, mediaId: pub.id };
    await db()`UPDATE episode_publications SET step = ${db().json(p.step as never)} WHERE id = ${p.id}`; // never publish twice
  }
  const m = await graph<{ permalink?: string }>(`/${p.step.mediaId}`, token, { fields: "permalink" }).catch(() => ({ permalink: undefined }));
  return { status: "published", step: p.step, externalId: String(p.step.mediaId), externalUrl: m.permalink ?? `https://www.instagram.com/${a.handle.replace(/^@/, "")}/` };
}

// ------------------------------------------------------------------ Facebook Page Reels (start → hosted upload → finish → poll)
async function facebook(p: PublicationRow): Promise<Advance> {
  const a = await account(p.social_account_id);
  const token = decrypt(a.access_token_enc);
  const page = a.external_account_id;
  if (!p.step.videoId) {
    const start = await graphPost<{ video_id: string; upload_url?: string }>(`/${page}/video_reels`, token, { upload_phase: "start" });
    const url = await signedUrl(p.video.storage_path, 2 * 3600);
    const up = await fetch(start.upload_url ?? `https://rupload.facebook.com/video-upload/${GRAPH_VERSION}/${start.video_id}`, {
      method: "POST",
      headers: { Authorization: `OAuth ${token}`, file_url: url },
    });
    const upJson = (await up.json().catch(() => ({}))) as { success?: boolean; debug_info?: { message?: string } };
    if (!up.ok || upJson.success === false) return { status: "failed", step: {}, error: `Facebook upload failed: ${upJson.debug_info?.message ?? up.status}` };
    await graphPost(`/${page}/video_reels`, token, {
      upload_phase: "finish",
      video_id: start.video_id,
      video_state: "PUBLISHED",
      description: p.caption.text.slice(0, 5000),
      ...(p.caption.title ? { title: p.caption.title } : {}),
    });
    return { status: "processing", step: { videoId: start.video_id }, retryInSec: 20 };
  }
  const v = await graph<{ status?: { video_status?: string; publishing_phase?: { status?: string; errors?: { message?: string }[] }; processing_phase?: { status?: string } }; permalink_url?: string }>(
    `/${p.step.videoId}`,
    token,
    { fields: "status,permalink_url" },
  );
  const err = v.status?.publishing_phase?.errors?.[0]?.message;
  if (v.status?.video_status === "error" || err) return { status: "failed", step: {}, error: `Facebook couldn't publish the Reel: ${err ?? "processing error"}.` };
  if (v.status?.publishing_phase?.status === "complete" || v.status?.video_status === "ready") {
    const url = v.permalink_url ? (v.permalink_url.startsWith("http") ? v.permalink_url : `https://www.facebook.com${v.permalink_url}`) : `https://www.facebook.com/reel/${p.step.videoId}`;
    return { status: "published", step: p.step, externalId: String(p.step.videoId), externalUrl: url };
  }
  return { status: "processing", step: p.step, retryInSec: 20 };
}

/** Meta request limit: wait and continue from the same step instead of failing (the limit clears within the hour). */
function waitOnMetaLimit(run: (p: PublicationRow) => Promise<Advance>) {
  return async (p: PublicationRow): Promise<Advance> => {
    try {
      return await run(p);
    } catch (err) {
      if (!isMetaRateLimit(err)) throw err;
      return {
        status: p.step.container || p.step.videoId ? "processing" : "uploading",
        step: p.step,
        retryInSec: 600,
        note: "Meta's hourly request limit was reached. Trying again in 10 minutes; nothing to do.",
      };
    }
  };
}

export const ADAPTERS: Record<PublishPlatform, (p: PublicationRow) => Promise<Advance>> = {
  youtube,
  tiktok,
  instagram: waitOnMetaLimit(instagram),
  facebook: waitOnMetaLimit(facebook),
};
