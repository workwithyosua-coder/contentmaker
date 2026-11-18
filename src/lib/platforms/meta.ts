import "server-only";
import { createHmac } from "node:crypto";

// Facebook Login for Business (config_id) + Graph API: Facebook Pages and Instagram (via the linked Page).
const VERSION = process.env.META_GRAPH_VERSION?.trim() || "v26.0";
const GRAPH = `https://graph.facebook.com/${VERSION}`;

export function metaConfigured() {
  return Boolean(process.env.META_APP_ID && process.env.META_APP_SECRET && process.env.META_LOGIN_CONFIG_ID);
}

function creds() {
  const appId = process.env.META_APP_ID?.trim();
  const appSecret = process.env.META_APP_SECRET?.trim();
  const configId = process.env.META_LOGIN_CONFIG_ID?.trim();
  if (!appId || !appSecret || !configId) {
    throw new Error("META_APP_ID / META_APP_SECRET / META_LOGIN_CONFIG_ID are not set in Vercel.");
  }
  return { appId, appSecret, configId };
}

export const metaRedirectUri = (origin: string) => `${origin}/api/connect/meta/callback`;

export function metaAuthorizeUrl(origin: string, state: string) {
  const { appId, configId } = creds();
  const u = new URL(`https://www.facebook.com/${VERSION}/dialog/oauth`);
  u.searchParams.set("client_id", appId);
  u.searchParams.set("redirect_uri", metaRedirectUri(origin));
  u.searchParams.set("state", state);
  u.searchParams.set("response_type", "code");
  u.searchParams.set("config_id", configId);
  return u.toString();
}

export class GraphError extends Error {
  constructor(message: string, public code?: number, public subcode?: number) {
    super(message);
  }
}

/** GET a Graph API path (or a full `paging.next` URL) with appsecret_proof. */
export async function graph<T>(pathOrUrl: string, token: string, params: Record<string, string> = {}): Promise<T> {
  const u = new URL(pathOrUrl.startsWith("http") ? pathOrUrl : `${GRAPH}${pathOrUrl}`);
  for (const [k, v] of Object.entries(params)) u.searchParams.set(k, v);
  u.searchParams.set("access_token", token);
  u.searchParams.set("appsecret_proof", createHmac("sha256", creds().appSecret).update(token).digest("hex"));
  const res = await fetch(u, { cache: "no-store" });
  const json = (await res.json()) as T & { error?: { message: string; code?: number; error_subcode?: number } };
  if (!res.ok || json.error) {
    throw new GraphError(json.error?.message ?? `Graph API ${res.status}`, json.error?.code, json.error?.error_subcode);
  }
  return json;
}

export async function exchangeMetaCode(code: string, origin: string) {
  const { appId, appSecret } = creds();
  const u = new URL(`${GRAPH}/oauth/access_token`);
  u.searchParams.set("client_id", appId);
  u.searchParams.set("client_secret", appSecret);
  u.searchParams.set("redirect_uri", metaRedirectUri(origin));
  u.searchParams.set("code", code);
  const res = await fetch(u, { cache: "no-store" });
  const short = (await res.json()) as { access_token?: string; error?: { message: string } };
  if (!short.access_token) throw new GraphError(short.error?.message ?? "Meta token exchange failed");
  // Long-lived user token → Page tokens derived from it do not expire.
  const long = await graph<{ access_token: string }>("/oauth/access_token", short.access_token, {
    grant_type: "fb_exchange_token",
    client_id: appId,
    client_secret: appSecret,
    fb_exchange_token: short.access_token,
  });
  return long.access_token;
}

export type MetaPage = {
  id: string;
  name: string;
  access_token: string;
  picture?: { data?: { url?: string } };
  instagram_business_account?: { id: string; username?: string; profile_picture_url?: string };
};

export async function listMetaPages(userToken: string): Promise<MetaPage[]> {
  const res = await graph<{ data: MetaPage[] }>("/me/accounts", userToken, {
    fields: "id,name,access_token,picture{url},instagram_business_account{id,username,profile_picture_url}",
    limit: "100",
  });
  return res.data ?? [];
}

type InsightRow = { name: string; values?: { value: unknown }[]; total_value?: { value: unknown } };

/**
 * Best-effort insights: asks for all metrics at once; if Meta rejects one (renamed/unsupported for this media type),
 * retries each metric alone and skips the ones that fail. `unsupported` remembers failures across a sync run.
 */
export async function insightsBestEffort(
  objectId: string,
  token: string,
  metrics: string[],
  unsupported: Set<string>,
  extra: Record<string, string> = {},
): Promise<Record<string, number>> {
  const wanted = metrics.filter((m) => !unsupported.has(m));
  const out: Record<string, number> = {};
  const read = (rows: InsightRow[]) => {
    for (const r of rows) {
      const v = r.total_value?.value ?? r.values?.[0]?.value;
      if (typeof v === "number") out[r.name] = v;
    }
  };
  if (!wanted.length) return out;
  try {
    read((await graph<{ data: InsightRow[] }>(`/${objectId}/insights`, token, { metric: wanted.join(","), ...extra })).data);
    return out;
  } catch {
    for (const m of wanted) {
      try {
        read((await graph<{ data: InsightRow[] }>(`/${objectId}/insights`, token, { metric: m, ...extra })).data);
      } catch {
        unsupported.add(m);
      }
    }
    return out;
  }
}

/** POST to a Graph API path (form-encoded) with appsecret_proof. */
export async function graphPost<T>(path: string, token: string, params: Record<string, string> = {}): Promise<T> {
  const body = new URLSearchParams(params);
  body.set("access_token", token);
  body.set("appsecret_proof", createHmac("sha256", creds().appSecret).update(token).digest("hex"));
  const res = await fetch(`${GRAPH}${path}`, { method: "POST", body, cache: "no-store" });
  const json = (await res.json()) as T & { error?: { message: string; code?: number; error_subcode?: number; error_user_msg?: string } };
  if (!res.ok || json.error) {
    throw new GraphError(json.error?.error_user_msg || json.error?.message || `Graph API ${res.status}`, json.error?.code, json.error?.error_subcode);
  }
  return json;
}

/** Validity and granted permissions of a (Page) token, via the app token. */
export async function debugToken(token: string) {
  const { appId, appSecret } = creds();
  const u = new URL(`${GRAPH}/debug_token`);
  u.searchParams.set("input_token", token);
  u.searchParams.set("access_token", `${appId}|${appSecret}`);
  const res = await fetch(u, { cache: "no-store", signal: AbortSignal.timeout(8000) });
  const json = (await res.json().catch(() => ({}))) as {
    data?: { is_valid?: boolean; scopes?: string[]; expires_at?: number; error?: { message?: string } };
    error?: { message?: string; code?: number };
  };
  // Only Meta saying is_valid: false means the login is bad. An error from the check itself (rate limit, app token
  // problem, outage) says nothing about the login, so it's reported as unknown rather than "expired".
  if (!res.ok || json.error || typeof json.data?.is_valid !== "boolean") {
    return { valid: null, scopes: null, expiresAt: null, error: json.error?.message ?? `debug_token HTTP ${res.status}` };
  }
  return {
    valid: json.data.is_valid,
    scopes: json.data.scopes ?? [],
    expiresAt: json.data.expires_at || null,
    error: json.data.is_valid ? null : (json.data.error?.message ?? null),
  };
}

export const GRAPH_VERSION = VERSION;
