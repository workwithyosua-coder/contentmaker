import "server-only";

// Google OAuth 2.0 (web server flow) + YouTube Data API v3 + YouTube Analytics API v2.
export const YOUTUBE_SCOPES = [
  "https://www.googleapis.com/auth/youtube.readonly",
  "https://www.googleapis.com/auth/yt-analytics.readonly",
];

export function youtubeConfigured() {
  return Boolean(process.env.GOOGLE_CLIENT_ID && process.env.GOOGLE_CLIENT_SECRET);
}

function creds() {
  const clientId = process.env.GOOGLE_CLIENT_ID?.trim();
  const clientSecret = process.env.GOOGLE_CLIENT_SECRET?.trim();
  if (!clientId || !clientSecret) throw new Error("GOOGLE_CLIENT_ID / GOOGLE_CLIENT_SECRET are not set in Vercel.");
  return { clientId, clientSecret };
}

export const youtubeRedirectUri = (origin: string) => `${origin}/api/connect/youtube/callback`;

export function youtubeAuthorizeUrl(origin: string, state: string) {
  const u = new URL("https://accounts.google.com/o/oauth2/v2/auth");
  u.searchParams.set("client_id", creds().clientId);
  u.searchParams.set("redirect_uri", youtubeRedirectUri(origin));
  u.searchParams.set("response_type", "code");
  u.searchParams.set("scope", YOUTUBE_SCOPES.join(" "));
  u.searchParams.set("access_type", "offline"); // we need a refresh token for daily syncs
  u.searchParams.set("prompt", "consent"); // always return a refresh token, also on reconnect
  u.searchParams.set("include_granted_scopes", "true");
  u.searchParams.set("state", state);
  return u.toString();
}

export type GoogleToken = { access_token: string; expires_in: number; refresh_token?: string; scope: string };

async function tokenRequest(body: Record<string, string>): Promise<GoogleToken> {
  const res = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams(body),
  });
  const json = (await res.json()) as Partial<GoogleToken> & { error?: string; error_description?: string };
  if (!res.ok || !json.access_token) throw new Error(`Google token error: ${json.error_description || json.error || res.status}`);
  return json as GoogleToken;
}

export function exchangeGoogleCode(code: string, origin: string) {
  const { clientId, clientSecret } = creds();
  return tokenRequest({
    code,
    client_id: clientId,
    client_secret: clientSecret,
    redirect_uri: youtubeRedirectUri(origin),
    grant_type: "authorization_code",
  });
}

export function refreshGoogleToken(refreshToken: string) {
  const { clientId, clientSecret } = creds();
  return tokenRequest({ refresh_token: refreshToken, client_id: clientId, client_secret: clientSecret, grant_type: "refresh_token" });
}

async function gapi<T>(url: string, token: string): Promise<T> {
  const res = await fetch(url, { headers: { Authorization: `Bearer ${token}` }, cache: "no-store" });
  const json = (await res.json()) as T & { error?: { message?: string } };
  if (!res.ok || json.error) throw new Error(`YouTube API: ${json.error?.message ?? res.status}`);
  return json;
}

const YT = "https://www.googleapis.com/youtube/v3";

export type YtChannel = {
  id: string;
  title: string;
  thumbnail?: string;
  subscribers?: number;
  uploadsPlaylist?: string;
};

export async function getMyChannel(token: string): Promise<YtChannel | null> {
  const data = await gapi<{
    items?: {
      id: string;
      snippet: { title: string; thumbnails?: Record<string, { url: string }> };
      statistics?: { subscriberCount?: string; hiddenSubscriberCount?: boolean };
      contentDetails?: { relatedPlaylists?: { uploads?: string } };
    }[];
  }>(`${YT}/channels?part=snippet,statistics,contentDetails&mine=true`, token);
  const c = data.items?.[0];
  if (!c) return null;
  return {
    id: c.id,
    title: c.snippet.title,
    thumbnail: c.snippet.thumbnails?.default?.url ?? c.snippet.thumbnails?.medium?.url,
    subscribers: c.statistics?.subscriberCount ? Number(c.statistics.subscriberCount) : undefined,
    uploadsPlaylist: c.contentDetails?.relatedPlaylists?.uploads,
  };
}

export type YtVideo = {
  id: string;
  title: string;
  description: string;
  publishedAt: string;
  durationS: number;
  thumbnail?: string;
  views?: number;
  likes?: number;
  comments?: number;
};

/** "PT1M5S" → 65 */
export function isoDurationToSeconds(iso: string) {
  const m = /P(?:(\d+)D)?T?(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?/.exec(iso);
  if (!m) return 0;
  return Number(m[1] ?? 0) * 86400 + Number(m[2] ?? 0) * 3600 + Number(m[3] ?? 0) * 60 + Number(m[4] ?? 0);
}

/** Every upload (newest first, up to maxPages × 50) with its public stats. */
export async function listMyVideos(token: string, uploadsPlaylist: string, maxPages = 6): Promise<YtVideo[]> {
  const ids: string[] = [];
  let pageToken = "";
  for (let i = 0; i < maxPages; i++) {
    const data = await gapi<{ items?: { contentDetails: { videoId: string } }[]; nextPageToken?: string }>(
      `${YT}/playlistItems?part=contentDetails&maxResults=50&playlistId=${uploadsPlaylist}${pageToken ? `&pageToken=${pageToken}` : ""}`,
      token,
    );
    ids.push(...(data.items ?? []).map((it) => it.contentDetails.videoId));
    if (!data.nextPageToken) break;
    pageToken = data.nextPageToken;
  }
  const out: YtVideo[] = [];
  for (let i = 0; i < ids.length; i += 50) {
    const data = await gapi<{
      items?: {
        id: string;
        snippet: { title: string; description: string; publishedAt: string; thumbnails?: Record<string, { url: string }> };
        contentDetails: { duration: string };
        statistics?: { viewCount?: string; likeCount?: string; commentCount?: string };
      }[];
    }>(`${YT}/videos?part=snippet,contentDetails,statistics&id=${ids.slice(i, i + 50).join(",")}`, token);
    for (const v of data.items ?? []) {
      out.push({
        id: v.id,
        title: v.snippet.title,
        description: v.snippet.description,
        publishedAt: v.snippet.publishedAt,
        durationS: isoDurationToSeconds(v.contentDetails.duration),
        thumbnail: v.snippet.thumbnails?.medium?.url ?? v.snippet.thumbnails?.default?.url,
        views: v.statistics?.viewCount ? Number(v.statistics.viewCount) : undefined,
        likes: v.statistics?.likeCount ? Number(v.statistics.likeCount) : undefined,
        comments: v.statistics?.commentCount ? Number(v.statistics.commentCount) : undefined,
      });
    }
  }
  return out;
}

export type YtAnalyticsRow = {
  views?: number;
  averageViewDuration?: number;
  averageViewPercentage?: number;
  shares?: number;
  subscribersGained?: number;
};

/** Per-video lifetime analytics for the channel's top videos (by views). Missing metrics are simply absent. */
export async function videoAnalytics(token: string): Promise<Map<string, YtAnalyticsRow>> {
  const today = new Date().toISOString().slice(0, 10);
  const u = new URL("https://youtubeanalytics.googleapis.com/v2/reports");
  u.searchParams.set("ids", "channel==MINE");
  u.searchParams.set("startDate", "2005-01-01");
  u.searchParams.set("endDate", today);
  u.searchParams.set("dimensions", "video");
  u.searchParams.set("metrics", "views,averageViewDuration,averageViewPercentage,shares,subscribersGained");
  u.searchParams.set("sort", "-views");
  u.searchParams.set("maxResults", "200");
  const data = await gapi<{ columnHeaders?: { name: string }[]; rows?: (string | number)[][] }>(u.toString(), token);
  const headers = (data.columnHeaders ?? []).map((h) => h.name);
  const out = new Map<string, YtAnalyticsRow>();
  for (const row of data.rows ?? []) {
    const rec: Record<string, number> = {};
    headers.forEach((h, i) => {
      if (h !== "video") rec[h] = Number(row[i]);
    });
    out.set(String(row[headers.indexOf("video")]), rec);
  }
  return out;
}
