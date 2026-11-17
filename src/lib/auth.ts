// Single-owner password lock. Works in both the proxy (edge-style runtime) and server actions (Web Crypto only).
export const AUTH_COOKIE = "studio_auth";
export const AUTH_MAX_AGE = 60 * 60 * 24 * 90; // 90 days

export async function tokenFor(password: string): Promise<string> {
  const data = new TextEncoder().encode(`studio-auth-v1:${password}`);
  const digest = await crypto.subtle.digest("SHA-256", data);
  return Array.from(new Uint8Array(digest), (b) => b.toString(16).padStart(2, "0")).join("");
}

export function safeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

/** True when the request carries a valid session cookie. Fails closed if APP_PASSWORD is not set. */
export async function isAuthed(cookieValue: string | undefined): Promise<boolean> {
  const password = process.env.APP_PASSWORD;
  if (!password || !cookieValue) return false;
  return safeEqual(cookieValue, await tokenFor(password));
}
