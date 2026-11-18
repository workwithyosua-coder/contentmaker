import "server-only";

// TikTok Login Kit (web) + Display API, v2. Docs: developers.tiktok.com/doc/login-kit-web
export const TIKTOK_SCOPES = ["user.info.basic", "user.info.stats", "video.list"];
/** Added only by "Reconnect for publishing": TikTok rejects the whole login if the app hasn't enabled Content Posting yet. */
export const TIKTOK_PUBLISH_SCOPE = "video.publish";
const API = "https://open.tiktokapis.com/v2";

export function tiktokConfigured() {
  return Boolean(process.env.TIKTOK_CLIENT_KEY && process.env.TIKTOK_CLIENT_SECRET);
}

function creds() {
  const clientKey = process.env.TIKTOK_CLIENT_KEY?.trim();
  const clientSecret = process.env.TIKTOK_CLIENT_SECRET?.trim();
  if (!clientKey || !clientSecret) throw new Error("TIKTOK_CLIENT_KEY / TIKTOK_CLIENT_SECRET are not set in Vercel.");
  return { clientKey, clientSecret };
}

export function tiktokRedirectUri(origin: string) {
  return `${origin}/api/connect/tiktok/callback`;
}

export function tiktokAuthorizeUrl(origin: string, state: string, publish = false) {
  const u = new URL("https://www.tiktok.com/v2/auth/authorize/");
  u.searchParams.set("client_key", creds().clientKey);
  u.searchParams.set("scope", [...TIKTOK_SCOPES, ...(publish ? [TIKTOK_PUBLISH_SCOPE] : [])].join(","));
  u.searchParams.set("response_type", "code");
  u.searchParams.set("redirect_uri", tiktokRedirectUri(origin));
  u.searchParams.set("state", state);
  return u.toString();
}

export type TikTokToken = {
  access_token: string;
  expires_in: number;
  refresh_token: string;
  refresh_expires_in: number;
  open_id: string;
  scope: string;
};

async function tokenRequest(body: Record<string, string>): Promise<TikTokToken> {
  const res = await fetch(`${API}/oauth/token/`, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded", "Cache-Control": "no-cache" },
    body: new URLSearchParams(body),
  });
  const json = (await res.json()) as Partial<TikTokToken> & { error?: string; error_description?: string };
  if (!res.ok || json.error || !json.access_token) {
    throw new Error(`TikTok token error: ${json.error_description || json.error || res.status}`);
  }
  return json as TikTokToken;
}

export function exchangeTikTokCode(code: string, origin: string) {
  const { clientKey, clientSecret } = creds();
  return tokenRequest({
    client_key: clientKey,
    client_secret: clientSecret,
    code,
    grant_type: "authorization_code",
    redirect_uri: tiktokRedirectUri(origin),
  });
}

export function refreshTikTokToken(refreshToken: string) {
  const { clientKey, clientSecret } = creds();
  return tokenRequest({
    client_key: clientKey,
    client_secret: clientSecret,
    grant_type: "refresh_token",
    refresh_token: refreshToken,
  });
}

type ApiError = { code: string; message: string; log_id?: string };

async function api<T>(path: string, accessToken: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`${API}${path}`, {
    ...init,
    headers: { Authorization: `Bearer ${accessToken}`, "Content-Type": "application/json", ...(init?.headers ?? {}) },
  });
  const json = (await res.json()) as { data: T; error?: ApiError };
  if (!res.ok || (json.error && json.error.code !== "ok")) {
    throw new Error(`TikTok API ${path}: ${json.error?.message || res.status} (${json.error?.code ?? "http"})`);
  }
  return json.data;
}

export type TikTokUser = {
  open_id: string;
  display_name?: string;
  avatar_url?: string;
  follower_count?: number;
  following_count?: number;
  likes_count?: number;
  video_count?: number;
};

export async function getTikTokUser(accessToken: string): Promise<TikTokUser> {
  const fields = "open_id,display_name,avatar_url,follower_count,following_count,likes_count,video_count";
  const data = await api<{ user: TikTokUser }>(`/user/info/?fields=${fields}`, accessToken);
  return data.user;
}

export type TikTokVideo = {
  id: string;
  create_time: number; // unix seconds
  title?: string;
  video_description?: string;
  duration?: number;
  cover_image_url?: string;
  share_url?: string;
  view_count?: number;
  like_count?: number;
  comment_count?: number;
  share_count?: number;
};

/** All videos, newest first, following the cursor (max `maxPages` × 20). */
export async function listTikTokVideos(accessToken: string, maxPages = 15): Promise<TikTokVideo[]> {
  const fields =
    "id,create_time,title,video_description,duration,cover_image_url,share_url,view_count,like_count,comment_count,share_count";
  const out: TikTokVideo[] = [];
  let cursor: number | undefined;
  for (let page = 0; page < maxPages; page++) {
    const data = await api<{ videos: TikTokVideo[]; cursor: number; has_more: boolean }>(
      `/video/list/?fields=${fields}`,
      accessToken,
      { method: "POST", body: JSON.stringify(cursor ? { max_count: 20, cursor } : { max_count: 20 }) },
    );
    out.push(...(data.videos ?? []));
    if (!data.has_more) break;
    cursor = data.cursor;
  }
  return out;
}
