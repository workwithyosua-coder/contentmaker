import { db } from "@/lib/db";
import { safeEqual } from "@/lib/auth";
import { deleteObjects, putObject, signedUrl, storageDriver } from "@/lib/storage";

// Diagnostic endpoint: GET /api/health with header `x-health-token: <HEALTH_TOKEN>`.
// Excluded from the password proxy, protected by its own token instead. Fails closed if HEALTH_TOKEN is unset.
export async function GET(request: Request) {
  const expected = process.env.HEALTH_TOKEN;
  const given = request.headers.get("x-health-token") ?? "";
  if (!expected || !safeEqual(given, expected)) return new Response("Not found", { status: 404 });

  const started = Date.now();
  const timeout = new Promise<never>((_, reject) => setTimeout(() => reject(new Error("timed out after 15s")), 15_000));
  try {
    const [row] = await Promise.race([
      db()<{ users: number; posts: number; now: Date }[]>`
        SELECT (SELECT count(*)::int FROM users) AS users, (SELECT count(*)::int FROM posts) AS posts, now()`,
      timeout,
    ]);
    // ?storage=1: round-trip a tiny file through the private recordings bucket
    let storage: unknown = undefined;
    if (new URL(request.url).searchParams.get("storage") === "1") {
      const path = `_healthcheck/${Date.now()}.webm`;
      try {
        await putObject(path, new Uint8Array([26, 69, 223, 163]).buffer, "audio/webm");
        const url = await signedUrl(path, 60);
        const res = await fetch(url);
        storage = { ok: res.ok, status: res.status, bytes: (await res.arrayBuffer()).byteLength, driver: storageDriver() };
      } catch (err) {
        storage = { ok: false, error: err instanceof Error ? err.message : String(err), driver: storageDriver() };
      } finally {
        await deleteObjects([path]).catch(() => {});
      }
    }
    return Response.json({
      db: "ok",
      storage,
      ms: Date.now() - started,
      users: row.users,
      posts: row.posts,
      region: process.env.VERCEL_REGION ?? null,
      hasAnthropicKey: Boolean(process.env.ANTHROPIC_API_KEY),
      // The TikTok client key is public (it appears in the login URL); the secret is never shown.
      tiktok: {
        clientKey: process.env.TIKTOK_CLIENT_KEY ?? null,
        clientKeyHasWhitespace: /\s/.test(process.env.TIKTOK_CLIENT_KEY ?? ""),
        secretLength: process.env.TIKTOK_CLIENT_SECRET?.length ?? 0,
        secretHasWhitespace: /\s/.test(process.env.TIKTOK_CLIENT_SECRET ?? ""),
      },
      google: {
        clientIdLooksValid: /^[\w-]+\.apps\.googleusercontent\.com$/.test(process.env.GOOGLE_CLIENT_ID ?? ""),
        secretLength: process.env.GOOGLE_CLIENT_SECRET?.length ?? 0,
        secretHasWhitespace: /\s/.test(process.env.GOOGLE_CLIENT_SECRET ?? ""),
      },
      meta: {
        appIdLooksValid: /^\d+$/.test(process.env.META_APP_ID ?? ""),
        configIdLooksValid: /^\d+$/.test(process.env.META_LOGIN_CONFIG_ID ?? ""),
      },
    });
  } catch (err) {
    const e = err as { message?: string; code?: string };
    console.error("[health] database check failed:", e?.code, e?.message);
    return Response.json(
      { db: "error", ms: Date.now() - started, code: e?.code ?? null, message: e?.message ?? String(err), region: process.env.VERCEL_REGION ?? null },
      { status: 500 },
    );
  }
}
